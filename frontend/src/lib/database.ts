/** Cadence Notion-style databases */

import {
  collection,
  doc,
  setDoc,
  updateDoc,
  deleteDoc,
  getDoc,
  getDocs,
  query,
  where,
  onSnapshot,
  Timestamp,
  type Unsubscribe,
} from "firebase/firestore";
import { db, createNote, updateNote, type Note } from "@/lib/firebase";

export type DbPropType =
  | "title"
  | "text"
  | "number"
  | "checkbox"
  | "date"
  | "datetime"
  | "select"
  | "multi_select"
  | "status"
  | "tags"
  | "url"
  | "email"
  | "phone"
  | "created_time"
  | "last_edited_time";

export type DbSelectOption = {
  id: string;
  label: string;
  color?: string;
};

export type DbProperty = {
  id: string;
  name: string;
  type: DbPropType;
  options?: DbSelectOption[];
  /** For status: groups of option ids */
  statusGroups?: { name: string; optionIds: string[] }[];
};

export type DbViewType = "table" | "list" | "board" | "calendar" | "gallery" | "form";

export type DbFilter = {
  propId: string;
  op: "eq" | "neq" | "contains" | "empty" | "not_empty";
  value?: string | number | boolean;
};

export type DbSort = {
  propId: string;
  dir: "asc" | "desc";
};

export type DbView = {
  id: string;
  name: string;
  type: DbViewType;
  filters?: DbFilter[];
  sorts?: DbSort[];
  /** Board: property used for columns */
  groupBy?: string;
  /** Calendar: date property */
  dateProp?: string;
};

export type CadenceDatabase = {
  id: string;
  user_id: string;
  name: string;
  icon?: string;
  properties: DbProperty[];
  views: DbView[];
  created_at: Date;
  updated_at: Date;
};

const SELECT_COLORS = ["#0F766E", "#0369A1", "#B45309", "#7C3AED", "#BE123C", "#3F6212"];

function uid(prefix: string) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

export function defaultTaskProperties(): DbProperty[] {
  const statusOpts: DbSelectOption[] = [
    { id: "todo", label: "未開始", color: SELECT_COLORS[1] },
    { id: "doing", label: "進行中", color: SELECT_COLORS[0] },
    { id: "done", label: "已完成", color: SELECT_COLORS[5] },
  ];
  const priorityOpts: DbSelectOption[] = [
    { id: "high", label: "高", color: SELECT_COLORS[4] },
    { id: "med", label: "中", color: SELECT_COLORS[2] },
    { id: "low", label: "低", color: SELECT_COLORS[1] },
  ];
  return [
    { id: "title", name: "名稱", type: "title" },
    {
      id: "status",
      name: "狀態",
      type: "status",
      options: statusOpts,
      statusGroups: [
        { name: "未開始", optionIds: ["todo"] },
        { name: "進行中", optionIds: ["doing"] },
        { name: "已完成", optionIds: ["done"] },
      ],
    },
    { id: "due", name: "截止日期", type: "date" },
    { id: "priority", name: "優先級", type: "select", options: priorityOpts },
    { id: "tags", name: "標籤", type: "tags" },
  ];
}

export function defaultViews(): DbView[] {
  return [
    { id: "v_table", name: "表格", type: "table" },
    { id: "v_list", name: "列表", type: "list" },
  ];
}

function mapDb(id: string, data: Record<string, unknown>): CadenceDatabase {
  return {
    id,
    user_id: String(data.user_id || ""),
    name: String(data.name || "未命名資料庫"),
    icon: data.icon ? String(data.icon) : undefined,
    properties: Array.isArray(data.properties) ? (data.properties as DbProperty[]) : defaultTaskProperties(),
    views: Array.isArray(data.views) ? (data.views as DbView[]) : defaultViews(),
    created_at: (data.created_at as { toDate?: () => Date })?.toDate?.() || new Date(),
    updated_at: (data.updated_at as { toDate?: () => Date })?.toDate?.() || new Date(),
  };
}

export async function createDatabase(
  uid: string,
  name = "未命名資料庫",
  template: "blank" | "tasks" = "tasks"
): Promise<string> {
  const id = `${uid}_db_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const properties =
    template === "blank"
      ? [{ id: "title", name: "名稱", type: "title" as const }]
      : defaultTaskProperties();
  await setDoc(doc(db, "databases", id), {
    user_id: uid,
    name: (name || "未命名資料庫").trim() || "未命名資料庫",
    icon: "db",
    properties,
    views: defaultViews(),
    created_at: Timestamp.now(),
    updated_at: Timestamp.now(),
  });
  return id;
}

export async function getDatabase(dbId: string): Promise<CadenceDatabase | null> {
  const snap = await getDoc(doc(db, "databases", dbId));
  if (!snap.exists()) return null;
  return mapDb(snap.id, snap.data() as Record<string, unknown>);
}

export function listenDatabase(
  dbId: string,
  callback: (database: CadenceDatabase | null) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  return onSnapshot(
    doc(db, "databases", dbId),
    (snap) => {
      if (!snap.exists()) {
        callback(null);
        return;
      }
      callback(mapDb(snap.id, snap.data() as Record<string, unknown>));
    },
    (err) => onError?.(err)
  );
}

export function listenUserDatabases(
  uid: string,
  callback: (list: CadenceDatabase[]) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  const q = query(collection(db, "databases"), where("user_id", "==", uid));
  return onSnapshot(
    q,
    (snap) => {
      const list = snap.docs.map((d) => mapDb(d.id, d.data() as Record<string, unknown>));
      list.sort((a, b) => b.updated_at.getTime() - a.updated_at.getTime());
      callback(list);
    },
    (err) => onError?.(err)
  );
}

export async function updateDatabase(
  dbId: string,
  updates: Partial<Pick<CadenceDatabase, "name" | "icon" | "properties" | "views">>
) {
  await updateDoc(doc(db, "databases", dbId), {
    ...updates,
    updated_at: Timestamp.now(),
  });
}

export async function deleteDatabase(dbId: string) {
  await deleteDoc(doc(db, "databases", dbId));
}

export function listenDatabaseRows(
  uid: string,
  databaseId: string,
  callback: (rows: Note[]) => void
): Unsubscribe {
  const q = query(
    collection(db, "notes"),
    where("user_id", "==", uid),
    where("database_id", "==", databaseId)
  );
  return onSnapshot(q, (snap) => {
    const rows = snap.docs.map((d) => {
      const data = d.data();
      return {
        id: d.id,
        ...data,
        created_at: data.created_at?.toDate?.() || new Date(),
        updated_at: data.updated_at?.toDate?.() || new Date(),
      } as Note;
    });
    rows.sort((a, b) => b.updated_at.getTime() - a.updated_at.getTime());
    callback(rows);
  });
}

export async function createDatabaseRow(
  uid: string,
  databaseId: string,
  title = "未命名",
  props: Record<string, unknown> = {}
): Promise<string> {
  return createNote(uid, title, "", undefined, [], {
    database_id: databaseId,
    props,
    status: "backlog",
  });
}

export async function updateRowProps(
  noteId: string,
  props: Record<string, unknown>,
  extra?: Partial<Pick<Note, "title" | "tags" | "status">>
) {
  await updateNote(noteId, { props, ...extra });
}

export function addProperty(
  properties: DbProperty[],
  type: DbPropType = "text",
  name?: string
): DbProperty[] {
  const id = uid("p");
  const labels: Partial<Record<DbPropType, string>> = {
    text: "文字",
    number: "數字",
    checkbox: "核取方塊",
    date: "日期",
    datetime: "日期時間",
    select: "單選",
    multi_select: "多選",
    status: "狀態",
    tags: "標籤",
    url: "網址",
    email: "電子郵件",
    phone: "電話",
  };
  const prop: DbProperty = {
    id,
    name: name || labels[type] || "屬性",
    type,
  };
  if (type === "select" || type === "multi_select") {
    prop.options = [
      { id: uid("o"), label: "選項 A", color: SELECT_COLORS[0] },
      { id: uid("o"), label: "選項 B", color: SELECT_COLORS[1] },
    ];
  }
  if (type === "status") {
    prop.options = [
      { id: "todo", label: "未開始", color: SELECT_COLORS[1] },
      { id: "doing", label: "進行中", color: SELECT_COLORS[0] },
      { id: "done", label: "已完成", color: SELECT_COLORS[5] },
    ];
  }
  return [...properties.filter((p) => p.type !== "title" || p.id === "title"), prop].sort((a, b) =>
    a.type === "title" ? -1 : b.type === "title" ? 1 : 0
  );
}

export function getCellValue(row: Note, prop: DbProperty): unknown {
  if (prop.type === "title") return row.title;
  if (prop.type === "tags") return row.tags || [];
  if (prop.type === "created_time") return row.created_at?.toISOString?.() || "";
  if (prop.type === "last_edited_time") return row.updated_at?.toISOString?.() || "";
  return row.props?.[prop.id];
}

export async function setCellValue(
  row: Note,
  prop: DbProperty,
  value: unknown
): Promise<void> {
  if (prop.type === "title") {
    await updateNote(row.id, { title: String(value || "未命名") });
    return;
  }
  if (prop.type === "tags") {
    const tags = Array.isArray(value)
      ? value.map(String)
      : String(value || "")
          .split(/[\s,，]+/)
          .map((t) => t.replace(/^#/, "").trim())
          .filter(Boolean);
    await updateNote(row.id, { tags });
    return;
  }
  if (prop.type === "created_time" || prop.type === "last_edited_time") return;
  const next = { ...(row.props || {}), [prop.id]: value };
  const extra: Partial<Pick<Note, "status">> = {};
  if (prop.type === "status" && typeof value === "string") {
    if (value === "doing" || value === "done" || value === "todo" || value === "backlog") {
      extra.status = value === "todo" ? "backlog" : (value as Note["status"]);
    }
  }
  await updateNote(row.id, { props: next, ...extra });
}

export async function listUserDatabasesOnce(uid: string): Promise<CadenceDatabase[]> {
  const q = query(collection(db, "databases"), where("user_id", "==", uid));
  const snap = await getDocs(q);
  return snap.docs.map((d) => mapDb(d.id, d.data() as Record<string, unknown>));
}
