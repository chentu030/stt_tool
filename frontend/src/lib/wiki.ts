/** Cadence [[note link]] helpers */

import { ALIASES_PROP } from "@/lib/importMarkdownNotes";

export function extractWikiLinks(md: string): string[] {
  const out: string[] = [];
  const re = /\[\[([^\]|#]+)(?:\|[^\]]+)?\]\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(md || ""))) {
    const t = m[1].trim();
    if (t && !out.includes(t)) out.push(t);
  }
  return out;
}

export function extractTagsFromText(md: string): string[] {
  const out: string[] = [];
  const re = /(?:^|\s)#([\p{L}\p{N}_/-]+)/gu;
  let m: RegExpExecArray | null;
  while ((m = re.exec(md || ""))) {
    const t = m[1];
    if (t && !out.includes(t)) out.push(t);
  }
  return out;
}

export type NoteLite = {
  id: string;
  title: string;
  body_md: string;
  tags?: string[];
  /** note.props — used for aliases from YAML import */
  props?: Record<string, unknown>;
};

function aliasesOf(n: NoteLite): string[] {
  const raw = n.props?.[ALIASES_PROP];
  if (!Array.isArray(raw)) return [];
  return raw.map((x) => String(x).trim()).filter(Boolean);
}

export function findNoteByTitle(notes: NoteLite[], title: string): NoteLite | undefined {
  const t = title.trim().toLowerCase();
  if (!t) return undefined;
  const exactTitle = notes.find((n) => n.title.trim().toLowerCase() === t);
  if (exactTitle) return exactTitle;
  const exactAlias = notes.find((n) =>
    aliasesOf(n).some((a) => a.toLowerCase() === t)
  );
  if (exactAlias) return exactAlias;
  return notes.find((n) => n.title.trim().toLowerCase().includes(t));
}

export function findBacklinks(notes: NoteLite[], current: NoteLite): NoteLite[] {
  const titles = [
    current.title.trim().toLowerCase(),
    ...aliasesOf(current).map((a) => a.toLowerCase()),
  ].filter(Boolean);
  if (!titles.length) return [];
  return notes.filter((n) => {
    if (n.id === current.id) return false;
    const links = extractWikiLinks(n.body_md).map((x) => x.toLowerCase());
    if (titles.some((t) => links.includes(t))) return true;
    // Prop relation fields with [[wikilinks]] also count as backlinks
    const props = n.props || {};
    for (const [k, v] of Object.entries(props)) {
      if (k === ALIASES_PROP || k === "frontmatter" || k === "live_segments") continue;
      const blob = Array.isArray(v) ? v.map(String).join(" ") : String(v ?? "");
      if (!/\[\[/.test(blob)) continue;
      const propLinks = extractWikiLinks(blob).map((x) => x.toLowerCase());
      if (titles.some((t) => propLinks.includes(t))) return true;
    }
    return false;
  });
}

export function suggestWikiTitles(notes: NoteLite[], query: string, limit = 8): NoteLite[] {
  const q = query.trim().toLowerCase();
  if (!q) return notes.slice(0, limit);
  return notes
    .filter((n) => {
      if (n.title.toLowerCase().includes(q)) return true;
      return aliasesOf(n).some((a) => a.toLowerCase().includes(q));
    })
    .slice(0, limit);
}

/** Replace [[Title]] with markdown links when we know the id map */
export function wikiToMarkdownLinks(md: string, resolve: (title: string) => string | null): string {
  return (md || "").replace(/\[\[([^\]|#]+)(?:\|([^\]]+))?\]\]/g, (_, title, alias) => {
    const id = resolve(title.trim());
    const label = (alias || title).trim();
    if (!id) return `[[${title}]]`;
    return `[${label}](/notes/${id})`;
  });
}
