import { initializeApp } from "firebase/app";
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, signOut as fbSignOut,
  onAuthStateChanged, User
} from "firebase/auth";
import {
  getFirestore, collection, doc, setDoc,
  query, where, onSnapshot, updateDoc, deleteDoc,
  Timestamp, Unsubscribe, getDoc, getDocs
} from "firebase/firestore";
import {
  getStorage, ref, uploadBytesResumable, getDownloadURL, getBytes, deleteObject,
  UploadTaskSnapshot, uploadBytes
} from "firebase/storage";

const firebaseConfig = {
  apiKey: "AIzaSyCPbw1q2LBbbEsYq1rvvRP7k7Rhwf064kk",
  authDomain: "stt-tool-f6e6d.firebaseapp.com",
  projectId: "stt-tool-f6e6d",
  storageBucket: "stt-tool-f6e6d.firebasestorage.app",
  messagingSenderId: "709725695008",
  appId: "1:709725695008:web:4ffb404811019b00846045",
  measurementId: "G-5B2WVTE54M",
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);

const googleProvider = new GoogleAuthProvider();

// ─── Auth ────────────────────────────────────────────────────
export const loginWithGoogle = async () => {
  try {
    return await signInWithPopup(auth, googleProvider);
  } catch {
    // Popup failed (domain not authorized, popup blocked, etc.) — use redirect
    return signInWithRedirect(auth, googleProvider);
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
  storage_paths: string[];
  result_paths: string[];
  transcripts: { filename: string; text: string }[];
  error_message: string;
  position_label?: string;
  queue_ahead?: number;
}

// ─── Firestore helpers ───────────────────────────────────────
export async function createJob(
  uid: string,
  sourceType: "upload" | "youtube",
  filenames: string[],
  youtubeUrl: string = ""
): Promise<string> {
  const jobId = `${uid}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const jobRef = doc(db, "jobs", jobId);
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
  // Delete files from storage
  const allPaths = [...storagePaths, ...resultPaths];
  for (const p of allPaths) {
    try { await deleteObject(ref(storage, p)); } catch { /* ignore */ }
  }
  // Delete Firestore document
  await deleteDoc(doc(db, "jobs", jobId));
}

// ─── Storage helpers ─────────────────────────────────────────
export function uploadFile(
  path: string,
  file: File,
  onProgress?: (pct: number) => void
): Promise<string> {
  return new Promise((resolve, reject) => {
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
        const url = await getDownloadURL(task.snapshot.ref);
        resolve(url);
      }
    );
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
  cover?: string;
  /** nested under another note */
  parent_id?: string;
  /** Canva-lite slide deck JSON */
  deck?: Record<string, unknown> | null;
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
    cover?: string;
    parent_id?: string;
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
    cover: extra?.cover || "",
    parent_id: extra?.parent_id || "",
    created_at: Timestamp.now(),
    updated_at: Timestamp.now(),
  });
  return id;
}

export async function updateNote(
  noteId: string,
  updates: Partial<
    Pick<
      Note,
      "title" | "body_md" | "tags" | "folder" | "journal_date" | "status" | "icon" | "cover" | "parent_id" | "deck"
    >
  >
) {
  await updateDoc(doc(db, "notes", noteId), {
    ...updates,
    updated_at: Timestamp.now(),
  });
}

export async function getNote(noteId: string): Promise<Note | null> {
  const snap = await getDoc(doc(db, "notes", noteId));
  if (!snap.exists()) return null;
  const data = snap.data();
  return {
    id: snap.id,
    ...data,
    created_at: data.created_at?.toDate?.() || new Date(),
    updated_at: data.updated_at?.toDate?.() || new Date(),
  } as Note;
}

export function listenToUserNotes(uid: string, callback: (notes: Note[]) => void): Unsubscribe {
  const q = query(collection(db, "notes"), where("user_id", "==", uid));
  return onSnapshot(q, (snap) => {
    const notes = snap.docs.map((d) => {
      const data = d.data();
      return {
        id: d.id,
        ...data,
        created_at: data.created_at?.toDate?.() || new Date(),
        updated_at: data.updated_at?.toDate?.() || new Date(),
      } as Note;
    });
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
};

/** Keep last ~30 snapshots under notes/{id}/versions */
export async function pushNoteVersion(noteId: string, title: string, bodyMd: string) {
  const id = `v_${Date.now()}`;
  await setDoc(doc(db, "notes", noteId, "versions", id), {
    title,
    body_md: bodyMd,
    created_at: Timestamp.now(),
  });
}

export async function listNoteVersions(noteId: string): Promise<NoteVersion[]> {
  const res = await getDocs(collection(db, "notes", noteId, "versions"));
  const list = res.docs.map((d) => {
    const data = d.data();
    return {
      id: d.id,
      title: data.title || "",
      body_md: data.body_md || "",
      created_at: data.created_at?.toDate?.() || new Date(),
    } as NoteVersion;
  });
  list.sort((a, b) => b.created_at.getTime() - a.created_at.getTime());
  return list.slice(0, 30);
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
