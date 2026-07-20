/** Create workspace pages that appear in the notes tree (with optional app backends). */

import {
  collection,
  getDocs,
  query,
  where,
} from "firebase/firestore";
import { createNote, db, updateNote, type Note } from "@/lib/firebase";
import { createBoard } from "@/lib/boardStore";
import { createCanvas } from "@/lib/canvasCloud";
import { createGraph } from "@/lib/graphStore";
import { createDatabase } from "@/lib/database";

export type NoteAppLinkType = "board" | "canvas" | "graph" | "database" | "web";

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
  | "web";

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

const APP_LINK_ICONS: Record<NoteAppLinkType, string> = {
  board: "view_kanban",
  database: "table_chart",
  canvas: "palette",
  graph: "hub",
  web: "language",
};

const APP_LINK_TITLES: Record<NoteAppLinkType, string> = {
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
    type === "web"
  ) {
    return { type, id };
  }
  return null;
}

/** Canonical open path — all workspace pages stay on /notes so tab bar works. */
export function noteOpenHref(note: Pick<Note, "id" | "app_link">): string {
  return `/notes/${note.id}`;
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
  type: Exclude<NoteAppLinkType, "web">,
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

export async function createWorkspacePage(
  uid: string,
  kind: WorkspacePageKind,
  opts?: {
    folder?: string;
    parentId?: string;
    tags?: string[];
    status?: Note["status"];
    /** Initial URL when kind === "web" */
    webUrl?: string;
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
