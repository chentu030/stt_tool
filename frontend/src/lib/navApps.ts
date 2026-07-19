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
  | "research";

export type NavAppDef = {
  id: NavAppId;
  href: string;
  label: string;
};

export const NAV_APPS: NavAppDef[] = [
  { id: "library", href: "/library", label: "知識庫" },
  { id: "journal", href: "/journal", label: "日誌" },
  { id: "capture", href: "/capture", label: "捕捉" },
  { id: "board", href: "/board", label: "看板" },
  { id: "db", href: "/db", label: "資料庫" },
  { id: "canvas", href: "/canvas", label: "白板" },
  { id: "graph", href: "/graph", label: "圖譜" },
  { id: "team", href: "/team", label: "團隊" },
  { id: "research", href: "/research", label: "研究" },
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

export const RESEARCH_FOLDER = "深度研究";

/** Command palette navigation rows */
export const CMD_NAV: { href: string; label: string }[] = [
  { href: "/", label: "總覽" },
  ...NAV_APPS.map((a) => ({ href: a.href, label: a.label })),
  { href: libraryFolderUrl(RESEARCH_FOLDER), label: "深度研究資料夾" },
  { href: libraryJobsUrl(), label: "轉錄紀錄" },
  { href: "/settings", label: "設定" },
];
