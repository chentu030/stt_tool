/** Knowledge-base indexing, search ranking, and AI context packing */

export type LibraryNote = {
  id: string;
  title: string;
  body_md: string;
  tags?: string[];
  folder?: string;
  journal_date?: string;
  status?: string;
  icon?: string;
  color?: string;
  source_job_id?: string;
  updated_at: Date;
  created_at: Date;
};

export type LibraryJob = {
  id: string;
  status: string;
  title?: string;
  filenames?: string[];
  youtube_url?: string;
  created_at: Date;
};

export function libraryJobTitle(job: LibraryJob): string {
  const custom = (job.title || "").trim();
  if (custom) return custom;
  return job.filenames?.[0] || job.youtube_url || "轉錄";
}

export type SortKey = "updated" | "created" | "title" | "length" | "relevance";
export type ViewMode = "list" | "grid" | "compact" | "table";

export type LibraryStats = {
  noteCount: number;
  jobCount: number;
  doneJobs: number;
  tagCount: number;
  folderCount: number;
  wordCount: number;
  charCount: number;
  linkedCount: number;
  emptyCount: number;
  avgWords: number;
  updatedThisWeek: number;
};

export type FolderBucket = { name: string; count: number };
export type TagBucket = { name: string; count: number };

export type SearchHit = LibraryNote & {
  score: number;
  snippet: string;
  matchFields: string[];
};

function countWords(text: string): number {
  const t = (text || "").trim();
  if (!t) return 0;
  const cjk = (t.match(/[\u4e00-\u9fff]/g) || []).length;
  const latin = t
    .replace(/[\u4e00-\u9fff]/g, " ")
    .split(/\s+/)
    .filter(Boolean).length;
  return cjk + latin;
}

function plainSnippet(md: string, q: string, max = 140): string {
  const plain = (md || "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[#>*`\[\]()_-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!plain) return "（空白筆記）";
  const needle = q.trim().toLowerCase();
  if (needle) {
    const idx = plain.toLowerCase().indexOf(needle);
    if (idx >= 0) {
      const start = Math.max(0, idx - 40);
      const end = Math.min(plain.length, idx + needle.length + 80);
      return `${start > 0 ? "…" : ""}${plain.slice(start, end)}${end < plain.length ? "…" : ""}`;
    }
  }
  return plain.length > max ? `${plain.slice(0, max)}…` : plain;
}

export function computeLibraryStats(notes: LibraryNote[], jobs: LibraryJob[]): LibraryStats {
  const tagSet = new Set<string>();
  const folderSet = new Set<string>();
  let wordCount = 0;
  let charCount = 0;
  let linkedCount = 0;
  let emptyCount = 0;
  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  let updatedThisWeek = 0;

  for (const n of notes) {
    (n.tags || []).forEach((t) => tagSet.add(t));
    if (n.folder) folderSet.add(n.folder);
    const body = n.body_md || "";
    wordCount += countWords(body);
    charCount += body.length;
    if (/\[\[.+?\]\]/.test(body)) linkedCount += 1;
    if (!body.trim()) emptyCount += 1;
    if (n.updated_at.getTime() >= weekAgo) updatedThisWeek += 1;
  }

  return {
    noteCount: notes.length,
    jobCount: jobs.length,
    doneJobs: jobs.filter((j) => /done|complete|success|finished/i.test(j.status)).length,
    tagCount: tagSet.size,
    folderCount: folderSet.size,
    wordCount,
    charCount,
    linkedCount,
    emptyCount,
    avgWords: notes.length ? Math.round(wordCount / notes.length) : 0,
    updatedThisWeek,
  };
}

export function folderBuckets(notes: LibraryNote[]): FolderBucket[] {
  const map = new Map<string, number>();
  for (const n of notes) {
    const key = n.folder?.trim() || "未分類";
    map.set(key, (map.get(key) || 0) + 1);
  }
  return Array.from(map.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "zh-Hant"));
}

export function tagBuckets(notes: LibraryNote[], extraFromBody = true): TagBucket[] {
  const map = new Map<string, number>();
  const re = /(?:^|\s)#([\p{L}\p{N}_/-]+)/gu;
  for (const n of notes) {
    for (const t of n.tags || []) {
      map.set(t, (map.get(t) || 0) + 1);
    }
    if (extraFromBody) {
      let m: RegExpExecArray | null;
      const body = n.body_md || "";
      re.lastIndex = 0;
      while ((m = re.exec(body))) {
        map.set(m[1], (map.get(m[1]) || 0) + 1);
      }
    }
  }
  return Array.from(map.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "zh-Hant"));
}

function scoreNote(n: LibraryNote, tokens: string[]): { score: number; fields: string[] } {
  if (!tokens.length) return { score: 0, fields: [] };
  const title = n.title.toLowerCase();
  const body = (n.body_md || "").toLowerCase();
  const tags = (n.tags || []).join(" ").toLowerCase();
  const folder = (n.folder || "").toLowerCase();
  let score = 0;
  const fields: string[] = [];

  for (const tok of tokens) {
    if (title === tok) {
      score += 40;
      fields.push("title");
    } else if (title.includes(tok)) {
      score += 22;
      fields.push("title");
    }
    if (tags.includes(tok)) {
      score += 16;
      fields.push("tag");
    }
    if (folder.includes(tok)) {
      score += 10;
      fields.push("folder");
    }
    const bodyHits = body.split(tok).length - 1;
    if (bodyHits > 0) {
      score += Math.min(18, 4 + bodyHits * 2);
      fields.push("body");
    }
  }

  // recency boost
  const ageDays = (Date.now() - n.updated_at.getTime()) / (24 * 60 * 60 * 1000);
  score += Math.max(0, 8 - ageDays * 0.4);

  return { score, fields: Array.from(new Set(fields)) };
}

export function searchNotes(
  notes: LibraryNote[],
  query: string,
  opts?: {
    tag?: string;
    folder?: string;
    status?: string;
    sort?: SortKey;
  }
): SearchHit[] {
  const q = query.trim().toLowerCase();
  const tokens = q ? q.split(/\s+/).filter(Boolean) : [];
  const tag = opts?.tag || "";
  const folder = opts?.folder || "";
  const status = opts?.status || "";
  const sort = opts?.sort || (tokens.length ? "relevance" : "updated");

  let hits: SearchHit[] = notes
    .filter((n) => {
      if (tag) {
        const has =
          (n.tags || []).includes(tag) ||
          new RegExp(`(?:^|\\s)#${tag}(?:\\s|$)`).test(n.body_md || "");
        if (!has) return false;
      }
      if (folder === "__none__") {
        if (n.folder?.trim()) return false;
      } else if (folder) {
        const nf = (n.folder || "").trim().replace(/\\/g, "/");
        const f = folder.trim().replace(/\\/g, "/");
        if (nf !== f && !nf.startsWith(`${f}/`)) return false;
      }
      if (status && (n.status || "") !== status) return false;
      if (!tokens.length) return true;
      const { score } = scoreNote(n, tokens);
      return score > 0;
    })
    .map((n) => {
      const { score, fields } = scoreNote(n, tokens);
      return {
        ...n,
        score,
        snippet: plainSnippet(n.body_md, q),
        matchFields: fields,
      };
    });

  hits = [...hits].sort((a, b) => {
    if (sort === "relevance") return b.score - a.score || b.updated_at.getTime() - a.updated_at.getTime();
    if (sort === "title") return a.title.localeCompare(b.title, "zh-Hant");
    if (sort === "created") return b.created_at.getTime() - a.created_at.getTime();
    if (sort === "length") return (b.body_md?.length || 0) - (a.body_md?.length || 0);
    return b.updated_at.getTime() - a.updated_at.getTime();
  });

  return hits;
}

/** Pack notes into a bounded context string for the AI assistant */
export function packLibraryContext(
  notes: LibraryNote[],
  query: string,
  opts?: { selectedIds?: string[]; maxNotes?: number; maxChars?: number }
): { context: string; usedIds: string[]; truncated: boolean } {
  const maxNotes = opts?.maxNotes ?? 12;
  const maxChars = opts?.maxChars ?? 14000;
  const selected = new Set(opts?.selectedIds || []);

  let pool: LibraryNote[];
  if (selected.size) {
    pool = notes.filter((n) => selected.has(n.id));
  } else {
    const ranked = searchNotes(notes, query, { sort: query.trim() ? "relevance" : "updated" });
    pool = (ranked.length ? ranked : notes).slice(0, maxNotes);
  }

  const chunks: string[] = [];
  const usedIds: string[] = [];
  let total = 0;
  let truncated = false;

  for (const n of pool.slice(0, maxNotes)) {
    const head = `### ${n.title}\n路徑: /notes/${n.id}\n資料夾: ${n.folder || "未分類"}\n標籤: ${(n.tags || []).map((t) => `#${t}`).join(" ") || "無"}\n`;
    const bodyBudget = Math.min(1200, Math.max(200, maxChars - total - head.length - 20));
    let body = (n.body_md || "").trim();
    if (body.length > bodyBudget) {
      body = `${body.slice(0, bodyBudget)}…`;
      truncated = true;
    }
    const block = `${head}\n${body || "（空白）"}\n`;
    if (total + block.length > maxChars) {
      truncated = true;
      break;
    }
    chunks.push(block);
    usedIds.push(n.id);
    total += block.length;
  }

  return {
    context: chunks.join("\n---\n\n"),
    usedIds,
    truncated,
  };
}

export function exportNotesMarkdown(notes: LibraryNote[], title = "Albireus 知識庫匯出"): string {
  const lines = [`# ${title}`, "", `匯出時間：${new Date().toLocaleString("zh-TW")}`, `篇數：${notes.length}`, ""];
  for (const n of notes) {
    lines.push(`## ${n.title}`);
    lines.push("");
    if (n.folder) lines.push(`- 資料夾：${n.folder}`);
    if ((n.tags || []).length) lines.push(`- 標籤：${(n.tags || []).map((t) => `#${t}`).join(" ")}`);
    lines.push(`- 更新：${n.updated_at.toLocaleString("zh-TW")}`);
    lines.push("");
    lines.push(n.body_md || "");
    lines.push("");
    lines.push("---");
    lines.push("");
  }
  return lines.join("\n");
}

export function downloadText(filename: string, content: string, mime = "text/markdown;charset=utf-8") {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export type ActivityItem = {
  id: string;
  kind: "note" | "job";
  title: string;
  at: Date;
  href: string;
  meta: string;
};

export function recentActivity(notes: LibraryNote[], jobs: LibraryJob[], limit = 8): ActivityItem[] {
  const items: ActivityItem[] = [
    ...notes.map((n) => ({
      id: `n-${n.id}`,
      kind: "note" as const,
      title: n.title || "未命名筆記",
      at: n.updated_at,
      href: `/notes/${n.id}`,
      meta: n.folder || ((n.tags || [])[0] ? `#${(n.tags || [])[0]}` : "筆記"),
    })),
    ...jobs.map((j) => ({
      id: `j-${j.id}`,
      kind: "job" as const,
      title: libraryJobTitle(j),
      at: j.created_at,
      href: `/job/${j.id}`,
      meta: j.status,
    })),
  ];
  return items.sort((a, b) => b.at.getTime() - a.at.getTime()).slice(0, limit);
}

export const AI_SUGGESTIONS: { label: string; prompt: string }[] = [
  { label: "最近摘要", prompt: "用三點總結我知識庫最近在寫什麼" },
  { label: "找可連結", prompt: "找出彼此相關、可以互相連結的筆記" },
  { label: "複習清單", prompt: "幫我整理一份學習複習清單" },
  { label: "補缺漏", prompt: "哪些主題內容還很薄、值得補筆記？" },
  { label: "本週行動", prompt: "把本週更新的筆記做成行動項目" },
];
