"use client";

import { useEffect, useMemo, useState } from "react";
import {
  EXPORT_STYLE_PRESETS,
  buildExportPreviewHtml,
  runNoteExport,
  type ExportFormatId,
  type ExportStyleId,
  type MarkdownExportMeta,
} from "@/lib/exportNote";
import { toast } from "@/lib/toast";

type Props = {
  open: boolean;
  onClose: () => void;
  title: string;
  body: string;
  props?: Record<string, unknown> | null;
  meta?: MarkdownExportMeta;
  /** Initial format when opened from a menu item */
  initialFormat?: ExportFormatId;
};

const FORMATS: { id: ExportFormatId; label: string }[] = [
  { id: "md", label: "Markdown" },
  { id: "pdf", label: "PDF" },
  { id: "docx", label: "DOCX" },
  { id: "ppt", label: "簡報大綱" },
];

export default function NoteExportDialog({
  open,
  onClose,
  title,
  body,
  props,
  meta,
  initialFormat = "md",
}: Props) {
  const [format, setFormat] = useState<ExportFormatId>(initialFormat);
  const [style, setStyle] = useState<ExportStyleId>(
    initialFormat === "ppt" ? "deck" : "report"
  );
  const [includeSource, setIncludeSource] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setFormat(initialFormat);
    setStyle(initialFormat === "ppt" ? "deck" : "report");
  }, [open, initialFormat]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const previewHtml = useMemo(() => {
    if (!open) return "";
    const previewBody =
      format === "ppt"
        ? body
        : body;
    // For 簡報大綱, still use deck-ish preview of body with style deck
    return buildExportPreviewHtml(title, previewBody, {
      style: format === "ppt" ? "deck" : style,
      includeSource,
      props,
    });
  }, [open, title, body, format, style, includeSource, props]);

  if (!open) return null;

  const download = async () => {
    setBusy(true);
    try {
      await runNoteExport(format, title, body, {
        style: format === "ppt" ? "deck" : style,
        includeSource,
        props,
        meta,
      });
      toast("已開始匯出");
      onClose();
    } catch (e) {
      toast(e instanceof Error ? e.message : "匯出失敗");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="note-export-overlay" role="presentation" onClick={onClose}>
      <div
        className="note-export-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="匯出預覽"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="note-export-head">
          <div>
            <h2>匯出</h2>
            <p>先預覽版型，再下載檔案。預設不含素材區塊。</p>
          </div>
          <button type="button" className="doc-cmd" onClick={onClose} aria-label="關閉">
            ✕
          </button>
        </header>

        <div className="note-export-controls">
          <div className="note-export-group" role="group" aria-label="格式">
            {FORMATS.map((f) => (
              <button
                key={f.id}
                type="button"
                className={`note-export-chip${format === f.id ? " is-on" : ""}`}
                onClick={() => {
                  setFormat(f.id);
                  if (f.id === "ppt") setStyle("deck");
                }}
              >
                {f.label}
              </button>
            ))}
          </div>
          <div className="note-export-group" role="group" aria-label="版型">
            {EXPORT_STYLE_PRESETS.map((s) => (
              <button
                key={s.id}
                type="button"
                className={`note-export-chip${style === s.id ? " is-on" : ""}`}
                title={s.hint}
                disabled={format === "ppt" && s.id !== "deck"}
                onClick={() => setStyle(s.id)}
              >
                {s.label}
              </button>
            ))}
          </div>
          <label className="note-export-check">
            <input
              type="checkbox"
              checked={includeSource}
              onChange={(e) => setIncludeSource(e.target.checked)}
            />
            包含素材
          </label>
        </div>

        <div className="note-export-preview-wrap">
          <iframe
            className="note-export-preview"
            title="匯出預覽"
            srcDoc={previewHtml}
            sandbox=""
          />
        </div>

        <footer className="note-export-foot">
          <button type="button" className="doc-cmd" onClick={onClose}>
            取消
          </button>
          <button
            type="button"
            className="btn primary"
            disabled={busy}
            onClick={() => void download()}
          >
            {busy ? "處理中…" : "下載"}
          </button>
        </footer>
      </div>
    </div>
  );
}
