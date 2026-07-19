"use client";

import { useEffect, useRef } from "react";
import {
  FOLDER_ICONS,
  PAGE_COLORS,
  PAGE_ICONS,
  type PageColorId,
} from "@/lib/pageChrome";

type Props = {
  mode: "note" | "folder";
  icon: string;
  color: PageColorId | "";
  onChange: (next: { icon: string; color: PageColorId | "" }) => void;
  onClose: () => void;
  /** fixed position (context menu); omit for inline popover */
  x?: number;
  y?: number;
  className?: string;
};

export default function IconColorPicker({
  mode,
  icon,
  color,
  onChange,
  onClose,
  x,
  y,
  className = "",
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const icons = mode === "folder" ? FOLDER_ICONS : PAGE_ICONS;
  const fixed = typeof x === "number" && typeof y === "number";

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      className={`ic-picker${fixed ? " ic-picker--fixed" : ""} ${className}`.trim()}
      style={fixed ? { left: x, top: y } : undefined}
      role="dialog"
      aria-label="選擇圖示與顏色"
      onMouseDown={(e) => e.stopPropagation()}
    >
      <p className="ic-picker-label">圖示</p>
      <div className="ic-picker-icons">
        <button
          type="button"
          className={!icon ? "is-on" : undefined}
          title="預設"
          onClick={() => onChange({ icon: "", color })}
        >
          —
        </button>
        {icons.map((ic) => (
          <button
            key={ic}
            type="button"
            className={icon === ic ? "is-on" : undefined}
            onClick={() => onChange({ icon: ic, color })}
          >
            {ic}
          </button>
        ))}
      </div>
      <p className="ic-picker-label">顏色</p>
      <div className="ic-picker-colors">
        {PAGE_COLORS.map((c) => (
          <button
            key={c.id || "default"}
            type="button"
            className={`ic-swatch${(color || "") === c.id ? " is-on" : ""}`}
            title={c.label}
            style={{
              background: c.id ? c.fg : "var(--bg-muted)",
              boxShadow: c.id ? undefined : "inset 0 0 0 1px var(--border)",
            }}
            onClick={() => onChange({ icon, color: c.id })}
          />
        ))}
      </div>
    </div>
  );
}
