"use client";

import { useMemo, useState } from "react";
import type { Note } from "@/lib/firebase";
import type { CanvasDoc } from "@/lib/canvasStore";
import Link from "next/link";
import { NoteHandoffLinks } from "@/components/shell/ContinueChips";
import { buildResearchUrl } from "@/lib/researchBridge";
import { CANVAS_TIPS } from "@/lib/canvasStore";
import { continueSelectionInAiRail, openGlobalAiRail } from "@/lib/aiRailBridge";

type Props = {
  notes: Note[];
  doc: CanvasDoc;
  selectedIds: string[];
  onPinNote: (noteId: string) => void;
  onFocusNote: (noteId: string) => void;
  /** Optional packed selection for AI rail */
  selectionPack?: { label: string; selection: string; context: string } | null;
};

export default function CanvasAside({
  notes,
  doc,
  selectedIds,
  onPinNote,
  onFocusNote,
  selectionPack,
}: Props) {
  const [q, setQ] = useState("");

  const pinned = useMemo(() => new Set(doc.notes.map((n) => n.noteId)), [doc.notes]);

  const focusedNoteId = useMemo(() => {
    const hit = selectedIds.find((id) => id.startsWith("note:"));
    return hit ? hit.slice(5) : null;
  }, [selectedIds]);
  const focusedNote = focusedNoteId ? notes.find((n) => n.id === focusedNoteId) : null;

  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return notes
      .filter((n) => {
        if (!s) return true;
        return n.title.toLowerCase().includes(s) || n.body_md.toLowerCase().includes(s);
      })
      .slice(0, 40);
  }, [notes, q]);

  return (
    <aside className="cv-aside cv-aside--immersive">
      <div className="cv-aside-head">
        <strong>筆記</strong>
        <div className="cv-aside-head-actions">
          {selectedIds.length > 0 && (
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              title="把目前選取加入右側 AI 脈絡"
              onClick={() => {
                continueSelectionInAiRail({
                  selectionText: selectionPack?.selection || "",
                  context: selectionPack?.context || `白板：${doc.name}\n選取 ${selectedIds.length} 項`,
                  title: doc.name || "白板",
                  contextLabel: `白板選取 · ${selectedIds.length}`,
                });
              }}
            >
              選取→AI
            </button>
          )}
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            onClick={() =>
              openGlobalAiRail({
                contextLabel: `白板 · ${doc.name || "未命名"}`,
                useCanvasSelection: true,
                prompt: selectedIds.length
                  ? "請根據目前白板選取內容整理重點"
                  : "請根據目前白板內容整理重點",
              })
            }
            title="開啟全域 AI 側欄"
          >
            AI
          </button>
        </div>
      </div>

      {focusedNoteId && (
        <div className="cv-aside-block">
          <h3>已選筆記</h3>
          <p className="cv-muted" style={{ marginBottom: "0.4rem" }}>
            {focusedNote?.title || "未命名"}
          </p>
          <NoteHandoffLinks noteId={focusedNoteId} title={focusedNote?.title} />
        </div>
      )}

      <div className="cv-stat-grid">
        <div>
          <strong>{doc.notes.length}</strong>
          <span>筆記</span>
        </div>
        <div>
          <strong>{doc.stickies.length}</strong>
          <span>便利貼</span>
        </div>
        <div>
          <strong>{(doc.media || []).length}</strong>
          <span>媒體</span>
        </div>
        <div>
          <strong>{doc.edges.length}</strong>
          <span>連線</span>
        </div>
      </div>

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
                <Link
                  href={buildResearchUrl({ from: n.id, topic: n.title || undefined, returnTo: true })}
                  className="cv-open"
                  title="深度研究"
                >
                  研
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
    </aside>
  );
}
