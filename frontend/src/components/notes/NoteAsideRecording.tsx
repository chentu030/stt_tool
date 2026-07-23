"use client";

import { useMemo, useState } from "react";
import {
  formatSegClock,
  previewSegmentText,
  type LiveSegment,
} from "@/lib/liveSegments";

type Props = {
  segments: LiveSegment[];
  onJumpOrganize?: () => void;
};

export default function NoteAsideRecording({ segments, onJumpOrganize }: Props) {
  const [q, setQ] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return segments;
    return segments.filter(
      (s) =>
        s.text.toLowerCase().includes(needle) ||
        s.label.toLowerCase().includes(needle)
    );
  }, [segments, q]);

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
        {onJumpOrganize && (
          <button type="button" className="btn btn-sm btn-soft" onClick={onJumpOrganize}>
            跳到 AI 整理
          </button>
        )}
      </div>
      <p className="note-aside-rec-meta">{filtered.length} / {segments.length} 段</p>
      <ul className="note-aside-rec-list">
        {filtered.map((s) => {
          const expanded = openId === s.id;
          const clock =
            s.endSec > s.startSec
              ? `${formatSegClock(s.startSec)}–${formatSegClock(s.endSec)}`
              : s.label;
          return (
            <li key={s.id} className={`note-aside-rec-item${expanded ? " is-open" : ""}`}>
              <button
                type="button"
                className="note-aside-rec-row"
                onClick={() => setOpenId(expanded ? null : s.id)}
                aria-expanded={expanded}
              >
                <span className="note-aside-rec-time">{clock}</span>
                <span className="note-aside-rec-preview">{previewSegmentText(s.text)}</span>
              </button>
              {expanded && (
                <div className="note-aside-rec-detail">
                  {s.text.trim() ? (
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
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
