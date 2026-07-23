"use client";

import { useEffect, useRef, useState } from "react";
import { STICKY_COLORS, ToolId, colorToShapeHex, resolveStickyStyle } from "@/lib/canvasStore";
import CanvasColorPicker from "@/components/canvas/CanvasColorPicker";

type DockPanel = "insert" | "color" | "view" | "more" | null;

const TOOLS: { id: ToolId; label: string; hint: string; icon: string }[] = [
  { id: "select", label: "選取", hint: "V", icon: "↖" },
  { id: "pan", label: "平移", hint: "H · Space", icon: "✋" },
  { id: "sticky", label: "便利貼", hint: "S", icon: "🗒" },
  { id: "text", label: "文字", hint: "T", icon: "T" },
  { id: "rect", label: "矩形", hint: "R", icon: "▭" },
  { id: "ellipse", label: "圓形", hint: "O", icon: "○" },
  { id: "frame", label: "框架", hint: "F", icon: "▢" },
  { id: "connect", label: "連線", hint: "C", icon: "⤴" },
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
      <p className="cv-dock-panel-title">檢視 · {Math.round(scale * 100)}%</p>
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
        <button
          key={t.id}
          type="button"
          className={`cv-dock-btn${tool === t.id ? " is-on" : ""}`}
          aria-label={`${t.label}（${t.hint}）`}
          onClick={() => {
            onTool(t.id);
            setPanel(null);
            setMobileOpen(false);
          }}
        >
          <span className="cv-dock-icon" aria-hidden>
            {t.icon}
          </span>
          <DockTip label={t.label} hint={t.hint} />
        </button>
      ))}

      <span className="cv-dock-sep" aria-hidden />

      {editMode ? (
        <>
          <button
            type="button"
            className={`cv-dock-btn${panel === "color" ? " is-on" : ""}`}
            aria-label="顏色"
            onClick={() => togglePanel("color")}
          >
            <span
              className="cv-dock-icon cv-dock-icon--swatch"
              style={{ background: customStyle.bg, borderColor: customStyle.border }}
              aria-hidden
            />
            <DockTip label="顏色" hint="套用到選取" />
          </button>
          <button
            type="button"
            className="cv-dock-btn"
            aria-label="複製"
            disabled={!canEditSelection}
            onClick={onDuplicate}
          >
            <span className="cv-dock-icon" aria-hidden>⧉</span>
            <DockTip label="複製" hint="Ctrl+D" />
          </button>
          <button
            type="button"
            className="cv-dock-btn"
            aria-label="刪除"
            disabled={!canEditSelection}
            onClick={onDelete}
          >
            <span className="cv-dock-icon" aria-hidden>×</span>
            <DockTip label="刪除" hint="Del" />
          </button>
          {selectionCount > 1 && (
            <span className="cv-dock-badge" title={`已選 ${selectionCount} 個`}>
              {selectionCount}
            </span>
          )}
        </>
      ) : (
        <>
          <button
            type="button"
            className={`cv-dock-btn${panel === "insert" ? " is-on" : ""}`}
            aria-label="插入"
            aria-expanded={panel === "insert"}
            onClick={() => togglePanel("insert")}
          >
            <span className="cv-dock-icon" aria-hidden>+</span>
            <DockTip label="插入" hint="媒體／網址" />
          </button>
          <button
            type="button"
            className={`cv-dock-btn${panel === "color" ? " is-on" : ""}`}
            aria-label="顏色"
            onClick={() => togglePanel("color")}
          >
            <span
              className="cv-dock-icon cv-dock-icon--swatch"
              style={{ background: customStyle.bg, borderColor: customStyle.border }}
              aria-hidden
            />
            <DockTip label="顏色" hint="便利貼／形狀" />
          </button>
        </>
      )}

      <span className="cv-dock-sep" aria-hidden />

      <button
        type="button"
        className={`cv-dock-btn${panel === "view" ? " is-on" : ""}`}
        aria-label="檢視"
        onClick={() => togglePanel("view")}
      >
        <span className="cv-dock-icon cv-dock-icon--sm" aria-hidden>
          {Math.round(scale * 100)}
        </span>
        <DockTip label="檢視" hint={`${Math.round(scale * 100)}%`} />
      </button>
      <button
        type="button"
        className={`cv-dock-btn${panel === "more" ? " is-on" : ""}`}
        aria-label="更多"
        onClick={() => togglePanel("more")}
      >
        <span className="cv-dock-icon" aria-hidden>⋯</span>
        <DockTip label="更多" hint="網格／匯出／分享" />
      </button>
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
        {mobileOpen ? "×" : "+"}
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
