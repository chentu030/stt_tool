/** Named collaborators for a note: notes/{noteId}/acl/{uid} */

import {
  collection,
  doc,
  deleteDoc,
  getDoc,
  onSnapshot,
  setDoc,
  Timestamp,
  type Unsubscribe,
} from "firebase/firestore";
import { db } from "@/lib/firebase";

export type NoteAclRole = "editor" | "viewer";

export type NoteAclEntry = {
  uid: string;
  role: NoteAclRole;
  name: string;
  username: string;
  invited_by: string;
  updated_at: Date;
};

function aclCol(noteId: string) {
  return collection(db, "notes", noteId, "acl");
}

export function listenNoteAcl(
  noteId: string,
  cb: (entries: NoteAclEntry[]) => void
): Unsubscribe {
  return onSnapshot(
    aclCol(noteId),
    (snap) => {
      const list: NoteAclEntry[] = snap.docs.map((d) => {
        const data = d.data();
        return {
          uid: d.id,
          role: data.role === "viewer" ? "viewer" : "editor",
          name: String(data.name || ""),
          username: String(data.username || ""),
          invited_by: String(data.invited_by || ""),
          updated_at: data.updated_at?.toDate?.() || new Date(),
        };
      });
      list.sort((a, b) => a.name.localeCompare(b.name, "zh-Hant") || a.uid.localeCompare(b.uid));
      cb(list);
    },
    (err) => {
      console.error("[listenNoteAcl]", err);
      cb([]);
    }
  );
}

export async function getNoteAclRole(
  noteId: string,
  uid: string
): Promise<NoteAclRole | null> {
  if (!noteId || !uid) return null;
  const snap = await getDoc(doc(aclCol(noteId), uid));
  if (!snap.exists()) return null;
  return snap.data()?.role === "viewer" ? "viewer" : "editor";
}

export async function setNoteAclEntry(opts: {
  noteId: string;
  uid: string;
  role: NoteAclRole;
  name: string;
  username?: string;
  invitedBy: string;
}): Promise<void> {
  await setDoc(
    doc(aclCol(opts.noteId), opts.uid),
    {
      role: opts.role,
      name: opts.name || "",
      username: opts.username || "",
      invited_by: opts.invitedBy,
      updated_at: Timestamp.now(),
    },
    { merge: true }
  );
}

export async function removeNoteAclEntry(noteId: string, uid: string): Promise<void> {
  await deleteDoc(doc(aclCol(noteId), uid));
}

/** Resolve @username → uid via usernames/{uname}. */
export async function resolveUidByUsername(raw: string): Promise<{
  uid: string;
  username: string;
} | null> {
  const username = raw.trim().toLowerCase().replace(/^@/, "");
  if (!username) return null;
  const snap = await getDoc(doc(db, "usernames", username));
  if (!snap.exists()) return null;
  const uid = String(snap.data()?.uid || "");
  if (!uid) return null;
  return { uid, username };
}
