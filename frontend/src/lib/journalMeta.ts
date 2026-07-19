/** Journal calendar, streaks, prompts, and note helpers */

import type { Note } from "@/lib/firebase";

export type MoodId = "great" | "good" | "ok" | "low" | "rough";

export const MOODS: { id: MoodId; label: string; color: string }[] = [
  { id: "great", label: "超好", color: "#34D399" },
  { id: "good", label: "不錯", color: "#0D9488" },
  { id: "ok", label: "普通", color: "#94A3B8" },
  { id: "low", label: "低落", color: "#F59E0B" },
  { id: "rough", label: "很糟", color: "#EF4444" },
];

export type JournalMeta = {
  mood?: MoodId;
  energy?: number; // 1-5
};

export type JournalEntry = Note & {
  dateKey: string;
  snippet: string;
  meta: JournalMeta;
  wordCount: number;
};

const META_RE = /<!--\s*cadence-journal\s+([^>]*)-->/i;

export function parseJournalMeta(body: string): JournalMeta {
  const m = META_RE.exec(body || "");
  if (!m) return {};
  const attrs = m[1];
  const mood = /mood="([^"]+)"/i.exec(attrs)?.[1] as MoodId | undefined;
  const energyRaw = /energy="(\d+)"/i.exec(attrs)?.[1];
  const energy = energyRaw ? Math.min(5, Math.max(1, Number(energyRaw))) : undefined;
  return {
    mood: MOODS.some((x) => x.id === mood) ? mood : undefined,
    energy,
  };
}

export function upsertJournalMeta(body: string, meta: JournalMeta): string {
  const tag = `<!--cadence-journal mood="${meta.mood || ""}" energy="${meta.energy ?? ""}"-->`;
  if (META_RE.test(body || "")) return (body || "").replace(META_RE, tag);
  return `${tag}\n${body || ""}`;
}

export function dateKeyFromDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function parseDateKey(key: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}

export function isJournalNote(n: Note): boolean {
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
    .sort((a, b) => b.dateKey.localeCompare(a.dateKey));
}

export type JournalStats = {
  total: number;
  thisMonth: number;
  thisWeek: number;
  streak: number;
  longestStreak: number;
  wordsTotal: number;
  avgWords: number;
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
    // If today empty, start from yesterday
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
  let wordsTotal = 0;
  for (const e of entries) {
    wordsTotal += e.wordCount;
    if (e.meta.mood) moodCounts[e.meta.mood] += 1;
  }

  return {
    total: entries.length,
    thisMonth: entries.filter((e) => e.dateKey.startsWith(ym)).length,
    thisWeek: entries.filter((e) => weekKeys.has(e.dateKey)).length,
    streak,
    longestStreak: Math.max(longest, streak),
    wordsTotal,
    avgWords: entries.length ? Math.round(wordsTotal / entries.length) : 0,
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
    cells.push({
      dateKey: key,
      day: d.getDate(),
      inMonth: d.getMonth() === month,
      isToday: key === todayKey,
      hasEntry: !!entry,
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

export const CHECKIN_TEMPLATES = [
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

export function monthLabel(year: number, month: number): string {
  return `${year} 年 ${month + 1} 月`;
}

export function weekdayLabels(): string[] {
  return ["一", "二", "三", "四", "五", "六", "日"];
}

export function exportMonthMarkdown(entries: JournalEntry[], year: number, month: number): string {
  const prefix = `${year}-${String(month + 1).padStart(2, "0")}`;
  const list = entries.filter((e) => e.dateKey.startsWith(prefix)).sort((a, b) => a.dateKey.localeCompare(b.dateKey));
  const lines = [`# ${monthLabel(year, month)} 日誌匯出`, "", `篇數：${list.length}`, ""];
  for (const e of list) {
    lines.push(`## ${e.dateKey}`);
    lines.push("");
    if (e.meta.mood) lines.push(`情緒：${MOODS.find((m) => m.id === e.meta.mood)?.label || e.meta.mood}`);
    if (e.meta.energy) lines.push(`能量：${e.meta.energy}/5`);
    lines.push("");
    lines.push((e.body_md || "").replace(META_RE, "").trim());
    lines.push("");
    lines.push("---");
    lines.push("");
  }
  return lines.join("\n");
}
