/**
 * Typed postMessage notes RPC for sandboxed community extension iframes.
 * Host never evals remote main.js — iframe UI only.
 */

import {
  collection,
  getDocs,
  query,
  where,
} from "firebase/firestore";
import {
  createNote,
  db,
  getNote,
  updateNote,
  uploadNoteMedia,
  type Note,
} from "@/lib/firebase";
import { mediaMarkdownForFile } from "@/lib/noteMediaInsert";
import type { PackagePermission } from "@/lib/community/types";

export const NOTES_RPC_RESULT = "cadence.notes.result" as const;

export const NOTES_RPC_METHODS = ["get", "list", "update", "create", "attach"] as const;
export type NotesRpcMethod = (typeof NOTES_RPC_METHODS)[number];

export type NotesRpcRequestType =
  | "cadence.notes.get"
  | "cadence.notes.list"
  | "cadence.notes.update"
  | "cadence.notes.create"
  | "cadence.notes.attach";

export type NotesRpcErrorCode =
  | "bad_request"
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "too_large"
  | "internal";

export type NotesRpcNoteSummary = {
  id: string;
  title: string;
  tags: string[];
  folder: string;
  updated_at: number;
  created_at: number;
};

export type NotesRpcNote = NotesRpcNoteSummary & {
  body_md: string;
};

export type NotesRpcResultMessage = {
  type: typeof NOTES_RPC_RESULT;
  reqId: string;
  method: NotesRpcMethod;
  ok: boolean;
  data?: unknown;
  error?: { code: NotesRpcErrorCode; message: string };
};

const TYPE_TO_METHOD: Record<NotesRpcRequestType, NotesRpcMethod> = {
  "cadence.notes.get": "get",
  "cadence.notes.list": "list",
  "cadence.notes.update": "update",
  "cadence.notes.create": "create",
  "cadence.notes.attach": "attach",
};

const METHOD_PERM: Record<NotesRpcMethod, PackagePermission> = {
  get: "notes_read",
  list: "notes_read",
  update: "notes_write",
  create: "notes_write",
  /** Attach also needs `network` when sourcing from a remote `url`. */
  attach: "notes_write",
};

const LIST_DEFAULT_LIMIT = 50;
const LIST_MAX_LIMIT = 100;
/** Decoded payload / fetched body cap for cadence.notes.attach (postMessage-friendly). */
export const NOTES_RPC_ATTACH_MAX_BYTES = 8 * 1024 * 1024;
const ATTACH_FETCH_TIMEOUT_MS = 30_000;

function isRecord(v: unknown): v is Record<string, unknown> {
  return Boolean(v) && typeof v === "object" && !Array.isArray(v);
}

function asString(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

function asStringArray(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out = v
    .filter((x): x is string => typeof x === "string")
    .map((s) => s.trim())
    .filter(Boolean);
  return out;
}

function sanitizeFilename(name: string): string {
  const base = name.replace(/[/\\?%*:|"<>]/g, "_").trim().slice(0, 120);
  return base || "attachment";
}

function decodeBase64Payload(raw: string): Uint8Array {
  const cleaned = raw.replace(/\s+/g, "");
  const bin = atob(cleaned);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function bytesFromDataUrl(dataUrl: string): { bytes: Uint8Array; contentType?: string } {
  const m = /^data:([^;,]+)?(?:;charset=[^;,]+)?;base64,([\s\S]+)$/i.exec(dataUrl.trim());
  if (!m) throw new Error("dataUrl 必須是 data:*;base64,… 格式");
  return {
    contentType: m[1]?.trim() || undefined,
    bytes: decodeBase64Payload(m[2]),
  };
}

async function bytesFromRemoteUrl(url: string): Promise<{
  bytes: Uint8Array;
  contentType?: string;
  filenameHint?: string;
}> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("url 無效");
  }
  if (parsed.protocol !== "https:") {
    throw new Error("僅允許 https 遠端附件");
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ATTACH_FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(parsed.toString(), {
      method: "GET",
      signal: ctrl.signal,
      credentials: "omit",
      redirect: "follow",
    });
    if (!res.ok) throw new Error(`遠端下載失敗（HTTP ${res.status}）`);
    const lenHeader = res.headers.get("content-length");
    if (lenHeader) {
      const len = Number(lenHeader);
      if (Number.isFinite(len) && len > NOTES_RPC_ATTACH_MAX_BYTES) {
        throw new Error(`檔案超過 ${NOTES_RPC_ATTACH_MAX_BYTES} bytes`);
      }
    }
    const buf = await res.arrayBuffer();
    if (buf.byteLength > NOTES_RPC_ATTACH_MAX_BYTES) {
      throw new Error(`檔案超過 ${NOTES_RPC_ATTACH_MAX_BYTES} bytes`);
    }
    const cd = res.headers.get("content-disposition") || "";
    const nameMatch = /filename\*?=(?:UTF-8''|")?([^";]+)/i.exec(cd);
    const filenameHint = nameMatch
      ? decodeURIComponent(nameMatch[1].replace(/"/g, "").trim())
      : parsed.pathname.split("/").pop() || undefined;
    return {
      bytes: new Uint8Array(buf),
      contentType: res.headers.get("content-type")?.split(";")[0]?.trim() || undefined,
      filenameHint,
    };
  } finally {
    clearTimeout(timer);
  }
}

export function parseNotesRpcMethod(type: unknown): NotesRpcMethod | null {
  if (typeof type !== "string") return null;
  if (type in TYPE_TO_METHOD) return TYPE_TO_METHOD[type as NotesRpcRequestType];
  return null;
}

export function isNotesRpcRequest(
  data: unknown
): data is Record<string, unknown> & {
  type: NotesRpcRequestType;
  reqId: string;
} {
  if (!isRecord(data)) return false;
  if (!parseNotesRpcMethod(data.type)) return false;
  return typeof data.reqId === "string" && data.reqId.length > 0 && data.reqId.length <= 128;
}

function toSummary(note: Note): NotesRpcNoteSummary {
  return {
    id: note.id,
    title: note.title || "",
    tags: Array.isArray(note.tags) ? note.tags : [],
    folder: note.folder || "",
    updated_at: note.updated_at?.getTime?.() || 0,
    created_at: note.created_at?.getTime?.() || 0,
  };
}

function toFull(note: Note): NotesRpcNote {
  return {
    ...toSummary(note),
    body_md: note.body_md || "",
  };
}

function resultOk(reqId: string, method: NotesRpcMethod, data: unknown): NotesRpcResultMessage {
  return { type: NOTES_RPC_RESULT, reqId, method, ok: true, data };
}

function resultErr(
  reqId: string,
  method: NotesRpcMethod,
  code: NotesRpcErrorCode,
  message: string
): NotesRpcResultMessage {
  return { type: NOTES_RPC_RESULT, reqId, method, ok: false, error: { code, message } };
}

function noteFromSnap(id: string, data: Record<string, unknown>): Note {
  const created = data.created_at as { toDate?: () => Date } | Date | undefined;
  const updated = data.updated_at as { toDate?: () => Date } | Date | undefined;
  return {
    id,
    user_id: String(data.user_id || ""),
    title: String(data.title || ""),
    body_md: String(data.body_md || ""),
    tags: Array.isArray(data.tags) ? (data.tags as string[]) : [],
    folder: String(data.folder || ""),
    journal_date: String(data.journal_date || ""),
    status: (data.status as Note["status"]) || "backlog",
    source_job_id: String(data.source_job_id || ""),
    icon: String(data.icon || ""),
    color: String(data.color || ""),
    cover: String(data.cover || ""),
    parent_id: String(data.parent_id || ""),
    created_at:
      created && typeof created === "object" && "toDate" in created && created.toDate
        ? created.toDate()
        : created instanceof Date
          ? created
          : new Date(),
    updated_at:
      updated && typeof updated === "object" && "toDate" in updated && updated.toDate
        ? updated.toDate()
        : updated instanceof Date
          ? updated
          : new Date(),
  };
}

async function listOwnedNotes(uid: string): Promise<Note[]> {
  const snap = await getDocs(query(collection(db, "notes"), where("user_id", "==", uid)));
  const notes = snap.docs.map((d) => noteFromSnap(d.id, d.data() as Record<string, unknown>));
  notes.sort((a, b) => b.updated_at.getTime() - a.updated_at.getTime());
  return notes;
}

export type NotesRpcHandleContext = {
  uid: string;
  permissions: PackagePermission[];
};

/**
 * Handle one iframe postMessage payload.
 * Returns a result message, or null if the message is not a notes RPC request.
 */
export async function handleNotesRpcRequest(
  data: unknown,
  ctx: NotesRpcHandleContext
): Promise<NotesRpcResultMessage | null> {
  if (!isNotesRpcRequest(data)) return null;
  const method = parseNotesRpcMethod(data.type)!;
  const reqId = data.reqId;

  const need = METHOD_PERM[method];
  if (!ctx.permissions.includes(need)) {
    return resultErr(reqId, method, "forbidden", `缺少權限：${need}`);
  }
  if (!ctx.uid) {
    return resultErr(reqId, method, "unauthorized", "請先登入");
  }

  try {
    if (method === "get") {
      const noteId = asString(data.noteId)?.trim();
      if (!noteId) return resultErr(reqId, method, "bad_request", "缺少 noteId");
      const note = await getNote(noteId);
      if (!note || note.user_id !== ctx.uid) {
        return resultErr(reqId, method, "not_found", "找不到筆記");
      }
      return resultOk(reqId, method, toFull(note));
    }

    if (method === "list") {
      const q = (asString(data.q) || "").trim().toLowerCase();
      const folder = asString(data.folder);
      const includeBody = data.includeBody === true;
      let limit = LIST_DEFAULT_LIMIT;
      if (typeof data.limit === "number" && Number.isFinite(data.limit)) {
        limit = Math.max(1, Math.min(LIST_MAX_LIMIT, Math.floor(data.limit)));
      }
      let notes = await listOwnedNotes(ctx.uid);
      if (folder != null && folder !== "") {
        notes = notes.filter((n) => (n.folder || "") === folder);
      }
      if (q) {
        notes = notes.filter((n) => {
          const title = (n.title || "").toLowerCase();
          const tags = (n.tags || []).join(" ").toLowerCase();
          const body = includeBody ? (n.body_md || "").toLowerCase() : "";
          return title.includes(q) || tags.includes(q) || body.includes(q);
        });
      }
      const slice = notes.slice(0, limit);
      const items = includeBody ? slice.map(toFull) : slice.map(toSummary);
      return resultOk(reqId, method, { items, total: notes.length });
    }

    if (method === "update") {
      const noteId = asString(data.noteId)?.trim();
      if (!noteId) return resultErr(reqId, method, "bad_request", "缺少 noteId");
      const patchRaw = data.patch;
      if (!isRecord(patchRaw)) {
        return resultErr(reqId, method, "bad_request", "缺少 patch");
      }
      const note = await getNote(noteId);
      if (!note || note.user_id !== ctx.uid) {
        return resultErr(reqId, method, "not_found", "找不到筆記");
      }
      const updates: {
        title?: string;
        body_md?: string;
        tags?: string[];
        folder?: string;
      } = {};
      if ("title" in patchRaw) {
        const t = asString(patchRaw.title);
        if (t === undefined) return resultErr(reqId, method, "bad_request", "title 必須是字串");
        updates.title = t.slice(0, 500) || "未命名筆記";
      }
      if ("body_md" in patchRaw) {
        const b = asString(patchRaw.body_md);
        if (b === undefined) return resultErr(reqId, method, "bad_request", "body_md 必須是字串");
        updates.body_md = b;
      }
      if ("tags" in patchRaw) {
        const tags = asStringArray(patchRaw.tags);
        if (tags === undefined) {
          return resultErr(reqId, method, "bad_request", "tags 必須是字串陣列");
        }
        updates.tags = tags.slice(0, 40);
      }
      if ("folder" in patchRaw) {
        const f = asString(patchRaw.folder);
        if (f === undefined) return resultErr(reqId, method, "bad_request", "folder 必須是字串");
        updates.folder = f.slice(0, 400);
      }
      if (Object.keys(updates).length === 0) {
        return resultErr(reqId, method, "bad_request", "patch 沒有可更新欄位");
      }
      const { updatedAt } = await updateNote(noteId, updates);
      const next = await getNote(noteId);
      return resultOk(reqId, method, {
        note: next && next.user_id === ctx.uid ? toFull(next) : { id: noteId, ...updates },
        updated_at: updatedAt,
      });
    }

    if (method === "attach") {
      const noteId = asString(data.noteId)?.trim();
      if (!noteId) return resultErr(reqId, method, "bad_request", "缺少 noteId");

      const note = await getNote(noteId);
      if (!note || note.user_id !== ctx.uid) {
        return resultErr(reqId, method, "not_found", "找不到筆記");
      }

      const insertRaw = asString(data.insert)?.trim().toLowerCase();
      if (insertRaw && insertRaw !== "append" && insertRaw !== "none") {
        return resultErr(reqId, method, "bad_request", "insert 必須是 append 或 none");
      }
      const insert: "append" | "none" = insertRaw === "none" ? "none" : "append";

      const dataBase64 = asString(data.dataBase64);
      const dataUrl = asString(data.dataUrl);
      const remoteUrl = asString(data.url)?.trim();
      const sources = [dataBase64, dataUrl, remoteUrl].filter(Boolean);
      if (sources.length !== 1) {
        return resultErr(
          reqId,
          method,
          "bad_request",
          "請擇一提供 dataBase64、dataUrl 或 url"
        );
      }

      let bytes: Uint8Array;
      let inferredType: string | undefined;
      let filenameHint: string | undefined;

      try {
        if (remoteUrl) {
          if (!ctx.permissions.includes("network")) {
            return resultErr(reqId, method, "forbidden", "遠端 url 附件需要 network 權限");
          }
          const remote = await bytesFromRemoteUrl(remoteUrl);
          bytes = remote.bytes;
          inferredType = remote.contentType;
          filenameHint = remote.filenameHint;
        } else if (dataUrl) {
          const parsed = bytesFromDataUrl(dataUrl);
          bytes = parsed.bytes;
          inferredType = parsed.contentType;
        } else {
          bytes = decodeBase64Payload(dataBase64!);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "無法讀取附件內容";
        if (message.includes("超過")) {
          return resultErr(reqId, method, "too_large", message);
        }
        return resultErr(reqId, method, "bad_request", message);
      }

      if (bytes.byteLength === 0) {
        return resultErr(reqId, method, "bad_request", "附件內容為空");
      }
      if (bytes.byteLength > NOTES_RPC_ATTACH_MAX_BYTES) {
        return resultErr(
          reqId,
          method,
          "too_large",
          `檔案超過 ${NOTES_RPC_ATTACH_MAX_BYTES} bytes`
        );
      }

      const filename = sanitizeFilename(
        asString(data.filename)?.trim() || filenameHint || "attachment"
      );
      const contentType =
        (asString(data.contentType)?.trim() || inferredType || "application/octet-stream").slice(
          0,
          120
        );

      const file = new File([new Uint8Array(bytes)], filename, { type: contentType });
      const uploaded = await uploadNoteMedia(ctx.uid, noteId, file);
      const markdown = mediaMarkdownForFile(uploaded.url, file).trim();

      let body_md = note.body_md || "";
      if (insert === "append") {
        const trimmed = body_md.trimEnd();
        body_md = `${trimmed}${trimmed ? "\n\n" : ""}${markdown}\n`;
        await updateNote(noteId, { body_md });
      }

      const next = insert === "append" ? await getNote(noteId) : note;
      return resultOk(reqId, method, {
        url: uploaded.url,
        path: uploaded.path,
        name: uploaded.name,
        contentType: uploaded.contentType,
        markdown,
        insert,
        note:
          next && next.user_id === ctx.uid
            ? toFull(next)
            : { ...toFull(note), body_md },
      });
    }

    // create
    const title = (asString(data.title) || "").trim() || "未命名筆記";
    const body_md = asString(data.body_md) ?? "";
    const tags = asStringArray(data.tags) || [];
    const folder = asString(data.folder) || "";
    const id = await createNote(ctx.uid, title.slice(0, 500), body_md, undefined, tags.slice(0, 40), {
      folder: folder.slice(0, 400),
    });
    const created = await getNote(id);
    return resultOk(reqId, method, {
      note: created
        ? toFull(created)
        : {
            id,
            title,
            body_md,
            tags,
            folder,
            updated_at: Date.now(),
            created_at: Date.now(),
          },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "內部錯誤";
    return resultErr(reqId, method, "internal", message);
  }
}

/** Expected origin for an extension frame URL (empty if unparseable). */
export function originFromFrameUrl(frameUrl: string): string {
  try {
    return new URL(frameUrl).origin;
  } catch {
    return "";
  }
}
