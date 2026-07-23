/** Journal calendar, streaks, prompts, and note helpers */

import type { Note } from "@/lib/firebase";

export type MoodId = "great" | "good" | "ok" | "low" | "rough";

export type JournalTagDef = { id: string; label: string; color: string };
export type JournalTemplateDef = { id: string; label: string; body: string };

/** Built-in starter tags (users can delete / replace via prefs). */
export const DEFAULT_JOURNAL_TAGS: JournalTagDef[] = [
  { id: "great", label: "超好", color: "#34D399" },
  { id: "good", label: "不錯", color: "#0D9488" },
  { id: "ok", label: "普通", color: "#94A3B8" },
  { id: "low", label: "低落", color: "#F59E0B" },
  { id: "rough", label: "很糟", color: "#EF4444" },
];

/** @deprecated Prefer DEFAULT_JOURNAL_TAGS — kept for older imports */
export const MOODS = DEFAULT_JOURNAL_TAGS;

export const JOURNAL_TAG_COLORS = [
  "#0D9488",
  "#34D399",
  "#3B82F6",
  "#8B5CF6",
  "#EC4899",
  "#F59E0B",
  "#EF4444",
  "#94A3B8",
  "#14B8A6",
  "#F97316",
];

export type JournalMeta = {
  /** Selected custom tag ids (multi). */
  tags: string[];
  /** Legacy single mood — still read for old notes. */
  mood?: MoodId;
  /** Legacy energy — no longer written by UI. */
  energy?: number;
};

export type JournalEntry = Note & {
  dateKey: string;
  snippet: string;
  meta: JournalMeta;
  wordCount: number;
};

const META_RE = /<!--\s*cadence-journal\s+([^>]*)-->/i;

function splitTagIds(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(/[,，]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 24);
}

export function parseJournalMeta(body: string): JournalMeta {
  const m = META_RE.exec(body || "");
  if (!m) return { tags: [] };
  const attrs = m[1];
  const mood = /mood="([^"]*)"/i.exec(attrs)?.[1] as MoodId | "" | undefined;
  const energyRaw = /energy="(\d+)"/i.exec(attrs)?.[1];
  const energy = energyRaw ? Math.min(5, Math.max(1, Number(energyRaw))) : undefined;
  const tagsAttr = /tags="([^"]*)"/i.exec(attrs)?.[1];
  let tags = splitTagIds(tagsAttr);
  const moodId = mood && DEFAULT_JOURNAL_TAGS.some((x) => x.id === mood) ? (mood as MoodId) : undefined;
  // Migrate legacy single mood into tags when tags empty.
  if (!tags.length && moodId) tags = [moodId];
  return {
    tags,
    mood: moodId,
    energy,
  };
}

export function upsertJournalMeta(body: string, meta: Partial<JournalMeta> & { tags?: string[] }): string {
  const tags = (meta.tags || []).map((t) => String(t).trim()).filter(Boolean).slice(0, 24);
  const tag = `<!--cadence-journal tags="${tags.join(",")}"-->`;
  if (META_RE.test(body || "")) return (body || "").replace(META_RE, tag);
  return `${tag}\n${body || ""}`;
}

export function journalTagIdFromLabel(label: string, existing: JournalTagDef[]): string {
  const base =
    label
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "-")
      .replace(/[^\w\u4e00-\u9fff-]/g, "")
      .slice(0, 32) || `tag-${Date.now().toString(36)}`;
  let id = base;
  let n = 2;
  const used = new Set(existing.map((t) => t.id));
  while (used.has(id)) {
    id = `${base}-${n}`;
    n += 1;
  }
  return id;
}

export function nextJournalTagColor(existing: JournalTagDef[]): string {
  const used = new Set(existing.map((t) => t.color.toLowerCase()));
  const free = JOURNAL_TAG_COLORS.find((c) => !used.has(c.toLowerCase()));
  return free || JOURNAL_TAG_COLORS[existing.length % JOURNAL_TAG_COLORS.length];
}

export function dateKeyFromDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Monday-start week containing `dateKey` (7 keys). */
export function weekDateKeys(dateKey: string): string[] {
  const d = parseDateKey(dateKey);
  if (!d) return [dateKey];
  const dow = d.getDay(); // 0=Sun
  const toMon = dow === 0 ? -6 : 1 - dow;
  const mon = new Date(d.getFullYear(), d.getMonth(), d.getDate() + toMon);
  return Array.from({ length: 7 }, (_, i) => {
    const x = new Date(mon.getFullYear(), mon.getMonth(), mon.getDate() + i);
    return dateKeyFromDate(x);
  });
}

/** All dateKeys in the calendar month of `dateKey`. */
export function monthDateKeys(dateKey: string): string[] {
  const d = parseDateKey(dateKey);
  if (!d) return [dateKey];
  const y = d.getFullYear();
  const m = d.getMonth();
  const last = new Date(y, m + 1, 0).getDate();
  return Array.from({ length: last }, (_, i) => dateKeyFromDate(new Date(y, m, i + 1)));
}

/** Signed day difference: b − a. */
export function daysBetween(a: string, b: string): number {
  const da = parseDateKey(a);
  const db = parseDateKey(b);
  if (!da || !db) return 0;
  const utcA = Date.UTC(da.getFullYear(), da.getMonth(), da.getDate());
  const utcB = Date.UTC(db.getFullYear(), db.getMonth(), db.getDate());
  return Math.round((utcB - utcA) / 86_400_000);
}

/** Shift a dateKey by N days. */
export function shiftDateKey(dateKey: string, days: number): string {
  const d = parseDateKey(dateKey);
  if (!d) return dateKey;
  d.setDate(d.getDate() + days);
  return dateKeyFromDate(d);
}

/** N consecutive dateKeys starting at `dateKey` (inclusive). */
export function rollingDateKeys(dateKey: string, count: number): string[] {
  const n = Math.max(1, Math.floor(count));
  return Array.from({ length: n }, (_, i) => shiftDateKey(dateKey, i));
}

export function parseDateKey(key: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}

export function isJournalNote(n: Note): boolean {
  if ((n.folder || "") === "會議") return false;
  if ((n.tags || []).includes("會議") && !(n.tags || []).includes("journal")) return false;
  if (n.journal_date) return true;
  if ((n.tags || []).includes("journal")) return true;
  return /^\d{4}-\d{2}-\d{2}$/.test(n.title);
}

export function journalDateOf(n: Note): string {
  if (n.journal_date && /^\d{4}-\d{2}-\d{2}$/.test(n.journal_date)) return n.journal_date;
  if (/^\d{4}-\d{2}-\d{2}$/.test(n.title)) return n.title;
  return dateKeyFromDate(n.created_at);
}

function countWords(text: string): number {
  const t = (text || "").replace(META_RE, "").trim();
  if (!t) return 0;
  const cjk = (t.match(/[\u4e00-\u9fff]/g) || []).length;
  const latin = t.replace(/[\u4e00-\u9fff]/g, " ").split(/\s+/).filter(Boolean).length;
  return cjk + latin;
}

function snippetOf(body: string, max = 120): string {
  const plain = (body || "")
    .replace(META_RE, "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[#>*`\[\]()_-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!plain) return "（空白日誌）";
  return plain.length > max ? `${plain.slice(0, max)}…` : plain;
}

export function toJournalEntries(notes: Note[]): JournalEntry[] {
  return notes
    .filter(isJournalNote)
    .map((n) => ({
      ...n,
      dateKey: journalDateOf(n),
      snippet: snippetOf(n.body_md),
      meta: parseJournalMeta(n.body_md),
      wordCount: countWords(n.body_md),
    }))
    .sort((a, b) => {
      const byDay = b.dateKey.localeCompare(a.dateKey);
      if (byDay !== 0) return byDay;
      return b.updated_at.getTime() - a.updated_at.getTime();
    });
}

export type JournalStats = {
  total: number;
  thisMonth: number;
  thisWeek: number;
  streak: number;
  longestStreak: number;
  wordsTotal: number;
  avgWords: number;
  /** Counts by tag id (custom + legacy moods). */
  tagCounts: Record<string, number>;
  /** @deprecated use tagCounts */
  moodCounts: Record<MoodId, number>;
  filledDays: Set<string>;
};

function startOfWeek(d: Date): Date {
  const x = new Date(d);
  const day = (x.getDay() + 6) % 7; // Mon=0
  x.setDate(x.getDate() - day);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function computeJournalStats(entries: JournalEntry[], today = new Date()): JournalStats {
  const filledDays = new Set(entries.map((e) => e.dateKey));
  const todayKey = dateKeyFromDate(today);
  const ym = todayKey.slice(0, 7);
  const weekStart = startOfWeek(today);
  const weekKeys = new Set<string>();
  for (let i = 0; i < 7; i++) {
    const d = new Date(weekStart);
    d.setDate(weekStart.getDate() + i);
    weekKeys.add(dateKeyFromDate(d));
  }

  let streak = 0;
  {
    const cursor = new Date(today);
    if (!filledDays.has(dateKeyFromDate(cursor))) {
      cursor.setDate(cursor.getDate() - 1);
    }
    while (filledDays.has(dateKeyFromDate(cursor))) {
      streak += 1;
      cursor.setDate(cursor.getDate() - 1);
    }
  }

  let longest = 0;
  let run = 0;
  const sorted = Array.from(filledDays).sort();
  let prev: string | null = null;
  for (const key of sorted) {
    if (!prev) {
      run = 1;
    } else {
      const p = parseDateKey(prev)!;
      const c = parseDateKey(key)!;
      const diff = (c.getTime() - p.getTime()) / 86400000;
      run = diff === 1 ? run + 1 : 1;
    }
    longest = Math.max(longest, run);
    prev = key;
  }

  const moodCounts: Record<MoodId, number> = {
    great: 0,
    good: 0,
    ok: 0,
    low: 0,
    rough: 0,
  };
  const tagCounts: Record<string, number> = {};
  let wordsTotal = 0;
  for (const e of entries) {
    wordsTotal += e.wordCount;
    const ids = e.meta.tags?.length
      ? e.meta.tags
      : e.meta.mood
        ? [e.meta.mood]
        : [];
    for (const id of ids) {
      tagCounts[id] = (tagCounts[id] || 0) + 1;
      if (id in moodCounts) moodCounts[id as MoodId] += 1;
    }
  }

  return {
    total: entries.length,
    thisMonth: entries.filter((e) => e.dateKey.startsWith(ym)).length,
    thisWeek: entries.filter((e) => weekKeys.has(e.dateKey)).length,
    streak,
    longestStreak: Math.max(longest, streak),
    wordsTotal,
    avgWords: entries.length ? Math.round(wordsTotal / entries.length) : 0,
    tagCounts,
    moodCounts,
    filledDays,
  };
}

export type CalCell = {
  dateKey: string;
  day: number;
  inMonth: boolean;
  isToday: boolean;
  hasEntry: boolean;
  /** First tag id for calendar dot color. */
  tagId?: string;
  mood?: MoodId;
};

export function buildMonthGrid(
  year: number,
  month: number, // 0-11
  filled: Map<string, JournalEntry>,
  today = new Date()
): CalCell[] {
  const first = new Date(year, month, 1);
  const startPad = (first.getDay() + 6) % 7; // Mon first
  const start = new Date(year, month, 1 - startPad);
  const todayKey = dateKeyFromDate(today);
  const cells: CalCell[] = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    const key = dateKeyFromDate(d);
    const entry = filled.get(key);
    const tagId = entry?.meta.tags?.[0] || entry?.meta.mood;
    cells.push({
      dateKey: key,
      day: d.getDate(),
      inMonth: d.getMonth() === month,
      isToday: key === todayKey,
      hasEntry: !!entry,
      tagId,
      mood: entry?.meta.mood,
    });
  }
  return cells;
}

export function heatWeeks(
  filledDays: Set<string>,
  weeks = 16,
  today = new Date()
): { dateKey: string; level: number }[][] {
  const end = new Date(today);
  end.setHours(0, 0, 0, 0);
  const start = startOfWeek(end);
  start.setDate(start.getDate() - (weeks - 1) * 7);
  const grid: { dateKey: string; level: number }[][] = [];
  for (let w = 0; w < weeks; w++) {
    const col: { dateKey: string; level: number }[] = [];
    for (let d = 0; d < 7; d++) {
      const cur = new Date(start);
      cur.setDate(start.getDate() + w * 7 + d);
      const key = dateKeyFromDate(cur);
      col.push({ dateKey: key, level: filledDays.has(key) ? 1 : 0 });
    }
    grid.push(col);
  }
  return grid;
}

export type HeatCell = {
  dateKey: string;
  /** 0 empty · 1–4 intensity */
  level: number;
  inYear: boolean;
  words: number;
};

export type HeatYearGraph = {
  year: number;
  weeks: HeatCell[][];
  monthLabels: { label: string; weekIndex: number }[];
  filledCount: number;
  totalCellsInYear: number;
};

function heatLevelFromWords(words: number, filled: boolean): number {
  if (!filled && words <= 0) return 0;
  if (words <= 0) return 1;
  if (words < 80) return 1;
  if (words < 200) return 2;
  if (words < 450) return 3;
  return 4;
}

/** GitHub-style year heatmap (Mon-first columns). */
export function heatYearGraph(
  filledDays: Set<string>,
  opts?: {
    year?: number;
    wordsByDate?: Map<string, number> | Record<string, number>;
    today?: Date;
  }
): HeatYearGraph {
  const today = opts?.today ? new Date(opts.today) : new Date();
  today.setHours(0, 0, 0, 0);
  const year = opts?.year ?? today.getFullYear();
  const wordsMap =
    opts?.wordsByDate instanceof Map
      ? opts.wordsByDate
      : new Map(Object.entries(opts?.wordsByDate || {}));

  const yearStart = new Date(year, 0, 1);
  const yearEnd = new Date(year, 11, 31);
  const gridStart = startOfWeek(yearStart);
  // Include week that contains Dec 31
  let gridEnd = startOfWeek(yearEnd);
  gridEnd = new Date(gridEnd.getFullYear(), gridEnd.getMonth(), gridEnd.getDate() + 6);

  const weeks: HeatCell[][] = [];
  const cursor = new Date(gridStart);
  while (cursor.getTime() <= gridEnd.getTime()) {
    const col: HeatCell[] = [];
    for (let d = 0; d < 7; d++) {
      const cur = new Date(cursor);
      cur.setDate(cursor.getDate() + d);
      const key = dateKeyFromDate(cur);
      const inYear = cur.getFullYear() === year;
      const words = Number(wordsMap.get(key) || 0);
      const filled = filledDays.has(key);
      const level = inYear ? heatLevelFromWords(words, filled) : 0;
      col.push({ dateKey: key, level: inYear ? level : 0, inYear, words });
    }
    weeks.push(col);
    cursor.setDate(cursor.getDate() + 7);
  }

  const monthNames = ["1月", "2月", "3月", "4月", "5月", "6月", "7月", "8月", "9月", "10月", "11月", "12月"];
  const monthLabels: { label: string; weekIndex: number }[] = [];
  const seenMonths = new Set<number>();
  weeks.forEach((col, weekIndex) => {
    for (const cell of col) {
      if (!cell.inYear) continue;
      const d = parseDateKey(cell.dateKey);
      if (!d || d.getDate() !== 1) continue;
      const m = d.getMonth();
      if (seenMonths.has(m)) continue;
      seenMonths.add(m);
      monthLabels.push({ label: monthNames[m], weekIndex });
    }
  });
  // Fallback: if Jan 1 was mid-week and somehow missed, label first in-year week for missing months
  if (seenMonths.size < 12) {
    weeks.forEach((col, weekIndex) => {
      for (const cell of col) {
        if (!cell.inYear) continue;
        const d = parseDateKey(cell.dateKey);
        if (!d) continue;
        const m = d.getMonth();
        if (seenMonths.has(m)) continue;
        seenMonths.add(m);
        monthLabels.push({ label: monthNames[m], weekIndex });
        break;
      }
    });
    monthLabels.sort((a, b) => a.weekIndex - b.weekIndex);
  }

  let filledCount = 0;
  let totalCellsInYear = 0;
  for (const col of weeks) {
    for (const cell of col) {
      if (!cell.inYear) continue;
      totalCellsInYear += 1;
      if (cell.level > 0) filledCount += 1;
    }
  }

  return { year, weeks, monthLabels, filledCount, totalCellsInYear };
}

/** Years that appear in filled days, plus current year. Desc sorted. */
export function heatAvailableYears(filledDays: Set<string>, today = new Date()): number[] {
  const years = new Set<number>([today.getFullYear()]);
  for (const key of filledDays) {
    const y = Number(key.slice(0, 4));
    if (y >= 2000 && y <= 2100) years.add(y);
  }
  return [...years].sort((a, b) => b - a);
}

export const JOURNAL_PROMPTS = [
  "今天最想記住的一件事是什麼？",
  "有哪個決定讓你覺得踏實？",
  "什麼消耗了你的能量？",
  "今天學到什麼可以明天用？",
  "對誰說一句謝謝？",
  "如果只能寫三個字總結今天？",
  "哪段對話值得記下來？",
  "明天只做一件最重要的事會是？",
  "身體現在感覺如何？",
  "有什麼想原諒自己的？",
  "今天哪個時刻最安靜？",
  "若重來一次，你會改哪個選擇？",
];

export function promptForDate(dateKey: string): string {
  let hash = 0;
  for (let i = 0; i < dateKey.length; i++) hash = (hash * 31 + dateKey.charCodeAt(i)) >>> 0;
  return JOURNAL_PROMPTS[hash % JOURNAL_PROMPTS.length];
}

export const DEFAULT_JOURNAL_TEMPLATES: JournalTemplateDef[] = [
  {
    id: "morning",
    label: "晨間",
    body: `## 晨間定調
- 今日意圖：
- 最重要的一件事：
- 想避開的干擾：
`,
  },
  {
    id: "evening",
    label: "夜間",
    body: `## 夜間收斂
- 完成了：
- 沒做完但可放下：
- 明天接手：
`,
  },
  {
    id: "gratitude",
    label: "感恩",
    body: `## 感恩三件
1. 
2. 
3. 
`,
  },
  {
    id: "wins",
    label: "小勝利",
    body: `## 今日小勝利
- 
- 
`,
  },
];

/** @deprecated Prefer DEFAULT_JOURNAL_TEMPLATES */
export const CHECKIN_TEMPLATES = DEFAULT_JOURNAL_TEMPLATES;

export function monthLabel(year: number, month: number): string {
  return `${year} 年 ${month + 1} 月`;
}

export function weekdayLabels(): string[] {
  return ["一", "二", "三", "四", "五", "六", "日"];
}

export function exportMonthMarkdown(
  entries: JournalEntry[],
  year: number,
  month: number,
  tagDefs: JournalTagDef[] = DEFAULT_JOURNAL_TAGS
): string {
  const prefix = `${year}-${String(month + 1).padStart(2, "0")}`;
  const list = entries.filter((e) => e.dateKey.startsWith(prefix)).sort((a, b) => a.dateKey.localeCompare(b.dateKey));
  const lines = [`# ${monthLabel(year, month)} 日誌匯出`, "", `篇數：${list.length}`, ""];
  const labelOf = (id: string) => tagDefs.find((t) => t.id === id)?.label || id;
  for (const e of list) {
    lines.push(`## ${e.dateKey}`);
    lines.push("");
    const tags = e.meta.tags?.length ? e.meta.tags : e.meta.mood ? [e.meta.mood] : [];
    if (tags.length) lines.push(`標籤：${tags.map(labelOf).join("、")}`);
    lines.push("");
    lines.push((e.body_md || "").replace(META_RE, "").trim());
    lines.push("");
    lines.push("---");
    lines.push("");
  }
  return lines.join("\n");
}
