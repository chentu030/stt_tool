"use client";

import { useEffect, useRef } from "react";
import {
  FOLDER_ICONS,
  PAGE_COLORS,
  PAGE_ICONS,
  normalizePageIcon,
  pageColorMeta,
  type PageColorId,
} from "@/lib/pageChrome";
import PageChromeIcon from "@/components/PageChromeIcon";

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
  const current = normalizePageIcon(icon);
  const tint = color ? pageColorMeta(color).fg : "var(--text-main)";

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
          className={!current ? "is-on" : undefined}
          title="無圖示"
          onClick={() => onChange({ icon: "", color })}
        >
          <span className="ic-picker-none">無</span>
        </button>
        {icons.map((ic) => (
          <button
            key={ic}
            type="button"
            className={current === ic ? "is-on" : undefined}
            title={ic}
            style={{ color: tint }}
            onClick={() => onChange({ icon: ic, color })}
          >
            <PageChromeIcon icon={ic} color={color || undefined} />
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
            onClick={() => onChange({ icon: current, color: c.id })}
          />
        ))}
      </div>
      {current && (
        <p className="ic-picker-hint">顏色會套用到圖示（與側欄標題）</p>
      )}
    </div>
  );
}
