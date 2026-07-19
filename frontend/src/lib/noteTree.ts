/** Build Notion/Obsidian-like folder trees from note.folder paths */

export type TreeNote = {
  id: string;
  title: string;
  folder?: string;
  updated_at?: Date;
};

export type FolderNode = {
  id: string;
  name: string;
  path: string;
  children: FolderNode[];
  notes: TreeNote[];
  noteCount: number;
};

export const UNCATEGORIZED = "未分類";

export function normalizeFolderPath(folder?: string): string {
  return (folder || "")
    .trim()
    .replace(/\\/g, "/")
    .replace(/\/+/g, "/")
    .replace(/^\/|\/$/g, "");
}

export function splitFolderPath(folder?: string): string[] {
  const p = normalizeFolderPath(folder);
  if (!p) return [];
  return p.split("/").filter(Boolean);
}

function emptyFolder(name: string, path: string): FolderNode {
  return { id: path || "__root__", name, path, children: [], notes: [], noteCount: 0 };
}

/** Build a nested tree. Notes without folder go under 未分類. */
export function buildNoteTree(notes: TreeNote[]): {
  roots: FolderNode[];
  uncategorized: TreeNote[];
  total: number;
} {
  const rootMap = new Map<string, FolderNode>();
  const childMaps = new WeakMap<FolderNode, Map<string, FolderNode>>();

  function getChildMap(n: FolderNode) {
    let m = childMaps.get(n);
    if (!m) {
      m = new Map();
      childMaps.set(n, m);
    }
    return m;
  }

  const ensure = (segments: string[]): FolderNode => {
    let path = "";
    let level: Map<string, FolderNode> = rootMap;
    let node: FolderNode | undefined;
    for (const seg of segments) {
      path = path ? `${path}/${seg}` : seg;
      let found = level.get(path);
      if (!found) {
        // also allow lookup by name at this level for uniqueness of path keys
        found = emptyFolder(seg, path);
        level.set(path, found);
      }
      node = found;
      level = getChildMap(found);
    }
    return node!;
  };

  const uncategorized: TreeNote[] = [];
  const sorted = [...notes].sort((a, b) =>
    (a.title || "").localeCompare(b.title || "", "zh-Hant")
  );

  for (const note of sorted) {
    const segs = splitFolderPath(note.folder);
    if (!segs.length) {
      uncategorized.push(note);
      continue;
    }
    ensure(segs).notes.push(note);
  }

  const materialize = (n: FolderNode) => {
    const m = childMaps.get(n);
    if (m) {
      n.children = [...m.values()].sort((a, b) => a.name.localeCompare(b.name, "zh-Hant"));
      n.children.forEach(materialize);
    }
    n.noteCount = n.notes.length + n.children.reduce((s, c) => s + c.noteCount, 0);
  };

  const topLevel = [...rootMap.values()].sort((a, b) =>
    a.name.localeCompare(b.name, "zh-Hant")
  );
  topLevel.forEach(materialize);

  return {
    roots: topLevel,
    uncategorized,
    total: notes.length,
  };
}

function folderHasMatch(node: FolderNode, q: string): boolean {
  if (node.name.toLowerCase().includes(q)) return true;
  if (node.notes.some((n) => (n.title || "").toLowerCase().includes(q))) return true;
  return node.children.some((c) => folderHasMatch(c, q));
}

export type FlatTreeRow = {
  kind: "folder" | "note";
  depth: number;
  folder?: FolderNode;
  note?: TreeNote;
  path: string;
};

export function flattenVisibleNotes(
  roots: FolderNode[],
  uncategorized: TreeNote[],
  expanded: Set<string>,
  query: string
): FlatTreeRow[] {
  const q = query.trim().toLowerCase();
  const out: FlatTreeRow[] = [];

  const noteMatch = (n: TreeNote) =>
    !q ||
    (n.title || "").toLowerCase().includes(q) ||
    (n.folder || "").toLowerCase().includes(q);

  const walk = (node: FolderNode, depth: number) => {
    const childNotes = node.notes.filter(noteMatch);
    const hasMatchingDesc =
      !q || childNotes.length > 0 || node.children.some((c) => folderHasMatch(c, q));
    if (q && !hasMatchingDesc && !node.name.toLowerCase().includes(q)) return;

    out.push({ kind: "folder", depth, folder: node, path: node.path });
    const open = q ? true : expanded.has(node.path);
    if (!open) return;
    for (const c of node.children) walk(c, depth + 1);
    for (const n of childNotes) {
      out.push({ kind: "note", depth: depth + 1, note: n, path: node.path });
    }
  };

  for (const r of roots) walk(r, 0);

  const unc = uncategorized.filter(noteMatch);
  if (!q || unc.length) {
    if (unc.length > 0 || (!q && uncategorized.length === 0 && roots.length === 0)) {
      // show 未分類 when there are uncategorized notes
    }
    if (unc.length > 0 || (!q && uncategorized.length > 0)) {
      const path = UNCATEGORIZED;
      out.push({
        kind: "folder",
        depth: 0,
        folder: {
          id: "__none__",
          name: UNCATEGORIZED,
          path,
          children: [],
          notes: unc,
          noteCount: unc.length,
        },
        path,
      });
      if (q || expanded.has(path)) {
        for (const n of unc) {
          out.push({ kind: "note", depth: 1, note: n, path });
        }
      }
    }
  }

  return out;
}

export function filterNotesByFolderQuery(
  notes: TreeNote[],
  folderParam: string
): TreeNote[] {
  if (!folderParam) return notes;
  if (folderParam === "__none__" || folderParam === UNCATEGORIZED) {
    return notes.filter((n) => !normalizeFolderPath(n.folder));
  }
  const target = normalizeFolderPath(folderParam);
  return notes.filter((n) => {
    const p = normalizeFolderPath(n.folder);
    return p === target || p.startsWith(`${target}/`);
  });
}
