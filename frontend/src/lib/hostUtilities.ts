/**
 * Built-in host utilities (一般擴充功能) — not iframe page extensions.
 * Community packaging still only ships `extension` (iframe) + `template`.
 * These tools live in the host app until a `kind: "tool"` schema exists.
 */

export type HostUtilityKind = "utility";

export type HostUtilityMeta = {
  id: string;
  kind: HostUtilityKind;
  name: string;
  description: string;
  icon: string;
  /** Where the tool assists (not a workspace page of its own). */
  surfaces: Array<"note" | "color-picker" | "folder">;
  /** Prototype flag — shipped with host, no install step. */
  builtin: true;
};

export const HOST_UTILITIES: HostUtilityMeta[] = [
  {
    id: "color-eyedropper",
    kind: "utility",
    name: "色票工具",
    description:
      "吸取螢幕上任意像素顏色，顯示 RGB／Hex 並一鍵複製，供頁面圖示、資料夾或文字顏色使用。",
    icon: "colorize",
    surfaces: ["note", "color-picker", "folder"],
    builtin: true,
  },
];

export function getHostUtility(id: string): HostUtilityMeta | undefined {
  return HOST_UTILITIES.find((u) => u.id === id);
}

const SWATCH_OPEN_KEY = "albireus_utility_color_swatch_open";

export function loadColorSwatchOpen(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return localStorage.getItem(SWATCH_OPEN_KEY) === "1";
  } catch {
    return false;
  }
}

export function saveColorSwatchOpen(open: boolean) {
  try {
    localStorage.setItem(SWATCH_OPEN_KEY, open ? "1" : "0");
  } catch {
    /* ignore */
  }
}
