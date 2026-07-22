/** Import local .md / .markdown files as Cadence notes. */

import { createNote } from "@/lib/firebase";
import { normalizeFolderPath } from "@/lib/noteTree";

const MD_EXT = /\.(md|markdown|mdx)$/i;
const MAX_BYTES = 2_500_000;

export function isMarkdownFile(file: File): boolean {
  if (MD_EXT.test(file.name)) return true;
  const t = (file.type || "").toLowerCase();
  return (
    t === "text/markdown" ||
    t === "text/x-markdown" ||
    t === "text/plain"
  ) && MD_EXT.test(file.name);
}

export function dataTransferHasFiles(dt: DataTransfer | null | undefined): boolean {
  if (!dt) return false;
  if (dt.types && Array.from(dt.types as unknown as string[]).includes("Files")) return true;
  return !!(dt.files && dt.files.length > 0);
}

export function markdownFilesFromDataTransfer(dt: DataTransfer): File[] {
  const list = Array.from(dt.files || []);
  return list.filter(isMarkdownFile);
}

/** Prefer filename; fall back to first AT1. */
export function titleFromMarkdown(filename: string, body: string): string {
  const fromName = filename
    .replace(/\\/g, "/")
    .split("/")
    .pop()
    ?.replace(MD_EXT, "")
    .trim();
  if (fromName) return fromName;
  const h1 = body.match(/^\s*#\s+(.+?)\s*$/m);
  if (h1?.[1]?.trim()) return h1[1].trim();
  return "未命名";
}

/** Optional YAML frontmatter: extract tags, return body without fence. */
export function parseMarkdownImport(raw: string): { body: string; tags: string[] } {
  const text = raw.replace(/^\uFEFF/, "");
  if (!text.startsWith("---")) return { body: text, tags: [] };
  const end = text.indexOf("\n---", 3);
  if (end < 0) return { body: text, tags: [] };
  const fence = text.slice(3, end).trim();
  const body = text.slice(end + 4).replace(/^\r?\n/, "");
  const tags: string[] = [];
  const tagsLine = fence.match(/^tags:\s*(.+)$/im);
  if (tagsLine) {
    const v = tagsLine[1].trim();
    if (v.startsWith("[") && v.endsWith("]")) {
      for (const part of v.slice(1, -1).split(",")) {
        const t = part.trim().replace(/^['"]|['"]$/g, "").replace(/^#/, "");
        if (t) tags.push(t);
      }
    } else {
      for (const part of v.split(/[, ]+/)) {
        const t = part.trim().replace(/^#/, "");
        if (t) tags.push(t);
      }
    }
  }
  return { body, tags };
}

export type ImportMarkdownResult = {
  createdIds: string[];
  skipped: { name: string; reason: string }[];
};

export async function importMarkdownFilesAsNotes(
  uid: string,
  files: File[],
  opts?: {
    folder?: string;
    parentId?: string;
    defaultTags?: string[];
    defaultStatus?: "backlog" | "doing" | "done" | "";
  }
): Promise<ImportMarkdownResult> {
  const folder = normalizeFolderPath(opts?.folder || "");
  const parentId = opts?.parentId || "";
  const defaultTags = opts?.defaultTags || [];
  const createdIds: string[] = [];
  const skipped: { name: string; reason: string }[] = [];

  for (const file of files) {
    if (!isMarkdownFile(file)) {
      skipped.push({ name: file.name, reason: "不是 Markdown 檔" });
      continue;
    }
    if (file.size > MAX_BYTES) {
      skipped.push({ name: file.name, reason: "檔案太大（上限約 2.5MB）" });
      continue;
    }
    try {
      const raw = await file.text();
      const { body, tags: fmTags } = parseMarkdownImport(raw);
      const title = titleFromMarkdown(file.name, body);
      const tags = Array.from(new Set([...defaultTags, ...fmTags]));
      const id = await createNote(uid, title, body, undefined, tags, {
        folder: parentId ? "" : folder,
        parent_id: parentId || undefined,
        status: opts?.defaultStatus || "backlog",
      });
      createdIds.push(id);
    } catch (err) {
      skipped.push({
        name: file.name,
        reason: err instanceof Error ? err.message : "匯入失敗",
      });
    }
  }

  return { createdIds, skipped };
}
