"use client";

import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { HexColorPicker } from "react-colorful";
import ColorEyedropperTools from "@/components/ColorEyedropperTools";
import { hexToRgb, normalizeHexColor, rgbToHex } from "@/lib/colorPick";
import {
  STICKY_COLORS,
  clampOpacity,
  colorToShapeHex,
  resolveStickyStyle,
} from "@/lib/canvasStore";

type Props = {
  color: string;
  onChange: (color: string) => void;
  /** 0–1 fill/stroke opacity */
  opacity?: number;
  onOpacityChange?: (opacity: number) => void;
  open: boolean;
  onClose: () => void;
  anchorRef: RefObject<HTMLElement | null>;
  /** Hide sticky presets (e.g. text-only color). */
  hidePresets?: boolean;
  title?: string;
};

export default function CanvasColorPicker({
  color,
  onChange,
  opacity = 1,
  onOpacityChange,
  open,
  onClose,
  anchorRef,
  hidePresets,
  title,
}: Props) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const activeHex = colorToShapeHex(color);
  const [draft, setDraft] = useState(activeHex);
  const rgb = hexToRgb(normalizeHexColor(draft) || activeHex);
  const opacityPct = Math.round(clampOpacity(opacity) * 100);

  useEffect(() => {
    setDraft(activeHex);
  }, [activeHex]);

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const el = anchorRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const width = 248;
      let left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8));
      let top = r.bottom + 6;
      if (top + 480 > window.innerHeight && r.top > 480) {
        top = Math.max(8, r.top - 490);
      }
      setPos({ top, left });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, anchorRef]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (panelRef.current?.contains(t)) return;
      if (anchorRef.current?.contains(t)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose, anchorRef]);

  if (!open || !pos || typeof document === "undefined") return null;

  const applyHex = (hex: string) => {
    const n = normalizeHexColor(hex);
    if (!n) return;
    setDraft(n);
    onChange(n);
  };

  return createPortal(
    <div
      ref={panelRef}
      className="cv-color-panel"
      style={{ position: "fixed", top: pos.top, left: pos.left, zIndex: 5000 }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {title ? <p className="cv-color-label">{title}</p> : null}
      {!hidePresets && (
        <>
          <p className="cv-color-label">預設</p>
          <div className="cv-color-presets">
            {STICKY_COLORS.map((c) => {
              const style = resolveStickyStyle(c.id);
              return (
                <button
                  key={c.id}
                  type="button"
                  className={`cv-swatch${color === c.id ? " is-on" : ""}`}
                  style={{ background: style.bg, borderColor: style.border }}
                  title={c.label}
                  onClick={() => onChange(c.id)}
                />
              );
            })}
          </div>
        </>
      )}

      <p className="cv-color-label">色盤</p>
      <HexColorPicker color={normalizeHexColor(draft) || activeHex} onChange={applyHex} className="cv-color-wheel" />

      <p className="cv-color-label">吸取顏色</p>
      <ColorEyedropperTools color={normalizeHexColor(draft) || activeHex} onSample={applyHex} />

      <div className="cv-color-rgb">
        {(["r", "g", "b"] as const).map((ch) => (
          <label key={ch}>
            <span>{ch.toUpperCase()}</span>
            <input
              type="number"
              min={0}
              max={255}
              value={rgb[ch]}
              onChange={(e) => {
                const n = Math.min(255, Math.max(0, Number(e.target.value) || 0));
                const next = { ...rgb, [ch]: n };
                applyHex(rgbToHex(next.r, next.g, next.b));
              }}
            />
          </label>
        ))}
      </div>

      {onOpacityChange ? (
        <label className="cv-color-opacity">
          <span>透明度 {opacityPct}%</span>
          <input
            type="range"
            min={5}
            max={100}
            value={opacityPct}
            onChange={(e) => onOpacityChange(Number(e.target.value) / 100)}
          />
        </label>
      ) : null}

      <div className="cv-color-hex">
        <span>HEX</span>
        <input
          className="input"
          value={draft}
          onChange={(e) => {
            const v = e.target.value.trim();
            setDraft(v);
            const n = normalizeHexColor(v);
            if (n) onChange(n);
          }}
        />
        <button type="button" className="btn btn-sm btn-soft" onClick={onClose}>
          完成
        </button>
      </div>
    </div>,
    document.body
  );
}
