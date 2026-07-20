/** Create workspace pages that appear in the notes tree (with optional app backends). */

import {
  collection,
  getDocs,
  query,
  where,
} from "firebase/firestore";
import { createNote, db, updateNote, type Note } from "@/lib/firebase";
import { createBoard, updateBoard } from "@/lib/boardStore";
import { createCanvas } from "@/lib/canvasCloud";
import { createGraph, updateGraph } from "@/lib/graphStore";
import { createDatabase } from "@/lib/database";
import type { ExtensionManifest } from "@/lib/community/types";
import type { BoardStatus } from "@/lib/boardMeta";
import type { GraphFilters, LayoutMode } from "@/lib/graphModel";

export type NoteAppLinkType =
  | "board"
  | "canvas"
  | "graph"
  | "database"
  | "web"
  | "extension";

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
  | "graph"
  | "web"
  | `ext:${string}`;

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
  { kind: "web", label: "網頁", icon: "language" },
];

const APP_LINK_ICONS: Record<Exclude<NoteAppLinkType, "extension">, string> = {
  board: "view_kanban",
  database: "table_chart",
  canvas: "palette",
  graph: "hub",
  web: "language",
};

const APP_LINK_TITLES: Record<Exclude<NoteAppLinkType, "extension">, string> = {
  board: "未命名看板",
  database: "未命名資料庫",
  canvas: "未命名白板",
  graph: "未命名圖譜",
  web: "未命名網頁",
};

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
  if (
    type === "board" ||
    type === "canvas" ||
    type === "graph" ||
    type === "database" ||
    type === "web" ||
    type === "extension"
  ) {
    return { type, id };
  }
  return null;
}

/**
 * Canonical open path for sidebar / + menu / tabs.
 * Specialty apps (board / canvas / graph / database) open their full-screen
 * native routes. Only slash-command embeds stay inside a note (via embed=1).
 */
export function noteOpenHref(note: Pick<Note, "id" | "app_link">): string {
  const link = note.app_link;
  const noteQ = `note=${encodeURIComponent(note.id)}`;
  if (link?.type === "board" && link.id) return `/board/${link.id}?${noteQ}`;
  if (link?.type === "canvas" && link.id) return `/canvas/${link.id}?${noteQ}`;
  if (link?.type === "graph" && link.id) return `/graph/${link.id}?${noteQ}`;
  if (link?.type === "database" && link.id) return `/db/${link.id}?${noteQ}`;
  return `/notes/${note.id}`;
}

/** Specialty app types that own a full-screen route (not note-shell iframe). */
export function isFullScreenAppLink(
  link: Note["app_link"] | null | undefined
): link is NoteAppLink & { type: "board" | "canvas" | "graph" | "database" } {
  return (
    !!link &&
    (link.type === "board" ||
      link.type === "canvas" ||
      link.type === "graph" ||
      link.type === "database") &&
    !!link.id
  );
}

/** Deep-link path for embedding specialty UIs (iframe / legacy routes). */
export function noteAppEmbedHref(
  link: NoteAppLink,
  noteId?: string
): string | null {
  const q = noteId ? `?embed=1&note=${encodeURIComponent(noteId)}` : "?embed=1";
  switch (link.type) {
    case "board":
      return `/board/${link.id}${q}`;
    case "canvas":
      return `/canvas/${link.id}${q}`;
    case "graph":
      return `/graph/${link.id}${q}`;
    case "database":
      return `/db/${link.id}${q}`;
    case "web":
    case "extension":
      return null;
    default:
      return null;
  }
}

export function normalizeWebUrl(raw: string): string {
  const t = raw.trim();
  if (!t) return "";
  if (/^https?:\/\//i.test(t)) return t;
  if (/^\/\//.test(t)) return `https:${t}`;
  return `https://${t}`;
}

export function webUrlFromNote(note: Pick<Note, "props" | "app_link">): string {
  const props = note.props || {};
  const fromProps = typeof props.web_url === "string" ? props.web_url.trim() : "";
  if (fromProps) return fromProps;
  if (note.app_link?.type === "web" && note.app_link.id.startsWith("http")) {
    return note.app_link.id;
  }
  return "";
}

export function extensionEntryFromNote(note: Pick<Note, "props">): string {
  const props = note.props || {};
  return typeof props.extension_entry === "string" ? props.extension_entry.trim() : "";
}

export function extensionIdFromNote(note: Pick<Note, "props" | "app_link">): string {
  const props = note.props || {};
  if (typeof props.extension_id === "string" && props.extension_id.trim()) {
    return props.extension_id.trim();
  }
  if (note.app_link?.type === "extension") return note.app_link.id;
  return "";
}

export async function findNoteIdByAppLink(
  uid: string,
  type: NoteAppLinkType,
  appId: string
): Promise<string | null> {
  const snap = await getDocs(query(collection(db, "notes"), where("user_id", "==", uid)));
  for (const d of snap.docs) {
    const link = parseNoteAppLink(d.data().app_link);
    if (link && link.type === type && link.id === appId) return d.id;
  }
  return null;
}

/** Ensure an orphan specialty resource has a note shell; returns note id. */
export async function ensureNoteForAppLink(
  uid: string,
  type: Exclude<NoteAppLinkType, "web" | "extension">,
  appId: string,
  title?: string
): Promise<string> {
  const existing = await findNoteIdByAppLink(uid, type, appId);
  if (existing) return existing;
  return createNote(uid, title || APP_LINK_TITLES[type], "", undefined, [], {
    status: "backlog",
    icon: APP_LINK_ICONS[type],
    app_link: { type, id: appId },
  });
}

export async function createExtensionWorkspacePage(
  uid: string,
  ext: ExtensionManifest,
  opts?: {
    folder?: string;
    parentId?: string;
    tags?: string[];
    status?: Note["status"];
  }
): Promise<{ noteId: string; href: string }> {
  const folder = opts?.parentId ? "" : opts?.folder || "";
  const parentId = opts?.parentId || "";
  const title = ext.pageType.createLabel || ext.name;
  const noteId = await createNote(uid, title, "", undefined, opts?.tags || [], {
    folder,
    status: opts?.status || "backlog",
    parent_id: parentId,
    icon: ext.icon || "extension",
    props: {
      extension_id: ext.id,
      extension_entry: ext.pageType.entry,
      extension_name: ext.name,
    },
    app_link: { type: "extension", id: ext.id },
  });
  return { noteId, href: noteOpenHref({ id: noteId, app_link: { type: "extension", id: ext.id } }) };
}

export async function createWorkspacePage(
  uid: string,
  kind: WorkspacePageKind,
  opts?: {
    folder?: string;
    parentId?: string;
    tags?: string[];
    status?: Note["status"];
    webUrl?: string;
    extension?: ExtensionManifest;
    databaseTemplate?: import("@/lib/database").DbTemplateId;
    databaseName?: string;
    /** Display name for board / canvas / graph */
    name?: string;
    boardStatuses?: BoardStatus[];
    graphFilters?: GraphFilters;
    graphLayout?: LayoutMode;
  }
): Promise<{ noteId: string; href: string }> {
  const folder = opts?.parentId ? "" : opts?.folder || "";
  const parentId = opts?.parentId || "";
  const tags = opts?.tags || [];
  const status = opts?.status || "backlog";
  const pageName = (opts?.name || "").trim();

  if (typeof kind === "string" && kind.startsWith("ext:")) {
    const ext = opts?.extension;
    if (!ext) throw new Error("缺少擴充套件資訊");
    return createExtensionWorkspacePage(uid, ext, { folder, parentId, tags, status });
  }

  if (kind === "note") {
    const noteId = await createNote(uid, "未命名筆記", "", undefined, tags, {
      folder,
      status,
      parent_id: parentId,
      icon: "description",
    });
    return { noteId, href: noteOpenHref({ id: noteId }) };
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
    return { noteId, href: noteOpenHref({ id: noteId }) };
  }

  if (kind === "web") {
    const url = normalizeWebUrl(opts?.webUrl || "https://www.google.com");
    let title = "未命名網頁";
    try {
      title = new URL(url).hostname.replace(/^www\./, "") || title;
    } catch {
      /* keep default */
    }
    const noteId = await createNote(uid, title, "", undefined, tags, {
      folder,
      status,
      parent_id: parentId,
      icon: "language",
      props: { web_url: url },
      app_link: { type: "web", id: "pending" },
    });
    await updateNote(noteId, {
      app_link: { type: "web", id: noteId },
      props: { web_url: url },
    });
    return {
      noteId,
      href: noteOpenHref({ id: noteId, app_link: { type: "web", id: noteId } }),
    };
  }

  if (kind === "board") {
    const name = pageName || "未命名看板";
    const appId = await createBoard(uid, name);
    if (opts?.boardStatuses) {
      await updateBoard(uid, appId, { statuses: opts.boardStatuses, name });
    } else if (pageName) {
      await updateBoard(uid, appId, { name });
    }
    const noteId = await createNote(uid, name, "", undefined, tags, {
      folder,
      status,
      parent_id: parentId,
      icon: "view_kanban",
      app_link: { type: "board", id: appId },
    });
    return { noteId, href: noteOpenHref({ id: noteId, app_link: { type: "board", id: appId } }) };
  }

  if (kind === "database") {
    const tpl = opts?.databaseTemplate || "tasks";
    const name = (opts?.databaseName || pageName || "").trim() || "未命名資料庫";
    const appId = await createDatabase(uid, name, tpl);
    const noteId = await createNote(uid, name, "", undefined, tags, {
      folder,
      status,
      parent_id: parentId,
      icon: "table_chart",
      app_link: { type: "database", id: appId },
    });
    return { noteId, href: noteOpenHref({ id: noteId, app_link: { type: "database", id: appId } }) };
  }

  if (kind === "canvas") {
    const name = pageName || "未命名白板";
    const appId = await createCanvas(uid, name);
    const noteId = await createNote(uid, name, "", undefined, tags, {
      folder,
      status,
      parent_id: parentId,
      icon: "palette",
      app_link: { type: "canvas", id: appId },
    });
    return { noteId, href: noteOpenHref({ id: noteId, app_link: { type: "canvas", id: appId } }) };
  }

  const name = pageName || "未命名圖譜";
  const appId = await createGraph(uid, name);
  if (opts?.graphFilters || opts?.graphLayout) {
    await updateGraph(uid, appId, {
      name,
      ...(opts.graphFilters ? { filters: opts.graphFilters } : {}),
      ...(opts.graphLayout ? { layout: opts.graphLayout } : {}),
    });
  }
  const noteId = await createNote(uid, name, "", undefined, tags, {
    folder,
    status,
    parent_id: parentId,
    icon: "hub",
    app_link: { type: "graph", id: appId },
  });
  return { noteId, href: noteOpenHref({ id: noteId, app_link: { type: "graph", id: appId } }) };
}
