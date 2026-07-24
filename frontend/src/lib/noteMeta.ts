/** Note outline, stats, and related-note helpers */

import {
  bodyForExport,
  noteIsSourceMaterial,
} from "@/lib/writingMaterial";

export type HeadingItem = {
  id: string;
  level: 1 | 2 | 3;
  text: string;
  index: number;
};

export type NoteStats = {
  words: number;
  chars: number;
  charsNoSpace: number;
  lines: number;
  headings: number;
  links: number;
  todos: number;
  todosDone: number;
  readingMins: number;
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

export type ComputeNoteStatsOptions = {
  /** Exclude「素材」regions (default true for writing chrome). */
  excludeSource?: boolean;
  props?: Record<string, unknown> | null;
};

export function computeNoteStats(
  md: string,
  opts?: ComputeNoteStatsOptions
): NoteStats {
  const exclude = opts?.excludeSource !== false;
  const body = exclude
    ? bodyForExport(md || "", {
        includeSource: false,
        wholeNoteIsSource: noteIsSourceMaterial(opts?.props),
      })
    : md || "";
  const plain = body
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[#>*`\[\]()_-]/g, " ");
  const words = countWords(plain);
  const todos = (body.match(/^\s*[-*]\s+\[[ xX]\]/gm) || []).length;
  const todosDone = (body.match(/^\s*[-*]\s+\[[xX]\]/gm) || []).length;
  const links = (body.match(/\[\[.+?\]\]|https?:\/\/\S+/g) || []).length;
  const headings = (body.match(/^#{1,3}\s+.+/gm) || []).length;
  return {
    words,
    chars: body.length,
    charsNoSpace: body.replace(/\s/g, "").length,
    lines: body ? body.split("\n").length : 0,
    headings,
    links,
    todos,
    todosDone,
    readingMins: words === 0 ? 0 : Math.max(1, Math.ceil(words / 400)),
  };
}

export function extractOutline(md: string): HeadingItem[] {
  const lines = (md || "").split("\n");
  const out: HeadingItem[] = [];
  lines.forEach((line, index) => {
    const m = /^(#{1,3})\s+(.+)$/.exec(line.trim());
    if (!m) return;
    const level = m[1].length as 1 | 2 | 3;
    // Strip md marks + common escapes (e.g. "1\." → "1.") so TOC matches rendered headings.
    const text = unescapeMdHeading(m[2]);
    if (!text) return;
    out.push({
      id: `h-${index}-${level}-${text.slice(0, 24)}`,
      level,
      text,
      index,
    });
  });
  return out;
}

/** Display / jump text for outline: drop inline marks and unescape `1\.` style sequences. */
export function unescapeMdHeading(raw: string): string {
  return String(raw || "")
    .replace(/[#*`]/g, "")
    .replace(/\\([\\`*_{}[\]()#+\-.!|])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

export type RelatedNote = {
  id: string;
  title: string;
  reason: string;
  score: number;
};

export function findRelatedNotes(
  current: { id: string; title: string; body_md: string; tags?: string[]; folder?: string },
  notes: { id: string; title: string; body_md: string; tags?: string[]; folder?: string }[],
  limit = 6
): RelatedNote[] {
  const titleTok = current.title.toLowerCase();
  const tags = new Set((current.tags || []).map((t) => t.toLowerCase()));
  const folder = (current.folder || "").toLowerCase();

  const scored: RelatedNote[] = [];
  for (const n of notes) {
    if (n.id === current.id) continue;
    let score = 0;
    const reasons: string[] = [];
    const nTags = (n.tags || []).map((t) => t.toLowerCase());
    const shared = nTags.filter((t) => tags.has(t));
    if (shared.length) {
      score += shared.length * 12;
      reasons.push(`#${shared[0]}`);
    }
    if (folder && (n.folder || "").toLowerCase() === folder) {
      score += 10;
      reasons.push("同資料夾");
    }
    if (titleTok && n.title.toLowerCase().includes(titleTok.slice(0, 8))) {
      score += 8;
      reasons.push("標題相近");
    }
    if (current.title && n.body_md.includes(`[[${current.title}`)) {
      score += 16;
      reasons.push("連到本頁");
    }
    if (n.title && current.body_md.includes(`[[${n.title}`)) {
      score += 14;
      reasons.push("本頁連出");
    }
    if (score > 0) {
      scored.push({
        id: n.id,
        title: n.title || "未命名",
        reason: reasons.slice(0, 2).join(" · "),
        score,
      });
    }
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, limit);
}

export function slugifyHeading(text: string) {
  return text
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^\w\u4e00-\u9fff-]/g, "")
    .slice(0, 48);
}

export const NOTE_AI_ACTIONS = [
  { id: "summarize" as const, label: "摘要", hint: "條列重點", mode: "append" as const },
  { id: "rewrite" as const, label: "改寫", hint: "更清晰", mode: "replace" as const },
  { id: "outline" as const, label: "大綱", hint: "結構整理", mode: "append" as const },
  { id: "expand" as const, label: "擴寫", hint: "補細節", mode: "replace" as const },
  { id: "actions" as const, label: "待辦", hint: "抽出行動項", mode: "append" as const },
  { id: "quiz" as const, label: "測驗", hint: "出題複習", mode: "append" as const },
  { id: "explain" as const, label: "說明", hint: "白話解釋", mode: "append" as const },
];

export type NoteAiActionId = (typeof NOTE_AI_ACTIONS)[number]["id"];
