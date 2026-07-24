/** Import local .md / .markdown files as Cadence notes (folders, YAML, wiki/attachments). */

import { createNote, updateNote, uploadNoteMedia } from "@/lib/firebase";
import { normalizeFolderPath } from "@/lib/noteTree";
import { structureFrontmatterExtras, ORGANIZED_PROP } from "@/lib/noteKnowledge";

const MD_EXT = /\.(md|markdown|mdx)$/i;
const MAX_BYTES = 2_500_000;
const MEDIA_EXT = /\.(png|jpe?g|gif|webp|svg|bmp|pdf|mp3|wav|m4a|ogg|mp4|webm|mov)$/i;

/** Stored on note.props for wiki alias resolution + FM round-trip. */
export const ALIASES_PROP = "aliases";
/** Extra / unknown YAML keys preserved for export. */
export const FRONTMATTER_PROP = "frontmatter";

export function isMarkdownFile(file: File): boolean {
  if (MD_EXT.test(file.name)) return true;
  const t = (file.type || "").toLowerCase();
  return (
    (t === "text/markdown" ||
      t === "text/x-markdown" ||
      t === "text/plain") &&
    MD_EXT.test(file.name)
  );
}

export function isMediaAttachmentFile(file: File): boolean {
  return MEDIA_EXT.test(file.name);
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

/** All files from a drop (md + attachments); keeps webkitRelativePath. */
export function filesFromDataTransfer(dt: DataTransfer): File[] {
  return Array.from(dt.files || []);
}

/** Prefer filename; then frontmatter title; fall back to first AT1. */
export function titleFromMarkdown(filename: string, body: string, fmTitle?: string): string {
  if (fmTitle?.trim()) return fmTitle.trim();
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

function unquote(s: string): string {
  const t = s.trim();
  if (
    (t.startsWith('"') && t.endsWith('"')) ||
    (t.startsWith("'") && t.endsWith("'"))
  ) {
    return t.slice(1, -1);
  }
  return t;
}

function parseYamlScalar(raw: string): string | number | boolean | null {
  const v = unquote(raw.trim());
  if (v === "" || v === "~" || /^null$/i.test(v)) return null;
  if (/^true$/i.test(v)) return true;
  if (/^false$/i.test(v)) return false;
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  return v;
}

/** Parse inline `[a, b]` or multiline `- a` list into strings. */
function parseYamlStringList(value: string, fence: string, key: string): string[] {
  const v = value.trim();
  if (!v || v === "[]") return [];
  if (v.startsWith("[") && v.endsWith("]")) {
    return v
      .slice(1, -1)
      .split(",")
      .map((p) => unquote(p.trim()).replace(/^#/, ""))
      .filter(Boolean);
  }
  // Flow without brackets: a, b
  if (v.includes(",") && !v.startsWith("-")) {
    return v
      .split(",")
      .map((p) => unquote(p.trim()).replace(/^#/, ""))
      .filter(Boolean);
  }
  // Block list under this key
  if (v === "" || v === "|" || v === ">") {
    const lines = fence.split(/\r?\n/);
    const out: string[] = [];
    let inKey = false;
    const keyRe = new RegExp(`^${key}\\s*:`, "i");
    for (const line of lines) {
      if (keyRe.test(line)) {
        inKey = true;
        continue;
      }
      if (!inKey) continue;
      if (/^\S/.test(line) && !/^\s*-\s+/.test(line)) break;
      const m = line.match(/^\s*-\s+(.+)$/);
      if (m) out.push(unquote(m[1]).replace(/^#/, ""));
    }
    return out.filter(Boolean);
  }
  return [unquote(v).replace(/^#/, "")].filter(Boolean);
}

function parseYamlBlock(fence: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const lines = fence.split(/\r?\n/);
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim() || line.trim().startsWith("#")) {
      i++;
      continue;
    }
    const m = line.match(/^([A-Za-z0-9_-]+)\s*:\s*(.*)$/);
    if (!m) {
      i++;
      continue;
    }
    const key = m[1];
    const rest = m[2] ?? "";
    // Block sequence
    if (rest.trim() === "" || rest.trim() === "|" || rest.trim() === ">") {
      const items: string[] = [];
      let j = i + 1;
      while (j < lines.length) {
        const L = lines[j];
        if (/^\S/.test(L) && !/^\s*-\s+/.test(L)) break;
        const im = L.match(/^\s*-\s+(.+)$/);
        if (im) items.push(unquote(im[1]));
        else if (L.trim() && !/^\s*-\s*$/.test(L) && !/^\s*#/.test(L)) break;
        j++;
      }
      if (items.length) {
        out[key] = items;
        i = j;
        continue;
      }
      out[key] = rest.trim() === "|" || rest.trim() === ">" ? "" : null;
      i++;
      continue;
    }
    if (rest.trim().startsWith("[")) {
      out[key] = parseYamlStringList(rest, fence, key);
      i++;
      continue;
    }
    out[key] = parseYamlScalar(rest);
    i++;
  }
  return out;
}

export type ParsedMarkdownImport = {
  body: string;
  title?: string;
  tags: string[];
  aliases: string[];
  journalDate?: string;
  created?: string;
  updated?: string;
  /** Explicit folder from YAML (when not using directory structure) */
  folder?: string;
  /** Cadence note id for local-folder bridge matching */
  cadenceId?: string;
  /** note.props.type from YAML `type` */
  noteType?: string;
  /** Mapped kanban status from YAML status/state when recognized */
  kanbanStatus?: "backlog" | "doing" | "done";
  /** First-class props: type, fm_status, relation fields with [[wikilinks]] */
  promotedProps: Record<string, unknown>;
  /** Non-mapped YAML keys for round-trip */
  extras: Record<string, unknown>;
};

const RESERVED_FM = new Set([
  "title",
  "tags",
  "tag",
  "aliases",
  "alias",
  "date",
  "created",
  "created_at",
  "updated",
  "updated_at",
  "modified",
  "journal_date",
  "journal",
  "folder",
  "cadence_id",
  "type",
  "note_type",
  "status",
  "state",
  "progress",
  "organized",
]);

function asStringList(v: unknown): string[] {
  if (Array.isArray(v)) {
    return v.map((x) => String(x).trim().replace(/^#/, "")).filter(Boolean);
  }
  if (typeof v === "string") {
    return parseYamlStringList(v, "", "x");
  }
  return [];
}

function asDateString(v: unknown): string | undefined {
  if (v == null) return undefined;
  if (typeof v === "number") {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
  }
  const s = String(v).trim();
  if (!s) return undefined;
  return s;
}

function asJournalDate(v: unknown): string | undefined {
  const s = asDateString(v);
  if (!s) return undefined;
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : undefined;
}

/** Optional YAML frontmatter → structured fields + body without fence. */
export function parseMarkdownImport(raw: string): ParsedMarkdownImport {
  const text = raw.replace(/^\uFEFF/, "");
  if (!text.startsWith("---")) {
    return { body: text, tags: [], aliases: [], extras: {}, promotedProps: {} };
  }
  const end = text.indexOf("\n---", 3);
  if (end < 0) return { body: text, tags: [], aliases: [], extras: {}, promotedProps: {} };
  const fence = text.slice(3, end).replace(/^\r?\n/, "").replace(/\r?\n$/, "");
  const body = text.slice(end + 4).replace(/^\r?\n/, "");
  const map = parseYamlBlock(fence);

  const tags = asStringList(map.tags ?? map.tag);
  const aliases = asStringList(map.aliases ?? map.alias);
  const title =
    typeof map.title === "string" || typeof map.title === "number"
      ? String(map.title).trim()
      : undefined;
  const journalDate =
    asJournalDate(map.journal_date) ||
    asJournalDate(map.journal) ||
    asJournalDate(map.date);
  const created = asDateString(map.created ?? map.created_at);
  const updated = asDateString(map.updated ?? map.updated_at ?? map.modified);
  const folder =
    typeof map.folder === "string" || typeof map.folder === "number"
      ? normalizeFolderPath(String(map.folder))
      : undefined;
  const cadenceRaw = map.cadence_id ?? map.cadenceId;
  const cadenceId =
    cadenceRaw != null && String(cadenceRaw).trim()
      ? String(cadenceRaw).trim()
      : undefined;

  const rawExtras: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(map)) {
    if (RESERVED_FM.has(k.toLowerCase())) continue;
    rawExtras[k] = v;
  }
  // Re-include type/status keys for structured promotion (they are reserved above)
  for (const k of ["type", "note_type", "status", "state", "progress", "organized"]) {
    if (map[k] != null) rawExtras[k] = map[k];
  }
  // Keep original date fields that weren't mapped to journal when useful for export
  if (map.date != null && !journalDate) rawExtras.date = map.date;
  if (created) rawExtras.created = created;
  if (updated) rawExtras.updated = updated;

  const structured = structureFrontmatterExtras(rawExtras);
  if (map.organized === true || map.organized === "true" || map.organized === 1) {
    structured.promoted[ORGANIZED_PROP] = true;
  }

  return {
    body,
    title: title || undefined,
    tags,
    aliases,
    journalDate,
    created,
    updated,
    folder: folder || undefined,
    cadenceId,
    noteType: structured.type,
    kanbanStatus: structured.kanbanStatus,
    promotedProps: structured.promoted,
    extras: structured.extras,
  };
}

/** Serialize note metadata as YAML frontmatter block (no trailing --- body). */
export function serializeFrontmatter(meta: {
  title?: string;
  tags?: string[];
  aliases?: string[];
  journalDate?: string;
  folder?: string;
  created?: string | Date;
  updated?: string | Date;
  /** Local-folder bridge identity */
  cadenceId?: string;
  extras?: Record<string, unknown>;
}): string {
  const lines: string[] = ["---"];
  if (meta.title?.trim()) lines.push(`title: ${yamlQuote(meta.title.trim())}`);
  const tags = (meta.tags || []).map((t) => t.replace(/^#/, "")).filter(Boolean);
  if (tags.length) {
    lines.push(`tags: [${tags.map((t) => yamlQuote(t)).join(", ")}]`);
  }
  const aliases = (meta.aliases || []).map((a) => a.trim()).filter(Boolean);
  if (aliases.length) {
    lines.push(`aliases: [${aliases.map((a) => yamlQuote(a)).join(", ")}]`);
  }
  if (meta.journalDate?.trim()) {
    lines.push(`date: ${yamlQuote(meta.journalDate.trim())}`);
  }
  if (meta.folder?.trim()) {
    lines.push(`folder: ${yamlQuote(meta.folder.trim())}`);
  }
  if (meta.cadenceId?.trim()) {
    lines.push(`cadence_id: ${yamlQuote(meta.cadenceId.trim())}`);
  }
  const created = formatFmDate(meta.created);
  if (created) lines.push(`created: ${yamlQuote(created)}`);
  const updated = formatFmDate(meta.updated);
  if (updated) lines.push(`updated: ${yamlQuote(updated)}`);
  for (const [k, v] of Object.entries(meta.extras || {})) {
    if (RESERVED_FM.has(k.toLowerCase())) continue;
    if (v == null) continue;
    if (Array.isArray(v)) {
      const items = v.map((x) => yamlQuote(String(x))).join(", ");
      lines.push(`${k}: [${items}]`);
    } else if (typeof v === "boolean" || typeof v === "number") {
      lines.push(`${k}: ${v}`);
    } else {
      lines.push(`${k}: ${yamlQuote(String(v))}`);
    }
  }
  lines.push("---");
  return lines.join("\n");
}

function formatFmDate(v?: string | Date): string | undefined {
  if (!v) return undefined;
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return undefined;
    return v.toISOString();
  }
  return String(v).trim() || undefined;
}

function yamlQuote(s: string): string {
  if (/^[\w./:@+-]+$/u.test(s) && !/^(true|false|null)$/i.test(s)) return s;
  return JSON.stringify(s);
}

/** Body + YAML frontmatter for export round-trip. */
export function markdownWithFrontmatter(
  body: string,
  meta: Parameters<typeof serializeFrontmatter>[0]
): string {
  const fm = serializeFrontmatter(meta);
  const bare = (body || "").replace(/^\uFEFF/, "");
  // Avoid double FM if body already starts with ---
  if (bare.startsWith("---\n") || bare.startsWith("---\r\n")) {
    return bare;
  }
  return `${fm}\n\n${bare}`.replace(/\n{3,}/g, "\n\n");
}

export function relativePathOf(file: File): string {
  const rel =
    (file as File & { webkitRelativePath?: string }).webkitRelativePath ||
    file.name;
  return rel.replace(/\\/g, "/");
}

/**
 * Derive Cadence folder from file relative path.
 * Strips the root directory name (selected folder) and the filename.
 * `baseFolder` is prepended when dropping into an existing Cadence folder.
 */
export function folderFromImportPath(
  file: File,
  baseFolder = ""
): string {
  const rel = relativePathOf(file);
  const parts = rel.split("/").filter(Boolean);
  if (parts.length <= 1) {
    return normalizeFolderPath(baseFolder);
  }
  // Drop filename
  parts.pop();
  // Drop root folder name from directory picker / folder drag
  if (parts.length >= 1) parts.shift();
  const nested = parts.join("/");
  const base = normalizeFolderPath(baseFolder);
  if (!nested) return base;
  if (!base) return normalizeFolderPath(nested);
  return normalizeFolderPath(`${base}/${nested}`);
}

/** Normalize `[[Folder/Note]]` / `[[Note.md]]` → `[[Note]]` so title-based wiki keeps working. */
export function normalizeWikilinksInBody(body: string): string {
  return (body || "").replace(
    /\[\[([^\]|#]+)(\|[^\]]+)?\]\]/g,
    (_m, target: string, aliasPart?: string) => {
      let t = target.trim().replace(/\\/g, "/");
      t = t.replace(MD_EXT, "");
      const leaf = t.split("/").filter(Boolean).pop() || t;
      return `[[${leaf.trim()}${aliasPart || ""}]]`;
    }
  );
}

/** Normalize relative markdown/image paths: `\` → `/`, strip `./`. Leave http(s), data:, wiki alone. */
export function normalizeAttachmentPathsInBody(body: string, noteDir = ""): string {
  const rewrite = (rawUrl: string): string => {
    const url = rawUrl.trim();
    if (!url) return url;
    if (/^(https?:|data:|blob:|mailto:|#|\/notes\/)/i.test(url)) return url;
    if (url.startsWith("[[")) return url;
    let p = url.replace(/\\/g, "/");
    // strip query/hash for path normalize, keep them
    const hashIdx = p.search(/[?#]/);
    let hash = "";
    if (hashIdx >= 0) {
      hash = p.slice(hashIdx);
      p = p.slice(0, hashIdx);
    }
    while (p.startsWith("./")) p = p.slice(2);
    // Resolve .. against noteDir when provided
    if (noteDir && !p.startsWith("/")) {
      const baseParts = noteDir.split("/").filter(Boolean);
      const pathParts = p.split("/");
      for (const part of pathParts) {
        if (part === "..") baseParts.pop();
        else if (part && part !== ".") baseParts.push(part);
      }
      p = baseParts.join("/");
    } else {
      p = p
        .split("/")
        .filter((x) => x && x !== ".")
        .join("/");
    }
    return p + hash;
  };

  return (body || "")
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_m, alt: string, src: string) => {
      return `![${alt}](${rewrite(src)})`;
    })
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, label: string, src: string) => {
      // skip wiki-style already handled; keep normal md links
      if (src.trim().startsWith("[[")) return `[${label}](${src})`;
      return `[${label}](${rewrite(src)})`;
    });
}

function noteDirFromRelativePath(rel: string): string {
  const parts = rel.replace(/\\/g, "/").split("/").filter(Boolean);
  parts.pop();
  if (parts.length) parts.shift(); // strip root folder name
  return parts.join("/");
}

export function buildAttachmentIndex(files: File[]): Map<string, File> {
  const map = new Map<string, File>();
  for (const f of files) {
    if (isMarkdownFile(f)) continue;
    if (!isMediaAttachmentFile(f)) continue;
    const rel = relativePathOf(f);
    const parts = rel.split("/").filter(Boolean);
    // Full relative (with and without root folder)
    map.set(rel.toLowerCase(), f);
    if (parts.length > 1) {
      map.set(parts.slice(1).join("/").toLowerCase(), f);
    }
    map.set(parts[parts.length - 1].toLowerCase(), f);
  }
  return map;
}

export async function rewriteAndUploadAttachments(
  uid: string,
  noteId: string,
  body: string,
  noteRelPath: string,
  attachmentIndex: Map<string, File>
): Promise<string> {
  if (!attachmentIndex.size) return body;
  const noteDir = noteDirFromRelativePath(noteRelPath);
  const cache = new Map<string, string>();

  const resolveFile = (rawUrl: string): File | undefined => {
    let p = rawUrl.trim().replace(/\\/g, "/");
    if (/^(https?:|data:|blob:|mailto:|#)/i.test(p)) return undefined;
    while (p.startsWith("./")) p = p.slice(2);
    const hashIdx = p.search(/[?#]/);
    if (hashIdx >= 0) p = p.slice(0, hashIdx);
    const candidates = [
      p,
      noteDir ? `${noteDir}/${p}` : p,
      p.split("/").pop() || p,
    ];
    for (const c of candidates) {
      const hit = attachmentIndex.get(c.toLowerCase());
      if (hit) return hit;
    }
    return undefined;
  };

  const replaceAsync = async (src: string): Promise<string> => {
    const file = resolveFile(src);
    if (!file) return src;
    const key = relativePathOf(file).toLowerCase();
    if (cache.has(key)) return cache.get(key)!;
    try {
      const up = await uploadNoteMedia(uid, noteId, file);
      cache.set(key, up.url);
      return up.url;
    } catch {
      return src;
    }
  };

  // Collect unique local srcs first
  const srcs = new Set<string>();
  const re = /!\[[^\]]*\]\(([^)]+)\)|\[[^\]]+\]\(([^)]+)\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) {
    const src = (m[1] || m[2] || "").trim();
    if (src && resolveFile(src)) srcs.add(src);
  }
  const urlMap = new Map<string, string>();
  for (const src of srcs) {
    urlMap.set(src, await replaceAsync(src));
  }
  if (!urlMap.size) return body;

  return body
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_a, alt: string, src: string) => {
      const next = urlMap.get(src.trim()) || src;
      return `![${alt}](${next})`;
    })
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_a, label: string, src: string) => {
      const next = urlMap.get(src.trim()) || src;
      return `[${label}](${next})`;
    });
}

export type ImportMarkdownResult = {
  createdIds: string[];
  skipped: { name: string; reason: string }[];
};

export type ImportMarkdownOptions = {
  /** Base Cadence folder when not using per-file relative paths */
  folder?: string;
  parentId?: string;
  defaultTags?: string[];
  defaultStatus?: "backlog" | "doing" | "done" | "";
  /** Preserve directory structure from webkitRelativePath (default true when any file has a nested path) */
  preserveFolders?: boolean;
  /** Upload sibling media and rewrite local paths (default true) */
  uploadAttachments?: boolean;
  /** Normalize [[path/Note.md]] → [[Note]] (default true) */
  normalizeWikilinks?: boolean;
};

/** Hidden `<input type=file accept=.md multiple>` picker. */
export function pickMarkdownFiles(): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".md,.markdown,.mdx,text/markdown";
    input.multiple = true;
    input.style.display = "none";
    const done = (files: File[]) => {
      input.remove();
      resolve(files);
    };
    input.onchange = () => done(Array.from(input.files || []));
    input.oncancel = () => done([]);
    document.body.appendChild(input);
    input.click();
  });
}

/**
 * Directory picker: prefer `showDirectoryPicker`, fall back to `webkitdirectory`.
 * Returns all files under the tree (md + attachments) with webkitRelativePath set.
 */
export async function pickMarkdownFolder(): Promise<File[]> {
  const w = window as Window & {
    showDirectoryPicker?: () => Promise<FileSystemDirectoryHandle>;
  };
  if (typeof w.showDirectoryPicker === "function") {
    try {
      const root = await w.showDirectoryPicker();
      return await readDirectoryHandle(root, root.name);
    } catch (err) {
      // User cancel
      if (err instanceof DOMException && err.name === "AbortError") return [];
      // Fall through to input
    }
  }
  return pickMarkdownFolderViaInput();
}

function pickMarkdownFolderViaInput(): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    (input as HTMLInputElement & { webkitdirectory?: boolean }).webkitdirectory = true;
    input.setAttribute("webkitdirectory", "");
    input.setAttribute("directory", "");
    input.style.display = "none";
    const done = (files: File[]) => {
      input.remove();
      resolve(files);
    };
    input.onchange = () => done(Array.from(input.files || []));
    input.oncancel = () => done([]);
    document.body.appendChild(input);
    input.click();
  });
}

async function readDirectoryHandle(
  dir: FileSystemDirectoryHandle,
  prefix: string
): Promise<File[]> {
  const out: File[] = [];
  // FileSystemDirectoryHandle async iterator
  const handle = dir as FileSystemDirectoryHandle & {
    values?: () => AsyncIterable<FileSystemHandle>;
    entries?: () => AsyncIterable<[string, FileSystemHandle]>;
  };
  const iter =
    handle.entries?.() ||
    (async function* () {
      if (!handle.values) return;
      for await (const h of handle.values()) {
        yield [h.name, h] as [string, FileSystemHandle];
      }
    })();
  for await (const [name, entry] of iter) {
    const path = `${prefix}/${name}`;
    if (entry.kind === "directory") {
      out.push(
        ...(await readDirectoryHandle(entry as FileSystemDirectoryHandle, path))
      );
    } else if (entry.kind === "file") {
      const fileHandle = entry as FileSystemFileHandle;
      const file = await fileHandle.getFile();
      // Re-wrap so webkitRelativePath is available
      const named = new File([file], file.name, {
        type: file.type,
        lastModified: file.lastModified,
      });
      Object.defineProperty(named, "webkitRelativePath", {
        value: path,
        configurable: true,
      });
      out.push(named);
    }
  }
  return out;
}

export async function importMarkdownFilesAsNotes(
  uid: string,
  files: File[],
  opts?: ImportMarkdownOptions
): Promise<ImportMarkdownResult> {
  const baseFolder = normalizeFolderPath(opts?.folder || "");
  const parentId = opts?.parentId || "";
  const defaultTags = opts?.defaultTags || [];
  const createdIds: string[] = [];
  const skipped: { name: string; reason: string }[] = [];

  const allFiles = files.filter(Boolean);
  const mdFiles = allFiles.filter(isMarkdownFile);
  const hasNested = mdFiles.some((f) => relativePathOf(f).includes("/"));
  const preserveFolders =
    opts?.preserveFolders ?? (hasNested && !parentId);
  const uploadAttachments = opts?.uploadAttachments !== false;
  const normalizeWiki = opts?.normalizeWikilinks !== false;
  const attachmentIndex = uploadAttachments
    ? buildAttachmentIndex(allFiles)
    : new Map<string, File>();

  for (const file of mdFiles) {
    if (file.size > MAX_BYTES) {
      skipped.push({ name: file.name, reason: "檔案太大（上限約 2.5MB）" });
      continue;
    }
    try {
      const raw = await file.text();
      const parsed = parseMarkdownImport(raw);
      let body = parsed.body;
      if (normalizeWiki) body = normalizeWikilinksInBody(body);
      const noteRel = relativePathOf(file);
      const noteDir = noteDirFromRelativePath(noteRel);
      body = normalizeAttachmentPathsInBody(body, noteDir);

      const title = titleFromMarkdown(file.name, body, parsed.title);
      const tags = Array.from(new Set([...defaultTags, ...parsed.tags]));
      let folder = "";
      if (!parentId) {
        if (preserveFolders) {
          const fromPath = folderFromImportPath(file, baseFolder);
          folder =
            fromPath ||
            (parsed.folder
              ? normalizeFolderPath(
                  baseFolder ? `${baseFolder}/${parsed.folder}` : parsed.folder
                )
              : baseFolder);
        } else {
          folder = parsed.folder || baseFolder;
        }
      }

      const props: Record<string, unknown> = { ...parsed.promotedProps };
      if (parsed.aliases.length) props[ALIASES_PROP] = parsed.aliases;
      if (Object.keys(parsed.extras).length) {
        props[FRONTMATTER_PROP] = parsed.extras;
      }
      // Map YAML type/status/priority/due → workspace catalog keys
      const fmBag = { ...parsed.extras, ...parsed.promotedProps };
      if (fmBag.type != null || parsed.noteType) {
        props.ws_type = String(parsed.noteType || fmBag.type || "").trim();
      }
      if (parsed.kanbanStatus) {
        props.ws_status = parsed.kanbanStatus;
      } else if (fmBag.status != null) {
        const s = String(fmBag.status).trim();
        const map: Record<string, string> = {
          待辦: "backlog",
          未開始: "backlog",
          進行中: "doing",
          完成: "done",
          已完成: "done",
        };
        props.ws_status = map[s] || s;
      }
      if (fmBag.priority != null) props.ws_priority = String(fmBag.priority).trim();
      if (fmBag.due != null) props.ws_due = String(fmBag.due).trim().slice(0, 10);

      const id = await createNote(uid, title, body, undefined, tags, {
        folder,
        parent_id: parentId || undefined,
        status: parsed.kanbanStatus || opts?.defaultStatus || "backlog",
        journal_date: parsed.journalDate || undefined,
        props,
      });

      if (uploadAttachments && attachmentIndex.size) {
        const rewritten = await rewriteAndUploadAttachments(
          uid,
          id,
          body,
          noteRel,
          attachmentIndex
        );
        if (rewritten !== body) {
          await updateNote(id, { body_md: rewritten }, { silent: true });
        }
      }

      createdIds.push(id);
    } catch (err) {
      skipped.push({
        name: file.name,
        reason: err instanceof Error ? err.message : "匯入失敗",
      });
    }
  }

  // Non-md only selection
  if (!mdFiles.length && allFiles.length) {
    for (const f of allFiles) {
      skipped.push({ name: f.name, reason: "不是 Markdown 檔" });
    }
  }

  return { createdIds, skipped };
}
