"use client";

import { useMemo, useState } from "react";
import type { Note } from "@/lib/firebase";
import type { CanvasDoc, CanvasAiOp } from "@/lib/canvasStore";
import { CANVAS_TIPS } from "@/lib/canvasStore";
import Link from "next/link";

type ChatMsg = { role: "user" | "assistant"; text: string; ops?: CanvasAiOp[] };

type Props = {
  notes: Note[];
  doc: CanvasDoc;
  selectedIds: string[];
  onPinNote: (noteId: string) => void;
  onFocusNote: (noteId: string) => void;
  onAskCanvasAi: (prompt: string) => Promise<{ message: string; ops: CanvasAiOp[] }>;
  onApplyOps: (ops: CanvasAiOp[]) => void;
};

const QUICK = [
  "分析這張白板，給 3 點改進建議",
  "幫我整理成幾個區塊框架",
  "依內容建議該連結哪些筆記並釘上",
  "為選取的便利貼擴寫內容",
];

export default function CanvasAside({
  notes,
  doc,
  selectedIds,
  onPinNote,
  onFocusNote,
  onAskCanvasAi,
  onApplyOps,
}: Props) {
  const [q, setQ] = useState("");
  const [tab, setTab] = useState<"notes" | "ai">("ai");
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [msgs, setMsgs] = useState<ChatMsg[]>([]);

  const pinned = useMemo(() => new Set(doc.notes.map((n) => n.noteId)), [doc.notes]);

  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return notes
      .filter((n) => {
        if (!s) return true;
        return n.title.toLowerCase().includes(s) || n.body_md.toLowerCase().includes(s);
      })
      .slice(0, 40);
  }, [notes, q]);

  const send = async (prompt: string) => {
    const text = prompt.trim();
    if (!text || busy) return;
    setBusy(true);
    setError("");
    setMsgs((m) => [...m, { role: "user", text }]);
    setInput("");
    try {
      const res = await onAskCanvasAi(text);
      setMsgs((m) => [...m, { role: "assistant", text: res.message, ops: res.ops }]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <aside className="cv-aside cv-aside--immersive">
      <div className="cv-aside-tabs">
        <button type="button" className={tab === "ai" ? "is-on" : ""} onClick={() => setTab("ai")}>
          AI 助手
        </button>
        <button type="button" className={tab === "notes" ? "is-on" : ""} onClick={() => setTab("notes")}>
          筆記
        </button>
      </div>

      {tab === "ai" ? (
        <div className="cv-ai-panel">
          <div className="cv-stat-grid" style={{ marginBottom: "0.55rem" }}>
            <div>
              <strong>{doc.notes.length}</strong>
              <span>筆記</span>
            </div>
            <div>
              <strong>{doc.stickies.length}</strong>
              <span>便利貼</span>
            </div>
            <div>
              <strong>{doc.shapes.length}</strong>
              <span>圖形</span>
            </div>
            <div>
              <strong>{doc.edges.length}</strong>
              <span>連線</span>
            </div>
          </div>
          <div className="cv-ai-quick">
            {QUICK.map((t) => (
              <button key={t} type="button" disabled={busy} onClick={() => void send(t)}>
                {t}
              </button>
            ))}
          </div>
          <div className="cv-ai-msgs">
            {msgs.length === 0 && (
              <p className="cv-muted">AI 看得到整張白板與選取內容，可給建議或直接改畫布。</p>
            )}
            {msgs.map((m, i) => (
              <div key={i} className={`cv-ai-msg cv-ai-msg--${m.role}`}>
                <div className="cv-ai-msg-body">{m.text}</div>
                {m.ops && m.ops.length > 0 && (
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => onApplyOps(m.ops!)}
                  >
                    套用 {m.ops.length} 項變更
                  </button>
                )}
              </div>
            ))}
          </div>
          {error && <p className="cv-error">{error}</p>}
          <div className="cv-ai-compose">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="問白板或請 AI 編輯…"
              rows={3}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send(input);
                }
              }}
            />
            <button type="button" className="btn btn-sm" disabled={busy || !input.trim()} onClick={() => void send(input)}>
              {busy ? "…" : "送出"}
            </button>
          </div>
          {selectedIds.length > 0 && (
            <p className="cv-muted" style={{ fontSize: "0.72rem" }}>
              目前選取 {selectedIds.length} 項會一併傳給 AI
            </p>
          )}
        </div>
      ) : (
        <>
          <section className="cv-aside-block">
            <h3>釘上筆記</h3>
            <input
              className="input"
              placeholder="搜尋筆記…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <ul className="cv-note-list">
              {list.map((n) => {
                const on = pinned.has(n.id);
                return (
                  <li key={n.id}>
                    <button
                      type="button"
                      className={on ? "is-on" : ""}
                      onClick={() => (on ? onFocusNote(n.id) : onPinNote(n.id))}
                    >
                      <strong>{n.title || "未命名"}</strong>
                      <span>{on ? "已在畫布 · 點擊對焦" : "釘上畫布"}</span>
                    </button>
                    <Link href={`/notes/${n.id}`} className="cv-open">
                      開
                    </Link>
                  </li>
                );
              })}
              {list.length === 0 && <li className="cv-muted">沒有符合的筆記</li>}
            </ul>
          </section>
          <section className="cv-aside-block">
            <h3>提示</h3>
            <ul className="cv-tips">
              {CANVAS_TIPS.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
          </section>
        </>
      )}
    </aside>
  );
}
