/**
 * Bridge between Cadence notes and Deep Research.
 * URL seeds, insert handoff, report body formatting, notebook citations.
 */

export type ResearchLaunchOpts = {
  /** Seed note id → topic/context + pin in library scope */
  from?: string;
  /** Explicit note ids for research scope */
  notes?: string[];
  topic?: string;
  /** Selected text from editor (session-stashed; URL carries flag) */
  selection?: string;
  /** After save/insert, navigate back here */
  returnTo?: boolean;
};

export type CitationLike = {
  index: number;
  kind: "web" | "note";
  title: string;
  uri: string;
  noteId?: string;
};

const INSERT_KEY = (noteId: string) => `cadence_research_insert_v1_${noteId}`;
const SELECTION_KEY = "cadence_research_selection_v1";

export function buildResearchUrl(opts: ResearchLaunchOpts): string {
  const q = new URLSearchParams();
  if (opts.from) q.set("from", opts.from);
  if (opts.notes?.length) q.set("notes", opts.notes.join(","));
  if (opts.topic?.trim()) q.set("topic", opts.topic.trim().slice(0, 200));
  if (opts.returnTo && opts.from) q.set("returnTo", "1");
  if (opts.selection?.trim()) {
    stashResearchSelection(opts.selection.trim());
    q.set("sel", "1");
  }
  const s = q.toString();
  return s ? `/research?${s}` : "/research";
}

export function stashResearchSelection(text: string) {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(
      SELECTION_KEY,
      JSON.stringify({ text: text.slice(0, 6000), at: Date.now() })
    );
  } catch {
    /* ignore */
  }
}

export function takeResearchSelection(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(SELECTION_KEY);
    if (!raw) return null;
    sessionStorage.removeItem(SELECTION_KEY);
    const parsed = JSON.parse(raw) as { text?: string; at?: number };
    if (!parsed.text) return null;
    if (parsed.at && Date.now() - parsed.at > 30 * 60 * 1000) return null;
    return parsed.text;
  } catch {
    return null;
  }
}

export function parseNotesParam(raw: string | null): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 40);
}

/**
 * Rewrite [n] footnotes into notebook-native links:
 * note → [[Title]]; web → [Title](url)
 */
export function rewriteCitationsForNotebook(
  markdown: string,
  sources: CitationLike[]
): string {
  if (!markdown || !sources?.length) return markdown;
  const map = new Map(sources.map((s) => [s.index, s]));
  return markdown.replace(/\[(\d+)\]/g, (full, num) => {
    const s = map.get(Number(num));
    if (!s) return full;
    if (s.kind === "note") {
      const title = (s.title || "筆記").replace(/[\[\]]/g, "");
      return `[[${title}]]`;
    }
    const title = (s.title || s.uri || "來源").replace(/[\[\]]/g, "");
    const uri = s.uri || "";
    if (!uri) return full;
    return `[${title}](${uri})`;
  });
}

export function formatResearchNoteBody(opts: {
  title: string;
  summary: string;
  markdown: string;
  model?: string;
  sourceNoteTitle?: string;
  webSources?: CitationLike[];
  noteSources?: CitationLike[];
  sources?: CitationLike[];
}): string {
  const allSources =
    opts.sources ||
    [...(opts.webSources || []), ...(opts.noteSources || [])].sort(
      (a, b) => a.index - b.index
    );
  const md = rewriteCitationsForNotebook(opts.markdown, allSources);
  const summary = rewriteCitationsForNotebook(opts.summary, allSources);

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

${summary}

${md}

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
  sources?: CitationLike[];
}): string {
  const summary = opts.sources
    ? rewriteCitationsForNotebook(opts.summary, opts.sources)
    : opts.summary;
  const md = opts.sources
    ? rewriteCitationsForNotebook(opts.markdown, opts.sources)
    : opts.markdown;
  if (opts.mode === "summary") {
    return `\n\n---\n\n## 深度研究 · ${opts.title}\n\n${summary}\n`;
  }
  return `\n\n---\n\n## 深度研究 · ${opts.title}\n\n### 摘要\n\n${summary}\n\n${md}\n`;
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
  opts?: {
    selectedIds?: string[];
    query?: string;
    limit?: number;
    /** chars per note excerpt (default 1800) */
    excerptChars?: number;
  }
): Array<{ id: string; title: string; excerpt: string; updatedAt?: string }> {
  const limit = opts?.limit ?? 28;
  const excerptChars = opts?.excerptChars ?? 1800;
  const selected = new Set(opts?.selectedIds || []);
  let pool = notes;
  if (selected.size) {
    pool = notes.filter((n) => selected.has(n.id));
  } else if (opts?.query?.trim()) {
    const q = opts.query.trim().toLowerCase();
    const tokens = q.split(/\s+/).filter((t) => t.length >= 2);
    pool = [...notes]
      .map((n) => {
        const hay = `${n.title}\n${n.body_md || ""}`.toLowerCase();
        let score = 0;
        for (const t of tokens) {
          if (hay.includes(t)) score += t.length >= 4 ? 3 : 1;
        }
        if ((n.title || "").toLowerCase().includes(tokens[0] || q)) score += 5;
        return { n, score };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .map((x) => x.n);
    if (!pool.length) pool = notes;
  }
  return pool.slice(0, limit).map((n) => ({
    id: n.id,
    title: n.title || "未命名",
    excerpt: (n.body_md || "").replace(/\s+/g, " ").trim().slice(0, excerptChars),
    updatedAt: n.updated_at?.toISOString?.() || undefined,
  }));
}

/** Expand scope with wiki-linked note titles found in seed note bodies */
export function expandScopeWithWiki(
  notes: Array<{ id: string; title: string; body_md?: string }>,
  seedIds: string[],
  extractWiki: (md: string) => string[]
): string[] {
  const byTitle = new Map(
    notes.map((n) => [(n.title || "").trim().toLowerCase(), n.id])
  );
  const out = new Set(seedIds);
  for (const id of seedIds) {
    const n = notes.find((x) => x.id === id);
    if (!n?.body_md) continue;
    for (const title of extractWiki(n.body_md)) {
      const linked = byTitle.get(title.trim().toLowerCase());
      if (linked) out.add(linked);
    }
  }
  return Array.from(out).slice(0, 40);
}
