"use client";

import { useRef } from "react";
import { STICKY_COLORS, StickyColor, ToolId } from "@/lib/canvasStore";

const TOOLS: { id: ToolId; label: string; hint: string }[] = [
  { id: "select", label: "選取", hint: "V" },
  { id: "pan", label: "平移", hint: "H" },
  { id: "sticky", label: "便利貼", hint: "S" },
  { id: "text", label: "文字框", hint: "T" },
  { id: "rect", label: "矩形", hint: "R" },
  { id: "ellipse", label: "圓形", hint: "O" },
  { id: "frame", label: "框架", hint: "F" },
  { id: "connect", label: "連線", hint: "C" },
];

type Props = {
  tool: ToolId;
  onTool: (t: ToolId) => void;
  stickyColor: StickyColor;
  onStickyColor: (c: StickyColor) => void;
  scale: number;
  grid: boolean;
  snap: boolean;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFit: () => void;
  onReset: () => void;
  onToggleGrid: () => void;
  onToggleSnap: () => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onAutoLayout: () => void;
  onExport: () => void;
  onImport: () => void;
  canEditSelection: boolean;
  onInsertFiles?: (files: FileList | File[]) => void;
  onInsertUrl?: () => void;
  uploadBusy?: boolean;
};

export default function CanvasToolbar({
  tool,
  onTool,
  stickyColor,
  onStickyColor,
  scale,
  grid,
  snap,
  onZoomIn,
  onZoomOut,
  onFit,
  onReset,
  onToggleGrid,
  onToggleSnap,
  onDelete,
  onDuplicate,
  onAutoLayout,
  onExport,
  onImport,
  canEditSelection,
  onInsertFiles,
  onInsertUrl,
  uploadBusy,
}: Props) {
  const imageRef = useRef<HTMLInputElement>(null);
  const audioRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLInputElement>(null);
  const pdfRef = useRef<HTMLInputElement>(null);
  const pptRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const pick = (files: FileList | null) => {
    if (files?.length) onInsertFiles?.(files);
  };

  return (
    <div className="cv-toolbar">
      <div className="cv-tool-group">
        {TOOLS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`cv-tool${tool === t.id ? " is-on" : ""}`}
            title={`${t.label} (${t.hint})`}
            onClick={() => onTool(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="cv-tool-group">
        {STICKY_COLORS.map((c) => (
          <button
            key={c.id}
            type="button"
            className={`cv-swatch${stickyColor === c.id ? " is-on" : ""}`}
            style={{ background: c.bg, borderColor: c.border }}
            title={c.label}
            onClick={() => onStickyColor(c.id)}
          />
        ))}
      </div>

      <div className="cv-tool-group">
        <button type="button" className="cv-tool" disabled={uploadBusy} onClick={() => imageRef.current?.click()} title="插入圖片">
          圖片
        </button>
        <button type="button" className="cv-tool" disabled={uploadBusy} onClick={() => audioRef.current?.click()} title="插入語音">
          語音
        </button>
        <button type="button" className="cv-tool" disabled={uploadBusy} onClick={() => videoRef.current?.click()} title="插入影片">
          影片
        </button>
        <button type="button" className="cv-tool" disabled={uploadBusy} onClick={() => onInsertUrl?.()} title="網址／YouTube／網頁">
          網址
        </button>
        <button type="button" className="cv-tool" disabled={uploadBusy} onClick={() => pdfRef.current?.click()} title="插入 PDF">
          PDF
        </button>
        <button type="button" className="cv-tool" disabled={uploadBusy} onClick={() => pptRef.current?.click()} title="插入 PPT">
          PPT
        </button>
        <button type="button" className="cv-tool" disabled={uploadBusy} onClick={() => fileRef.current?.click()} title="插入檔案">
          檔案
        </button>
        {uploadBusy && <span className="cv-zoom">上傳中…</span>}
      </div>

      <input ref={imageRef} type="file" accept="image/*" hidden multiple onChange={(e) => { pick(e.target.files); e.target.value = ""; }} />
      <input ref={audioRef} type="file" accept="audio/*" hidden multiple onChange={(e) => { pick(e.target.files); e.target.value = ""; }} />
      <input ref={videoRef} type="file" accept="video/*" hidden multiple onChange={(e) => { pick(e.target.files); e.target.value = ""; }} />
      <input ref={pdfRef} type="file" accept="application/pdf,.pdf" hidden multiple onChange={(e) => { pick(e.target.files); e.target.value = ""; }} />
      <input
        ref={pptRef}
        type="file"
        accept=".ppt,.pptx,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation"
        hidden
        multiple
        onChange={(e) => {
          pick(e.target.files);
          e.target.value = "";
        }}
      />
      <input ref={fileRef} type="file" hidden multiple onChange={(e) => { pick(e.target.files); e.target.value = ""; }} />

      <div className="cv-tool-group">
        <button type="button" className="cv-tool" onClick={onZoomOut} title="Ctrl+-">－</button>
        <span className="cv-zoom">{Math.round(scale * 100)}%</span>
        <button type="button" className="cv-tool" onClick={onZoomIn} title="Ctrl+=">＋</button>
        <button type="button" className="cv-tool" onClick={onFit} title="Shift+1 · 看全部">適中</button>
        <button type="button" className="cv-tool" onClick={onReset} title="Shift+0 · 100%">100%</button>
      </div>

      <div className="cv-tool-group">
        <button type="button" className={`cv-tool${grid ? " is-on" : ""}`} onClick={onToggleGrid}>網格</button>
        <button type="button" className={`cv-tool${snap ? " is-on" : ""}`} onClick={onToggleSnap}>對齊</button>
        <button type="button" className="cv-tool" disabled={!canEditSelection} onClick={onDuplicate}>複製</button>
        <button type="button" className="cv-tool" disabled={!canEditSelection} onClick={onDelete}>刪除</button>
        <button type="button" className="cv-tool" onClick={onAutoLayout}>自動排版</button>
        <button type="button" className="cv-tool" onClick={onExport}>匯出</button>
        <button type="button" className="cv-tool" onClick={onImport}>匯入</button>
      </div>
    </div>
  );
}
