"use client";

import { useEffect, useState } from "react";

type Props = {
  open: boolean;
  title: string;
  busy: boolean;
  error?: string;
  previewLines: string[];
  onConfirm: (lines: string[]) => void;
  onCancel: () => void;
};

/** Preview AI-generated cards before placing them on the board. */
export default function CanvasAiActionPreview({
  open,
  title,
  busy,
  error,
  previewLines,
  onConfirm,
  onCancel,
}: Props) {
  const [edited, setEdited] = useState(previewLines);

  useEffect(() => {
    setEdited(previewLines);
  }, [previewLines]);

  if (!open) return null;

  return (
    <div
      className="cadence-dialog-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div className="cadence-dialog" role="dialog" aria-modal="true" aria-label={title}>
        <h2 className="cadence-dialog-title">{title}</h2>
        <p className="cadence-dialog-msg">確認後才會放到白板上並建立連線。可先微調每一行。</p>
        {busy && <p className="sel-ai-busy">產生中…</p>}
        {error && <p className="sel-ai-error">{error}</p>}
        {!busy && !error && (
          <div className="cv-ai-preview-list">
            {edited.map((line, i) => (
              <textarea
                key={i}
                className="input cv-ai-preview-line"
                rows={2}
                value={line}
                onChange={(e) => {
                  const next = [...edited];
                  next[i] = e.target.value;
                  setEdited(next);
                }}
              />
            ))}
            {!edited.length && <p className="cadence-dialog-msg">（沒有產生內容）</p>}
          </div>
        )}
        <div className="cadence-dialog-actions">
          <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={busy}>
            取消
          </button>
          <button
            type="button"
            className="btn"
            disabled={busy || !edited.some((l) => l.trim())}
            onClick={() => onConfirm(edited.map((l) => l.trim()).filter(Boolean))}
          >
            確認放到白板
          </button>
        </div>
      </div>
    </div>
  );
}
