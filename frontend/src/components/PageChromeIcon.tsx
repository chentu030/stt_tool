"use client";

import type { CSSProperties } from "react";
import {
  normalizePageIcon,
  pageColorMeta,
  type PageColorId,
} from "@/lib/pageChrome";

type Props = {
  icon?: string | null;
  color?: PageColorId | string | null;
  /** Used when icon is empty */
  fallback?: string;
  /** If true and icon empty, render nothing */
  hideWhenEmpty?: boolean;
  className?: string;
  style?: CSSProperties;
  /** Override fill weight: 0 outline, 1 filled */
  filled?: boolean;
};

export default function PageChromeIcon({
  icon,
  color,
  fallback = "description",
  hideWhenEmpty = false,
  className = "",
  style,
  filled = false,
}: Props) {
  const name = normalizePageIcon(icon);
  if (!name && hideWhenEmpty) return null;
  const glyph = name || fallback;
  const meta = pageColorMeta(color);
  const tint = color ? meta.fg : undefined;

  return (
    <span
      className={`material-symbols-outlined page-chrome-icon${className ? ` ${className}` : ""}`}
      style={{
        color: tint,
        fontVariationSettings: `'FILL' ${filled ? 1 : 0}, 'wght' 400, 'GRAD' 0, 'opsz' 24`,
        ...style,
      }}
      aria-hidden
    >
      {glyph}
    </span>
  );
}
