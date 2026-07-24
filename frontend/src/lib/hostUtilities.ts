/**
 * Built-in host utilities（擴充功能）— assist notes/chrome; not standalone pages.
 * Listed in the community store under「擴充功能」; can be disabled / removed (hidden).
 */

import type { CatalogEntry } from "@/lib/community/types";

export type HostUtilityKind = "utility";

export type HostUtilityMeta = {
  id: string;
  kind: HostUtilityKind;
  name: string;
  description: string;
  icon: string;
  category?: string;
  tags?: string[];
  /** Where the tool assists (not a workspace page of its own). */
  surfaces: Array<"note" | "color-picker" | "folder">;
  /** Shipped with host — no zip install. */
  builtin: true;
  /** Free vs paid listing in the store. */
  paid?: boolean;
  featured?: boolean;
};

export const HOST_UTILITIES: HostUtilityMeta[] = [
  {
    id: "color-eyedropper",
    kind: "utility",
    name: "色票工具",
    description:
      "吸取螢幕上任意像素顏色，顯示 RGB／Hex 並一鍵複製，供頁面圖示、資料夾或文字顏色使用。",
    icon: "colorize",
    category: "生產力",
    tags: ["顏色", "色票", "設計", "工具"],
    surfaces: ["note", "color-picker", "folder"],
    builtin: true,
    featured: true,
    paid: false,
  },
];

export function getHostUtility(id: string): HostUtilityMeta | undefined {
  return HOST_UTILITIES.find((u) => u.id === id);
}

export function hostUtilitiesToCatalogEntries(): CatalogEntry[] {
  return HOST_UTILITIES.map((u) => ({
    id: u.id,
    kind: "utility",
    name: u.name,
    description: u.description,
    author: "Albireus",
    icon: u.icon,
    category: u.category || "工具",
    source: `builtin-utility:${u.id}`,
    tags: u.tags,
    featured: u.featured !== false,
    rating: 4.8,
    downloads: 0,
    paid: Boolean(u.paid),
  }));
}

const SWATCH_OPEN_KEY = "albireus_utility_color_swatch_open";
const SWATCH_HIDDEN_KEY = "albireus_utility_color_swatch_hidden";
const DISABLED_UTILITIES_KEY = "albireus_utilities_disabled";

function loadDisabledUtilityIds(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(DISABLED_UTILITIES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is string => typeof x === "string");
  } catch {
    return [];
  }
}

function saveDisabledUtilityIds(ids: string[]) {
  try {
    localStorage.setItem(DISABLED_UTILITIES_KEY, JSON.stringify([...new Set(ids)]));
  } catch {
    /* ignore */
  }
}

/** Whether a host utility should run (default: enabled). */
export function isHostUtilityEnabled(id: string): boolean {
  return !loadDisabledUtilityIds().includes(id);
}

export function setHostUtilityEnabled(id: string, enabled: boolean) {
  const cur = loadDisabledUtilityIds();
  if (enabled) {
    saveDisabledUtilityIds(cur.filter((x) => x !== id));
    /* Re-enabling from the store also restores a previously dismissed FAB */
    if (id === "color-eyedropper") saveColorSwatchHidden(false);
  } else {
    saveDisabledUtilityIds([...cur, id]);
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("albireus:utility-enabled", { detail: { id, enabled } }));
  }
}

/** Remove / uninstall UX for builtin utilities → disable + hide chip. */
export function uninstallHostUtility(id: string) {
  setHostUtilityEnabled(id, false);
  if (id === "color-eyedropper") {
    saveColorSwatchHidden(true);
    saveColorSwatchOpen(false);
  }
}

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

export function loadColorSwatchHidden(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return localStorage.getItem(SWATCH_HIDDEN_KEY) === "1";
  } catch {
    return false;
  }
}

export function saveColorSwatchHidden(hidden: boolean) {
  try {
    localStorage.setItem(SWATCH_HIDDEN_KEY, hidden ? "1" : "0");
  } catch {
    /* ignore */
  }
}
