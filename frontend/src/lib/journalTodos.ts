/**
 * Day-scoped journal todos (Firestore under users/{uid}/journal_todos).
 */

import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  updateDoc,
  where,
  type Unsubscribe,
} from "firebase/firestore";
import { db } from "@/lib/firebase";

export type JournalTodo = {
  id: string;
  dateKey: string;
  title: string;
  done: boolean;
  createdAtMs: number;
  updated_at?: Date;
};

function todosCol(uid: string) {
  return collection(db, "users", uid, "journal_todos");
}

function mapDoc(id: string, data: Record<string, unknown>): JournalTodo {
  const created =
    data.created_at &&
    typeof data.created_at === "object" &&
    "toMillis" in (data.created_at as object)
      ? (data.created_at as { toMillis: () => number }).toMillis()
      : Number(data.createdAtMs) || 0;
  return {
    id,
    dateKey: String(data.dateKey || ""),
    title: String(data.title || "").trim() || "未命名",
    done: Boolean(data.done),
    createdAtMs: created,
    updated_at:
      data.updated_at &&
      typeof data.updated_at === "object" &&
      "toDate" in (data.updated_at as object)
        ? (data.updated_at as { toDate: () => Date }).toDate()
        : undefined,
  };
}

function sortTodos(a: JournalTodo, b: JournalTodo) {
  return (
    Number(a.done) - Number(b.done) ||
    a.createdAtMs - b.createdAtMs ||
    a.title.localeCompare(b.title)
  );
}

export function listenJournalTodos(
  uid: string,
  dateKey: string,
  onData: (todos: JournalTodo[]) => void,
  onError?: (e: Error) => void
): Unsubscribe {
  const q = query(todosCol(uid), where("dateKey", "==", dateKey));
  return onSnapshot(
    q,
    (snap) => {
      const rows = snap.docs
        .map((d) => mapDoc(d.id, d.data() as Record<string, unknown>))
        .sort(sortTodos);
      onData(rows);
    },
    (err) => onError?.(err as Error)
  );
}

export async function createJournalTodo(
  uid: string,
  dateKey: string,
  title: string
): Promise<string> {
  const trimmed = title.trim();
  if (!trimmed) throw new Error("請輸入代辦內容");
  const ref = await addDoc(todosCol(uid), {
    dateKey,
    title: trimmed,
    done: false,
    created_at: serverTimestamp(),
    updated_at: serverTimestamp(),
  });
  return ref.id;
}

export async function setJournalTodoDone(
  uid: string,
  todoId: string,
  done: boolean
): Promise<void> {
  await updateDoc(doc(todosCol(uid), todoId), {
    done: Boolean(done),
    updated_at: serverTimestamp(),
  });
}

export async function updateJournalTodoTitle(
  uid: string,
  todoId: string,
  title: string
): Promise<void> {
  const trimmed = title.trim();
  if (!trimmed) throw new Error("代辦不可為空");
  await updateDoc(doc(todosCol(uid), todoId), {
    title: trimmed,
    updated_at: serverTimestamp(),
  });
}

export async function deleteJournalTodo(
  uid: string,
  todoId: string
): Promise<void> {
  await deleteDoc(doc(todosCol(uid), todoId));
}
