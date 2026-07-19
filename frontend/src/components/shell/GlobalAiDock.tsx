"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import { listenToUserNotes, type Note } from "@/lib/firebase";
import { packLibraryContext } from "@/lib/libraryIndex";

type Msg = { id: string; role: "user" | "assistant"; text: string };

function uid() {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

/** Floating Cadence AI dock — global assistant entry (P1 skeleton + library ask) */
export default function GlobalAiDock() {
  const { user } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notes, setNotes] = useState<Note[]>([]);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const onNotePage = pathname?.startsWith("/notes/");

  useEffect(() => {
    if (!user) {
      setNotes([]);
      return;
    }
    return listenToUserNotes(user.uid, setNotes);
  }, [user]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "a") {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 40);
  }, [open]);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [msgs, busy]);

  const scopeLabel = useMemo(() => {
    if (onNotePage) return "目前在筆記頁 — 也可用 Ctrl+J 開側欄 AI";
    return `知識庫 ${notes.length} 篇`;
  }, [onNotePage, notes.length]);

  const send = async (text: string) => {
    const prompt = text.trim();
    if (!prompt || busy) return;
    setBusy(true);
    setError("");
    setInput("");
    const userMsg: Msg = { id: uid(), role: "user", text: prompt };
    setMsgs((p) => [...p, userMsg]);
    try {
      const packed = packLibraryContext(
        notes.map((n) => ({
          id: n.id,
          title: n.title,
          body_md: n.body_md,
          tags: n.tags,
          folder: n.folder,
          updated_at: n.updated_at,
          created_at: n.created_at,
        })),
        prompt,
        { maxNotes: 8, maxChars: 12000 }
      );
      const res = await fetch("/api/ai/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "library",
          prompt,
          context: packed.context,
          messages: [...msgs, userMsg]
            .slice(-8)
            .map((m) => ({
              role: m.role === "assistant" ? "model" : "user",
              text: m.text,
            }))
            .slice(0, -1),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "失敗");
      setMsgs((p) => [...p, { id: uid(), role: "assistant", text: data.text || "（無回覆）" }]);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      setMsgs((p) => [...p, { id: uid(), role: "assistant", text: `無法回答：${msg}` }]);
    } finally {
      setBusy(false);
    }
  };

  if (!user) return null;

  return (
    <>
      <button
        type="button"
        className={`cadence-ai-fab${open ? " is-open" : ""}`}
        title="Cadence AI（Ctrl+Shift+A）"
        onClick={() => setOpen((v) => !v)}
      >
        AI
      </button>
      {open && (
        <div className="cadence-ai-dock">
          <div className="cadence-ai-dock-head">
            <strong>Cadence AI</strong>
            <span className="cadence-ai-dock-scope">{scopeLabel}</span>
            <button type="button" className="doc-cmd" onClick={() => setOpen(false)}>
              關閉
            </button>
          </div>
          {onNotePage && (
            <p className="cadence-ai-dock-hint">
              筆記內建議用側欄 AI（Ctrl+J）以帶入本篇完整脈絡。此處可跨知識庫提問。
            </p>
          )}
          <div className="cadence-ai-dock-msgs" ref={listRef}>
            {msgs.length === 0 && (
              <p className="note-aside-empty">問任何關於你知識庫的問題，或請它整理靈感。</p>
            )}
            {msgs.map((m) => (
              <div key={m.id} className={`note-ai-msg note-ai-msg--${m.role}`}>
                <span>{m.role === "user" ? "你" : "助手"}</span>
                <p>{m.text}</p>
              </div>
            ))}
            {busy && <p className="note-aside-hint">思考中…</p>}
          </div>
          {error && <p className="note-aside-error">{error}</p>}
          <form
            className="cadence-ai-dock-compose"
            onSubmit={(e) => {
              e.preventDefault();
              void send(input);
            }}
          >
            <textarea
              ref={inputRef}
              className="input"
              rows={2}
              placeholder="問 Cadence AI…"
              value={input}
              disabled={busy}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send(input);
                }
              }}
            />
            <div className="cadence-ai-dock-actions">
              <button type="button" className="doc-cmd" onClick={() => router.push("/library")}>
                知識庫
              </button>
              <button type="submit" className="btn btn-sm" disabled={busy || !input.trim()}>
                送出
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
