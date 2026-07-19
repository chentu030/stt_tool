/** Obsidian-style [[wikilinks]] helpers */

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

export type NoteLite = { id: string; title: string; body_md: string; tags?: string[] };

export function findNoteByTitle(notes: NoteLite[], title: string): NoteLite | undefined {
  const t = title.trim().toLowerCase();
  return notes.find((n) => n.title.trim().toLowerCase() === t)
    || notes.find((n) => n.title.trim().toLowerCase().includes(t));
}

export function findBacklinks(notes: NoteLite[], current: NoteLite): NoteLite[] {
  const title = current.title.trim().toLowerCase();
  if (!title) return [];
  return notes.filter((n) => {
    if (n.id === current.id) return false;
    const links = extractWikiLinks(n.body_md).map((x) => x.toLowerCase());
    return links.includes(title);
  });
}

export function suggestWikiTitles(notes: NoteLite[], query: string, limit = 8): NoteLite[] {
  const q = query.trim().toLowerCase();
  if (!q) return notes.slice(0, limit);
  return notes
    .filter((n) => n.title.toLowerCase().includes(q))
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
