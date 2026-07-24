"use client";

import { useRef, useState } from "react";
import {
  STICKY_COLORS,
  colorToShapeHex,
  resolveStickyStyle,
  type AlignMode,
  type Selectable,
} from "@/lib/canvasStore";
import CanvasColorPicker from "@/components/canvas/CanvasColorPicker";

export type SelectionKind = "sticky" | "shape" | "media" | "note" | "section" | "stroke" | "mixed" | "empty";

type Props = {
  box: { x: number; y: number; w: number; h: number };
  count: number;
  kind: SelectionKind;
  color?: string;
  opacity?: number;
  textColor?: string;
  canTranscribe?: boolean;
  hasTranscript?: boolean;
  /** Allow 摘要／心智圖／拆卡 without transcript (YouTube multimodal / PDF text). */
  canOrganize?: boolean;
  onDuplicate: () => void;
  onDelete: () => void;
  onAi: () => void;
  onColor?: (c: string) => void;
  onOpacity?: (o: number) => void;
  onTextColor?: (c: string) => void;
  onAlign?: (mode: AlignMode) => void;
  onTranscribe?: () => void;
  onSummarize?: () => void;
  onMindMap?: () => void;
  onSplitCards?: () => void;
  onHarvestNote?: () => void;
};

export function selectionKindOf(selected: Selectable[]): SelectionKind {
  if (!selected.length) return "empty";
  const types = new Set(selected.map((s) => s.type).filter((t) => t !== "edge"));
  if (types.size === 0) return "empty";
  if (types.size > 1) return "mixed";
  return [...types][0] as SelectionKind;
}

export default function CanvasSelectionChrome({
  box,
  count,
  kind,
  color,
  opacity = 1,
  textColor,
  canTranscribe,
  hasTranscript,
  canOrganize,
  onDuplicate,
  onDelete,
  onAi,
  onColor,
  onOpacity,
  onTextColor,
  onAlign,
  onTranscribe,
  onSummarize,
  onMindMap,
  onSplitCards,
  onHarvestNote,
}: Props) {
  const multi = count > 1;
  const [fillOpen, setFillOpen] = useState(false);
  const [textOpen, setTextOpen] = useState(false);
  const fillBtnRef = useRef<HTMLButtonElement>(null);
  const textBtnRef = useRef<HTMLButtonElement>(null);
  const showFill =
    (kind === "sticky" || kind === "shape" || kind === "section" || kind === "stroke") && onColor;
  const showText = kind === "sticky" && onTextColor;
  const fillStyle = color ? resolveStickyStyle(color, opacity) : null;
  const textHex = textColor ? colorToShapeHex(textColor) : "#1f2937";

  return (
    <div
      className="cv-sel-chrome"
      style={{
        left: box.x + box.w / 2,
        top: Math.max(8, box.y - 8),
      }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <span className="cv-sel-chrome-count">{multi ? `已選 ${count}` : "已選"}</span>

      {showFill && (
        <span className="cv-sel-chrome-swatches" title="填色">
          {STICKY_COLORS.map((c) => (
            <button
              key={c.id}
              type="button"
              className={`cv-sel-chrome-swatch${color === c.id ? " is-on" : ""}`}
              style={{ background: c.bg, borderColor: c.border }}
              title={c.label}
              onClick={() => onColor(c.id)}
            />
          ))}
          <button
            ref={fillBtnRef}
            type="button"
            className={`cv-sel-chrome-swatch cv-sel-chrome-swatch--custom${fillOpen ? " is-on" : ""}`}
            style={{
              background: fillStyle
                ? `conic-gradient(from 180deg, ${fillStyle.border}, ${fillStyle.bg}, ${colorToShapeHex(color || "yellow")})`
                : undefined,
            }}
            title="自訂填色／透明度"
            onClick={() => {
              setTextOpen(false);
              setFillOpen((v) => !v);
            }}
          />
          <CanvasColorPicker
            color={color || "yellow"}
            onChange={onColor}
            opacity={opacity}
            onOpacityChange={onOpacity}
            open={fillOpen}
            onClose={() => setFillOpen(false)}
            anchorRef={fillBtnRef}
            title="填色"
          />
        </span>
      )}

      {showText && (
        <span className="cv-sel-chrome-swatches" title="文字顏色">
          <button
            ref={textBtnRef}
            type="button"
            className={`cv-sel-chrome-btn is-tiny${textOpen ? " is-on" : ""}`}
            title="文字顏色"
            onClick={() => {
              setFillOpen(false);
              setTextOpen((v) => !v);
            }}
          >
            <span className="cv-sel-chrome-text-swatch" style={{ background: textHex }} />
            字色
          </button>
          <CanvasColorPicker
            color={textColor || "#1f2937"}
            onChange={onTextColor}
            open={textOpen}
            onClose={() => setTextOpen(false)}
            anchorRef={textBtnRef}
            hidePresets
            title="文字顏色"
          />
        </span>
      )}

      {multi && onAlign && (
        <span className="cv-sel-chrome-align" title="對齊／均分（重疊時會自動拉開）">
          {(
            [
              ["left", "左", "左對齊"],
              ["centerX", "中", "水平置中"],
              ["right", "右", "右對齊"],
              ["top", "上", "上對齊"],
              ["centerY", "直中", "垂直置中"],
              ["bottom", "下", "下對齊"],
              ["distributeX", "橫距", "水平均分（間距不足會拉開）"],
              ["distributeY", "直距", "垂直均分（間距不足會拉開）"],
            ] as [AlignMode, string, string][]
          ).map(([mode, label, tip]) => (
            <button
              key={mode}
              type="button"
              className="cv-sel-chrome-btn is-tiny"
              title={tip}
              onClick={() => onAlign(mode)}
            >
              {label}
            </button>
          ))}
        </span>
      )}

      {kind === "media" && canTranscribe && !hasTranscript && onTranscribe && (
        <button type="button" className="cv-sel-chrome-btn" onClick={onTranscribe}>
          轉錄
        </button>
      )}
      {kind === "media" && (hasTranscript || canOrganize) && (
        <>
          {onSummarize && (
            <button type="button" className="cv-sel-chrome-btn" onClick={onSummarize}>
              摘要
            </button>
          )}
          {onMindMap && (
            <button type="button" className="cv-sel-chrome-btn" onClick={onMindMap}>
              心智圖
            </button>
          )}
          {onSplitCards && (
            <button type="button" className="cv-sel-chrome-btn is-ai" onClick={onSplitCards}>
              拆成知識卡
            </button>
          )}
        </>
      )}

      <button type="button" className="cv-sel-chrome-btn" onClick={onDuplicate} title="複製">
        複製
      </button>
      {onHarvestNote && (kind === "sticky" || kind === "mixed" || kind === "section" || multi) && (
        <button
          type="button"
          className="cv-sel-chrome-btn is-ai"
          onClick={onHarvestNote}
          title="把選取內容收成筆記"
        >
          收成筆記
        </button>
      )}
      <button type="button" className="cv-sel-chrome-btn" onClick={onDelete} title="刪除">
        刪除
      </button>
      {kind !== "stroke" && (
        <button type="button" className="cv-sel-chrome-btn is-ai" onClick={onAi} title="AI 動作">
          AI
        </button>
      )}
    </div>
  );
}
