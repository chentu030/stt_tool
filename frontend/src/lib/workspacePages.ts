/** Create workspace pages that appear in the notes tree (with optional app backends). */

import { createNote, type Note } from "@/lib/firebase";
import { createBoard } from "@/lib/boardStore";
import { createCanvas } from "@/lib/canvasCloud";
import { createGraph } from "@/lib/graphStore";
import { createDatabase } from "@/lib/database";

export type NoteAppLinkType = "board" | "canvas" | "graph" | "database";

export type NoteAppLink = {
  type: NoteAppLinkType;
  id: string;
};

export type WorkspacePageKind =
  | "note"
  | "journal"
  | "board"
  | "database"
  | "canvas"
  | "graph";

export const WORKSPACE_PAGE_OPTIONS: {
  kind: WorkspacePageKind;
  label: string;
  icon: string;
}[] = [
  { kind: "note", label: "新筆記", icon: "description" },
  { kind: "journal", label: "新日誌", icon: "menu_book" },
  { kind: "board", label: "新看板", icon: "view_kanban" },
  { kind: "database", label: "新資料庫", icon: "table_chart" },
  { kind: "canvas", label: "新白板", icon: "palette" },
  { kind: "graph", label: "新圖譜", icon: "hub" },
];

function todayKey() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function parseNoteAppLink(raw: unknown): NoteAppLink | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const type = o.type;
  const id = typeof o.id === "string" ? o.id.trim() : "";
  if (!id) return null;
  if (type === "board" || type === "canvas" || type === "graph" || type === "database") {
    return { type, id };
  }
  return null;
}

/** Href for opening a note — app-linked pages go to their app route. */
export function noteOpenHref(note: Pick<Note, "id" | "app_link">): string {
  const link = note.app_link;
  if (!link?.type || !link.id) return `/notes/${note.id}`;
  const q = `?note=${encodeURIComponent(note.id)}`;
  switch (link.type) {
    case "board":
      return `/board/${link.id}${q}`;
    case "canvas":
      return `/canvas/${link.id}${q}`;
    case "graph":
      return `/graph/${link.id}${q}`;
    case "database":
      return `/db/${link.id}`;
    default:
      return `/notes/${note.id}`;
  }
}

export async function createWorkspacePage(
  uid: string,
  kind: WorkspacePageKind,
  opts?: {
    folder?: string;
    parentId?: string;
    tags?: string[];
    status?: Note["status"];
  }
): Promise<{ noteId: string; href: string }> {
  const folder = opts?.parentId ? "" : opts?.folder || "";
  const parentId = opts?.parentId || "";
  const tags = opts?.tags || [];
  const status = opts?.status || "backlog";

  if (kind === "note") {
    const noteId = await createNote(uid, "未命名筆記", "", undefined, tags, {
      folder,
      status,
      parent_id: parentId,
      icon: "description",
    });
    return { noteId, href: `/notes/${noteId}` };
  }

  if (kind === "journal") {
    const dateKey = todayKey();
    const noteId = await createNote(uid, `日誌 — ${dateKey}`, "", undefined, [...tags, "journal"], {
      folder: folder || "日誌",
      status,
      parent_id: parentId,
      journal_date: dateKey,
      icon: "menu_book",
    });
    return { noteId, href: `/notes/${noteId}` };
  }

  if (kind === "board") {
    const appId = await createBoard(uid, "未命名看板");
    const noteId = await createNote(uid, "未命名看板", "", undefined, tags, {
      folder,
      status,
      parent_id: parentId,
      icon: "view_kanban",
      app_link: { type: "board", id: appId },
    });
    return { noteId, href: noteOpenHref({ id: noteId, app_link: { type: "board", id: appId } }) };
  }

  if (kind === "database") {
    const appId = await createDatabase(uid, "未命名資料庫", "tasks");
    const noteId = await createNote(uid, "未命名資料庫", "", undefined, tags, {
      folder,
      status,
      parent_id: parentId,
      icon: "table_chart",
      app_link: { type: "database", id: appId },
    });
    return { noteId, href: noteOpenHref({ id: noteId, app_link: { type: "database", id: appId } }) };
  }

  if (kind === "canvas") {
    const appId = await createCanvas(uid, "未命名白板");
    const noteId = await createNote(uid, "未命名白板", "", undefined, tags, {
      folder,
      status,
      parent_id: parentId,
      icon: "palette",
      app_link: { type: "canvas", id: appId },
    });
    return { noteId, href: noteOpenHref({ id: noteId, app_link: { type: "canvas", id: appId } }) };
  }

  const appId = await createGraph(uid, "未命名圖譜");
  const noteId = await createNote(uid, "未命名圖譜", "", undefined, tags, {
    folder,
    status,
    parent_id: parentId,
    icon: "hub",
    app_link: { type: "graph", id: appId },
  });
  return { noteId, href: noteOpenHref({ id: noteId, app_link: { type: "graph", id: appId } }) };
}
