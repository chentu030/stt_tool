/**
 * Block-level discussion threads attached to a text selection within a note.
 * Path: notes/{noteId}/threads/{threadId}/messages/{messageId}
 */

import {
  collection,
  doc,
  setDoc,
  updateDoc,
  onSnapshot,
  query,
  orderBy,
  Timestamp,
  type Unsubscribe,
} from "firebase/firestore";
import { db } from "@/lib/firebase";

export type ThreadMessage = {
  id: string;
  author_id: string;
  author_name?: string;
  text: string;
  created_at: Date;
};

export type Thread = {
  id: string;
  selection_text: string;
  created_by: string;
  created_at: Date;
  resolved: boolean;
};

/** Stable, short id derived from the selected text — lets the same selection reopen the same thread. */
export function hashSelection(text: string): string {
  const s = text.trim().slice(0, 400);
  let hash = 5381;
  for (let i = 0; i < s.length; i++) {
    hash = ((hash << 5) + hash + s.charCodeAt(i)) >>> 0;
  }
  return `t_${hash.toString(36)}`;
}

function threadsCol(noteId: string) {
  return collection(db, "notes", noteId, "threads");
}
function threadMessagesCol(noteId: string, threadId: string) {
  return collection(db, "notes", noteId, "threads", threadId, "messages");
}

export async function ensureThread(
  noteId: string,
  selectionText: string,
  uid: string
): Promise<string> {
  const threadId = hashSelection(selectionText);
  await setDoc(
    doc(threadsCol(noteId), threadId),
    {
      selection_text: selectionText.trim().slice(0, 400),
      created_by: uid,
      created_at: Timestamp.now(),
      resolved: false,
    },
    { merge: true }
  );
  return threadId;
}

export function listenThread(
  noteId: string,
  threadId: string,
  cb: (thread: Thread | null) => void
): Unsubscribe {
  return onSnapshot(doc(threadsCol(noteId), threadId), (snap) => {
    if (!snap.exists()) {
      cb(null);
      return;
    }
    const data = snap.data();
    cb({
      id: snap.id,
      selection_text: String(data.selection_text || ""),
      created_by: String(data.created_by || ""),
      created_at: data.created_at?.toDate?.() || new Date(),
      resolved: !!data.resolved,
    });
  });
}

export function listenThreadMessages(
  noteId: string,
  threadId: string,
  cb: (messages: ThreadMessage[]) => void
): Unsubscribe {
  const q = query(threadMessagesCol(noteId, threadId), orderBy("created_at", "asc"));
  return onSnapshot(q, (snap) => {
    cb(
      snap.docs.map((d) => {
        const data = d.data();
        return {
          id: d.id,
          author_id: String(data.author_id || ""),
          author_name: data.author_name ? String(data.author_name) : undefined,
          text: String(data.text || ""),
          created_at: data.created_at?.toDate?.() || new Date(),
        };
      })
    );
  });
}

export async function sendThreadMessage(
  noteId: string,
  threadId: string,
  msg: { author_id: string; author_name?: string; text: string }
): Promise<void> {
  const ref = doc(threadMessagesCol(noteId, threadId));
  await setDoc(ref, {
    author_id: msg.author_id,
    author_name: msg.author_name || "",
    text: msg.text,
    created_at: Timestamp.now(),
  });
}

export async function resolveThread(noteId: string, threadId: string, resolved = true): Promise<void> {
  await updateDoc(doc(threadsCol(noteId), threadId), { resolved });
}
