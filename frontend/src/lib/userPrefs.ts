/** Cadence user preferences — local persistence + document theming */

export type ThemeMode = "light" | "dark" | "system";
export type AccentId = "teal" | "ocean" | "forest" | "amber" | "rose" | "slate";
export type DensityId = "cozy" | "comfortable" | "compact";
export type FontScale = "90" | "100" | "110" | "120";
export type SidebarWidth = "narrow" | "default" | "wide";
export type HomePage =
  | "/"
  | "/library"
  | "/capture"
  | "/journal"
  | "/board"
  | "/canvas"
  | "/graph"
  | "/research";
export type LibraryViewPref = "list" | "grid" | "compact" | "table";
export type LibrarySortPref = "updated" | "created" | "title" | "length";
export type BoardSortPref = "updated" | "priority" | "due" | "age" | "title";
export type GraphLayoutPref = "force" | "radial" | "cluster" | "grid" | "timeline";
export type CaptureSourcePref = "file" | "youtube" | "record";
export type WeekStart = "monday" | "sunday";
export type DateFormat = "ymd" | "mdy" | "dmy";
export type EditorWidth = "narrow" | "medium" | "wide" | "full";

export type UserPrefs = {
  version: 1;
  /** Appearance */
  theme: ThemeMode;
  accent: AccentId;
  density: DensityId;
  fontScale: FontScale;
  sidebarWidth: SidebarWidth;
  reduceMotion: boolean;
  showScrambleTitles: boolean;
  cardShadows: boolean;
  /** Navigation */
  homePage: HomePage;
  confirmNavigation: boolean;
  compactMobileNav: boolean;
  /** Library */
  libraryView: LibraryViewPref;
  librarySort: LibrarySortPref;
  libraryShowJobs: boolean;
  libraryShowEmpty: boolean;
  /** Board */
  boardSort: BoardSortPref;
  boardHideDone: boolean;
  boardSwimlanes: boolean;
  boardWipWarn: boolean;
  /** Notes / editor */
  defaultFolder: string;
  defaultTags: string;
  defaultStatus: "backlog" | "doing" | "done" | "";
  editorWidth: EditorWidth;
  editorFontSize: number; // px 14–22
  editorLineHeight: number; // 1.4–2.0
  editorShowOutline: boolean;
  editorSpellcheck: boolean;
  editorVimHints: boolean;
  autosaveSeconds: number;
  wikiSuggest: boolean;
  /** Capture */
  captureDefaultSource: CaptureSourcePref;
  captureAutoOpenJob: boolean;
  captureMaxFiles: number;
  captureLanguage: string;
  /** Journal */
  journalWeekStart: WeekStart;
  journalDefaultEnergy: number;
  journalShowHeatmap: boolean;
  journalPromptDaily: boolean;
  /** Graph */
  graphDefaultLayout: GraphLayoutPref;
  graphShowGhosts: boolean;
  graphShowTagEdges: boolean;
  /** Canvas */
  canvasGrid: boolean;
  canvasSnap: boolean;
  canvasDefaultTool: "select" | "pan" | "sticky";
  /** Privacy / data */
  dateFormat: DateFormat;
  analyticsLocalOnly: boolean;
  askBeforeDelete: boolean;
  /** Shortcuts */
  enableShortcuts: boolean;
  slashMenu: boolean;
  /** Cadence AI */
  aiAssistantName: string;
  aiStyle: "concise" | "balanced" | "detailed";
  aiModel: string;
  /** Default: Grounding with Google Search for Cadence AI */
  aiGrounding: boolean;
  aiDefaultScope: "note" | "folder" | "library";
  /** Workspace */
  favoriteNoteIds: string[];
  recentNoteIds: string[];
};

export const ACCENTS: {
  id: AccentId;
  label: string;
  hint: string;
  light: { accent: string; accent2: string; accent3: string; soft: string };
  dark: { accent: string; accent2: string; accent3: string; soft: string };
}[] = [
  {
    id: "teal",
    label: "青石",
    hint: "預設",
    light: { accent: "#0F766E", accent2: "#0D9488", accent3: "#115E59", soft: "rgba(15,118,110,0.08)" },
    dark: { accent: "#0D9488", accent2: "#14B8A6", accent3: "#0369A1", soft: "rgba(13,148,136,0.14)" },
  },
  {
    id: "ocean",
    label: "海洋",
    hint: "冷靜藍",
    light: { accent: "#0369A1", accent2: "#0284C7", accent3: "#0C4A6E", soft: "rgba(3,105,161,0.1)" },
    dark: { accent: "#38BDF8", accent2: "#7DD3FC", accent3: "#0284C7", soft: "rgba(56,189,248,0.14)" },
  },
  {
    id: "forest",
    label: "苔綠",
    hint: "沉穩",
    light: { accent: "#3F6212", accent2: "#65A30D", accent3: "#365314", soft: "rgba(101,163,13,0.1)" },
    dark: { accent: "#84CC16", accent2: "#A3E635", accent3: "#4D7C0F", soft: "rgba(132,204,22,0.14)" },
  },
  {
    id: "amber",
    label: "琥珀",
    hint: "溫暖",
    light: { accent: "#B45309", accent2: "#D97706", accent3: "#92400E", soft: "rgba(217,119,6,0.1)" },
    dark: { accent: "#F59E0B", accent2: "#FBBF24", accent3: "#D97706", soft: "rgba(245,158,11,0.14)" },
  },
  {
    id: "rose",
    label: "赤陶",
    hint: "醒目",
    light: { accent: "#BE123C", accent2: "#E11D48", accent3: "#9F1239", soft: "rgba(225,29,72,0.08)" },
    dark: { accent: "#FB7185", accent2: "#FDA4AF", accent3: "#E11D48", soft: "rgba(251,113,133,0.14)" },
  },
  {
    id: "slate",
    label: "石墨",
    hint: "低對比",
    light: { accent: "#475569", accent2: "#64748B", accent3: "#334155", soft: "rgba(71,85,105,0.1)" },
    dark: { accent: "#94A3B8", accent2: "#CBD5E1", accent3: "#64748B", soft: "rgba(148,163,184,0.14)" },
  },
];

export const HOME_OPTIONS: { id: HomePage; label: string }[] = [
  { id: "/", label: "總覽" },
  { id: "/library", label: "知識庫" },
  { id: "/capture", label: "捕捉" },
  { id: "/journal", label: "日誌" },
  { id: "/research", label: "深度研究" },
  { id: "/board", label: "看板" },
  { id: "/canvas", label: "白板" },
  { id: "/graph", label: "圖譜" },
];

export const CAPTURE_LANGS: { id: string; label: string }[] = [
  { id: "zh-TW", label: "繁體中文" },
  { id: "zh-CN", label: "簡體中文" },
  { id: "en", label: "English" },
  { id: "ja", label: "日本語" },
  { id: "auto", label: "自動偵測" },
];

export const SETTINGS_SECTIONS = [
  { id: "appearance", label: "外觀" },
  { id: "navigation", label: "導覽" },
  { id: "library", label: "知識庫" },
  { id: "board", label: "看板" },
  { id: "editor", label: "筆記編輯" },
  { id: "ai", label: "Cadence AI" },
  { id: "capture", label: "捕捉" },
  { id: "journal", label: "日誌" },
  { id: "views", label: "白板／圖譜" },
  { id: "privacy", label: "隱私與資料" },
  { id: "account", label: "帳號與工具" },
  { id: "about", label: "關於" },
] as const;

export type SettingsSectionId = (typeof SETTINGS_SECTIONS)[number]["id"];

export const DEFAULT_PREFS: UserPrefs = {
  version: 1,
  theme: "system",
  accent: "teal",
  density: "comfortable",
  fontScale: "100",
  sidebarWidth: "default",
  reduceMotion: false,
  showScrambleTitles: true,
  cardShadows: true,
  homePage: "/library",
  confirmNavigation: false,
  compactMobileNav: false,
  libraryView: "list",
  librarySort: "updated",
  libraryShowJobs: true,
  libraryShowEmpty: true,
  boardSort: "updated",
  boardHideDone: false,
  boardSwimlanes: false,
  boardWipWarn: true,
  defaultFolder: "",
  defaultTags: "",
  defaultStatus: "backlog",
  editorWidth: "medium",
  editorFontSize: 16,
  editorLineHeight: 1.65,
  editorShowOutline: true,
  editorSpellcheck: true,
  editorVimHints: false,
  autosaveSeconds: 2,
  wikiSuggest: true,
  captureDefaultSource: "file",
  captureAutoOpenJob: true,
  captureMaxFiles: 8,
  captureLanguage: "zh-TW",
  journalWeekStart: "monday",
  journalDefaultEnergy: 3,
  journalShowHeatmap: true,
  journalPromptDaily: true,
  graphDefaultLayout: "force",
  graphShowGhosts: true,
  graphShowTagEdges: false,
  canvasGrid: true,
  canvasSnap: true,
  canvasDefaultTool: "select",
  dateFormat: "ymd",
  analyticsLocalOnly: true,
  askBeforeDelete: true,
  enableShortcuts: true,
  slashMenu: true,
  aiAssistantName: "Cadence AI",
  aiStyle: "balanced",
  aiModel: "gemini-3.5-flash",
  aiGrounding: false,
  aiDefaultScope: "note",
  favoriteNoteIds: [],
  recentNoteIds: [],
};

const STORAGE_KEY = "cadence_prefs_v1";

export function loadPrefs(): UserPrefs {
  if (typeof window === "undefined") return { ...DEFAULT_PREFS };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      // migrate legacy theme key
      const legacy = localStorage.getItem("theme");
      const base = { ...DEFAULT_PREFS };
      if (legacy === "light" || legacy === "dark") base.theme = legacy;
      return base;
    }
    const parsed = JSON.parse(raw) as Partial<UserPrefs>;
    return sanitizePrefs({ ...DEFAULT_PREFS, ...parsed, version: 1 });
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export function savePrefs(prefs: UserPrefs) {
  if (typeof window === "undefined") return;
  const clean = sanitizePrefs(prefs);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(clean));
  // keep legacy theme key in sync for ThemeToggle fallbacks
  const resolved = resolveTheme(clean.theme);
  localStorage.setItem("theme", resolved);
  return clean;
}

export function resetPrefs(): UserPrefs {
  const next = { ...DEFAULT_PREFS };
  savePrefs(next);
  return next;
}

export function exportPrefsJson(prefs: UserPrefs): string {
  return JSON.stringify(sanitizePrefs(prefs), null, 2);
}

export function importPrefsJson(raw: string): UserPrefs {
  const parsed = JSON.parse(raw) as Partial<UserPrefs>;
  return sanitizePrefs({ ...DEFAULT_PREFS, ...parsed, version: 1 });
}

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

export function sanitizePrefs(p: UserPrefs): UserPrefs {
  const fav = Array.isArray(p.favoriteNoteIds)
    ? p.favoriteNoteIds.filter((x) => typeof x === "string").slice(0, 80)
    : [];
  const recent = Array.isArray(p.recentNoteIds)
    ? p.recentNoteIds.filter((x) => typeof x === "string").slice(0, 30)
    : [];
  return {
    ...DEFAULT_PREFS,
    ...p,
    version: 1,
    editorFontSize: clamp(Number(p.editorFontSize) || 16, 13, 24),
    editorLineHeight: clamp(Number(p.editorLineHeight) || 1.65, 1.3, 2.2),
    autosaveSeconds: clamp(Number(p.autosaveSeconds) || 2, 1, 30),
    captureMaxFiles: clamp(Number(p.captureMaxFiles) || 8, 1, 30),
    journalDefaultEnergy: clamp(Number(p.journalDefaultEnergy) || 3, 1, 5),
    defaultFolder: String(p.defaultFolder || "").slice(0, 80),
    defaultTags: String(p.defaultTags || "").slice(0, 200),
    aiAssistantName: String(p.aiAssistantName || "Cadence AI").slice(0, 40) || "Cadence AI",
    aiStyle:
      p.aiStyle === "concise" || p.aiStyle === "detailed" || p.aiStyle === "balanced"
        ? p.aiStyle
        : "balanced",
    aiModel: String(p.aiModel || "gemini-3.5-flash").slice(0, 80) || "gemini-3.5-flash",
    aiGrounding: !!p.aiGrounding,
    aiDefaultScope:
      p.aiDefaultScope === "folder" || p.aiDefaultScope === "library" || p.aiDefaultScope === "note"
        ? p.aiDefaultScope
        : "note",
    favoriteNoteIds: fav,
    recentNoteIds: recent,
  };
}

export function toggleFavoriteId(prefs: UserPrefs, noteId: string): UserPrefs {
  const set = new Set(prefs.favoriteNoteIds || []);
  if (set.has(noteId)) set.delete(noteId);
  else set.add(noteId);
  return { ...prefs, favoriteNoteIds: [...set].slice(0, 80) };
}

export function touchRecentId(prefs: UserPrefs, noteId: string): UserPrefs {
  const next = [noteId, ...(prefs.recentNoteIds || []).filter((id) => id !== noteId)];
  return { ...prefs, recentNoteIds: next.slice(0, 20) };
}

export function resolveTheme(mode: ThemeMode): "light" | "dark" {
  if (mode === "light" || mode === "dark") return mode;
  if (typeof window === "undefined") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function applyPrefsToDocument(prefs: UserPrefs) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  const theme = resolveTheme(prefs.theme);
  root.setAttribute("data-theme", theme);
  root.setAttribute("data-accent", prefs.accent);
  root.setAttribute("data-density", prefs.density);
  root.setAttribute("data-font-scale", prefs.fontScale);
  root.setAttribute("data-sidebar", prefs.sidebarWidth);
  root.setAttribute("data-reduce-motion", prefs.reduceMotion ? "1" : "0");
  root.setAttribute("data-card-shadow", prefs.cardShadows ? "1" : "0");
  root.setAttribute("data-editor-width", prefs.editorWidth);

  const accent = ACCENTS.find((a) => a.id === prefs.accent) || ACCENTS[0];
  const pal = theme === "dark" ? accent.dark : accent.light;
  root.style.setProperty("--accent", pal.accent);
  root.style.setProperty("--accent-2", pal.accent2);
  root.style.setProperty("--accent-3", pal.accent3);
  root.style.setProperty("--accent-soft", pal.soft);

  const scale = Number(prefs.fontScale) / 100;
  root.style.setProperty("--font-scale", String(scale));
  root.style.fontSize = `${16 * scale}px`;

  const sidebar =
    prefs.sidebarWidth === "narrow" ? "200px" : prefs.sidebarWidth === "wide" ? "280px" : "240px";
  root.style.setProperty("--sidebar-w", sidebar);

  root.style.setProperty("--editor-font-size", `${prefs.editorFontSize}px`);
  root.style.setProperty("--editor-line-height", String(prefs.editorLineHeight));

  const densityPad =
    prefs.density === "compact" ? "0.85" : prefs.density === "cozy" ? "1.15" : "1";
  root.style.setProperty("--density", densityPad);
}

export function parseDefaultTags(raw: string): string[] {
  return raw
    .split(/[,，\s]+/)
    .map((t) => t.replace(/^#/, "").trim())
    .filter(Boolean)
    .slice(0, 12);
}

export function formatPrefsSummary(prefs: UserPrefs): string {
  const theme = prefs.theme === "system" ? "跟隨系統" : prefs.theme === "dark" ? "深色" : "淺色";
  const accent = ACCENTS.find((a) => a.id === prefs.accent)?.label || prefs.accent;
  return `${theme} · ${accent} · ${prefs.density} · 字級 ${prefs.fontScale}%`;
}

/** Clear Cadence local workspace caches (not account data). */
export function clearLocalWorkspaceCaches(uid?: string) {
  const keys: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!k) continue;
    if (
      k.startsWith("cadence_canvas_") ||
      k.startsWith("cadence_graph_pos_") ||
      k === "cadence_canvas_positions_v1"
    ) {
      if (!uid || k.includes(uid) || k === "cadence_canvas_positions_v1") keys.push(k);
    }
  }
  keys.forEach((k) => localStorage.removeItem(k));
  return keys.length;
}

export const SHORTCUT_HELP: { keys: string; action: string }[] = [
  { keys: "⌘/Ctrl + S", action: "儲存筆記" },
  { keys: "⌘/Ctrl + K", action: "命令列（若頁面支援）" },
  { keys: "/", action: "筆記內斜線選單" },
  { keys: "[[", action: "Wiki 連結建議" },
  { keys: "Space（圖譜／白板）", action: "暫時平移" },
  { keys: "Esc", action: "取消選取／關閉選單" },
];
