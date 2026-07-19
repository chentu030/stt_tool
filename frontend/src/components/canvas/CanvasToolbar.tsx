"use client";

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
}: Props) {
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
        <button type="button" className="cv-tool" onClick={onZoomOut}>－</button>
        <span className="cv-zoom">{Math.round(scale * 100)}%</span>
        <button type="button" className="cv-tool" onClick={onZoomIn}>＋</button>
        <button type="button" className="cv-tool" onClick={onFit}>適中</button>
        <button type="button" className="cv-tool" onClick={onReset}>重置視角</button>
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
