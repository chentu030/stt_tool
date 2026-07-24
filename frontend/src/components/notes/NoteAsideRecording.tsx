"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  formatSegClock,
  liveSegmentClock,
  liveSegmentsToMarkdown,
  liveSegmentsToPlainText,
  liveSegmentsToTranscriptSegs,
  previewSegmentText,
  type LiveSegment,
} from "@/lib/liveSegments";
import { downloadText, toSrt, toVtt } from "@/lib/transcript";
import { askConfirm } from "@/lib/dialogs";
import { toast } from "@/lib/toast";

type Props = {
  segments: LiveSegment[];
  onJumpOrganize?: () => void;
  /** Persist edited segment text (note.props.live_segments). */
  onUpdateSegment?: (id: string, text: string) => Promise<void> | void;
  /** Persist deleted segment. */
  onDeleteSegment?: (id: string) => Promise<void> | void;
  /** Base filename for exports (without extension). */
  exportFilename?: string;
  canEdit?: boolean;
};

export default function NoteAsideRecording({
  segments,
  onJumpOrganize,
  onUpdateSegment,
  onDeleteSegment,
  exportFilename = "錄音逐字稿",
  canEdit = false,
}: Props) {
  const [q, setQ] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [withTimestamps, setWithTimestamps] = useState(true);
  const exportMenuRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return segments;
    return segments.filter(
      (s) =>
        s.text.toLowerCase().includes(needle) ||
        s.label.toLowerCase().includes(needle)
    );
  }, [segments, q]);

  useEffect(() => {
    if (!exportOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (!exportMenuRef.current?.contains(e.target as Node)) setExportOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setExportOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      window.removeEventListener("keydown", onKey);
    };
  }, [exportOpen]);

  const startEdit = (s: LiveSegment) => {
    setOpenId(s.id);
    setEditingId(s.id);
    setDraft(s.text);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setDraft("");
  };

  const saveEdit = async (id: string) => {
    if (!onUpdateSegment) return;
    setSaving(true);
    try {
      await onUpdateSegment(id, draft);
      setEditingId(null);
      setDraft("");
      toast("已更新此段");
    } catch (e) {
      toast(e instanceof Error ? e.message : "儲存失敗");
    } finally {
      setSaving(false);
    }
  };

  const removeSeg = async (s: LiveSegment) => {
    if (!onDeleteSegment) return;
    const clock = liveSegmentClock(s);
    const ok = await askConfirm({
      title: "刪除此段？",
      message: `將移除 ${clock} 這段錄音素材文字（無法復原）。`,
      danger: true,
      confirmLabel: "刪除",
    });
    if (!ok) return;
    try {
      await onDeleteSegment(s.id);
      if (openId === s.id) setOpenId(null);
      if (editingId === s.id) cancelEdit();
      toast("已刪除此段");
    } catch (e) {
      toast(e instanceof Error ? e.message : "刪除失敗");
    }
  };

  const base = (exportFilename || "錄音逐字稿").replace(/[\\/:*?"<>|]+/g, "_").trim() || "錄音逐字稿";

  const doExport = (fmt: "txt" | "md" | "srt" | "vtt") => {
    if (fmt === "txt") {
      downloadText(`${base}.txt`, liveSegmentsToPlainText(segments, withTimestamps));
    } else if (fmt === "md") {
      downloadText(
        `${base}.md`,
        liveSegmentsToMarkdown(segments, withTimestamps),
        "text/markdown;charset=utf-8"
      );
    } else if (fmt === "srt") {
      downloadText(`${base}.srt`, toSrt(liveSegmentsToTranscriptSegs(segments)));
    } else {
      downloadText(`${base}.vtt`, toVtt(liveSegmentsToTranscriptSegs(segments)), "text/vtt");
    }
    setExportOpen(false);
    toast("已開始下載");
  };

  if (!segments.length) {
    return (
      <div className="note-aside-body">
        <p className="note-aside-empty">尚無錄音素材。開始現場錄音後，分段會出現在這裡。</p>
      </div>
    );
  }

  return (
    <div className="note-aside-body note-aside-recording">
      <div className="note-aside-rec-toolbar">
        <input
          className="doc-prop-input"
          placeholder="搜尋分段逐字稿…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="搜尋錄音素材"
        />
        <div className="note-aside-rec-actions">
          {onJumpOrganize && (
            <button type="button" className="btn btn-sm btn-soft" onClick={onJumpOrganize}>
              跳到 AI 整理
            </button>
          )}
          <div className="doc-cmd-wrap" ref={exportMenuRef}>
            <button
              type="button"
              className={`doc-cmd${exportOpen ? " is-on" : ""}`}
              onClick={() => setExportOpen((v) => !v)}
              aria-expanded={exportOpen}
              aria-haspopup="menu"
            >
              匯出 ▾
            </button>
            {exportOpen && (
              <div className="doc-cmd-menu note-aside-rec-export" role="menu">
                <div className="doc-cmd-menu-section">
                  <p className="doc-cmd-menu-heading">時間戳</p>
                  <div className="doc-cmd-menu-chips" role="group" aria-label="是否含時間戳">
                    <button
                      type="button"
                      className={`doc-cmd-menu-chip${withTimestamps ? " is-on" : ""}`}
                      onClick={() => setWithTimestamps(true)}
                    >
                      含時間戳
                    </button>
                    <button
                      type="button"
                      className={`doc-cmd-menu-chip${!withTimestamps ? " is-on" : ""}`}
                      onClick={() => setWithTimestamps(false)}
                    >
                      不含時間戳
                    </button>
                  </div>
                </div>
                <button type="button" role="menuitem" onClick={() => doExport("txt")}>
                  <strong>純文字 (.txt)</strong>
                  <span>{withTimestamps ? "每段含時間範圍" : "僅文字，一段一段落"}</span>
                </button>
                <button type="button" role="menuitem" onClick={() => doExport("md")}>
                  <strong>Markdown (.md)</strong>
                  <span>{withTimestamps ? "標題為時間範圍" : "僅文字段落"}</span>
                </button>
                {withTimestamps && (
                  <>
                    <button type="button" role="menuitem" onClick={() => doExport("srt")}>
                      <strong>字幕 (.srt)</strong>
                      <span>含時間軸字幕格式</span>
                    </button>
                    <button type="button" role="menuitem" onClick={() => doExport("vtt")}>
                      <strong>字幕 (.vtt)</strong>
                      <span>WebVTT 時間軸格式</span>
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
      <p className="note-aside-rec-meta">{filtered.length} / {segments.length} 段</p>
      <ul className="note-aside-rec-list">
        {filtered.map((s) => {
          const expanded = openId === s.id;
          const editing = editingId === s.id;
          const clock =
            s.endSec > s.startSec
              ? `${formatSegClock(s.startSec)}–${formatSegClock(s.endSec)}`
              : s.label;
          return (
            <li key={s.id} className={`note-aside-rec-item${expanded ? " is-open" : ""}`}>
              <button
                type="button"
                className="note-aside-rec-row"
                onClick={() => {
                  if (editing) return;
                  setOpenId(expanded ? null : s.id);
                }}
                aria-expanded={expanded}
              >
                <span className="note-aside-rec-time">{clock}</span>
                <span className="note-aside-rec-preview">{previewSegmentText(s.text)}</span>
              </button>
              {expanded && (
                <div className="note-aside-rec-detail">
                  {editing ? (
                    <textarea
                      className="note-aside-rec-editor"
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      rows={Math.max(3, Math.min(10, Math.ceil(draft.length / 36) || 3))}
                      aria-label="編輯此段文字"
                      autoFocus
                    />
                  ) : s.text.trim() ? (
                    <p className="note-aside-rec-text">{s.text}</p>
                  ) : (
                    <p className="note-aside-empty">此段沒有文字（可能是純音檔）</p>
                  )}
                  {s.audioUrl ? (
                    <audio
                      className="note-aside-rec-audio"
                      controls
                      preload="metadata"
                      src={s.audioUrl}
                    />
                  ) : null}
                  {canEdit && (onUpdateSegment || onDeleteSegment) && (
                    <div className="note-aside-rec-seg-actions">
                      {editing ? (
                        <>
                          <button
                            type="button"
                            className="btn btn-sm"
                            disabled={saving || !onUpdateSegment}
                            onClick={() => void saveEdit(s.id)}
                          >
                            {saving ? "儲存中…" : "儲存"}
                          </button>
                          <button
                            type="button"
                            className="btn btn-sm btn-soft"
                            disabled={saving}
                            onClick={cancelEdit}
                          >
                            取消
                          </button>
                        </>
                      ) : (
                        <>
                          {onUpdateSegment && (
                            <button
                              type="button"
                              className="doc-cmd"
                              onClick={() => startEdit(s)}
                            >
                              編輯
                            </button>
                          )}
                          {onDeleteSegment && (
                            <button
                              type="button"
                              className="doc-cmd note-aside-rec-danger"
                              onClick={() => void removeSeg(s)}
                            >
                              刪除
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
