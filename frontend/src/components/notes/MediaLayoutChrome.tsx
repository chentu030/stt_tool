"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import {
  MEDIA_WRAP_OPTIONS,
  clampOffset,
  clampWidthPct,
  normalizeAlign,
  normalizeWrap,
  readLayoutFromAttrs,
  type MediaAlign,
  type MediaLayout,
  type MediaWrap,
} from "@/lib/mediaLayout";

type Props = {
  attrs: Record<string, unknown>;
  updateAttributes: (patch: Partial<MediaLayout>) => void;
  selected?: boolean;
  readOnly?: boolean;
  className?: string;
  children: ReactNode;
};

export default function MediaLayoutChrome({
  attrs,
  updateAttributes,
  selected = false,
  readOnly = false,
  className = "",
  children,
}: Props) {
  const layout = readLayoutFromAttrs(attrs);
  const frameRef = useRef<HTMLDivElement | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const resizing = useRef(false);
  const floating = useRef(false);

  useEffect(() => {
    if (!selected) setMenuOpen(false);
  }, [selected]);

  const onResizePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (readOnly) return;
      e.preventDefault();
      e.stopPropagation();
      const frame = frameRef.current;
      const prose = frame?.closest(".rich-prose") as HTMLElement | null;
      if (!frame || !prose) return;
      resizing.current = true;
      const startX = e.clientX;
      const startW = layout.widthPct;
      const proseW = prose.getBoundingClientRect().width || 1;
      const onMove = (ev: PointerEvent) => {
        if (!resizing.current) return;
        const dx = ev.clientX - startX;
        const deltaPct = (dx / proseW) * 100;
        // Grow/shrink from the side that feels natural for align.
        const sign = layout.align === "left" ? 1 : layout.align === "right" ? -1 : 1;
        updateAttributes({ widthPct: clampWidthPct(startW + sign * deltaPct) });
      };
      const onUp = () => {
        resizing.current = false;
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [layout.align, layout.widthPct, readOnly, updateAttributes]
  );

  const onFloatPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (readOnly) return;
      if (layout.wrap !== "front" && layout.wrap !== "behind") return;
      const t = e.target as HTMLElement;
      if (t.closest(".rich-media-toolbar, .rich-media-resize, input, button, a, textarea")) return;
      e.preventDefault();
      e.stopPropagation();
      const prose = frameRef.current?.closest(".rich-prose") as HTMLElement | null;
      if (!prose) return;
      floating.current = true;
      const rect = prose.getBoundingClientRect();
      const onMove = (ev: PointerEvent) => {
        if (!floating.current) return;
        const x = ((ev.clientX - rect.left) / rect.width) * 100;
        const y = ((ev.clientY - rect.top) / Math.max(rect.height, 1)) * 100;
        updateAttributes({
          offsetX: clampOffset(x - layout.widthPct / 2, layout.offsetX),
          offsetY: clampOffset(y - 4, layout.offsetY),
        });
      };
      const onUp = () => {
        floating.current = false;
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [layout.offsetX, layout.offsetY, layout.widthPct, layout.wrap, readOnly, updateAttributes]
  );

  const showChrome = selected && !readOnly;
  const isOverlay = layout.wrap === "front" || layout.wrap === "behind";

  const style: CSSProperties = {
    width: `${layout.widthPct}%`,
    maxWidth: "100%",
    ...(isOverlay
      ? {
          left: `${layout.offsetX}%`,
          top: `${layout.offsetY}%`,
        }
      : null),
  };

  return (
    <div
      ref={frameRef}
      className={`rich-media-frame ${className}`.trim()}
      data-width-pct={layout.widthPct}
      data-align={layout.align}
      data-wrap={layout.wrap}
      data-ox={layout.offsetX}
      data-oy={layout.offsetY}
      data-selected={showChrome ? "1" : "0"}
      style={style}
      onPointerDown={onFloatPointerDown}
    >
      {showChrome ? (
        <div
          className="rich-media-toolbar"
          contentEditable={false}
          onMouseDown={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
        >
          {(["left", "center", "right"] as MediaAlign[]).map((a) => (
            <button
              key={a}
              type="button"
              className={layout.align === a ? "is-on" : ""}
              title={a === "left" ? "靠左" : a === "right" ? "靠右" : "置中"}
              onClick={() => updateAttributes({ align: normalizeAlign(a) })}
            >
              {a === "left" ? "左" : a === "right" ? "右" : "中"}
            </button>
          ))}
          <span className="rich-media-toolbar-sep" />
          <div className="rich-media-wrap-menu">
            <button
              type="button"
              className={menuOpen ? "is-on" : ""}
              title="文字環繞"
              onClick={() => setMenuOpen((v) => !v)}
            >
              環繞
            </button>
            {menuOpen ? (
              <div className="rich-media-wrap-pop" role="menu">
                {MEDIA_WRAP_OPTIONS.map((o) => (
                  <button
                    key={o.id}
                    type="button"
                    role="menuitem"
                    className={layout.wrap === o.id ? "is-on" : ""}
                    onClick={() => {
                      updateAttributes({ wrap: normalizeWrap(o.id) as MediaWrap });
                      setMenuOpen(false);
                    }}
                  >
                    <strong>{o.label}</strong>
                    <span>{o.hint}</span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <span className="rich-media-toolbar-pct">{layout.widthPct}%</span>
        </div>
      ) : null}
      <div className="rich-media-frame-body">{children}</div>
      {showChrome ? (
        <button
          type="button"
          className="rich-media-resize"
          title="拖曳調整大小"
          aria-label="調整大小"
          onPointerDown={onResizePointerDown}
        />
      ) : null}
    </div>
  );
}
