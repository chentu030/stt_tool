/** Shared page/folder icon & color chrome (Notion-like) */

export type PageColorId =
  | ""
  | "gray"
  | "brown"
  | "orange"
  | "yellow"
  | "green"
  | "teal"
  | "blue"
  | "purple"
  | "pink"
  | "red";

/** Preset id or #rrggbb custom color */
export type PageColorValue = PageColorId | string;

export type FolderStyle = {
  icon?: string;
  color?: PageColorValue;
};

/** Google Material Symbols Outlined names (stored on note.icon / folderStyles) */
export const PAGE_ICONS = [
  "description",
  "edit_note",
  "lightbulb",
  "push_pin",
  "flag",
  "menu_book",
  "science",
  "mic",
  "photo_camera",
  "star",
  "local_fire_department",
  "psychology",
  "chat_bubble",
  "build",
  "palette",
  "bar_chart",
  "map",
  "explore",
  "home",
  "work",
  "inventory_2",
  "biotech",
  "spa",
  "rocket_launch",
  "view_kanban",
  "table_chart",
  "hub",
  "language",
] as const;

export const FOLDER_ICONS = [
  "folder",
  "folder_open",
  "topic",
  "inventory_2",
  "dns",
  "label",
  "push_pin",
  "star",
  "local_fire_department",
  "lightbulb",
  "menu_book",
  "psychology",
  "flag",
  "build",
  "palette",
  "bar_chart",
  "map",
  "home",
  "work",
  "spa",
  "rocket_launch",
  "biotech",
  "chat_bubble",
  "bookmark",
] as const;

const LEGACY_EMOJI_TO_MATERIAL: Record<string, string> = {
  "📄": "description",
  "📝": "edit_note",
  "💡": "lightbulb",
  "📌": "push_pin",
  "🎯": "flag",
  "📚": "menu_book",
  "🔬": "science",
  "🎤": "mic",
  "🗂": "topic",
  "⭐": "star",
  "🔥": "local_fire_department",
  "🧠": "psychology",
  "💬": "chat_bubble",
  "🛠": "build",
  "🎨": "palette",
  "📊": "bar_chart",
  "🗺": "map",
  "🧭": "explore",
  "🏠": "home",
  "💼": "work",
  "📦": "inventory_2",
  "🧪": "biotech",
  "🌱": "spa",
  "🚀": "rocket_launch",
  "📁": "folder",
  "📂": "folder_open",
  "🗃": "dns",
  "🗄": "dns",
  "🏷": "label",
  "📷": "photo_camera",
  "🗒": "description",
};

export function isMaterialIconName(icon?: string | null): boolean {
  return !!icon && /^[a-z][a-z0-9_]{0,47}$/i.test(icon.trim());
}

/** Normalize stored icon (Material name or legacy emoji) → Material name or "" */
export function normalizePageIcon(icon?: string | null): string {
  const raw = (icon || "").trim();
  if (!raw) return "";
  if (LEGACY_EMOJI_TO_MATERIAL[raw]) return LEGACY_EMOJI_TO_MATERIAL[raw];
  if (isMaterialIconName(raw)) return raw.toLowerCase();
  return "";
}

export const PAGE_COLORS: {
  id: PageColorId;
  label: string;
  /** Icon / text tint */
  fg: string;
  /** Soft row / chip background */
  bg: string;
}[] = [
  { id: "", label: "預設", fg: "var(--text-muted)", bg: "transparent" },
  { id: "gray", label: "灰", fg: "#64748B", bg: "rgba(100,116,139,0.12)" },
  { id: "brown", label: "棕", fg: "#A16207", bg: "rgba(161,98,7,0.12)" },
  { id: "orange", label: "橙", fg: "#EA580C", bg: "rgba(234,88,12,0.12)" },
  { id: "yellow", label: "黃", fg: "#CA8A04", bg: "rgba(202,138,4,0.14)" },
  { id: "green", label: "綠", fg: "#16A34A", bg: "rgba(22,163,74,0.12)" },
  { id: "teal", label: "青", fg: "#0D9488", bg: "rgba(13,148,136,0.12)" },
  { id: "blue", label: "藍", fg: "#2563EB", bg: "rgba(37,99,235,0.12)" },
  { id: "purple", label: "紫", fg: "#7C3AED", bg: "rgba(124,58,237,0.12)" },
  { id: "pink", label: "粉", fg: "#DB2777", bg: "rgba(219,39,119,0.12)" },
  { id: "red", label: "紅", fg: "#DC2626", bg: "rgba(220,38,38,0.12)" },
];

/** Hex presets shown in the custom color picker (same as note text color). */
export const PAGE_COLOR_HEX_PRESETS = [
  "#0f172a",
  "#dc2626",
  "#ea580c",
  "#ca8a04",
  "#16a34a",
  "#0891b2",
  "#2563eb",
  "#7c3aed",
];

export function normalizeHexColor(c: string): string | null {
  const s = c.trim();
  if (/^#[0-9a-f]{6}$/i.test(s)) return s.toLowerCase();
  if (/^#[0-9a-f]{3}$/i.test(s)) {
    const r = s[1];
    const g = s[2];
    const b = s[3];
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }
  if (/^[0-9a-f]{6}$/i.test(s)) return `#${s.toLowerCase()}`;
  return null;
}

export function hexToRgba(hex: string, alpha: number): string {
  const n = normalizeHexColor(hex);
  if (!n) return `rgba(100,116,139,${alpha})`;
  const r = parseInt(n.slice(1, 3), 16);
  const g = parseInt(n.slice(3, 5), 16);
  const b = parseInt(n.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

/** Accept preset ids or #rrggbb; empty string = default. */
export function normalizePageColor(color?: string | null): string {
  const c = (color || "").trim();
  if (!c) return "";
  if (PAGE_COLORS.some((x) => x.id === c)) return c;
  return normalizeHexColor(c) || "";
}

export function pageColorMeta(color?: string | null): {
  id: string;
  label: string;
  fg: string;
  bg: string;
} {
  const raw = (color || "").trim();
  const preset = PAGE_COLORS.find((c) => c.id === raw);
  if (preset) return preset;
  const hex = normalizeHexColor(raw);
  if (hex) {
    return { id: hex, label: hex, fg: hex, bg: hexToRgba(hex, 0.12) };
  }
  return PAGE_COLORS[0];
}

export function isPageColorId(v: unknown): v is PageColorId {
  return typeof v === "string" && PAGE_COLORS.some((c) => c.id === v);
}

/** True if value is a usable stored page/folder color (preset or hex). */
export function isStoredPageColor(v: unknown): v is string {
  return typeof v === "string" && normalizePageColor(v) !== "";
}

export function sanitizeFolderStyles(
  raw: unknown
): Record<string, FolderStyle> {
  if (!raw || typeof raw !== "object") return {};
  const out: Record<string, FolderStyle> = {};
  for (const [path, style] of Object.entries(raw as Record<string, unknown>)) {
    if (!path || path.length > 200) continue;
    if (!style || typeof style !== "object") continue;
    const s = style as FolderStyle;
    const icon = normalizePageIcon(typeof s.icon === "string" ? s.icon : "");
    const color = normalizePageColor(typeof s.color === "string" ? s.color : "");
    if (!icon && !color) continue;
    out[path] = { ...(icon ? { icon } : {}), ...(color ? { color } : {}) };
  }
  return out;
}

/** Remap folder style keys when a folder path is renamed/moved. */
export function remapFolderStyles(
  styles: Record<string, FolderStyle>,
  oldPath: string,
  newPath: string
): Record<string, FolderStyle> {
  if (!oldPath || oldPath === newPath) return styles;
  const next: Record<string, FolderStyle> = {};
  for (const [path, style] of Object.entries(styles)) {
    if (path === oldPath) next[newPath] = style;
    else if (path.startsWith(`${oldPath}/`)) {
      next[`${newPath}${path.slice(oldPath.length)}`] = style;
    } else next[path] = style;
  }
  return next;
}

/** Drop styles for a folder path and any nested paths under it. */
export function removeFolderStyles(
  styles: Record<string, FolderStyle>,
  path: string
): Record<string, FolderStyle> {
  if (!path) return styles;
  const next: Record<string, FolderStyle> = {};
  for (const [p, style] of Object.entries(styles)) {
    if (p === path || p.startsWith(`${path}/`)) continue;
    next[p] = style;
  }
  return next;
}

export function setFolderStyle(
  styles: Record<string, FolderStyle>,
  path: string,
  patch: FolderStyle
): Record<string, FolderStyle> {
  if (!path) return styles;
  const prev = styles[path] || {};
  const iconRaw = patch.icon !== undefined ? patch.icon : prev.icon || "";
  const icon = normalizePageIcon(iconRaw);
  const colorRaw = patch.color !== undefined ? patch.color : prev.color || "";
  const color = normalizePageColor(colorRaw);
  const next = { ...styles };
  if (!icon && !color) {
    delete next[path];
    return next;
  }
  next[path] = {
    ...(icon ? { icon } : {}),
    ...(color ? { color } : {}),
  };
  return next;
}
