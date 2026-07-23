/** Note / database public share links */

import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  Timestamp,
  type Unsubscribe,
} from "firebase/firestore";
import { db, createNote, type Note } from "@/lib/firebase";

export type ShareMode = "view" | "edit" | "copy";

export type NoteShare = {
  enabled: boolean;
  token: string;
  mode: ShareMode;
};

export type ShareTokenDoc = {
  note_id: string;
  owner_id: string;
  mode: ShareMode;
  enabled: boolean;
  created_at: Date;
  /** Public snapshot so viewers do not need notes/{id} read access */
  title: string;
  body_md: string;
  icon: string;
  cover: string;
};

function randomToken(): string {
  const bytes = new Uint8Array(16);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function shareUrl(token: string): string {
  if (typeof window === "undefined") return `/share/${token}`;
  return `${window.location.origin}/share/${token}`;
}

export function parseNoteShare(raw: unknown): NoteShare | null {
  if (!raw || typeof raw !== "object") return null;
  const s = raw as Record<string, unknown>;
  if (!s.enabled || typeof s.token !== "string" || !s.token) return null;
  const mode = s.mode === "edit" || s.mode === "copy" || s.mode === "view" ? s.mode : "view";
  return { enabled: true, token: s.token, mode };
}

function mapShareTokenData(token: string, data: Record<string, unknown>): ShareTokenDoc {
  return {
    note_id: String(data.note_id || ""),
    owner_id: String(data.owner_id || ""),
    mode: data.mode === "edit" || data.mode === "copy" ? data.mode : "view",
    enabled: data.enabled !== false,
    created_at: (data.created_at as { toDate?: () => Date })?.toDate?.() || new Date(),
    title: String(data.title || ""),
    body_md: String(data.body_md || ""),
    icon: String(data.icon || ""),
    cover: String(data.cover || ""),
  };
}

/** Build a Note-shaped object from the public share_tokens snapshot. */
export function noteFromShareToken(token: string, link: ShareTokenDoc): Note {
  return {
    id: link.note_id,
    user_id: link.owner_id,
    title: link.title,
    body_md: link.body_md,
    tags: [],
    folder: "",
    journal_date: "",
    status: "",
    source_job_id: "",
    icon: link.icon,
    cover: link.cover,
    parent_id: "",
    deck: null,
    share: { enabled: true, token, mode: link.mode },
    created_at: link.created_at,
    updated_at: link.created_at,
  };
}

async function writeShareTokenDoc(
  token: string,
  noteId: string,
  ownerId: string,
  mode: ShareMode,
  noteData?: Record<string, unknown> | null,
  isNewToken = false
): Promise<void> {
  const data = noteData || (await getDoc(doc(db, "notes", noteId))).data() || {};
  const payload: Record<string, unknown> = {
    note_id: noteId,
    owner_id: ownerId || String(data.user_id || ""),
    mode,
    enabled: true,
    title: String(data.title || ""),
    body_md: String(data.body_md || ""),
    icon: String(data.icon || ""),
    cover: String(data.cover || ""),
    updated_at: Timestamp.now(),
  };
  if (isNewToken) payload.created_at = Timestamp.now();
  await setDoc(doc(db, "share_tokens", token), payload, { merge: true });
}

/** Keep share_tokens snapshot in sync when the owner edits a shared note. */
export async function syncShareTokenSnapshot(noteId: string): Promise<void> {
  const snap = await getDoc(doc(db, "notes", noteId));
  if (!snap.exists()) return;
  const data = snap.data() as Record<string, unknown>;
  const share = parseNoteShare(data.share);
  if (!share?.enabled || !share.token) return;
  await setDoc(
    doc(db, "share_tokens", share.token),
    {
      note_id: noteId,
      owner_id: String(data.user_id || ""),
      mode: share.mode,
      enabled: true,
      title: String(data.title || ""),
      body_md: String(data.body_md || ""),
      icon: String(data.icon || ""),
      cover: String(data.cover || ""),
      updated_at: Timestamp.now(),
    },
    { merge: true }
  );
}

export async function enableNoteShare(
  noteId: string,
  ownerId: string,
  mode: ShareMode,
  existingToken?: string
): Promise<NoteShare> {
  const token = existingToken || randomToken();
  const share: NoteShare = { enabled: true, token, mode };
  const noteSnap = await getDoc(doc(db, "notes", noteId));
  const noteData = noteSnap.exists() ? (noteSnap.data() as Record<string, unknown>) : null;
  await updateDoc(doc(db, "notes", noteId), {
    share,
    updated_at: Timestamp.now(),
  });
  await writeShareTokenDoc(token, noteId, ownerId, mode, noteData, !existingToken);
  return share;
}

export async function setNoteShareMode(
  noteId: string,
  ownerId: string,
  mode: ShareMode,
  token: string
): Promise<NoteShare> {
  return enableNoteShare(noteId, ownerId, mode, token);
}

export async function disableNoteShare(noteId: string, token?: string): Promise<void> {
  await updateDoc(doc(db, "notes", noteId), {
    share: { enabled: false, token: token || "", mode: "view" },
    updated_at: Timestamp.now(),
  });
  if (token) {
    try {
      await deleteDoc(doc(db, "share_tokens", token));
    } catch {
      /* ignore */
    }
  }
}

export async function resolveShareToken(token: string): Promise<ShareTokenDoc | null> {
  const snap = await getDoc(doc(db, "share_tokens", token));
  if (!snap.exists()) return null;
  const data = snap.data() as Record<string, unknown>;
  if (data.enabled === false) return null;
  return mapShareTokenData(token, data);
}

export function listenToShareToken(
  token: string,
  callback: (link: ShareTokenDoc | null) => void
): Unsubscribe {
  return onSnapshot(doc(db, "share_tokens", token), (snap) => {
    if (!snap.exists()) {
      callback(null);
      return;
    }
    const data = snap.data() as Record<string, unknown>;
    if (data.enabled === false) {
      callback(null);
      return;
    }
    callback(mapShareTokenData(token, data));
  });
}

export function mapNoteSnap(id: string, data: Record<string, unknown>): Note {
  return {
    id,
    user_id: String(data.user_id || ""),
    title: String(data.title || ""),
    body_md: String(data.body_md || ""),
    tags: Array.isArray(data.tags) ? (data.tags as string[]) : [],
    folder: String(data.folder || ""),
    journal_date: String(data.journal_date || ""),
    status: (data.status as Note["status"]) || "",
    source_job_id: String(data.source_job_id || ""),
    icon: String(data.icon || ""),
    cover: String(data.cover || ""),
    parent_id: String(data.parent_id || ""),
    deck: (data.deck as Note["deck"]) || null,
    database_id: data.database_id ? String(data.database_id) : undefined,
    props: (data.props as Record<string, unknown>) || undefined,
    share: parseNoteShare(data.share) || undefined,
    created_at: (data.created_at as { toDate?: () => Date })?.toDate?.() || new Date(),
    updated_at: (data.updated_at as { toDate?: () => Date })?.toDate?.() || new Date(),
  };
}

export async function getNoteById(noteId: string): Promise<Note | null> {
  const snap = await getDoc(doc(db, "notes", noteId));
  if (!snap.exists()) return null;
  return mapNoteSnap(snap.id, snap.data() as Record<string, unknown>);
}

export function listenToNote(noteId: string, callback: (note: Note | null) => void): Unsubscribe {
  return onSnapshot(doc(db, "notes", noteId), (snap) => {
    if (!snap.exists()) {
      callback(null);
      return;
    }
    callback(mapNoteSnap(snap.id, snap.data() as Record<string, unknown>));
  });
}

export async function copySharedNoteToUser(
  uid: string,
  source: Note
): Promise<string> {
  return createNote(uid, `${source.title || "未命名"}（副本）`, source.body_md || "", undefined, [
    ...(source.tags || []),
  ], {
    folder: source.folder || "",
    status: "backlog",
    icon: source.icon || "",
    cover: source.cover || "",
  });
}
