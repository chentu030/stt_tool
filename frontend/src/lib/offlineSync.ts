/**
 * Offline note (and canvas/board) sync:
 * - Queue writes to IndexedDB when offline / network fails
 * - On reconnect, flush with conflict detection
 * - Conflict UI: preview local vs cloud, keep one side
 */

import {
  NoteConflictError,
  getNote,
  updateNote,
  type Note,
  type NoteUpdateFields,
} from "@/lib/firebase";
import { askConflict } from "@/lib/dialogs";
import { toast } from "@/lib/toast";
import {
  deletePending,
  getPending,
  listPending,
  pendingKey,
  putPending,
  type PendingWrite,
} from "@/lib/offlineStore";
import { getCanvasOnce, saveCanvas } from "@/lib/canvasCloud";
import { updateBoard } from "@/lib/boardStore";
import type { CanvasDoc } from "@/lib/canvasStore";
import type { BoardConfig } from "@/lib/boardStore";

export type SaveNoteResult =
  | { status: "saved"; updatedAt: number }
  | { status: "queued" }
  | { status: "conflict_resolved"; updatedAt: number; kept: "local" | "remote"; remote?: Note }
  | { status: "cancelled" }
  | { status: "error"; message: string };

function isOnline(): boolean {
  return typeof navigator === "undefined" ? true : navigator.onLine;
}

function isNetworkError(err: unknown): boolean {
  if (!isOnline()) return true;
  const code =
    err && typeof err === "object" && "code" in err
      ? String((err as { code?: string }).code || "")
      : "";
  if (
    code === "unavailable" ||
    code === "deadline-exceeded" ||
    code === "resource-exhausted" ||
    code === "cancelled"
  ) {
    return true;
  }
  const msg = err instanceof Error ? err.message : String(err || "");
  return /network|offline|Failed to fetch|UNAVAILABLE/i.test(msg);
}

export function snippetOf(text: string, max = 420): string {
  const t = (text || "").replace(/\s+/g, " ").trim();
  if (!t) return "（空白）";
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

export function noteReloadEvent(noteId: string) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("albireus:note-reload", { detail: { noteId } }));
}

export function noteBaseEvent(noteId: string, updatedAt: number) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent("albireus:note-base", { detail: { noteId, updatedAt } })
  );
}

async function resolveNoteConflict(opts: {
  noteId: string;
  label: string;
  localPreview: string;
  localTitle?: string;
  localUpdatedAt: number;
  remote: Note;
  payload: NoteUpdateFields;
}): Promise<"local" | "remote" | null> {
  const choice = await askConflict({
    title: "筆記內容衝突",
    message: `「${opts.label || "未命名"}」的雲端內容比本機這次儲存基準更新（其他裝置或先前寫入）。請選擇要保留哪一版。`,
    local: {
      label: "我的版本（本機）",
      updatedAt: opts.localUpdatedAt,
      title: opts.localTitle || opts.label,
      preview: opts.localPreview,
    },
    remote: {
      label: "雲端版本",
      updatedAt: opts.remote.updated_at,
      title: opts.remote.title,
      preview: snippetOf(
        [opts.remote.title, opts.remote.body_md || ""].filter(Boolean).join("\n")
      ),
    },
    keepLocalLabel: "使用我的版本",
    keepRemoteLabel: "使用雲端版本",
  });
  if (!choice) return null;

  if (choice === "local") {
    await updateNote(opts.noteId, opts.payload, { force: true });
    await deletePending(pendingKey("note", opts.noteId));
    return "local";
  }

  await deletePending(pendingKey("note", opts.noteId));
  noteReloadEvent(opts.noteId);
  return "remote";
}

export async function queueNoteWrite(input: {
  noteId: string;
  baseUpdatedAt: number;
  payload: NoteUpdateFields;
  label?: string;
}): Promise<void> {
  const title = String(input.payload.title ?? input.label ?? "未命名");
  const body = String(input.payload.body_md ?? "");
  const entry: PendingWrite = {
    key: pendingKey("note", input.noteId),
    kind: "note",
    docId: input.noteId,
    baseUpdatedAt: input.baseUpdatedAt,
    localUpdatedAt: Date.now(),
    label: title || "未命名",
    previewLocal: snippetOf([title, body].filter(Boolean).join("\n")),
    payload: { ...input.payload },
  };
  await putPending(entry);
}

/** Load pending offline draft for a note (if any). */
export async function loadPendingNoteDraft(noteId: string): Promise<PendingWrite | null> {
  return getPending(pendingKey("note", noteId));
}

/**
 * Save note: online with conflict check, or queue when offline.
 * On conflict, prompts the user (preview both sides).
 */
export async function saveNoteWithSync(
  noteId: string,
  updates: NoteUpdateFields,
  opts: {
    baseUpdatedAt: number;
    label?: string;
    /** Skip dialog and just queue / force — used rarely */
    force?: boolean;
  }
): Promise<SaveNoteResult> {
  const label = String(updates.title ?? opts.label ?? "未命名");
  const previewLocal = snippetOf(
    [updates.title, updates.body_md].filter((x) => typeof x === "string").join("\n")
  );

  if (!isOnline()) {
    await queueNoteWrite({
      noteId,
      baseUpdatedAt: opts.baseUpdatedAt,
      payload: updates,
      label,
    });
    return { status: "queued" };
  }

  try {
    const { updatedAt } = await updateNote(noteId, updates, {
      expectedUpdatedAt: opts.baseUpdatedAt,
      force: opts.force,
    });
    await deletePending(pendingKey("note", noteId));
    noteBaseEvent(noteId, updatedAt);
    return { status: "saved", updatedAt };
  } catch (err) {
    if (err instanceof NoteConflictError) {
      const kept = await resolveNoteConflict({
        noteId,
        label,
        localPreview: previewLocal,
        localTitle: typeof updates.title === "string" ? updates.title : label,
        localUpdatedAt: Date.now(),
        remote: err.remote,
        payload: updates,
      });
      if (!kept) return { status: "cancelled" };
      if (kept === "remote") {
        return { status: "conflict_resolved", updatedAt: err.remote.updated_at.getTime(), kept, remote: err.remote };
      }
      const now = Date.now();
      noteBaseEvent(noteId, now);
      return { status: "conflict_resolved", updatedAt: now, kept: "local" };
    }
    if (isNetworkError(err)) {
      await queueNoteWrite({
        noteId,
        baseUpdatedAt: opts.baseUpdatedAt,
        payload: updates,
        label,
      });
      return { status: "queued" };
    }
    return {
      status: "error",
      message: err instanceof Error ? err.message : "儲存失敗",
    };
  }
}

async function flushNotePending(entry: PendingWrite): Promise<void> {
  const remote = await getNote(entry.docId);
  if (!remote) {
    await deletePending(entry.key);
    return;
  }
  const remoteMs = remote.updated_at.getTime();
  const payload = entry.payload as NoteUpdateFields;

  if (remoteMs > entry.baseUpdatedAt) {
    const kept = await resolveNoteConflict({
      noteId: entry.docId,
      label: entry.label,
      localPreview: entry.previewLocal,
      localTitle: entry.label,
      localUpdatedAt: entry.localUpdatedAt,
      remote,
      payload,
    });
    if (kept === "local") {
      noteBaseEvent(entry.docId, Date.now());
      toast("已上傳本機版本", 2200);
    } else if (kept === "remote") {
      toast("已採用雲端版本", 2200);
    }
    return;
  }

  const { updatedAt } = await updateNote(entry.docId, payload, {
    expectedUpdatedAt: entry.baseUpdatedAt,
  });
  await deletePending(entry.key);
  noteBaseEvent(entry.docId, updatedAt);
}

async function flushCanvasPending(entry: PendingWrite): Promise<void> {
  const uid = entry.uid;
  if (!uid) {
    await deletePending(entry.key);
    return;
  }
  const remote = await getCanvasOnce(uid, entry.docId);
  const remoteAt = (remote as unknown as { updated_at?: Date } | null)?.updated_at;
  const remoteUpdated =
    remoteAt && typeof remoteAt.getTime === "function" ? remoteAt.getTime() : 0;

  const localDoc = entry.payload as unknown as CanvasDoc;
  if (remote && remoteUpdated > entry.baseUpdatedAt) {
    const choice = await askConflict({
      title: "白板內容衝突",
      message: `「${entry.label}」離線期間雲端也有變更，請選擇要保留哪一版。`,
      local: {
        label: "我的版本（本機）",
        updatedAt: entry.localUpdatedAt,
        title: entry.label,
        preview: entry.previewLocal,
      },
      remote: {
        label: "雲端版本",
        updatedAt: remoteUpdated,
        title: remote.name,
        preview: snippetOf(
          [
            remote.name,
            `便利貼 ${remote.stickies?.length || 0}`,
            `圖形 ${remote.shapes?.length || 0}`,
            `媒體 ${remote.media?.length || 0}`,
          ].join(" · ")
        ),
      },
      keepLocalLabel: "使用我的版本",
      keepRemoteLabel: "使用雲端版本",
    });
    if (choice === "local") {
      await saveCanvas(uid, entry.docId, localDoc);
      await deletePending(entry.key);
      toast("已上傳本機白板", 2200);
    } else if (choice === "remote") {
      await deletePending(entry.key);
      if (typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent("albireus:canvas-reload", { detail: { canvasId: entry.docId } })
        );
      }
      toast("已採用雲端白板", 2200);
    }
    return;
  }

  await saveCanvas(uid, entry.docId, localDoc);
  await deletePending(entry.key);
}

async function flushBoardPending(entry: PendingWrite): Promise<void> {
  const uid = entry.uid;
  if (!uid) {
    await deletePending(entry.key);
    return;
  }
  // Boards are small config — last-write with force after conflict prompt
  const patch = entry.payload as Partial<Pick<BoardConfig, "name" | "folders" | "tags" | "statuses">>;
  try {
    await updateBoard(uid, entry.docId, patch);
    await deletePending(entry.key);
  } catch (err) {
    if (isNetworkError(err)) throw err;
    const choice = await askConflict({
      title: "看板設定衝突",
      message: `「${entry.label}」無法順利同步，請選擇。`,
      local: {
        label: "我的版本",
        updatedAt: entry.localUpdatedAt,
        title: entry.label,
        preview: entry.previewLocal,
      },
      remote: {
        label: "保留雲端（略過本機）",
        preview: "略過這次本機變更，繼續使用雲端看板設定。",
      },
      keepLocalLabel: "重試上傳我的版本",
      keepRemoteLabel: "放棄本機變更",
    });
    if (choice === "local") {
      await updateBoard(uid, entry.docId, patch);
      await deletePending(entry.key);
    } else if (choice === "remote") {
      await deletePending(entry.key);
    }
  }
}

let flushing = false;

/** Flush all queued offline writes. Safe to call on `online`. */
export async function flushOfflineQueue(): Promise<{ flushed: number; conflicts: number }> {
  if (flushing || !isOnline()) return { flushed: 0, conflicts: 0 };
  flushing = true;
  let flushed = 0;
  let conflicts = 0;
  try {
    const pending = await listPending();
    if (!pending.length) return { flushed: 0, conflicts: 0 };
    toast(`正在同步 ${pending.length} 筆離線變更…`, 2800);
    for (const entry of pending) {
      try {
        if (entry.kind === "note") {
          const before = await getPending(entry.key);
          await flushNotePending(entry);
          const after = await getPending(entry.key);
          if (before && !after) flushed += 1;
          else if (before && after) conflicts += 1;
        } else if (entry.kind === "canvas") {
          await flushCanvasPending(entry);
          flushed += 1;
        } else if (entry.kind === "board") {
          await flushBoardPending(entry);
          flushed += 1;
        }
      } catch (err) {
        if (isNetworkError(err)) break;
        console.warn("[offlineSync] flush item failed", entry.key, err);
      }
    }
    if (flushed > 0) toast(`已同步 ${flushed} 筆變更`, 2200);
  } finally {
    flushing = false;
  }
  return { flushed, conflicts };
}

export async function queueCanvasWrite(input: {
  uid: string;
  canvasId: string;
  baseUpdatedAt: number;
  doc: CanvasDoc;
}): Promise<void> {
  const label = input.doc.name || "白板";
  await putPending({
    key: pendingKey("canvas", input.canvasId, input.uid),
    kind: "canvas",
    docId: input.canvasId,
    uid: input.uid,
    baseUpdatedAt: input.baseUpdatedAt,
    localUpdatedAt: Date.now(),
    label,
    previewLocal: snippetOf(
      [
        label,
        `便利貼 ${input.doc.stickies?.length || 0}`,
        `圖形 ${input.doc.shapes?.length || 0}`,
        `媒體 ${input.doc.media?.length || 0}`,
      ].join(" · ")
    ),
    payload: { ...input.doc } as unknown as Record<string, unknown>,
  });
}

export async function saveCanvasWithSync(
  uid: string,
  canvasId: string,
  data: CanvasDoc,
  baseUpdatedAt: number
): Promise<"saved" | "queued"> {
  if (!isOnline()) {
    await queueCanvasWrite({ uid, canvasId, baseUpdatedAt, doc: data });
    return "queued";
  }
  try {
    const remote = await getCanvasOnce(uid, canvasId);
    // Prefer Firestore updated_at when available on meta — getCanvasOnce strips it;
    // use base check only via pending flush. Online path writes directly;
    // conflict handled on next flush if we raced — also check via listen.
    await saveCanvas(uid, canvasId, data);
    await deletePending(pendingKey("canvas", canvasId, uid));
    void remote;
    return "saved";
  } catch (err) {
    if (isNetworkError(err)) {
      await queueCanvasWrite({ uid, canvasId, baseUpdatedAt, doc: data });
      return "queued";
    }
    throw err;
  }
}

export async function queueBoardWrite(input: {
  uid: string;
  boardId: string;
  baseUpdatedAt: number;
  patch: Partial<Pick<BoardConfig, "name" | "folders" | "tags" | "statuses">>;
  label?: string;
}): Promise<void> {
  await putPending({
    key: pendingKey("board", input.boardId, input.uid),
    kind: "board",
    docId: input.boardId,
    uid: input.uid,
    baseUpdatedAt: input.baseUpdatedAt,
    localUpdatedAt: Date.now(),
    label: input.label || input.patch.name || "看板",
    previewLocal: snippetOf(
      [
        input.patch.name,
        input.patch.folders?.length ? `資料夾 ${input.patch.folders.length}` : "",
        input.patch.tags?.length ? `標籤 ${input.patch.tags.length}` : "",
      ]
        .filter(Boolean)
        .join(" · ") || "看板設定變更"
    ),
    payload: { ...input.patch },
  });
}

export async function saveBoardWithSync(
  uid: string,
  boardId: string,
  patch: Partial<Pick<BoardConfig, "name" | "folders" | "tags" | "statuses">>,
  opts: { baseUpdatedAt: number; label?: string }
): Promise<"saved" | "queued"> {
  if (!isOnline()) {
    await queueBoardWrite({
      uid,
      boardId,
      baseUpdatedAt: opts.baseUpdatedAt,
      patch,
      label: opts.label,
    });
    return "queued";
  }
  try {
    await updateBoard(uid, boardId, patch);
    await deletePending(pendingKey("board", boardId, uid));
    return "saved";
  } catch (err) {
    if (isNetworkError(err)) {
      await queueBoardWrite({
        uid,
        boardId,
        baseUpdatedAt: opts.baseUpdatedAt,
        patch,
        label: opts.label,
      });
      return "queued";
    }
    throw err;
  }
}
