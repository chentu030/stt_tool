"use client";

import type { CSSProperties, PointerEvent as ReactPointerEvent, RefObject } from "react";
import { Slide, SlideBlock, ThemeTokens } from "@/lib/slideDeck";

type Props = {
  slide: Slide;
  theme: ThemeTokens;
  selectedId?: string | null;
  editingId?: string | null;
  interactive?: boolean;
  onSelect?: (id: string | null) => void;
  onChangeBlock?: (id: string, patch: Partial<SlideBlock>) => void;
  onEditStart?: (id: string) => void;
  onEditEnd?: () => void;
  stageRef?: RefObject<HTMLDivElement | null>;
};

function fontSizeFor(block: SlideBlock, stageH: number) {
  const base = Math.max(14, stageH * 0.035);
  return `${base * (block.scale || 1)}px`;
}

export default function SlideStage({
  slide,
  theme,
  selectedId,
  editingId,
  interactive = false,
  onSelect,
  onChangeBlock,
  onEditStart,
  onEditEnd,
  stageRef,
}: Props) {
  return (
    <div
      ref={stageRef}
      className="slide-stage"
      style={
        {
          "--slide-bg": theme.bg,
          "--slide-fg": theme.fg,
          "--slide-muted": theme.muted,
          "--slide-accent": theme.accent,
          "--slide-card": theme.card,
        } as CSSProperties
      }
      onMouseDown={(e) => {
        if (!interactive) return;
        if (e.target === e.currentTarget) onSelect?.(null);
      }}
    >
      <div className="slide-stage-accent" aria-hidden />
      {slide.blocks.map((b) => (
        <SlideBlockView
          key={b.id}
          block={b}
          selected={selectedId === b.id}
          editing={editingId === b.id}
          interactive={interactive}
          onSelect={() => onSelect?.(b.id)}
          onChange={(patch) => onChangeBlock?.(b.id, patch)}
          onEditStart={() => onEditStart?.(b.id)}
          onEditEnd={onEditEnd}
        />
      ))}
    </div>
  );
}

function SlideBlockView({
  block,
  selected,
  editing,
  interactive,
  onSelect,
  onChange,
  onEditStart,
  onEditEnd,
}: {
  block: SlideBlock;
  selected: boolean;
  editing: boolean;
  interactive: boolean;
  onSelect: () => void;
  onChange: (patch: Partial<SlideBlock>) => void;
  onEditStart: () => void;
  onEditEnd?: () => void;
}) {
  const dragRef = { sx: 0, sy: 0, ox: 0, oy: 0, mode: "" as "" | "move" | "resize" };

  const onPointerDown = (e: ReactPointerEvent) => {
    if (!interactive || editing) return;
    e.stopPropagation();
    e.preventDefault();
    onSelect();
    const target = e.currentTarget as HTMLElement;
    const stage = target.closest(".slide-stage") as HTMLElement | null;
    if (!stage) return;
    const isResize = (e.target as HTMLElement).dataset.handle === "resize";
    dragRef.mode = isResize ? "resize" : "move";
    dragRef.sx = e.clientX;
    dragRef.sy = e.clientY;
    dragRef.ox = block.x;
    dragRef.oy = block.y;
    const ow = block.w;
    const oh = block.h;
    const rect = stage.getBoundingClientRect();

    const onMove = (ev: globalThis.PointerEvent) => {
      const dx = ((ev.clientX - dragRef.sx) / rect.width) * 100;
      const dy = ((ev.clientY - dragRef.sy) / rect.height) * 100;
      if (dragRef.mode === "move") {
        onChange({ x: dragRef.ox + dx, y: dragRef.oy + dy });
      } else {
        onChange({ w: ow + dx, h: oh + dy });
      }
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const style: CSSProperties = {
    left: `${block.x}%`,
    top: `${block.y}%`,
    width: `${block.w}%`,
    height: `${block.h}%`,
    textAlign: block.align || "left",
    fontWeight: block.bold ? 700 : 500,
    color: block.role === "caption" || block.role === "subtitle" ? "var(--slide-muted)" : "var(--slide-fg)",
  };

  return (
    <div
      className={`slide-block${selected ? " is-on" : ""}${editing ? " is-edit" : ""}${interactive ? " is-interactive" : ""}`}
      style={style}
      onPointerDown={onPointerDown}
      onDoubleClick={(e) => {
        if (!interactive || block.type !== "text") return;
        e.stopPropagation();
        onEditStart();
      }}
    >
      {block.type === "image" && block.src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={block.src} alt="" className="slide-block-img" draggable={false} />
      ) : editing ? (
        <textarea
          className="slide-block-input"
          autoFocus
          value={block.text || ""}
          onChange={(e) => onChange({ text: e.target.value })}
          onBlur={() => onEditEnd?.()}
          onPointerDown={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              onEditEnd?.();
            }
          }}
        />
      ) : (
        <div className="slide-block-text" style={{ fontSize: `calc(var(--slide-unit, 16px) * ${block.scale || 1})` }}>
          {(block.text || "").split("\n").map((line, i) => (
            <div key={i}>{line || "\u00A0"}</div>
          ))}
        </div>
      )}
      {interactive && selected && !editing && (
        <span className="slide-resize" data-handle="resize" title="縮放" />
      )}
    </div>
  );
}

/** Unused helper kept for potential measurement */
export function measureFont(block: SlideBlock, h: number) {
  return fontSizeFor(block, h);
}
