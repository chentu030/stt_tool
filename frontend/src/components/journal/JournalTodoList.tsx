"use client";

import { useEffect, useState } from "react";
import {
  createJournalTodo,
  deleteJournalTodo,
  listenJournalTodos,
  setJournalTodoDone,
  type JournalTodo,
} from "@/lib/journalTodos";
import { dateKeyFromDate } from "@/lib/journalMeta";
import { toast } from "@/lib/toast";

type Props = {
  uid: string;
  dateKey: string;
};

export default function JournalTodoList({ uid, dateKey }: Props) {
  const [todos, setTodos] = useState<JournalTodo[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const today = dateKeyFromDate(new Date());
  const incomplete = todos.filter((t) => !t.done).length;
  const heading = dateKey === today ? "今日代辦" : "這天代辦";

  useEffect(() => {
    if (!uid || !dateKey) {
      setTodos([]);
      return;
    }
    return listenJournalTodos(
      uid,
      dateKey,
      setTodos,
      (e) => toast(e.message || "代辦同步失敗")
    );
  }, [uid, dateKey]);

  const addTodo = async () => {
    const title = draft.trim();
    if (!title || busy) return;
    setBusy(true);
    try {
      await createJournalTodo(uid, dateKey, title);
      setDraft("");
    } catch (e) {
      toast(e instanceof Error ? e.message : "新增失敗");
    } finally {
      setBusy(false);
    }
  };

  const toggleDone = async (todo: JournalTodo) => {
    try {
      await setJournalTodoDone(uid, todo.id, !todo.done);
    } catch (e) {
      toast(e instanceof Error ? e.message : "更新失敗");
    }
  };

  const remove = async (todo: JournalTodo) => {
    try {
      await deleteJournalTodo(uid, todo.id);
    } catch (e) {
      toast(e instanceof Error ? e.message : "刪除失敗");
    }
  };

  return (
    <section className="jn-aside-block jn-todo-block">
      <h3>
        {heading}
        {incomplete > 0 && <em className="jn-todo-count">{incomplete}</em>}
      </h3>

      <form
        className="jn-todo-add"
        onSubmit={(e) => {
          e.preventDefault();
          void addTodo();
        }}
      >
        <input
          type="text"
          className="jn-todo-input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="新增代辦"
          maxLength={200}
          disabled={busy}
          aria-label="新增代辦"
        />
        <button
          type="submit"
          className="btn btn-soft btn-sm"
          disabled={busy || !draft.trim()}
        >
          新增
        </button>
      </form>

      {todos.length === 0 ? (
        <p className="jn-muted">這天還沒有代辦。</p>
      ) : (
        <ul className="jn-todo-list">
          {todos.map((todo) => (
            <li
              key={todo.id}
              className={`jn-todo-item${todo.done ? " is-done" : ""}`}
            >
              <label className="jn-todo-check">
                <input
                  type="checkbox"
                  checked={todo.done}
                  onChange={() => void toggleDone(todo)}
                  aria-label={todo.done ? "標為未完成" : "標為完成"}
                />
                <span>{todo.title}</span>
              </label>
              <button
                type="button"
                className="jn-todo-del"
                onClick={() => void remove(todo)}
                title="刪除"
                aria-label={`刪除「${todo.title}」`}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
