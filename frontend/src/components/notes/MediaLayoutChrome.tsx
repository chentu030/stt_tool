"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import {
  MEDIA_WRAP_OPTIONS,
  clampOffset,
  clampWidthPct,
  normalizeAlign,
  normalizeWrap,
  offsetXForAlign,
  readLayoutFromAttrs,
  type MediaAlign,
  type MediaLayout,
  type MediaWrap,
} from "@/lib/mediaLayout";

type Props = {
  attrs: Record<string, unknown>;
  updateAttributes: (patch: Partial<MediaLayout>) => void;
  /** Keep NodeSelection after layout edits so chrome stays usable. */
  onRequestSelect?: () => void;
  /** Remove the media node from the document. */
  onDelete?: () => void;
  selected?: boolean;
  readOnly?: boolean;
  className?: string;
  children: ReactNode;
};

function setFloatDragging(on: boolean) {
  document.body.classList.toggle("rich-media-float-dragging", on);
  if (on) {
    window.getSelection()?.removeAllRanges();
  }
}

export default function MediaLayoutChrome({
  attrs,
  updateAttributes,
  onRequestSelect,
  onDelete,
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

  useEffect(() => {
    return () => setFloatDragging(false);
  }, []);

  const commitLayout = useCallback(
    (patch: Partial<MediaLayout>) => {
      updateAttributes(patch);
      // Attribute transactions often drop NodeSelection — re-select so wrap/resize stay available.
      queueMicrotask(() => onRequestSelect?.());
    },
    [onRequestSelect, updateAttributes]
  );

  const applyAlign = useCallback(
    (raw: MediaAlign) => {
      const align = normalizeAlign(raw);
      if (layout.wrap === "front" || layout.wrap === "behind") {
        // Full-width overlays can't visually shift; shrink so L/C/R is meaningful.
        const widthPct = layout.widthPct >= 95 ? 45 : layout.widthPct;
        commitLayout({
          align,
          widthPct,
          offsetX: offsetXForAlign(align, widthPct),
        });
        return;
      }
      if (layout.wrap === "floatLeft" || layout.wrap === "floatRight") {
        if (align === "left") {
          commitLayout({ align, wrap: "floatLeft" });
          return;
        }
        if (align === "right") {
          commitLayout({ align, wrap: "floatRight" });
          return;
        }
        commitLayout({ align, wrap: "inline" });
        return;
      }
      // Inline/break: margin align needs width < 100% to look different.
      if (align !== "left" && layout.widthPct >= 95 && layout.wrap !== "break") {
        commitLayout({ align, widthPct: 60 });
        return;
      }
      commitLayout({ align });
    },
    [commitLayout, layout.widthPct, layout.wrap]
  );

  const onResizePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (readOnly) return;
      e.preventDefault();
      e.stopPropagation();
      onRequestSelect?.();
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
        queueMicrotask(() => onRequestSelect?.());
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [layout.align, layout.widthPct, onRequestSelect, readOnly, updateAttributes]
  );

  const onFloatPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (readOnly) return;
      const t = e.target as HTMLElement;
      if (t.closest(".rich-media-toolbar, .rich-media-resize, input, button, a, textarea")) return;
      // Always try to select first so chrome (環繞 / 縮放) can appear again.
      onRequestSelect?.();
      if (layout.wrap !== "front" && layout.wrap !== "behind") return;
      // Capture-phase + preventDefault stops native text selection under the floating image.
      e.preventDefault();
      e.stopPropagation();
      const prose = frameRef.current?.closest(".rich-prose") as HTMLElement | null;
      if (!prose) return;
      const startX = e.clientX;
      const startY = e.clientY;
      const rect = prose.getBoundingClientRect();
      let dragging = false;
      const onMove = (ev: PointerEvent) => {
        const dist = Math.hypot(ev.clientX - startX, ev.clientY - startY);
        if (!dragging) {
          if (dist < 5) return;
          dragging = true;
          floating.current = true;
          setFloatDragging(true);
        }
        if (!floating.current) return;
        ev.preventDefault();
        const x = ((ev.clientX - rect.left) / rect.width) * 100;
        const y = ((ev.clientY - rect.top) / Math.max(rect.height, 1)) * 100;
        updateAttributes({
          offsetX: clampOffset(x - layout.widthPct / 2, layout.offsetX),
          offsetY: clampOffset(y - 4, layout.offsetY),
        });
      };
      const onUp = () => {
        floating.current = false;
        setFloatDragging(false);
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        if (dragging) queueMicrotask(() => onRequestSelect?.());
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [layout.offsetX, layout.offsetY, layout.widthPct, layout.wrap, onRequestSelect, readOnly, updateAttributes]
  );

  const showChrome = selected && !readOnly;
  const isOverlay = layout.wrap === "front" || layout.wrap === "behind";
  const isFloat = layout.wrap === "floatLeft" || layout.wrap === "floatRight";

  const style: CSSProperties = {
    width: `${layout.widthPct}%`,
    maxWidth: "100%",
    ...(isOverlay
      ? {
          left: `${layout.offsetX}%`,
          top: `${layout.offsetY}%`,
        }
      : null),
    // Inline margins beat CSS specificity wars (e.g. shell > frame { margin: 0 }).
    ...(!isOverlay && !isFloat
      ? {
          marginLeft: layout.align === "left" ? 0 : "auto",
          marginRight: layout.align === "right" ? 0 : "auto",
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
      onPointerDownCapture={onFloatPointerDown}
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
              onClick={() => applyAlign(a)}
            >
              {a === "left" ? "左" : a === "right" ? "右" : "中"}
            </button>
          ))}
          <span className="rich-media-toolbar-sep" />
          <div className="rich-media-wrap-menu">
            <button
              type="button"
              className={menuOpen || layout.wrap !== "inline" ? "is-on" : ""}
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
                      const wrap = normalizeWrap(o.id) as MediaWrap;
                      if (wrap === "front" || wrap === "behind") {
                        const widthPct = layout.widthPct >= 95 ? 45 : layout.widthPct;
                        commitLayout({
                          wrap,
                          widthPct,
                          offsetX: offsetXForAlign(layout.align, widthPct),
                        });
                      } else {
                        commitLayout({ wrap });
                      }
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
          {onDelete ? (
            <>
              <span className="rich-media-toolbar-sep" />
              <button
                type="button"
                className="rich-media-toolbar-delete"
                title="移除圖片"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onDelete();
                }}
              >
                刪除
              </button>
            </>
          ) : null}
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
