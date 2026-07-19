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

export type FolderStyle = {
  icon?: string;
  color?: PageColorId;
};

export const PAGE_ICONS = [
  "📄",
  "📝",
  "💡",
  "📌",
  "🎯",
  "📚",
  "🔬",
  "🎤",
  "🗂",
  "⭐",
  "🔥",
  "🧠",
  "💬",
  "🛠",
  "🎨",
  "📊",
  "🗺",
  "🧭",
  "🏠",
  "💼",
  "📦",
  "🧪",
  "🌱",
  "🚀",
] as const;

export const FOLDER_ICONS = [
  "📁",
  "📂",
  "🗂",
  "📦",
  "🗃",
  "🗄",
  "🏷",
  "📌",
  "⭐",
  "🔥",
  "💡",
  "📚",
  "🧠",
  "🎯",
  "🛠",
  "🎨",
  "📊",
  "🗺",
  "🏠",
  "💼",
  "🌱",
  "🚀",
  "🧪",
  "💬",
] as const;

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

export function pageColorMeta(color?: string | null) {
  const id = (color || "") as PageColorId;
  return PAGE_COLORS.find((c) => c.id === id) || PAGE_COLORS[0];
}

export function isPageColorId(v: unknown): v is PageColorId {
  return typeof v === "string" && PAGE_COLORS.some((c) => c.id === v);
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
    const icon = typeof s.icon === "string" ? s.icon.slice(0, 8) : "";
    const color = isPageColorId(s.color) ? s.color : "";
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

export function setFolderStyle(
  styles: Record<string, FolderStyle>,
  path: string,
  patch: FolderStyle
): Record<string, FolderStyle> {
  if (!path) return styles;
  const prev = styles[path] || {};
  const icon = patch.icon !== undefined ? patch.icon : prev.icon || "";
  const color = patch.color !== undefined ? patch.color : prev.color || "";
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
