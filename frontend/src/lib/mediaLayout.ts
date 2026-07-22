/** Shared layout attrs for note images / embeds (Word-ish wrap). */

export type MediaAlign = "left" | "center" | "right";
export type MediaWrap =
  | "inline"
  | "floatLeft"
  | "floatRight"
  | "break"
  | "front"
  | "behind";

export type MediaLayout = {
  widthPct: number;
  align: MediaAlign;
  wrap: MediaWrap;
  offsetX: number;
  offsetY: number;
};

export const DEFAULT_MEDIA_LAYOUT: MediaLayout = {
  widthPct: 100,
  align: "center",
  wrap: "inline",
  offsetX: 8,
  offsetY: 8,
};

export const MEDIA_WRAP_OPTIONS: { id: MediaWrap; label: string; hint: string }[] = [
  { id: "inline", label: "與文字排列", hint: "跟著段落流動" },
  { id: "floatLeft", label: "矩形 · 左", hint: "文字從右側繞過" },
  { id: "floatRight", label: "矩形 · 右", hint: "文字從左側繞過" },
  { id: "break", label: "上及下", hint: "獨占一行" },
  { id: "front", label: "文字在後", hint: "浮在文字上方" },
  { id: "behind", label: "文字在前", hint: "浮在文字下方" },
];

export function clampWidthPct(n: unknown, fallback = 100): number {
  const v = Number(n);
  if (!Number.isFinite(v)) return fallback;
  return Math.min(100, Math.max(15, Math.round(v)));
}

export function clampOffset(n: unknown, fallback = 8): number {
  const v = Number(n);
  if (!Number.isFinite(v)) return fallback;
  return Math.min(92, Math.max(0, Math.round(v * 10) / 10));
}

export function normalizeAlign(v: unknown): MediaAlign {
  return v === "left" || v === "right" || v === "center" ? v : "center";
}

export function normalizeWrap(v: unknown): MediaWrap {
  if (
    v === "inline" ||
    v === "floatLeft" ||
    v === "floatRight" ||
    v === "break" ||
    v === "front" ||
    v === "behind"
  ) {
    return v;
  }
  return "inline";
}

export function readLayoutFromAttrs(attrs: Record<string, unknown> | null | undefined): MediaLayout {
  const a = attrs || {};
  return {
    widthPct: clampWidthPct(a.widthPct ?? a["data-width-pct"], 100),
    align: normalizeAlign(a.align ?? a["data-align"]),
    wrap: normalizeWrap(a.wrap ?? a["data-wrap"]),
    offsetX: clampOffset(a.offsetX ?? a["data-ox"], 8),
    offsetY: clampOffset(a.offsetY ?? a["data-oy"], 8),
  };
}

export function readLayoutFromElement(el: Element): MediaLayout {
  const d = el as HTMLElement;
  return {
    widthPct: clampWidthPct(d.getAttribute("data-width-pct"), 100),
    align: normalizeAlign(d.getAttribute("data-align")),
    wrap: normalizeWrap(d.getAttribute("data-wrap")),
    offsetX: clampOffset(d.getAttribute("data-ox"), 8),
    offsetY: clampOffset(d.getAttribute("data-oy"), 8),
  };
}

export function layoutToDataAttrs(layout: MediaLayout): Record<string, string> {
  return {
    "data-width-pct": String(layout.widthPct),
    "data-align": layout.align,
    "data-wrap": layout.wrap,
    "data-ox": String(layout.offsetX),
    "data-oy": String(layout.offsetY),
  };
}

export function applyLayoutToElement(el: HTMLElement, layout: MediaLayout) {
  const attrs = layoutToDataAttrs(layout);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  el.style.width = `${layout.widthPct}%`;
  el.style.maxWidth = "100%";
  if (layout.wrap === "front" || layout.wrap === "behind") {
    el.style.left = `${layout.offsetX}%`;
    el.style.top = `${layout.offsetY}%`;
  } else {
    el.style.left = "";
    el.style.top = "";
  }
}

/** TipTap attribute defs shared by image / embed. */
export function mediaLayoutTipTapAttributes() {
  return {
    widthPct: {
      default: 100,
      parseHTML: (el: HTMLElement) => clampWidthPct(el.getAttribute("data-width-pct"), 100),
      renderHTML: (attrs: Record<string, unknown>) => ({
        "data-width-pct": String(clampWidthPct(attrs.widthPct, 100)),
      }),
    },
    align: {
      default: "center" as MediaAlign,
      parseHTML: (el: HTMLElement) => normalizeAlign(el.getAttribute("data-align")),
      renderHTML: (attrs: Record<string, unknown>) => ({
        "data-align": normalizeAlign(attrs.align),
      }),
    },
    wrap: {
      default: "inline" as MediaWrap,
      parseHTML: (el: HTMLElement) => normalizeWrap(el.getAttribute("data-wrap")),
      renderHTML: (attrs: Record<string, unknown>) => ({
        "data-wrap": normalizeWrap(attrs.wrap),
      }),
    },
    offsetX: {
      default: 8,
      parseHTML: (el: HTMLElement) => clampOffset(el.getAttribute("data-ox"), 8),
      renderHTML: (attrs: Record<string, unknown>) => ({
        "data-ox": String(clampOffset(attrs.offsetX, 8)),
      }),
    },
    offsetY: {
      default: 8,
      parseHTML: (el: HTMLElement) => clampOffset(el.getAttribute("data-oy"), 8),
      renderHTML: (attrs: Record<string, unknown>) => ({
        "data-oy": String(clampOffset(attrs.offsetY, 8)),
      }),
    },
  };
}

/** Encode layout into embed token segments after title. */
export function layoutToTokenParts(layout: MediaLayout): string[] {
  const parts: string[] = [];
  if (layout.widthPct !== 100) parts.push(`w=${layout.widthPct}`);
  if (layout.align !== "center") parts.push(`align=${layout.align}`);
  if (layout.wrap !== "inline") parts.push(`wrap=${layout.wrap}`);
  if (layout.wrap === "front" || layout.wrap === "behind") {
    if (layout.offsetX !== 8) parts.push(`ox=${layout.offsetX}`);
    if (layout.offsetY !== 8) parts.push(`oy=${layout.offsetY}`);
  }
  return parts;
}

export function parseLayoutTokenParts(parts: string[]): Partial<MediaLayout> {
  const out: Partial<MediaLayout> = {};
  for (const raw of parts) {
    const p = raw.trim();
    if (!p) continue;
    const eq = p.indexOf("=");
    if (eq < 0) continue;
    const key = p.slice(0, eq).trim().toLowerCase();
    const val = p.slice(eq + 1).trim();
    if (key === "w" || key === "width") out.widthPct = clampWidthPct(val, 100);
    else if (key === "align") out.align = normalizeAlign(val);
    else if (key === "wrap") out.wrap = normalizeWrap(val);
    else if (key === "ox") out.offsetX = clampOffset(val, 8);
    else if (key === "oy") out.offsetY = clampOffset(val, 8);
  }
  return out;
}

export function formatEmbedToken(
  kind: string,
  title: string,
  original: string,
  layout?: Partial<MediaLayout> | null
): string {
  const full = { ...DEFAULT_MEDIA_LAYOUT, ...(layout || {}) };
  const extras = layoutToTokenParts(full);
  const mid = [`embed`, kind || "web", title || kind || "embed", ...extras].join("|");
  return `[${mid}](${original || ""})`;
}

/** Parse `[embed|kind|title|w=60|…](url)` mid section into kind, title, layout. */
export function parseEmbedMid(mid: string): {
  kind: string;
  title: string;
  layout: Partial<MediaLayout>;
} {
  const segs = mid.split("|").map((s) => s.trim());
  // segs[0] is "embed" when full mid includes it; callers may pass without.
  let i = 0;
  if (segs[0]?.toLowerCase() === "embed") i = 1;
  const kind = segs[i] || "web";
  const title = segs[i + 1] || kind;
  const layout = parseLayoutTokenParts(segs.slice(i + 2));
  return { kind, title, layout };
}

export function layoutDataAttrString(layout: MediaLayout): string {
  const a = layoutToDataAttrs(layout);
  return Object.entries(a)
    .map(([k, v]) => `${k}="${v}"`)
    .join(" ");
}
