/** Kanban board helpers: columns, priority, filters, stats */

import type { Note } from "@/lib/firebase";

export type BoardStatus = "backlog" | "doing" | "done";
export type Priority = "urgent" | "high" | "normal" | "low";

export const BOARD_COLUMNS: {
  id: BoardStatus;
  label: string;
  hint: string;
  color: string;
  wipLimit?: number;
}[] = [
  { id: "backlog", label: "待辦", hint: "還沒開始", color: "#94A3B8", wipLimit: undefined },
  { id: "doing", label: "進行中", hint: "正在處理", color: "#0D9488", wipLimit: 5 },
  { id: "done", label: "完成", hint: "已收尾", color: "#34D399", wipLimit: undefined },
];

export const PRIORITIES: { id: Priority; label: string; color: string; rank: number }[] = [
  { id: "urgent", label: "緊急", color: "#EF4444", rank: 0 },
  { id: "high", label: "高", color: "#F59E0B", rank: 1 },
  { id: "normal", label: "普通", color: "#94A3B8", rank: 2 },
  { id: "low", label: "低", color: "#64748B", rank: 3 },
];

export type BoardMeta = {
  priority: Priority;
  due?: string; // YYYY-MM-DD
};

export type BoardCard = Note & {
  statusKey: BoardStatus;
  meta: BoardMeta;
  snippet: string;
  wordCount: number;
  ageDays: number;
  overdue: boolean;
};

const META_RE = /<!--\s*cadence-board\s+([^>]*)-->/i;

export function statusOf(n: Note): BoardStatus {
  if (n.status === "doing" || n.status === "done") return n.status;
  return "backlog";
}

export function parseBoardMeta(body: string, tags: string[] = []): BoardMeta {
  const m = META_RE.exec(body || "");
  let priority: Priority = "normal";
  let due: string | undefined;
  if (m) {
    const p = /priority="([^"]+)"/i.exec(m[1])?.[1] as Priority | undefined;
    if (PRIORITIES.some((x) => x.id === p)) priority = p!;
    const d = /due="(\d{4}-\d{2}-\d{2})"/i.exec(m[1])?.[1];
    if (d) due = d;
  }
  const tagJoin = tags.join(" ").toLowerCase();
  if (tagJoin.includes("urgent") || tags.includes("緊急")) priority = "urgent";
  else if (tagJoin.includes("high") || tags.includes("高優先")) priority = "high";
  return { priority, due };
}

export function upsertBoardMeta(body: string, meta: Partial<BoardMeta>): string {
  const cur = parseBoardMeta(body);
  const next: BoardMeta = {
    priority: meta.priority || cur.priority || "normal",
    due: meta.due !== undefined ? meta.due : cur.due,
  };
  const tag = `<!--cadence-board priority="${next.priority}" due="${next.due || ""}"-->`;
  if (META_RE.test(body || "")) return (body || "").replace(META_RE, tag);
  return `${tag}\n${body || ""}`;
}

function countWords(text: string): number {
  const t = (text || "").replace(META_RE, "").trim();
  if (!t) return 0;
  const cjk = (t.match(/[\u4e00-\u9fff]/g) || []).length;
  const latin = t.replace(/[\u4e00-\u9fff]/g, " ").split(/\s+/).filter(Boolean).length;
  return cjk + latin;
}

function snippetOf(body: string, max = 100): string {
  const plain = (body || "")
    .replace(META_RE, "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[#>*`\[\]()_-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!plain) return "（空白筆記）";
  return plain.length > max ? `${plain.slice(0, max)}…` : plain;
}

function daysBetween(a: Date, b: Date): number {
  return Math.floor((b.getTime() - a.getTime()) / 86400000);
}

export function toBoardCards(notes: Note[], today = new Date()): BoardCard[] {
  const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  return notes.map((n) => {
    const meta = parseBoardMeta(n.body_md, n.tags);
    const ageDays = Math.max(0, daysBetween(n.updated_at, today));
    return {
      ...n,
      statusKey: statusOf(n),
      meta,
      snippet: snippetOf(n.body_md),
      wordCount: countWords(n.body_md),
      ageDays,
      overdue: !!(meta.due && meta.due < todayKey && statusOf(n) !== "done"),
    };
  });
}

export type BoardFilters = {
  q: string;
  folder: string;
  tag: string;
  priority: "" | Priority;
  hideDone: boolean;
  onlyOverdue: boolean;
  onlyStale: boolean; // not updated in 7+ days and not done
};

export type BoardSort = "updated" | "title" | "priority" | "due" | "age";

export function filterBoardCards(cards: BoardCard[], f: BoardFilters): BoardCard[] {
  const q = f.q.trim().toLowerCase();
  return cards.filter((c) => {
    if (f.hideDone && c.statusKey === "done") return false;
    if (f.onlyOverdue && !c.overdue) return false;
    if (f.onlyStale && (c.statusKey === "done" || c.ageDays < 7)) return false;
    if (f.folder === "__none__") {
      if (c.folder?.trim()) return false;
    } else if (f.folder && (c.folder || "") !== f.folder) return false;
    if (f.tag && !(c.tags || []).includes(f.tag)) return false;
    if (f.priority && c.meta.priority !== f.priority) return false;
    if (!q) return true;
    return (
      c.title.toLowerCase().includes(q) ||
      c.body_md.toLowerCase().includes(q) ||
      (c.folder || "").toLowerCase().includes(q) ||
      (c.tags || []).some((t) => t.toLowerCase().includes(q))
    );
  });
}

export function sortBoardCards(cards: BoardCard[], sort: BoardSort): BoardCard[] {
  const rank = (p: Priority) => PRIORITIES.find((x) => x.id === p)?.rank ?? 9;
  return [...cards].sort((a, b) => {
    if (sort === "title") return a.title.localeCompare(b.title, "zh-Hant");
    if (sort === "priority") return rank(a.meta.priority) - rank(b.meta.priority);
    if (sort === "due") {
      const ad = a.meta.due || "9999";
      const bd = b.meta.due || "9999";
      return ad.localeCompare(bd);
    }
    if (sort === "age") return b.ageDays - a.ageDays;
    return b.updated_at.getTime() - a.updated_at.getTime();
  });
}

export type BoardStats = {
  total: number;
  backlog: number;
  doing: number;
  done: number;
  overdue: number;
  stale: number;
  doneRate: number;
  byFolder: { name: string; count: number }[];
  byPriority: Record<Priority, number>;
  wipOk: boolean;
};

export function computeBoardStats(cards: BoardCard[]): BoardStats {
  const backlog = cards.filter((c) => c.statusKey === "backlog").length;
  const doing = cards.filter((c) => c.statusKey === "doing").length;
  const done = cards.filter((c) => c.statusKey === "done").length;
  const overdue = cards.filter((c) => c.overdue).length;
  const stale = cards.filter((c) => c.statusKey !== "done" && c.ageDays >= 7).length;
  const folderMap = new Map<string, number>();
  const byPriority: Record<Priority, number> = { urgent: 0, high: 0, normal: 0, low: 0 };
  for (const c of cards) {
    const f = c.folder?.trim() || "未分類";
    folderMap.set(f, (folderMap.get(f) || 0) + 1);
    byPriority[c.meta.priority] += 1;
  }
  const doingLimit = BOARD_COLUMNS.find((c) => c.id === "doing")?.wipLimit;
  return {
    total: cards.length,
    backlog,
    doing,
    done,
    overdue,
    stale,
    doneRate: cards.length ? Math.round((done / cards.length) * 100) : 0,
    byFolder: Array.from(folderMap.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count),
    byPriority,
    wipOk: doingLimit == null || doing <= doingLimit,
  };
}

export function groupByFolder(cards: BoardCard[]): { lane: string; cards: BoardCard[] }[] {
  const map = new Map<string, BoardCard[]>();
  for (const c of cards) {
    const lane = c.folder?.trim() || "未分類";
    if (!map.has(lane)) map.set(lane, []);
    map.get(lane)!.push(c);
  }
  return Array.from(map.entries())
    .map(([lane, list]) => ({ lane, cards: list }))
    .sort((a, b) => a.lane.localeCompare(b.lane, "zh-Hant"));
}

export function exportBoardMarkdown(cards: BoardCard[]): string {
  const lines = [`# Cadence 看板匯出`, "", `匯出時間：${new Date().toLocaleString("zh-TW")}`, ""];
  for (const col of BOARD_COLUMNS) {
    const list = cards.filter((c) => c.statusKey === col.id);
    lines.push(`## ${col.label} (${list.length})`, "");
    for (const c of list) {
      lines.push(`- **${c.title || "未命名"}**`);
      if (c.folder) lines.push(`  - 資料夾：${c.folder}`);
      if (c.meta.priority !== "normal") lines.push(`  - 優先：${c.meta.priority}`);
      if (c.meta.due) lines.push(`  - 截止：${c.meta.due}`);
      if ((c.tags || []).length) lines.push(`  - 標籤：${(c.tags || []).map((t) => `#${t}`).join(" ")}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

export const BOARD_QUICK_TEMPLATES = [
  { id: "task", title: "新任務", body: "## 目標\n\n\n## 下一步\n- [ ] \n" },
  { id: "bug", title: "問題追蹤", body: "## 現象\n\n\n## 重現步驟\n1. \n\n## 預期\n\n" },
  { id: "idea", title: "靈感", body: "## 想法\n\n\n## 為什麼現在重要\n\n" },
];
