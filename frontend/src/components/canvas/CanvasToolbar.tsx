"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { STICKY_COLORS, ToolId, colorToShapeHex, resolveStickyStyle } from "@/lib/canvasStore";
import CanvasColorPicker from "@/components/canvas/CanvasColorPicker";

type DockPanel = "insert" | "color" | "view" | "more" | null;

const TOOLS: { id: ToolId; label: string; hint: string; icon: string }[] = [
  { id: "select", label: "選取", hint: "V", icon: "arrow_selector_tool" },
  { id: "pan", label: "平移", hint: "H · Space", icon: "pan_tool" },
  { id: "sticky", label: "便利貼", hint: "S", icon: "sticky_note_2" },
  { id: "text", label: "文字", hint: "T", icon: "title" },
  { id: "rect", label: "矩形", hint: "R", icon: "rectangle" },
  { id: "ellipse", label: "圓形", hint: "O", icon: "circle" },
  { id: "frame", label: "框架", hint: "F", icon: "crop_square" },
  { id: "connect", label: "連線", hint: "C", icon: "timeline" },
];

type Props = {
  tool: ToolId;
  onTool: (t: ToolId) => void;
  stickyColor: string;
  onStickyColor: (c: string) => void;
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
  selectionCount?: number;
  onInsertFiles?: (files: FileList | File[]) => void;
  onInsertUrl?: () => void;
  onInsertSection?: () => void;
  uploadBusy?: boolean;
  onShare?: () => void;
  shareEnabled?: boolean;
};

function DockTip({ label, hint }: { label: string; hint: string }) {
  return (
    <span className="cv-dock-tip" role="tooltip">
      <strong>{label}</strong>
      <em>{hint}</em>
    </span>
  );
}

function DockGlyph({ name, filled }: { name: string; filled?: boolean }) {
  return (
    <span
      className="material-symbols-outlined cv-dock-glyph"
      style={{
        fontVariationSettings: `'FILL' ${filled ? 1 : 0}, 'wght' 450, 'GRAD' 0, 'opsz' 20`,
      }}
      aria-hidden
    >
      {name}
    </span>
  );
}

function DockBtn({
  label,
  hint,
  active,
  disabled,
  expanded,
  onClick,
  children,
  className = "",
}: {
  label: string;
  hint: string;
  active?: boolean;
  disabled?: boolean;
  expanded?: boolean;
  onClick: () => void;
  children: ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      className={`cv-dock-btn${active ? " is-on" : ""}${className ? ` ${className}` : ""}`}
      aria-label={`${label}${hint ? `（${hint}）` : ""}`}
      aria-expanded={expanded}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
      <span className="cv-dock-label">{label}</span>
      <DockTip label={label} hint={hint} />
    </button>
  );
}

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
  selectionCount = 0,
  onInsertFiles,
  onInsertUrl,
  onInsertSection,
  uploadBusy,
  onShare,
  shareEnabled,
}: Props) {
  const imageRef = useRef<HTMLInputElement>(null);
  const audioRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLInputElement>(null);
  const pdfRef = useRef<HTMLInputElement>(null);
  const pptRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const customBtnRef = useRef<HTMLButtonElement>(null);
  const dockRef = useRef<HTMLDivElement>(null);
  const [panel, setPanel] = useState<DockPanel>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  const pick = (files: FileList | null) => {
    if (files?.length) onInsertFiles?.(files);
  };

  const customStyle = resolveStickyStyle(stickyColor);
  const isCustom = !STICKY_COLORS.some((c) => c.id === stickyColor);
  const hasSelection = selectionCount > 0;
  const editMode = hasSelection && canEditSelection;
  const zoomPct = Math.round(scale * 100);

  const togglePanel = (id: DockPanel) => {
    setPanel((p) => (p === id ? null : id));
    setPickerOpen(false);
  };

  useEffect(() => {
    if (!panel && !pickerOpen) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node | null;
      if (dockRef.current && t && !dockRef.current.contains(t)) {
        setPanel(null);
        setPickerOpen(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [panel, pickerOpen]);

  const fileInputs = (
    <>
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
    </>
  );

  const insertPanel = panel === "insert" && (
    <div className="cv-dock-panel" role="menu">
      <p className="cv-dock-panel-title">插入</p>
      <button type="button" className="cv-dock-panel-item" disabled={uploadBusy} onClick={() => imageRef.current?.click()}>圖片</button>
      <button type="button" className="cv-dock-panel-item" disabled={uploadBusy} onClick={() => audioRef.current?.click()}>語音</button>
      <button type="button" className="cv-dock-panel-item" disabled={uploadBusy} onClick={() => videoRef.current?.click()}>影片</button>
      <button type="button" className="cv-dock-panel-item" disabled={uploadBusy} onClick={() => { onInsertUrl?.(); setPanel(null); }}>網址 / YouTube</button>
      <button type="button" className="cv-dock-panel-item" onClick={() => { onInsertSection?.(); setPanel(null); }}>分區</button>
      <button type="button" className="cv-dock-panel-item" disabled={uploadBusy} onClick={() => pdfRef.current?.click()}>PDF</button>
      <button type="button" className="cv-dock-panel-item" disabled={uploadBusy} onClick={() => pptRef.current?.click()}>簡報</button>
      <button type="button" className="cv-dock-panel-item" disabled={uploadBusy} onClick={() => fileRef.current?.click()}>檔案</button>
      {uploadBusy && <span className="cv-dock-panel-meta">上傳中…</span>}
    </div>
  );

  const colorPanel = panel === "color" && (
    <div className="cv-dock-panel cv-dock-panel--colors" role="menu">
      <p className="cv-dock-panel-title">顏色{editMode ? " · 套用到選取" : ""}</p>
      <div className="cv-dock-swatches">
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
        <button
          ref={customBtnRef}
          type="button"
          className={`cv-swatch cv-swatch--custom${isCustom || pickerOpen ? " is-on" : ""}`}
          style={{
            background: `conic-gradient(from 180deg, ${customStyle.border}, ${customStyle.bg}, ${colorToShapeHex(stickyColor)})`,
            borderColor: customStyle.border,
          }}
          title="自訂顏色"
          onClick={() => setPickerOpen((v) => !v)}
        />
      </div>
      <CanvasColorPicker
        color={stickyColor}
        onChange={onStickyColor}
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        anchorRef={customBtnRef}
      />
    </div>
  );

  const viewPanel = panel === "view" && (
    <div className="cv-dock-panel" role="menu">
      <p className="cv-dock-panel-title">檢視 · {zoomPct}%</p>
      <div className="cv-dock-panel-row">
        <button type="button" className="cv-dock-panel-item" onClick={onZoomOut}>縮小</button>
        <button type="button" className="cv-dock-panel-item" onClick={onZoomIn}>放大</button>
      </div>
      <button type="button" className="cv-dock-panel-item" onClick={() => { onFit(); setPanel(null); }}>適中（看全部）</button>
      <button type="button" className="cv-dock-panel-item" onClick={() => { onReset(); setPanel(null); }}>100%</button>
    </div>
  );

  const morePanel = panel === "more" && (
    <div className="cv-dock-panel" role="menu">
      <p className="cv-dock-panel-title">更多</p>
      <button type="button" className={`cv-dock-panel-item${grid ? " is-on" : ""}`} onClick={onToggleGrid}>網格</button>
      <button type="button" className={`cv-dock-panel-item${snap ? " is-on" : ""}`} onClick={onToggleSnap}>對齊</button>
      <button type="button" className="cv-dock-panel-item" onClick={() => { onAutoLayout(); setPanel(null); }}>自動排版</button>
      <button type="button" className="cv-dock-panel-item" onClick={() => { onExport(); setPanel(null); }}>匯出</button>
      <button type="button" className="cv-dock-panel-item" onClick={() => { onImport(); setPanel(null); }}>匯入</button>
      {onShare && (
        <button
          type="button"
          className={`cv-dock-panel-item${shareEnabled ? " is-on" : ""}`}
          onClick={() => { onShare(); setPanel(null); }}
        >
          {shareEnabled ? "分享中…" : "分享白板"}
        </button>
      )}
    </div>
  );

  const rail = (
    <div className={`cv-dock-rail${editMode ? " is-edit" : ""}`} role="toolbar" aria-label="白板工具">
      {(editMode
        ? TOOLS.filter((t) => t.id === "select" || t.id === "pan")
        : TOOLS
      ).map((t) => (
        <DockBtn
          key={t.id}
          label={t.label}
          hint={t.hint}
          active={tool === t.id}
          onClick={() => {
            onTool(t.id);
            setPanel(null);
            setMobileOpen(false);
          }}
        >
          <DockGlyph name={t.icon} filled={tool === t.id} />
        </DockBtn>
      ))}

      <span className="cv-dock-sep" aria-hidden />

      {editMode ? (
        <>
          <DockBtn
            label="顏色"
            hint="套用到選取"
            active={panel === "color"}
            expanded={panel === "color"}
            onClick={() => togglePanel("color")}
          >
            <span
              className="cv-dock-icon cv-dock-icon--swatch"
              style={{ background: customStyle.bg, borderColor: customStyle.border }}
              aria-hidden
            />
          </DockBtn>
          <DockBtn
            label="複製"
            hint="Ctrl+D"
            disabled={!canEditSelection}
            onClick={onDuplicate}
          >
            <DockGlyph name="content_copy" />
          </DockBtn>
          <DockBtn
            label="刪除"
            hint="Del"
            disabled={!canEditSelection}
            onClick={onDelete}
          >
            <DockGlyph name="delete" />
          </DockBtn>
          {selectionCount > 1 && (
            <span className="cv-dock-badge" title={`已選 ${selectionCount} 個`}>
              {selectionCount}
            </span>
          )}
        </>
      ) : (
        <>
          <DockBtn
            label="插入"
            hint="媒體／網址"
            active={panel === "insert"}
            expanded={panel === "insert"}
            onClick={() => togglePanel("insert")}
          >
            <DockGlyph name="add" />
          </DockBtn>
          <DockBtn
            label="顏色"
            hint="便利貼／形狀"
            active={panel === "color"}
            expanded={panel === "color"}
            onClick={() => togglePanel("color")}
          >
            <span
              className="cv-dock-icon cv-dock-icon--swatch"
              style={{ background: customStyle.bg, borderColor: customStyle.border }}
              aria-hidden
            />
          </DockBtn>
        </>
      )}

      <span className="cv-dock-sep" aria-hidden />

      <DockBtn
        label="檢視"
        hint={`${zoomPct}%`}
        active={panel === "view"}
        expanded={panel === "view"}
        onClick={() => togglePanel("view")}
      >
        <span className="cv-dock-zoom" aria-hidden>
          {zoomPct}
        </span>
      </DockBtn>
      <DockBtn
        label="更多"
        hint="網格／匯出／分享"
        active={panel === "more"}
        expanded={panel === "more"}
        onClick={() => togglePanel("more")}
      >
        <DockGlyph name="more_horiz" />
      </DockBtn>
    </div>
  );

  return (
    <div className={`cv-dock${mobileOpen ? " is-mobile-open" : ""}`} ref={dockRef}>
      <button
        type="button"
        className="cv-dock-fab"
        aria-label={mobileOpen ? "收合工具" : "開啟工具"}
        onClick={() => {
          setMobileOpen((v) => !v);
          setPanel(null);
        }}
      >
        <DockGlyph name={mobileOpen ? "close" : "construction"} />
      </button>

      <div className="cv-dock-body">
        {rail}
        <div className="cv-dock-panels">
          {insertPanel}
          {colorPanel}
          {viewPanel}
          {morePanel}
        </div>
      </div>
      {fileInputs}
    </div>
  );
}
