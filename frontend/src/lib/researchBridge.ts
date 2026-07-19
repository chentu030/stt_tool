/**
 * Bridge between Cadence notes and Deep Research.
 * URL seeds, insert handoff, report body formatting.
 */

export type ResearchLaunchOpts = {
  /** Seed note id → topic/context + pin in library scope */
  from?: string;
  /** Explicit note ids for research scope */
  notes?: string[];
  topic?: string;
  /** After save/insert, navigate back here */
  returnTo?: boolean;
};

const INSERT_KEY = (noteId: string) => `cadence_research_insert_v1_${noteId}`;

export function buildResearchUrl(opts: ResearchLaunchOpts): string {
  const q = new URLSearchParams();
  if (opts.from) q.set("from", opts.from);
  if (opts.notes?.length) q.set("notes", opts.notes.join(","));
  if (opts.topic?.trim()) q.set("topic", opts.topic.trim().slice(0, 200));
  if (opts.returnTo && opts.from) q.set("returnTo", "1");
  const s = q.toString();
  return s ? `/research?${s}` : "/research";
}

export function parseNotesParam(raw: string | null): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 40);
}

export function formatResearchNoteBody(opts: {
  title: string;
  summary: string;
  markdown: string;
  model?: string;
  sourceNoteTitle?: string;
  webSources?: Array<{ index: number; title: string; uri: string }>;
  noteSources?: Array<{ index: number; title: string; uri: string }>;
}): string {
  const webList = (opts.webSources || [])
    .map((s) => `${s.index}. [${s.title}](${s.uri})`)
    .join("\n");
  const noteList = (opts.noteSources || [])
    .map((s) => `${s.index}. [[${s.title}]] (${s.uri})`)
    .join("\n");
  const relatedWiki = (opts.noteSources || [])
    .map((s) => `- [[${s.title}]]`)
    .join("\n");
  const sourceLine = opts.sourceNoteTitle
    ? `\n> 來源筆記：[[${opts.sourceNoteTitle}]]\n`
    : "";

  return `# ${opts.title}

> 由 Cadence 深度研究產生 · ${opts.model || "gemini-3.1-pro-preview"}
${sourceLine}
${relatedWiki ? `## 相關筆記\n\n${relatedWiki}\n\n` : ""}## 摘要

${opts.summary}

${opts.markdown}

---

## 來源

### 網路
${webList || "（無）"}

### 筆記
${noteList || "（無）"}
`;
}

/** Compact block to append into an existing note */
export function formatResearchInsertBlock(opts: {
  title: string;
  summary: string;
  markdown: string;
  mode?: "full" | "summary";
}): string {
  if (opts.mode === "summary") {
    return `\n\n---\n\n## 深度研究 · ${opts.title}\n\n${opts.summary}\n`;
  }
  return `\n\n---\n\n## 深度研究 · ${opts.title}\n\n### 摘要\n\n${opts.summary}\n\n${opts.markdown}\n`;
}

export function stashResearchInsert(noteId: string, markdown: string) {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(
      INSERT_KEY(noteId),
      JSON.stringify({ md: markdown, at: Date.now() })
    );
  } catch {
    /* ignore */
  }
}

export function takeResearchInsert(noteId: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(INSERT_KEY(noteId));
    if (!raw) return null;
    sessionStorage.removeItem(INSERT_KEY(noteId));
    const parsed = JSON.parse(raw) as { md?: string; at?: number };
    if (!parsed.md) return null;
    // expire after 2 hours
    if (parsed.at && Date.now() - parsed.at > 2 * 60 * 60 * 1000) return null;
    return parsed.md;
  } catch {
    return null;
  }
}

export function notesToResearchSnippets(
  notes: Array<{
    id: string;
    title: string;
    body_md?: string;
    updated_at?: Date;
  }>,
  opts?: { selectedIds?: string[]; query?: string; limit?: number }
): Array<{ id: string; title: string; excerpt: string; updatedAt?: string }> {
  const limit = opts?.limit ?? 28;
  const selected = new Set(opts?.selectedIds || []);
  let pool = notes;
  if (selected.size) {
    pool = notes.filter((n) => selected.has(n.id));
  }
  return pool.slice(0, limit).map((n) => ({
    id: n.id,
    title: n.title || "未命名",
    excerpt: (n.body_md || "").replace(/\s+/g, " ").trim().slice(0, 900),
    updatedAt: n.updated_at?.toISOString?.() || undefined,
  }));
}
