/** Single source of truth for app navigation destinations. */

export type NavAppId =
  | "library"
  | "journal"
  | "capture"
  | "board"
  | "db"
  | "canvas"
  | "graph"
  | "team"
  | "research"
  | "community";

export type NavAppDef = {
  id: string;
  href: string;
  label: string;
  /** Material icon name for community extensions */
  icon?: string;
  /** Built-in vs community extension */
  source?: "builtin" | "extension";
};

export const NAV_APPS: NavAppDef[] = [
  { id: "library", href: "/library", label: "知識庫", source: "builtin" },
  { id: "journal", href: "/journal", label: "日誌", source: "builtin" },
  { id: "capture", href: "/capture", label: "捕捉", source: "builtin" },
  { id: "board", href: "/board", label: "看板", source: "builtin" },
  { id: "db", href: "/db", label: "資料庫", source: "builtin" },
  { id: "canvas", href: "/canvas", label: "白板", source: "builtin" },
  { id: "graph", href: "/graph", label: "圖譜", source: "builtin" },
  { id: "team", href: "/team", label: "團隊", source: "builtin" },
  { id: "research", href: "/research", label: "研究", source: "builtin" },
  { id: "community", href: "/community", label: "社群", source: "builtin" },
];

/** Mobile bottom bar (capture is center FAB). */
export const MOBILE_BOTTOM: { href: string; label: string; id: string; fab?: boolean }[] = [
  { id: "library", href: "/library", label: "知識庫" },
  { id: "journal", href: "/journal", label: "日誌" },
  { id: "capture", href: "/capture", label: "捕捉", fab: true },
  { id: "research", href: "/research", label: "研究" },
  { id: "settings", href: "/settings", label: "設定" },
];

export function libraryFolderUrl(folder: string) {
  return `/library?folder=${encodeURIComponent(folder)}`;
}

export function libraryJobsUrl() {
  return "/library?tab=jobs";
}

/** Append ?note= for spatial apps to focus a note after redirect. */
export function withNoteFocus(base: string, noteId?: string | null) {
  if (!noteId) return base;
  const sep = base.includes("?") ? "&" : "?";
  return `${base}${sep}note=${encodeURIComponent(noteId)}`;
}

export function graphNoteUrl(noteId: string) {
  return withNoteFocus("/graph", noteId);
}

export function boardNoteUrl(noteId: string) {
  return withNoteFocus("/board", noteId);
}

export function canvasNoteUrl(noteId: string) {
  return withNoteFocus("/canvas", noteId);
}

export const RESEARCH_FOLDER = "深度研究";

/** Command palette navigation rows */
export const CMD_NAV: { href: string; label: string }[] = [
  { href: "/", label: "總覽" },
  ...NAV_APPS.map((a) => ({ href: a.href, label: a.label })),
  { href: libraryFolderUrl(RESEARCH_FOLDER), label: "深度研究資料夾" },
  { href: libraryJobsUrl(), label: "轉錄紀錄" },
  { href: "/settings", label: "設定" },
];
