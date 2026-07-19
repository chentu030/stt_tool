/** Multi-board configs under users/{uid}/boards/{id} */

import {
  collection,
  doc,
  setDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  Timestamp,
  type Unsubscribe,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { BoardStatus } from "@/lib/boardMeta";

export type BoardConfig = {
  id: string;
  name: string;
  /** Empty = all folders */
  folders: string[];
  /** Empty = all tags */
  tags: string[];
  /** Empty = all statuses */
  statuses: BoardStatus[];
  created_at: Date;
  updated_at: Date;
};

function boardsCol(uid: string) {
  return collection(db, "users", uid, "boards");
}

export function listenBoards(uid: string, cb: (list: BoardConfig[]) => void): Unsubscribe {
  return onSnapshot(boardsCol(uid), (snap) => {
    const list = snap.docs.map((d) => {
      const data = d.data();
      return {
        id: d.id,
        name: (data.name as string) || "未命名看板",
        folders: Array.isArray(data.folders) ? (data.folders as string[]) : [],
        tags: Array.isArray(data.tags) ? (data.tags as string[]) : [],
        statuses: Array.isArray(data.statuses) ? (data.statuses as BoardStatus[]) : [],
        created_at: data.created_at?.toDate?.() || new Date(),
        updated_at: data.updated_at?.toDate?.() || new Date(),
      } satisfies BoardConfig;
    });
    list.sort((a, b) => b.updated_at.getTime() - a.updated_at.getTime());
    cb(list);
  });
}

export async function createBoard(uid: string, name = "新看板"): Promise<string> {
  const ref = doc(boardsCol(uid));
  const now = Timestamp.now();
  await setDoc(ref, {
    name,
    folders: [],
    tags: [],
    statuses: [],
    created_at: now,
    updated_at: now,
  });
  return ref.id;
}

export async function updateBoard(
  uid: string,
  id: string,
  patch: Partial<Pick<BoardConfig, "name" | "folders" | "tags" | "statuses">>
) {
  await updateDoc(doc(db, "users", uid, "boards", id), {
    ...patch,
    updated_at: Timestamp.now(),
  });
}

export async function deleteBoard(uid: string, id: string) {
  await deleteDoc(doc(db, "users", uid, "boards", id));
}

export function lastBoardKey(uid: string) {
  return `cadence_last_board_${uid}`;
}
