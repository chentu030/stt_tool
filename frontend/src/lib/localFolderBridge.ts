/**
 * P1 local folder bridge — persist a File System Access directory handle and
 * pull/push Markdown ↔ Cadence notes (knowledge-base sync).
 * Chrome / Edge desktop; not a plugin loader or Local REST server.
 */

import { createNote, updateNote, type Note } from "@/lib/firebase";
import {
  ALIASES_PROP,
  FRONTMATTER_PROP,
  buildAttachmentIndex,
  isMarkdownFile,
  isMediaAttachmentFile,
  markdownWithFrontmatter,
  normalizeAttachmentPathsInBody,
  normalizeWikilinksInBody,
  parseMarkdownImport,
  rewriteAndUploadAttachments,
  titleFromMarkdown,
} from "@/lib/importMarkdownNotes";
import { frontmatterExtrasFromProps } from "@/lib/noteKnowledge";
import { normalizeFolderPath } from "@/lib/noteTree";

const DB_NAME = "cadence_local_bridge";
const DB_VERSION = 1;
const HANDLE_STORE = "handles";
const META_STORE = "meta";

export const CADENCE_ID_KEY = "cadence_id";

export type LocalFolderLinkMeta = {
  uid: string;
  folderName: string;
  linkedAt: number;
  lastPullAt?: number;
  lastPushAt?: number;
  /** noteId → path relative to linked root (e.g. inbox/Note.md) */
  pathByNoteId: Record<string, string>;
};

export type BridgeCapability = {
  supported: boolean;
  reason?: string;
};

export type PullResult = {
  created: number;
  updated: number;
  attachments: number;
  skipped: { path: string; reason: string }[];
};

export type PushResult = {
  written: number;
  attachments: number;
  skipped: { noteId: string; title: string; reason: string }[];
};

type FsPermissionMode = { mode?: "read" | "readwrite" };

type DirectoryHandleWithPermission = FileSystemDirectoryHandle & {
  queryPermission?: (desc?: FsPermissionMode) => Promise<PermissionState>;
  requestPermission?: (desc?: FsPermissionMode) => Promise<PermissionState>;
  values?: () => AsyncIterable<FileSystemHandle>;
  entries?: () => AsyncIterable<[string, FileSystemHandle]>;
};

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB unavailable"));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(HANDLE_STORE)) {
        db.createObjectStore(HANDLE_STORE);
      }
      if (!db.objectStoreNames.contains(META_STORE)) {
        db.createObjectStore(META_STORE, { keyPath: "uid" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error("IndexedDB open failed"));
  });
}

function idbReq<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error("IndexedDB request failed"));
  });
}

function handleKey(uid: string) {
  return `folder:${uid}`;
}

export function getBridgeCapability(): BridgeCapability {
  if (typeof window === "undefined") {
    return { supported: false, reason: "僅瀏覽器可用" };
  }
  const w = window as Window & {
    showDirectoryPicker?: (opts?: {
      mode?: "read" | "readwrite";
      id?: string;
    }) => Promise<FileSystemDirectoryHandle>;
  };
  if (typeof w.showDirectoryPicker !== "function") {
    return {
      supported: false,
      reason: "此瀏覽器不支援本機資料夾同步（請用 Chrome 或 Edge 桌面版）",
    };
  }
  if (typeof indexedDB === "undefined") {
    return { supported: false, reason: "無法儲存資料夾連結" };
  }
  return { supported: true };
}

async function ensurePermission(
  handle: DirectoryHandleWithPermission,
  mode: "read" | "readwrite"
): Promise<boolean> {
  try {
    const opts: FsPermissionMode = { mode };
    if (typeof handle.queryPermission === "function") {
      const q = await handle.queryPermission(opts);
      if (q === "granted") return true;
    }
    if (typeof handle.requestPermission === "function") {
      const r = await handle.requestPermission(opts);
      return r === "granted";
    }
    // Older Chromium: getFile may throw if denied
    return true;
  } catch {
    return false;
  }
}

export async function getLinkedFolderMeta(
  uid: string
): Promise<LocalFolderLinkMeta | null> {
  const db = await openDb();
  try {
    const tx = db.transaction(META_STORE, "readonly");
    const row = await idbReq(
      tx.objectStore(META_STORE).get(uid) as IDBRequest<LocalFolderLinkMeta | undefined>
    );
    return row || null;
  } finally {
    db.close();
  }
}

async function saveMeta(meta: LocalFolderLinkMeta): Promise<void> {
  const db = await openDb();
  try {
    const tx = db.transaction(META_STORE, "readwrite");
    await idbReq(tx.objectStore(META_STORE).put(meta));
  } finally {
    db.close();
  }
}

async function saveHandle(
  uid: string,
  handle: FileSystemDirectoryHandle
): Promise<void> {
  const db = await openDb();
  try {
    const tx = db.transaction(HANDLE_STORE, "readwrite");
    await idbReq(tx.objectStore(HANDLE_STORE).put(handle, handleKey(uid)));
  } finally {
    db.close();
  }
}

async function loadHandle(
  uid: string
): Promise<DirectoryHandleWithPermission | null> {
  const db = await openDb();
  try {
    const tx = db.transaction(HANDLE_STORE, "readonly");
    const h = await idbReq(
      tx.objectStore(HANDLE_STORE).get(handleKey(uid)) as IDBRequest<
        FileSystemDirectoryHandle | undefined
      >
    );
    return (h as DirectoryHandleWithPermission) || null;
  } finally {
    db.close();
  }
}

export async function linkLocalFolder(uid: string): Promise<LocalFolderLinkMeta> {
  const cap = getBridgeCapability();
  if (!cap.supported) throw new Error(cap.reason || "不支援本機資料夾");

  const w = window as unknown as {
    showDirectoryPicker: (opts?: {
      mode?: "read" | "readwrite";
      id?: string;
    }) => Promise<FileSystemDirectoryHandle>;
  };
  const handle = await w.showDirectoryPicker({
    mode: "readwrite",
    id: `cadence-kb-${uid.slice(0, 12)}`,
  });
  const ok = await ensurePermission(handle as DirectoryHandleWithPermission, "readwrite");
  if (!ok) throw new Error("未取得本機資料夾寫入權限");

  const prev = await getLinkedFolderMeta(uid);
  const meta: LocalFolderLinkMeta = {
    uid,
    folderName: handle.name,
    linkedAt: Date.now(),
    lastPullAt: prev?.lastPullAt,
    lastPushAt: prev?.lastPushAt,
    pathByNoteId: prev?.pathByNoteId || {},
  };
  await saveHandle(uid, handle);
  await saveMeta(meta);
  return meta;
}

export async function unlinkLocalFolder(uid: string): Promise<void> {
  const db = await openDb();
  try {
    const tx = db.transaction([HANDLE_STORE, META_STORE], "readwrite");
    await idbReq(tx.objectStore(HANDLE_STORE).delete(handleKey(uid)));
    await idbReq(tx.objectStore(META_STORE).delete(uid));
  } finally {
    db.close();
  }
}

async function requireLinkedHandle(
  uid: string,
  mode: "read" | "readwrite"
): Promise<{ handle: DirectoryHandleWithPermission; meta: LocalFolderLinkMeta }> {
  const meta = await getLinkedFolderMeta(uid);
  const handle = await loadHandle(uid);
  if (!meta || !handle) {
    throw new Error("尚未連結本機資料夾");
  }
  const ok = await ensurePermission(handle, mode);
  if (!ok) {
    throw new Error("本機資料夾權限已失效，請重新連結");
  }
  return { handle, meta };
}

type MdEntry = {
  relativePath: string;
  file: File;
  lastModified: number;
};

type FileEntry = {
  relativePath: string;
  file: File;
};

async function listFilesUnder(
  dir: DirectoryHandleWithPermission,
  prefix = ""
): Promise<FileEntry[]> {
  const out: FileEntry[] = [];
  const iter =
    dir.entries?.() ||
    (async function* () {
      if (!dir.values) return;
      for await (const h of dir.values()) {
        yield [h.name, h] as [string, FileSystemHandle];
      }
    })();

  for await (const [name, entry] of iter) {
    if (name.startsWith(".")) continue;
    const path = prefix ? `${prefix}/${name}` : name;
    if (entry.kind === "directory") {
      out.push(
        ...(await listFilesUnder(entry as DirectoryHandleWithPermission, path))
      );
    } else if (entry.kind === "file") {
      const fileHandle = entry as FileSystemFileHandle;
      const file = await fileHandle.getFile();
      const named = new File([file], file.name, {
        type: file.type,
        lastModified: file.lastModified,
      });
      Object.defineProperty(named, "webkitRelativePath", {
        value: path,
        configurable: true,
      });
      out.push({ relativePath: path.replace(/\\/g, "/"), file: named });
    }
  }
  return out;
}

async function listMarkdownUnder(
  dir: DirectoryHandleWithPermission,
  prefix = ""
): Promise<MdEntry[]> {
  const all = await listFilesUnder(dir, prefix);
  return all
    .filter((e) => isMarkdownFile(e.file))
    .map((e) => ({
      relativePath: e.relativePath,
      file: e.file,
      lastModified: e.file.lastModified,
    }));
}

async function writeBinaryFile(
  root: DirectoryHandleWithPermission,
  relativePath: string,
  data: ArrayBuffer | Blob
): Promise<void> {
  const parts = relativePath.replace(/\\/g, "/").split("/").filter(Boolean);
  const fileName = parts.pop();
  if (!fileName) throw new Error("無效路徑");
  const dir = await ensureDirPath(root, parts);
  const fh = await dir.getFileHandle(fileName, { create: true });
  const writable = await fh.createWritable();
  try {
    await writable.write(data);
  } finally {
    await writable.close();
  }
}

function collectRemoteAttachmentUrls(body: string): string[] {
  const urls = new Set<string>();
  const re = /!\[[^\]]*\]\(([^)]+)\)|\[[^\]]+\]\(([^)]+)\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body || ""))) {
    const src = (m[1] || m[2] || "").trim();
    if (/^https?:\/\//i.test(src)) urls.add(src);
  }
  return [...urls];
}

function filenameFromUrl(url: string, fallback: string): string {
  try {
    const u = new URL(url);
    const last = decodeURIComponent(u.pathname.split("/").pop() || "");
    const cleaned = last.replace(/[^\w.\u4e00-\u9fff-]+/g, "_").slice(0, 80);
    if (cleaned && /\.\w{2,8}$/.test(cleaned)) return cleaned;
  } catch {
    /* ignore */
  }
  return fallback;
}

/**
 * Download remote https attachments next to the note and rewrite body to relative paths.
 */
async function materializeRemoteAttachments(
  root: DirectoryHandleWithPermission,
  noteRel: string,
  body: string
): Promise<{ body: string; written: number }> {
  const urls = collectRemoteAttachmentUrls(body);
  if (!urls.length) return { body, written: 0 };
  const noteDir = noteDirFromRel(noteRel);
  const attachDir = noteDir ? `${noteDir}/attachments` : "attachments";
  let written = 0;
  let next = body;
  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    try {
      const res = await fetch(url);
      if (!res.ok) continue;
      const blob = await res.blob();
      if (blob.size > 12_000_000) continue;
      const name = filenameFromUrl(url, `file_${i + 1}`);
      const rel = `${attachDir}/${name}`;
      await writeBinaryFile(root, rel, blob);
      const relativeFromNote = noteDir ? `attachments/${name}` : `attachments/${name}`;
      next = next.split(url).join(relativeFromNote);
      written += 1;
    } catch {
      /* skip failed download */
    }
  }
  return { body: next, written };
}

function safeFileBase(title: string): string {
  return (title || "note").replace(/[\\/:*?"<>|]+/g, "_").trim().slice(0, 80) || "note";
}

function noteRelativePath(note: Note, pathByNoteId: Record<string, string>): string {
  const mapped = pathByNoteId[note.id];
  if (mapped) return mapped.replace(/\\/g, "/");
  const folder = normalizeFolderPath(note.folder || "");
  const base = `${safeFileBase(note.title)}.md`;
  return folder ? `${folder}/${base}` : base;
}

function noteDirFromRel(rel: string): string {
  const parts = rel.replace(/\\/g, "/").split("/").filter(Boolean);
  parts.pop();
  return parts.join("/");
}

function folderFromRelPath(rel: string): string {
  return normalizeFolderPath(noteDirFromRel(rel));
}

function extractCadenceId(parsed: ReturnType<typeof parseMarkdownImport>): string | undefined {
  const fromField = parsed.cadenceId?.trim();
  if (fromField) return fromField;
  const extras = parsed.extras || {};
  const raw = extras[CADENCE_ID_KEY] ?? extras.cadenceId;
  if (raw == null) return undefined;
  const s = String(raw).trim();
  return s || undefined;
}

function buildNoteMarkdown(note: Note): string {
  const aliases = Array.isArray(note.props?.[ALIASES_PROP])
    ? (note.props![ALIASES_PROP] as string[])
    : [];
  const fmExtras = frontmatterExtrasFromProps(note.props);
  delete fmExtras[CADENCE_ID_KEY];
  delete fmExtras.cadenceId;
  return markdownWithFrontmatter(note.body_md || "", {
    title: note.title,
    tags: note.tags,
    aliases,
    journalDate: note.journal_date,
    folder: note.folder,
    created: note.created_at,
    updated: note.updated_at,
    cadenceId: note.id,
    extras: fmExtras,
  });
}

async function ensureDirPath(
  root: DirectoryHandleWithPermission,
  dirParts: string[]
): Promise<DirectoryHandleWithPermission> {
  let cur = root;
  for (const part of dirParts) {
    if (!part || part === "." || part === "..") continue;
    cur = (await cur.getDirectoryHandle(part, {
      create: true,
    })) as DirectoryHandleWithPermission;
  }
  return cur;
}

async function writeTextFile(
  root: DirectoryHandleWithPermission,
  relativePath: string,
  content: string
): Promise<void> {
  const parts = relativePath.replace(/\\/g, "/").split("/").filter(Boolean);
  const fileName = parts.pop();
  if (!fileName) throw new Error("無效路徑");
  const dir = await ensureDirPath(root, parts);
  const fh = await dir.getFileHandle(fileName, { create: true });
  const writable = await fh.createWritable();
  try {
    await writable.write(content);
  } finally {
    await writable.close();
  }
}

/**
 * Pull Markdown from the linked folder into Cadence.
 * Match order: cadence_id → stored path map → create new.
 * On match, folder content wins (user-initiated pull).
 * Also uploads sibling binary attachments referenced by the markdown.
 */
export async function pullFromLocalFolder(
  uid: string,
  existingNotes: Note[]
): Promise<PullResult> {
  const { handle, meta } = await requireLinkedHandle(uid, "read");
  const allFiles = await listFilesUnder(handle);
  const entries = allFiles
    .filter((e) => isMarkdownFile(e.file))
    .map((e) => ({
      relativePath: e.relativePath,
      file: e.file,
      lastModified: e.file.lastModified,
    }));
  const attachmentFiles = allFiles
    .filter((e) => !isMarkdownFile(e.file) && (isMediaAttachmentFile(e.file) || e.file.size < 12_000_000))
    .map((e) => e.file);
  const attachmentIndex = buildAttachmentIndex(attachmentFiles);

  const byId = new Map(existingNotes.map((n) => [n.id, n]));
  const pathToNoteId = new Map(
    Object.entries(meta.pathByNoteId).map(([noteId, path]) => [path, noteId])
  );

  const result: PullResult = { created: 0, updated: 0, attachments: 0, skipped: [] };
  const nextMap = { ...meta.pathByNoteId };

  for (const entry of entries) {
    try {
      if (entry.file.size > 2_500_000) {
        result.skipped.push({ path: entry.relativePath, reason: "檔案太大" });
        continue;
      }
      const raw = await entry.file.text();
      const parsed = parseMarkdownImport(raw);
      let body = normalizeWikilinksInBody(parsed.body);
      body = normalizeAttachmentPathsInBody(body, noteDirFromRel(entry.relativePath));
      const title = titleFromMarkdown(entry.file.name, body, parsed.title);
      const tags = parsed.tags || [];
      const folder =
        parsed.folder || folderFromRelPath(entry.relativePath);

      const props: Record<string, unknown> = { ...(parsed.promotedProps || {}) };
      if (parsed.aliases.length) props[ALIASES_PROP] = parsed.aliases;
      const extras = { ...(parsed.extras || {}) };
      delete extras[CADENCE_ID_KEY];
      delete extras.cadenceId;
      if (Object.keys(extras).length) props[FRONTMATTER_PROP] = extras;

      const cadenceId = extractCadenceId(parsed);
      let targetId =
        (cadenceId && byId.has(cadenceId) ? cadenceId : undefined) ||
        pathToNoteId.get(entry.relativePath);

      if (targetId && byId.has(targetId)) {
        if (attachmentIndex.size) {
          const rewritten = await rewriteAndUploadAttachments(
            uid,
            targetId,
            body,
            entry.relativePath,
            attachmentIndex
          );
          if (rewritten !== body) {
            result.attachments += 1;
            body = rewritten;
          }
        }
        await updateNote(targetId, {
          title,
          body_md: body,
          tags,
          folder,
          journal_date: parsed.journalDate || "",
          ...(parsed.kanbanStatus ? { status: parsed.kanbanStatus } : {}),
          props: {
            ...(byId.get(targetId)?.props || {}),
            ...props,
          },
        });
        nextMap[targetId] = entry.relativePath;
        result.updated += 1;
      } else {
        const id = await createNote(uid, title, body, undefined, tags, {
          folder,
          journal_date: parsed.journalDate || undefined,
          status: parsed.kanbanStatus || "backlog",
          props,
        });
        if (attachmentIndex.size) {
          const rewritten = await rewriteAndUploadAttachments(
            uid,
            id,
            body,
            entry.relativePath,
            attachmentIndex
          );
          if (rewritten !== body) {
            result.attachments += 1;
            body = rewritten;
            await updateNote(id, { body_md: body }, { silent: true });
          }
        }
        // Stamp cadence_id on disk so the next pull/push matches stably
        try {
          const stamped = markdownWithFrontmatter(body, {
            title,
            tags,
            aliases: parsed.aliases,
            journalDate: parsed.journalDate,
            folder,
            created: parsed.created,
            updated: parsed.updated,
            cadenceId: id,
            extras,
          });
          await writeTextFile(handle, entry.relativePath, stamped);
        } catch {
          /* read-only or stamp failed — mapping still kept in meta */
        }
        nextMap[id] = entry.relativePath;
        byId.set(id, {
          id,
          user_id: uid,
          title,
          body_md: body,
          tags,
          folder,
          created_at: new Date(),
          updated_at: new Date(),
        } as Note);
        result.created += 1;
      }
    } catch (err) {
      result.skipped.push({
        path: entry.relativePath,
        reason: err instanceof Error ? err.message : "拉入失敗",
      });
    }
  }

  await saveMeta({
    ...meta,
    lastPullAt: Date.now(),
    pathByNoteId: nextMap,
  });
  return result;
}

/**
 * Push Cadence notes into the linked folder as Markdown (+ cadence_id).
 * Also materializes remote https attachments as local binary files.
 * When `noteIds` is omitted, pushes all notes (excludes app-link shells).
 */
export async function pushToLocalFolder(
  uid: string,
  notes: Note[],
  opts?: { noteIds?: string[] }
): Promise<PushResult> {
  const { handle, meta } = await requireLinkedHandle(uid, "readwrite");
  const pool = opts?.noteIds?.length
    ? notes.filter((n) => opts.noteIds!.includes(n.id))
    : notes.filter((n) => !n.app_link);

  const result: PushResult = { written: 0, attachments: 0, skipped: [] };
  const nextMap = { ...meta.pathByNoteId };
  const usedPaths = new Set(Object.values(nextMap));

  for (const note of pool) {
    try {
      let rel = noteRelativePath(note, nextMap);
      // Avoid colliding with a different note's mapped path
      if (
        usedPaths.has(rel) &&
        Object.entries(nextMap).some(([id, p]) => p === rel && id !== note.id)
      ) {
        const folder = normalizeFolderPath(note.folder || "");
        const base = `${safeFileBase(note.title)}_${note.id.slice(-6)}.md`;
        rel = folder ? `${folder}/${base}` : base;
      }
      let body = note.body_md || "";
      const matured = await materializeRemoteAttachments(handle, rel, body);
      body = matured.body;
      result.attachments += matured.written;
      const md = markdownWithFrontmatter(body, {
        title: note.title,
        tags: note.tags,
        aliases: Array.isArray(note.props?.[ALIASES_PROP])
          ? (note.props![ALIASES_PROP] as string[])
          : [],
        journalDate: note.journal_date,
        folder: note.folder,
        created: note.created_at,
        updated: note.updated_at,
        cadenceId: note.id,
        extras: (() => {
          const fmExtras = frontmatterExtrasFromProps(note.props);
          delete fmExtras[CADENCE_ID_KEY];
          delete fmExtras.cadenceId;
          return fmExtras;
        })(),
      });
      await writeTextFile(handle, rel, md);
      nextMap[note.id] = rel;
      usedPaths.add(rel);
      result.written += 1;
    } catch (err) {
      result.skipped.push({
        noteId: note.id,
        title: note.title,
        reason: err instanceof Error ? err.message : "匯出失敗",
      });
    }
  }

  await saveMeta({
    ...meta,
    lastPushAt: Date.now(),
    pathByNoteId: nextMap,
  });
  return result;
}

export function formatBridgeTime(ms?: number): string {
  if (!ms) return "尚未";
  try {
    return new Date(ms).toLocaleString("zh-TW");
  } catch {
    return "尚未";
  }
}
