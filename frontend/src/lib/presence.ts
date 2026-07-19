/**
 * Live cursor / avatar presence for a note page.
 * Path: note_presence/{noteId}/users/{uid}
 */

import {
  collection,
  doc,
  setDoc,
  deleteDoc,
  onSnapshot,
  Timestamp,
  type Unsubscribe,
} from "firebase/firestore";
import { db } from "@/lib/firebase";

export type PresenceStatus = "active" | "idle";

export type PresenceUser = {
  uid: string;
  x: number;
  y: number;
  name: string;
  color: string;
  status: PresenceStatus;
  updated_at: Date;
};

const STALE_MS = 20_000;
const HEARTBEAT_MS = 8_000;

export const PRESENCE_COLORS = [
  "#0D9488", "#0369A1", "#7C3AED", "#DB2777", "#EA580C", "#65A30D", "#0891B2",
];

export function colorForUid(uid: string): string {
  let hash = 0;
  for (let i = 0; i < uid.length; i++) hash = (hash * 31 + uid.charCodeAt(i)) >>> 0;
  return PRESENCE_COLORS[hash % PRESENCE_COLORS.length];
}

function usersCol(noteId: string) {
  return collection(db, "note_presence", noteId, "users");
}

export async function setPresence(
  noteId: string,
  uid: string,
  data: { x: number; y: number; name: string; color?: string; status?: PresenceStatus }
): Promise<void> {
  await setDoc(
    doc(usersCol(noteId), uid),
    {
      uid,
      x: data.x,
      y: data.y,
      name: data.name || "訪客",
      color: data.color || colorForUid(uid),
      status: data.status || "active",
      updated_at: Timestamp.now(),
    },
    { merge: true }
  );
}

export async function clearPresence(noteId: string, uid: string): Promise<void> {
  try {
    await deleteDoc(doc(usersCol(noteId), uid));
  } catch {
    /* best-effort */
  }
}

export function listenPresence(
  noteId: string,
  cb: (users: PresenceUser[]) => void
): Unsubscribe {
  return onSnapshot(
    usersCol(noteId),
    (snap) => {
      const now = Date.now();
      const list: PresenceUser[] = [];
      snap.docs.forEach((d) => {
        const data = d.data();
        const updatedAt = data.updated_at?.toDate?.() || new Date(0);
        if (now - updatedAt.getTime() > STALE_MS) return;
        list.push({
          uid: d.id,
          x: typeof data.x === "number" ? data.x : 0,
          y: typeof data.y === "number" ? data.y : 0,
          name: String(data.name || "訪客"),
          color: String(data.color || colorForUid(d.id)),
          status: (data.status as PresenceStatus) || "active",
          updated_at: updatedAt,
        });
      });
      cb(list);
    },
    (err) => console.error("[listenPresence]", err)
  );
}

/**
 * Starts a presence heartbeat for (noteId, uid). Call the returned cleanup
 * function on unmount; it also fires on `pagehide`/`beforeunload`.
 */
export function startPresenceHeartbeat(
  noteId: string,
  uid: string,
  getState: () => { x: number; y: number; name: string; color?: string; status?: PresenceStatus }
): () => void {
  let stopped = false;
  const tick = () => {
    if (stopped) return;
    void setPresence(noteId, uid, getState());
  };
  tick();
  const interval = setInterval(tick, HEARTBEAT_MS);
  const onUnload = () => {
    void clearPresence(noteId, uid);
  };
  window.addEventListener("beforeunload", onUnload);
  window.addEventListener("pagehide", onUnload);
  return () => {
    stopped = true;
    clearInterval(interval);
    window.removeEventListener("beforeunload", onUnload);
    window.removeEventListener("pagehide", onUnload);
    void clearPresence(noteId, uid);
  };
}
