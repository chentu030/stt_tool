/** Side-by-side note split width + collapse — sessionStorage */

const KEY = "cadence_note_split_layout_v1";
const COLLAPSED_PX = 40;
const MIN_PCT = 12;
const MAX_PCT = 88;
const COLLAPSE_PCT = 8;

export type SplitCollapse = "none" | "left" | "right";

export type NoteSplitLayout = {
  leftPct: number;
  collapse: SplitCollapse;
};

export function loadNoteSplitLayout(): NoteSplitLayout {
  if (typeof window === "undefined") return { leftPct: 50, collapse: "none" };
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return { leftPct: 50, collapse: "none" };
    const o = JSON.parse(raw) as Partial<NoteSplitLayout>;
    const leftPct =
      typeof o.leftPct === "number" && Number.isFinite(o.leftPct)
        ? Math.min(MAX_PCT, Math.max(MIN_PCT, o.leftPct))
        : 50;
    const collapse =
      o.collapse === "left" || o.collapse === "right" || o.collapse === "none"
        ? o.collapse
        : "none";
    return { leftPct, collapse };
  } catch {
    return { leftPct: 50, collapse: "none" };
  }
}

export function saveNoteSplitLayout(layout: NoteSplitLayout) {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(KEY, JSON.stringify(layout));
  } catch {
    /* ignore */
  }
}

export function clampSplitPct(pct: number): number {
  return Math.min(MAX_PCT, Math.max(MIN_PCT, pct));
}

/** While dragging: snap to collapse near edges, else clamp. */
export function pctFromPointer(
  clientX: number,
  rect: DOMRect
): { leftPct: number; collapse: SplitCollapse } {
  const w = Math.max(rect.width, 1);
  const raw = ((clientX - rect.left) / w) * 100;
  if (raw <= COLLAPSE_PCT) return { leftPct: MIN_PCT, collapse: "left" };
  if (raw >= 100 - COLLAPSE_PCT) return { leftPct: MAX_PCT, collapse: "right" };
  return { leftPct: clampSplitPct(raw), collapse: "none" };
}

export { COLLAPSED_PX, MIN_PCT, MAX_PCT };
