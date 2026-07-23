import { initializeApp, getApps, getApp } from "firebase/app";
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult,
  signOut as fbSignOut,
  onAuthStateChanged, User
} from "firebase/auth";
import {
  getFirestore,
  collection,
  doc,
  setDoc,
  query,
  where,
  onSnapshot,
  updateDoc,
  deleteDoc,
  Timestamp,
  Unsubscribe,
  getDoc,
  getDocs,
  runTransaction,
  deleteField,
} from "firebase/firestore";
import {
  getStorage, ref, uploadBytesResumable, getDownloadURL, getBytes, deleteObject,
  UploadTaskSnapshot, uploadBytes, getMetadata
} from "firebase/storage";

import { firebaseConfig } from "@/lib/firebasePublic";
import {
  applyLineOps,
  approxOpBytes,
  diffLines,
  editCharDelta,
  summarizeLineOps,
  type LineOp,
} from "@/lib/textDiff";

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
export const auth = getAuth(app);

/**
 * Memory-only Firestore. IndexedDB persistence was disabled after it crashed
 * whiteboard tabs/iframes on refresh (Chrome "This page couldn't load"),
 * especially with parent + embed=1 both opening the same persistent cache.
 */
export const db = getFirestore(app);
export const storage = getStorage(app);

const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: "select_account" });

// Complete redirect-based Google sign-in when an intentional redirect was used.
if (typeof window !== "undefined") {
  void getRedirectResult(auth).catch((err) => {
    console.warn("[auth] getRedirectResult", err);
  });
}

function authErrorCode(err: unknown): string {
  if (err && typeof err === "object" && "code" in err) {
    return String((err as { code?: string }).code || "");
  }
  return "";
}

export function authErrorMessage(err: unknown): string {
  const code = authErrorCode(err);
  if (code === "auth/popup-blocked") {
    return "瀏覽器擋下登入視窗，請允許彈出視窗後再試一次";
  }
  if (code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request") {
    return "已取消登入";
  }
  if (code === "auth/unauthorized-domain") {
    return "此網域尚未加入 Firebase 授權網域，請聯絡管理員";
  }
  if (err instanceof Error && err.message) return err.message;
  return "Google 登入失敗，請再試一次";
}

// ─── Auth ────────────────────────────────────────────────────
/**
 * Prefer popup. Do NOT blindly fall back to redirect on Vercel/custom domains —
 * redirect needs same-origin `/__/auth` proxy (we don't have it), so it silently fails.
 * Opt-in: NEXT_PUBLIC_AUTH_USE_REDIRECT=1
 */
export const loginWithGoogle = async () => {
  try {
    return await signInWithPopup(auth, googleProvider);
  } catch (err: unknown) {
    const code = authErrorCode(err);
    if (
      code === "auth/popup-closed-by-user" ||
      code === "auth/cancelled-popup-request" ||
      code === "auth/user-cancelled"
    ) {
      return null;
    }
    if (code === "auth/unauthorized-domain") {
      throw err;
    }
    const allowRedirect = process.env.NEXT_PUBLIC_AUTH_USE_REDIRECT === "1";
    if (allowRedirect && code === "auth/popup-blocked") {
      await signInWithRedirect(auth, googleProvider);
      return null;
    }
    throw err;
  }
};
export const logout = () => fbSignOut(auth);
export { onAuthStateChanged };
export type { User, Unsubscribe };

// ─── Job types ───────────────────────────────────────────────
export interface Job {
  id: string;
  user_id: string;
  created_at: Date;
  status: "uploading" | "queued" | "processing" | "done" | "error";
  progress: number;
  current_file: number;
  total_files: number;
  source_type: "upload" | "youtube";
  filenames: string[];
  youtube_url: string;
  /** Whisper language code or "None" for auto-detect */
  language?: string;
  /** User-editable display name; falls back to filename / YouTube URL */
  title?: string;
  storage_paths: string[];
  result_paths: string[];
  transcripts: { filename: string; text: string }[];
  error_message: string;
  position_label?: string;
  queue_ahead?: number;
}

export function jobDisplayTitle(
  job: Pick<Job, "title" | "filenames" | "youtube_url">
): string {
  const custom = (job.title || "").trim();
  if (custom && !/^https?:\/\//i.test(custom)) return custom;
  const fn = (job.filenames?.[0] || "").trim();
  if (fn && !/^https?:\/\//i.test(fn)) return fn;
  return "逐字稿";
}

/** Fetch YouTube video title via oEmbed (no API key). */
export async function fetchYoutubeTitle(url: string): Promise<string | null> {
  const raw = (url || "").trim();
  if (!raw || !/^https?:\/\//i.test(raw)) return null;
  try {
    const u = new URL("https://www.youtube.com/oembed");
    u.searchParams.set("url", raw);
    u.searchParams.set("format", "json");
    const res = await fetch(u.toString());
    if (!res.ok) return null;
    const data = (await res.json()) as { title?: string };
    const title = (data.title || "").trim();
    return title || null;
  } catch {
    return null;
  }
}

export async function updateJobTitle(jobId: string, title: string) {
  await updateDoc(doc(db, "jobs", jobId), { title: title.trim() });
}

// ─── Firestore helpers ───────────────────────────────────────
export async function createJob(
  uid: string,
  sourceType: "upload" | "youtube",
  filenames: string[],
  youtubeUrl: string = "",
  title: string = ""
): Promise<string> {
  const jobId = `${uid}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const jobRef = doc(db, "jobs", jobId);
  const displayTitle = (title || "").trim();
  await setDoc(jobRef, {
    user_id: uid,
    created_at: Timestamp.now(),
    status: "uploading",
    progress: 0,
    current_file: 0,
    total_files: filenames.length,
    source_type: sourceType,
    filenames,
    youtube_url: youtubeUrl,
    ...(displayTitle ? { title: displayTitle } : {}),
    storage_paths: [],
    result_paths: [],
    transcripts: [],
    error_message: "",
  });
  return jobId;
}

export async function updateJobStatus(
  jobId: string,
  updates: Partial<Omit<Job, "id">>
) {
  const jobRef = doc(db, "jobs", jobId);
  await updateDoc(jobRef, updates as Record<string, unknown>);
}

export function listenToJob(
  jobId: string,
  callback: (job: Job) => void
): Unsubscribe {
  const jobRef = doc(db, "jobs", jobId);
  return onSnapshot(jobRef, (snap) => {
    if (snap.exists()) {
      const data = snap.data();
      callback({
        id: snap.id,
        ...data,
        created_at: data.created_at?.toDate?.() || new Date(),
      } as Job);
    }
  });
}

export function listenToUserJobs(
  uid: string,
  callback: (jobs: Job[]) => void
): Unsubscribe {
  // No orderBy here: combining where(==) + orderBy(other field) requires a
  // Firestore composite index, which silently breaks the query if not created.
  // We sort client-side by created_at desc instead — no index needed.
  const q = query(collection(db, "jobs"), where("user_id", "==", uid));
  return onSnapshot(
    q,
    (snap) => {
      const jobs = snap.docs.map((d) => {
        const data = d.data();
        return {
          id: d.id,
          ...data,
          created_at: data.created_at?.toDate?.() || new Date(),
        } as Job;
      });
      jobs.sort((a, b) => b.created_at.getTime() - a.created_at.getTime());
      callback(jobs);
    },
    (err) => {
      console.error("[listenToUserJobs] snapshot error:", err);
    }
  );
}

export async function deleteJob(jobId: string, storagePaths: string[], resultPaths: string[]) {
  const allPaths = [...storagePaths, ...resultPaths];
  let released = 0;
  let ownerUid: string | null = null;
  const { uidFromUploadPath, releaseStorageUsage } = await import("@/lib/storageQuota");
  for (const p of allPaths) {
    try {
      if (!ownerUid) ownerUid = uidFromUploadPath(p);
      const fileRef = ref(storage, p);
      try {
        const meta = await getMetadata(fileRef);
        released += Math.max(0, Number(meta.size) || 0);
      } catch {
        /* ignore */
      }
      await deleteObject(fileRef);
    } catch {
      /* ignore */
    }
  }
  if (ownerUid && released > 0) {
    try {
      await releaseStorageUsage(ownerUid, released);
    } catch {
      /* ignore */
    }
  }
  await deleteDoc(doc(db, "jobs", jobId));
}

// ─── Storage helpers ─────────────────────────────────────────
export function uploadFile(
  path: string,
  file: File | Blob,
  onProgress?: (pct: number) => void
): Promise<string> {
  return new Promise((resolve, reject) => {
    void (async () => {
      try {
        const { uidFromUploadPath, assertCanUpload, addStorageUsage } = await import(
          "@/lib/storageQuota"
        );
        const uid = uidFromUploadPath(path);
        const size = "size" in file ? Number(file.size) || 0 : 0;
        if (uid && size > 0) {
          await assertCanUpload(uid, size);
        }
        const storageRef = ref(storage, path);
        const task = uploadBytesResumable(storageRef, file);
        task.on(
          "state_changed",
          (snap: UploadTaskSnapshot) => {
            const pct = Math.round((snap.bytesTransferred / snap.totalBytes) * 100);
            onProgress?.(pct);
          },
          reject,
          async () => {
            try {
              if (uid && size > 0) await addStorageUsage(uid, size);
            } catch {
              /* ignore quota bookkeeping */
            }
            const url = await getDownloadURL(task.snapshot.ref);
            resolve(url);
          }
        );
      } catch (e) {
        reject(e);
      }
    })();
  });
}

/** Upload media attached to a note under uploads/{uid}/notes/{noteId}/… */
export async function uploadNoteMedia(
  uid: string,
  noteId: string,
  file: File,
  onProgress?: (pct: number) => void
): Promise<{ url: string; path: string; name: string; contentType: string }> {
  const safe = file.name.replace(/[^\w.\u4e00-\u9fff-]+/g, "_").slice(0, 80);
  const path = `uploads/${uid}/notes/${noteId}/${Date.now()}_${safe}`;
  const url = await uploadFile(path, file, onProgress);
  return {
    url,
    path,
    name: file.name,
    contentType: file.type || "application/octet-stream",
  };
}

/** Upload media for a whiteboard under uploads/{uid}/canvases/{canvasId}/… */
export async function uploadCanvasMedia(
  uid: string,
  canvasId: string,
  file: File,
  onProgress?: (pct: number) => void
): Promise<{ url: string; path: string; name: string; contentType: string }> {
  const safe = file.name.replace(/[^\w.\u4e00-\u9fff-]+/g, "_").slice(0, 80);
  const path = `uploads/${uid}/canvases/${canvasId}/${Date.now()}_${safe}`;
  const url = await uploadFile(path, file, onProgress);
  return {
    url,
    path,
    name: file.name,
    contentType: file.type || "application/octet-stream",
  };
}

export type MediaKind = "image" | "audio" | "video" | "file";

export function detectMediaKind(file: File): MediaKind {
  const t = file.type || "";
  if (t.startsWith("image/")) return "image";
  if (t.startsWith("audio/")) return "audio";
  if (t.startsWith("video/")) return "video";
  return "file";
}

export async function getFileUrl(path: string): Promise<string> {
  return getDownloadURL(ref(storage, path));
}

// Fetch a stored .txt transcript's text content directly.
export async function getResultText(path: string): Promise<string> {
  const bytes = await getBytes(ref(storage, path));
  return new TextDecoder("utf-8").decode(bytes);
}

export async function saveJobTranscripts(
  jobId: string,
  uid: string,
  transcripts: { filename: string; text: string }[],
  resultPaths: string[] = []
): Promise<void> {
  const INLINE_LIMIT = 700_000;
  const combined = transcripts.reduce((n, t) => n + new TextEncoder().encode(t.text).length, 0);

  const newPaths: string[] = [];
  for (let i = 0; i < transcripts.length; i++) {
    const t = transcripts[i];
    const existing = resultPaths[i];
    const path = existing || `results/${uid}/${jobId}/${t.filename.replace(/\.[^/.]+$/, "") || "transcript"}.txt`;
    await uploadBytes(ref(storage, path), new Blob([t.text], { type: "text/plain;charset=utf-8" }));
    newPaths.push(path);
  }

  await updateDoc(doc(db, "jobs", jobId), {
    transcripts: combined <= INLINE_LIMIT ? transcripts : [],
    result_paths: newPaths,
  });
}

// ─── Notes ───────────────────────────────────────────────────
export interface Note {
  id: string;
  user_id: string;
  title: string;
  body_md: string;
  tags: string[];
  folder?: string;
  journal_date?: string;
  /** kanban status */
  status?: "backlog" | "doing" | "done" | "";
  source_job_id?: string;
  /** page chrome */
  icon?: string;
  /** accent color id for sidebar / title (see pageChrome) */
  color?: string;
  cover?: string;
  /** nested under another note */
  parent_id?: string;
  /** Manual sidebar order within folder / parent (lower = higher) */
  sort_order?: number;
  /** Canva-lite slide deck JSON */
  deck?: Record<string, unknown> | null;
  /** Cadence database row membership */
  database_id?: string;
  /** Custom property values keyed by property id */
  props?: Record<string, unknown>;
  /** Public share settings */
  share?: {
    enabled: boolean;
    token: string;
    mode: "view" | "edit" | "copy";
  };
  /** Link to a separate app resource (board / canvas / graph / database) */
  app_link?: {
    type: "board" | "canvas" | "graph" | "database" | "web" | "extension";
    id: string;
  };
  created_at: Date;
  updated_at: Date;
}

export async function createNote(
  uid: string,
  title: string,
  bodyMd: string,
  sourceJobId?: string,
  tags: string[] = [],
  extra?: {
    folder?: string;
    journal_date?: string;
    status?: Note["status"];
    icon?: string;
    color?: string;
    cover?: string;
    parent_id?: string;
    database_id?: string;
    props?: Record<string, unknown>;
    app_link?: Note["app_link"];
    sort_order?: number;
  }
): Promise<string> {
  const id = `${uid}_n_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  await setDoc(doc(db, "notes", id), {
    user_id: uid,
    title: title || "未命名筆記",
    body_md: bodyMd,
    tags,
    folder: extra?.folder || "",
    journal_date: extra?.journal_date || "",
    status: extra?.status || "backlog",
    source_job_id: sourceJobId || "",
    icon: extra?.icon || "",
    color: extra?.color || "",
    cover: extra?.cover || "",
    parent_id: extra?.parent_id || "",
    sort_order: typeof extra?.sort_order === "number" ? extra.sort_order : Date.now(),
    database_id: extra?.database_id || "",
    props: extra?.props || {},
    ...(extra?.app_link ? { app_link: extra.app_link } : {}),
    created_at: Timestamp.now(),
    updated_at: Timestamp.now(),
  });
  return id;
}

export class NoteConflictError extends Error {
  remote: Note;
  constructor(remote: Note) {
    super("NOTE_CONFLICT");
    this.name = "NoteConflictError";
    this.remote = remote;
  }
}

function noteFromSnap(id: string, data: Record<string, unknown>): Note {
  const appLink =
    data.app_link && typeof data.app_link === "object"
      ? (data.app_link as Note["app_link"])
      : undefined;
  const created = data.created_at as { toDate?: () => Date } | Date | undefined;
  const updated = data.updated_at as { toDate?: () => Date } | Date | undefined;
  return {
    id,
    ...(data as Omit<Note, "id" | "created_at" | "updated_at" | "app_link">),
    app_link: appLink,
    created_at: (created && typeof created === "object" && "toDate" in created && created.toDate
      ? created.toDate()
      : created instanceof Date
        ? created
        : new Date()) as Date,
    updated_at: (updated && typeof updated === "object" && "toDate" in updated && updated.toDate
      ? updated.toDate()
      : updated instanceof Date
        ? updated
        : new Date()) as Date,
  };
}

export type NoteUpdateFields = Partial<
  Pick<
    Note,
    | "title"
    | "body_md"
    | "tags"
    | "folder"
    | "journal_date"
    | "status"
    | "icon"
    | "color"
    | "cover"
    | "parent_id"
    | "sort_order"
    | "deck"
    | "database_id"
    | "props"
    | "share"
    | "source_job_id"
    | "app_link"
  >
>;

export async function updateNote(
  noteId: string,
  updates: NoteUpdateFields,
  options?: {
    silent?: boolean;
    /** Conflict if cloud `updated_at` is newer than this ms / Date */
    expectedUpdatedAt?: number | Date;
    /** Skip conflict check and overwrite */
    force?: boolean;
  }
): Promise<{ updatedAt: number }> {
  const now = Timestamp.now();
  const payload: Record<string, unknown> = { ...updates };
  if (!options?.silent) payload.updated_at = now;
  const updatedAtMs = now.toMillis();

  const expectedMs =
    options?.expectedUpdatedAt == null
      ? null
      : typeof options.expectedUpdatedAt === "number"
        ? options.expectedUpdatedAt
        : options.expectedUpdatedAt.getTime();

  const useConflictCheck =
    !options?.force && !options?.silent && expectedMs != null && Number.isFinite(expectedMs);

  if (!useConflictCheck) {
    await updateDoc(doc(db, "notes", noteId), payload);
    return { updatedAt: updatedAtMs };
  }

  let adoptedRemoteMs: number | null = null;
  await runTransaction(db, async (tx) => {
    const ref = doc(db, "notes", noteId);
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error("筆記不存在");
    const data = snap.data() as Record<string, unknown>;
    const remoteTs = data.updated_at as { toMillis?: () => number } | undefined;
    const remoteMs = remoteTs?.toMillis?.() ?? 0;
    if (remoteMs > expectedMs!) {
      const remote = noteFromSnap(snap.id, data);
      // Same payload already on cloud (overlapping identical write) — adopt remote clock.
      const sameBody =
        updates.body_md === undefined || updates.body_md === remote.body_md;
      const sameTitle = updates.title === undefined || updates.title === remote.title;
      if (sameBody && sameTitle) {
        adoptedRemoteMs = remoteMs;
        return;
      }
      throw new NoteConflictError(remote);
    }
    adoptedRemoteMs = null;
    tx.update(ref, payload);
  });
  return { updatedAt: adoptedRemoteMs ?? updatedAtMs };
}

/** Append markdown while a live session writes off the open editor (cross-page recording). */
export async function appendNoteMarkdown(noteId: string, md: string): Promise<void> {
  if (!md) return;
  const ref = doc(db, "notes", noteId);
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error("筆記不存在");
    const data = snap.data() as Record<string, unknown>;
    const body = String(data.body_md || "");
    tx.update(ref, {
      body_md: `${body}${md}`,
      updated_at: Timestamp.now(),
    });
  });
}

export async function getNote(noteId: string): Promise<Note | null> {
  const snap = await getDoc(doc(db, "notes", noteId));
  if (!snap.exists()) return null;
  return noteFromSnap(snap.id, snap.data() as Record<string, unknown>);
}

export function listenToNote(
  noteId: string,
  callback: (note: Note | null) => void
): Unsubscribe {
  return onSnapshot(doc(db, "notes", noteId), (snap) => {
    if (!snap.exists()) {
      callback(null);
      return;
    }
    callback(noteFromSnap(snap.id, snap.data() as Record<string, unknown>));
  });
}

export function listenToUserNotes(uid: string, callback: (notes: Note[]) => void): Unsubscribe {
  const q = query(collection(db, "notes"), where("user_id", "==", uid));
  return onSnapshot(q, (snap) => {
    const notes = snap.docs.map((d) => noteFromSnap(d.id, d.data() as Record<string, unknown>));
    notes.sort((a, b) => b.updated_at.getTime() - a.updated_at.getTime());
    callback(notes);
  });
}

export async function deleteNote(noteId: string) {
  await deleteDoc(doc(db, "notes", noteId));
}

export type NoteVersion = {
  id: string;
  title: string;
  body_md: string;
  created_at: Date;
  kind?: "full" | "delta";
  summary?: string;
};

const VERSION_KEEP = 30;
/** Prefer delta snapshots unless this long since last version (or force). */
const VERSION_MIN_INTERVAL_MS = 5 * 60 * 1000;
const VERSION_MIN_EDIT_CHARS = 80;

type VersionRaw = {
  id: string;
  kind: "full" | "delta";
  title: string;
  body_md: string;
  delta: LineOp[] | null;
  summary: string;
  created_at: Date;
};

function versionFromSnap(id: string, data: Record<string, unknown>): VersionRaw {
  const kind = data.kind === "delta" ? "delta" : "full";
  return {
    id,
    kind,
    title: String(data.title || ""),
    body_md: String(data.body_md || ""),
    delta: Array.isArray(data.delta) ? (data.delta as LineOp[]) : null,
    summary: String(data.summary || ""),
    created_at: (data.created_at as { toDate?: () => Date } | undefined)?.toDate?.() || new Date(),
  };
}

async function loadVersionRaws(noteId: string): Promise<VersionRaw[]> {
  const res = await getDocs(collection(db, "notes", noteId, "versions"));
  const list = res.docs.map((d) => versionFromSnap(d.id, d.data() as Record<string, unknown>));
  list.sort((a, b) => a.created_at.getTime() - b.created_at.getTime());
  return list;
}

/** Resolve delta chain → newest-first versions with full body_md for UI restore. */
function resolveVersionBodies(rawsAsc: VersionRaw[]): NoteVersion[] {
  const resolved: NoteVersion[] = [];
  let body = "";
  for (const v of rawsAsc) {
    if (v.kind === "full" || !v.delta) {
      body = v.body_md;
    } else {
      body = applyLineOps(body, v.delta);
    }
    resolved.push({
      id: v.id,
      title: v.title,
      body_md: body,
      created_at: v.created_at,
      kind: v.kind,
      summary: v.summary || (v.kind === "full" ? "完整快照" : "變更紀錄"),
    });
  }
  return resolved.reverse();
}

async function pruneNoteVersions(noteId: string, rawsAsc: VersionRaw[]) {
  if (rawsAsc.length <= VERSION_KEEP) return;
  const drop = rawsAsc.slice(0, rawsAsc.length - VERSION_KEEP);
  // Ensure the oldest kept entry can stand alone: materialize to full if it is a delta.
  const keptOldest = rawsAsc[rawsAsc.length - VERSION_KEEP];
  if (keptOldest?.kind === "delta") {
    const resolved = resolveVersionBodies(rawsAsc);
    const full = resolved.find((v) => v.id === keptOldest.id);
    if (full) {
      await setDoc(doc(db, "notes", noteId, "versions", keptOldest.id), {
        kind: "full",
        title: full.title,
        body_md: full.body_md,
        summary: "完整快照",
        created_at: Timestamp.fromDate(keptOldest.created_at),
        delta: deleteField(),
      });
    }
  }
  await Promise.all(drop.map((v) => deleteDoc(doc(db, "notes", noteId, "versions", v.id))));
}

/**
 * Sparse version history: full snapshot or line-delta vs last stored version.
 * Returns whether a version doc was written.
 */
export async function maybePushNoteVersion(
  noteId: string,
  title: string,
  bodyMd: string,
  opts?: {
    force?: boolean;
    /** Last successfully versioned body (client cache). */
    previousBody?: string;
    previousTitle?: string;
    lastVersionAt?: number;
  }
): Promise<{ written: boolean; at?: number }> {
  const force = !!opts?.force;
  const now = Date.now();
  const prevBody = opts?.previousBody;
  const prevTitle = opts?.previousTitle ?? "";
  const lastAt = opts?.lastVersionAt ?? 0;

  if (!force && lastAt && now - lastAt < VERSION_MIN_INTERVAL_MS) {
    const titleSame = (title || "") === prevTitle;
    const deltaChars = editCharDelta(prevBody ?? bodyMd, bodyMd);
    if (titleSame && deltaChars < VERSION_MIN_EDIT_CHARS) {
      return { written: false };
    }
  }

  if (
    typeof prevBody === "string" &&
    prevBody === bodyMd &&
    (title || "") === prevTitle &&
    !force
  ) {
    return { written: false };
  }

  let kind: "full" | "delta" = "full";
  let delta: LineOp[] | null = null;
  let summary = "完整快照";
  let storeBody = bodyMd;

  if (typeof prevBody === "string" && prevBody.length > 0) {
    const ops = diffLines(prevBody, bodyMd);
    const bytes = approxOpBytes(ops);
    if (bytes > 0 && bytes < bodyMd.length * 0.65) {
      kind = "delta";
      delta = ops;
      summary = summarizeLineOps(ops);
      if ((title || "") !== prevTitle) {
        summary = `標題變更 · ${summary}`;
      }
      storeBody = "";
    }
  }

  const id = `v_${now}`;
  const payload: Record<string, unknown> = {
    kind,
    title,
    summary,
    created_at: Timestamp.now(),
  };
  if (kind === "full") payload.body_md = storeBody;
  else payload.delta = delta;

  await setDoc(doc(db, "notes", noteId, "versions", id), payload);

  try {
    const raws = await loadVersionRaws(noteId);
    await pruneNoteVersions(noteId, raws);
  } catch {
    /* best-effort prune */
  }

  return { written: true, at: now };
}

/** @deprecated Prefer maybePushNoteVersion — kept for rare force-full callers. */
export async function pushNoteVersion(noteId: string, title: string, bodyMd: string) {
  await maybePushNoteVersion(noteId, title, bodyMd, { force: true });
}

export async function listNoteVersions(noteId: string): Promise<NoteVersion[]> {
  const raws = await loadVersionRaws(noteId);
  return resolveVersionBodies(raws).slice(0, VERSION_KEEP);
}

/** Cloud canvas doc under users/{uid}/workspace/canvas */
export async function loadCanvasCloud(uid: string): Promise<Record<string, unknown> | null> {
  const snap = await getDoc(doc(db, "users", uid, "workspace", "canvas"));
  if (!snap.exists()) return null;
  return snap.data() as Record<string, unknown>;
}

export async function saveCanvasCloud(uid: string, data: Record<string, unknown>) {
  await setDoc(
    doc(db, "users", uid, "workspace", "canvas"),
    { ...data, updated_at: Timestamp.now() },
    { merge: true }
  );
}
