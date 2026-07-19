"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { Note } from "@/lib/firebase";
import { CANVAS_TIPS, CanvasDoc } from "@/lib/canvasStore";

type Props = {
  notes: Note[];
  doc: CanvasDoc;
  onPinNote: (noteId: string) => void;
  onFocusNote: (noteId: string) => void;
  onAskAi: (prompt: string) => Promise<string>;
};

export default function CanvasAside({
  notes,
  doc,
  onPinNote,
  onFocusNote,
  onAskAi,
}: Props) {
  const [q, setQ] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [aiText, setAiText] = useState("");
  const [aiError, setAiError] = useState("");

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

  const runAi = async () => {
    setAiBusy(true);
    setAiError("");
    try {
      const titles = doc.notes
        .map((p) => notes.find((n) => n.id === p.noteId)?.title)
        .filter(Boolean)
        .slice(0, 20);
      const text = await onAskAi(
        `畫布上目前有這些筆記：\n${titles.map((t) => `- ${t}`).join("\n") || "（尚無）"}\n\n用繁體中文建議 3 種空間分組方式，以及還可以放哪些類型的便利貼／框架。`
      );
      setAiText(text);
    } catch (e) {
      setAiError(e instanceof Error ? e.message : String(e));
    } finally {
      setAiBusy(false);
    }
  };

  return (
    <aside className="cv-aside">
      <section className="cv-aside-block">
        <h3>概況</h3>
        <div className="cv-stat-grid">
          <div><strong>{doc.notes.length}</strong><span>筆記卡</span></div>
          <div><strong>{doc.stickies.length}</strong><span>便利貼</span></div>
          <div><strong>{doc.shapes.length}</strong><span>圖形</span></div>
          <div><strong>{doc.edges.length}</strong><span>連線</span></div>
        </div>
      </section>

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
                <Link href={`/notes/${n.id}`} className="cv-open">開</Link>
              </li>
            );
          })}
          {list.length === 0 && <li className="cv-muted">沒有符合的筆記</li>}
        </ul>
      </section>

      <section className="cv-aside-block">
        <h3>圖層</h3>
        <ul className="cv-layer-list">
          {doc.stickies.map((s) => (
            <li key={s.id}>便利貼 · {s.text.slice(0, 18) || "空白"}</li>
          ))}
          {doc.shapes.map((s) => (
            <li key={s.id}>{s.shape} · {s.label || "未命名"}</li>
          ))}
          {!doc.stickies.length && !doc.shapes.length && (
            <li className="cv-muted">尚無自訂物件</li>
          )}
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

      <section className="cv-aside-block">
        <h3>AI 佈局建議</h3>
        <button type="button" className="btn btn-soft btn-sm" disabled={aiBusy} onClick={() => { void runAi(); }}>
          {aiBusy ? "思考中…" : "分析目前畫布"}
        </button>
        {aiError && <p className="cv-error">{aiError}</p>}
        {aiText && <div className="cv-ai-out">{aiText}</div>}
      </section>
    </aside>
  );
}
