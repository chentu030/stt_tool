"use client";

import { STICKY_COLORS, type AlignMode, type Selectable } from "@/lib/canvasStore";

export type SelectionKind = "sticky" | "shape" | "media" | "note" | "section" | "mixed" | "empty";

type Props = {
  box: { x: number; y: number; w: number; h: number };
  count: number;
  kind: SelectionKind;
  color?: string;
  canTranscribe?: boolean;
  hasTranscript?: boolean;
  /** Allow 摘要／心智圖／拆卡 without transcript (YouTube multimodal / PDF text). */
  canOrganize?: boolean;
  onDuplicate: () => void;
  onDelete: () => void;
  onAi: () => void;
  onColor?: (c: string) => void;
  onAlign?: (mode: AlignMode) => void;
  onTranscribe?: () => void;
  onSummarize?: () => void;
  onMindMap?: () => void;
  onSplitCards?: () => void;
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
  canTranscribe,
  hasTranscript,
  canOrganize,
  onDuplicate,
  onDelete,
  onAi,
  onColor,
  onAlign,
  onTranscribe,
  onSummarize,
  onMindMap,
  onSplitCards,
}: Props) {
  const multi = count > 1;

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

      {(kind === "sticky" || kind === "shape" || kind === "section") && onColor && (
        <span className="cv-sel-chrome-swatches" title="顏色">
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
      <button type="button" className="cv-sel-chrome-btn" onClick={onDelete} title="刪除">
        刪除
      </button>
      <button type="button" className="cv-sel-chrome-btn is-ai" onClick={onAi} title="AI 動作">
        AI
      </button>
    </div>
  );
}
