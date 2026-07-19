/** Desktop sidebar layout — pixel width + collapsed (local). */

const WIDTH_KEY = "cadence_sidebar_px";
const COLLAPSED_KEY = "cadence_sidebar_collapsed";

export const SIDEBAR_MIN = 200;
export const SIDEBAR_MAX = 480;
export const SIDEBAR_COLLAPSED_W = 56;
export const SIDEBAR_DEFAULT = 260;

export function loadSidebarWidthPx(fallback = SIDEBAR_DEFAULT): number {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(WIDTH_KEY);
    if (!raw) return fallback;
    const n = Number(raw);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, Math.round(n)));
  } catch {
    return fallback;
  }
}

export function saveSidebarWidthPx(px: number) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(
      WIDTH_KEY,
      String(Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, Math.round(px))))
    );
  } catch {
    /* ignore */
  }
}

export function loadSidebarCollapsed(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return localStorage.getItem(COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
}

export function saveSidebarCollapsed(collapsed: boolean) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(COLLAPSED_KEY, collapsed ? "1" : "0");
  } catch {
    /* ignore */
  }
}

export function prefSidebarToPx(pref: "narrow" | "default" | "wide"): number {
  if (pref === "narrow") return 200;
  if (pref === "wide") return 300;
  return SIDEBAR_DEFAULT;
}
