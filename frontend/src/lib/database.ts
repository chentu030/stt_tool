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
  | "files"
  | "person"
  | "relation"
  | "formula"
  | "unique_id"
  | "created_time"
  | "last_edited_time"
  | "created_by"
  | "last_edited_by";

export type DbSelectOption = {
  id: string;
  label: string;
  color?: string;
};

export type DbFileValue = {
  url: string;
  name?: string;
};

export type DbProperty = {
  id: string;
  name: string;
  type: DbPropType;
  options?: DbSelectOption[];
  /** For status: groups of option ids */
  statusGroups?: { name: string; optionIds: string[] }[];
  /** formula: template with {{propId}} or simple math like {{a}}+{{b}} */
  formula?: string;
  /** relation: target database id (empty = same database) */
  relationDbId?: string;
  /** number display hint */
  numberFormat?: "number" | "percent" | "currency";
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

export function defaultProjectProperties(): DbProperty[] {
  const statusOpts: DbSelectOption[] = [
    { id: "backlog", label: "待辦", color: SELECT_COLORS[1] },
    { id: "active", label: "進行中", color: SELECT_COLORS[0] },
    { id: "blocked", label: "阻塞", color: SELECT_COLORS[4] },
    { id: "done", label: "完成", color: SELECT_COLORS[5] },
  ];
  return [
    { id: "title", name: "專案", type: "title" },
    {
      id: "status",
      name: "狀態",
      type: "status",
      options: statusOpts,
      statusGroups: [
        { name: "待辦", optionIds: ["backlog"] },
        { name: "進行中", optionIds: ["active", "blocked"] },
        { name: "完成", optionIds: ["done"] },
      ],
    },
    { id: "owner", name: "負責人", type: "text" },
    { id: "due", name: "目標日", type: "date" },
    { id: "priority", name: "優先級", type: "select", options: [
      { id: "p0", label: "P0", color: SELECT_COLORS[4] },
      { id: "p1", label: "P1", color: SELECT_COLORS[2] },
      { id: "p2", label: "P2", color: SELECT_COLORS[1] },
    ] },
    { id: "tags", name: "標籤", type: "tags" },
  ];
}

export function defaultReadingProperties(): DbProperty[] {
  const statusOpts: DbSelectOption[] = [
    { id: "want", label: "想讀", color: SELECT_COLORS[1] },
    { id: "reading", label: "閱讀中", color: SELECT_COLORS[0] },
    { id: "done", label: "已讀", color: SELECT_COLORS[5] },
  ];
  return [
    { id: "title", name: "書名／文章", type: "title" },
    { id: "author", name: "作者", type: "text" },
    {
      id: "status",
      name: "狀態",
      type: "status",
      options: statusOpts,
      statusGroups: [
        { name: "想讀", optionIds: ["want"] },
        { name: "閱讀中", optionIds: ["reading"] },
        { name: "已讀", optionIds: ["done"] },
      ],
    },
    { id: "rating", name: "評分", type: "number" },
    { id: "url", name: "連結", type: "url" },
    { id: "tags", name: "標籤", type: "tags" },
  ];
}

export function defaultContactsProperties(): DbProperty[] {
  return [
    { id: "title", name: "姓名", type: "title" },
    { id: "company", name: "公司", type: "text" },
    { id: "role", name: "職稱", type: "text" },
    { id: "email", name: "Email", type: "email" },
    { id: "phone", name: "電話", type: "phone" },
    { id: "tags", name: "標籤", type: "tags" },
    { id: "notes", name: "備註", type: "text" },
  ];
}

export function defaultViews(): DbView[] {
  return [
    { id: "v_table", name: "表格", type: "table" },
    { id: "v_board", name: "看板", type: "board", groupBy: "status" },
    { id: "v_list", name: "列表", type: "list" },
    { id: "v_gallery", name: "畫廊", type: "gallery" },
  ];
}

export function projectViews(): DbView[] {
  return [
    { id: "v_table", name: "表格", type: "table" },
    { id: "v_board", name: "看板", type: "board", groupBy: "status" },
    { id: "v_list", name: "列表", type: "list" },
  ];
}

export function readingViews(): DbView[] {
  return [
    { id: "v_table", name: "表格", type: "table" },
    { id: "v_gallery", name: "畫廊", type: "gallery" },
    { id: "v_board", name: "看板", type: "board", groupBy: "status" },
  ];
}

export function contactsViews(): DbView[] {
  return [
    { id: "v_table", name: "表格", type: "table" },
    { id: "v_list", name: "列表", type: "list" },
  ];
}

export type DbTemplateId = "blank" | "tasks" | "projects" | "reading" | "contacts";

export type DbTemplateDef = {
  id: DbTemplateId;
  name: string;
  description: string;
  icon: string;
  defaultName: string;
  previewProps: string[];
  viewLabels: string[];
};

export const DB_TEMPLATES: DbTemplateDef[] = [
  {
    id: "tasks",
    name: "任務清單",
    description: "狀態、截止日、優先級 — 適合待辦與追蹤。",
    icon: "checklist",
    defaultName: "任務清單",
    previewProps: ["狀態", "截止日期", "優先級", "標籤"],
    viewLabels: ["表格", "看板", "列表", "畫廊"],
  },
  {
    id: "projects",
    name: "專案追蹤",
    description: "負責人與看板視圖，一眼看進度。",
    icon: "rocket_launch",
    defaultName: "專案追蹤",
    previewProps: ["狀態", "負責人", "目標日", "優先級"],
    viewLabels: ["表格", "看板", "列表"],
  },
  {
    id: "reading",
    name: "閱讀清單",
    description: "書／文章、評分與連結，支援畫廊視圖。",
    icon: "menu_book",
    defaultName: "閱讀清單",
    previewProps: ["作者", "狀態", "評分", "連結"],
    viewLabels: ["表格", "畫廊", "看板"],
  },
  {
    id: "contacts",
    name: "聯絡人",
    description: "公司、職稱、Email 與電話。",
    icon: "contacts",
    defaultName: "聯絡人",
    previewProps: ["公司", "職稱", "Email", "電話"],
    viewLabels: ["表格", "列表", "表單"],
  },
  {
    id: "blank",
    name: "空白資料庫",
    description: "只有標題欄，自行加屬性與視圖。",
    icon: "table_chart",
    defaultName: "未命名資料庫",
    previewProps: ["名稱"],
    viewLabels: ["表格", "列表"],
  },
];

function schemaForTemplate(template: DbTemplateId): {
  properties: DbProperty[];
  views: DbView[];
  icon: string;
} {
  switch (template) {
    case "blank":
      return {
        properties: [{ id: "title", name: "名稱", type: "title" }],
        views: [
          { id: "v_table", name: "表格", type: "table" },
          { id: "v_list", name: "列表", type: "list" },
        ],
        icon: "table_chart",
      };
    case "projects":
      return {
        properties: defaultProjectProperties(),
        views: [
          ...projectViews(),
          { id: "v_form", name: "表單", type: "form" },
        ],
        icon: "rocket_launch",
      };
    case "reading":
      return {
        properties: defaultReadingProperties(),
        views: readingViews(),
        icon: "menu_book",
      };
    case "contacts":
      return {
        properties: defaultContactsProperties(),
        views: [
          ...contactsViews(),
          { id: "v_form", name: "表單", type: "form" },
        ],
        icon: "contacts",
      };
    case "tasks":
    default:
      return {
        properties: defaultTaskProperties(),
        views: [
          ...defaultViews(),
          { id: "v_calendar", name: "日曆", type: "calendar", dateProp: "due" },
          { id: "v_form", name: "表單", type: "form" },
        ],
        icon: "checklist",
      };
  }
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
  template: DbTemplateId = "tasks"
): Promise<string> {
  const id = `${uid}_db_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const schema = schemaForTemplate(template);
  const def = DB_TEMPLATES.find((t) => t.id === template);
  await setDoc(doc(db, "databases", id), {
    user_id: uid,
    name: (name || def?.defaultName || "未命名資料庫").trim() || "未命名資料庫",
    icon: schema.icon,
    template,
    properties: schema.properties,
    views: schema.views,
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
    files: "檔案／媒體",
    person: "人員",
    relation: "關聯",
    formula: "公式",
    unique_id: "唯一 ID",
    created_time: "建立時間",
    last_edited_time: "最後編輯",
    created_by: "建立者",
    last_edited_by: "編輯者",
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
    prop.statusGroups = [
      { name: "未開始", optionIds: ["todo"] },
      { name: "進行中", optionIds: ["doing"] },
      { name: "已完成", optionIds: ["done"] },
    ];
  }
  if (type === "formula") {
    prop.formula = "{{title}}";
  }
  if (type === "unique_id") {
    prop.name = name || "ID";
  }
  return [...properties.filter((p) => p.type !== "title" || p.id === "title"), prop].sort((a, b) =>
    a.type === "title" ? -1 : b.type === "title" ? 1 : 0
  );
}

export function evalFormula(
  prop: DbProperty,
  row: Note,
  properties: DbProperty[]
): string {
  const expr = (prop.formula || "").trim();
  if (!expr) return "";
  let replaced = expr.replace(/\{\{([a-zA-Z0-9_]+)\}\}/g, (_, pid: string) => {
    const p = properties.find((x) => x.id === pid);
    if (!p) return "";
    const v = getCellValue(row, p);
    if (v == null) return "";
    if (Array.isArray(v)) return v.map(String).join(",");
    if (typeof v === "object" && v && "url" in (v as object)) {
      return String((v as DbFileValue).url || "");
    }
    return String(v);
  });
  // Safe-ish arithmetic if expression is only numbers/operators after replace
  if (/^[\d.\s+\-*/()]+$/.test(replaced)) {
    try {
      // eslint-disable-next-line no-new-func
      const n = Function(`"use strict"; return (${replaced});`)();
      if (typeof n === "number" && Number.isFinite(n)) return String(n);
    } catch {
      /* fall through */
    }
  }
  return replaced;
}

export function getCellValue(row: Note, prop: DbProperty): unknown {
  if (prop.type === "title") return row.title;
  if (prop.type === "tags") return row.tags || [];
  if (prop.type === "created_time") return row.created_at?.toISOString?.() || "";
  if (prop.type === "last_edited_time") return row.updated_at?.toISOString?.() || "";
  if (prop.type === "created_by" || prop.type === "last_edited_by") {
    return row.user_id || "";
  }
  if (prop.type === "unique_id") {
    return row.props?.[prop.id] || row.id.slice(-6).toUpperCase();
  }
  if (prop.type === "formula") return null; // computed in UI
  return row.props?.[prop.id];
}

export async function setCellValue(
  row: Note,
  prop: DbProperty,
  value: unknown
): Promise<void> {
  if (
    prop.type === "created_time" ||
    prop.type === "last_edited_time" ||
    prop.type === "created_by" ||
    prop.type === "last_edited_by" ||
    prop.type === "formula" ||
    prop.type === "unique_id"
  ) {
    return;
  }
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
  if (prop.type === "files") {
    let files: DbFileValue[] = [];
    if (Array.isArray(value)) {
      files = value
        .map((x): DbFileValue | null => {
          if (typeof x === "string") {
            const url = x.trim();
            return url ? { url, name: url.split("/").pop() } : null;
          }
          if (x && typeof x === "object" && "url" in x) {
            const url = String((x as DbFileValue).url || "").trim();
            if (!url) return null;
            return { url, name: (x as DbFileValue).name };
          }
          return null;
        })
        .filter((x): x is DbFileValue => x != null);
    } else if (typeof value === "string" && value.trim()) {
      files = value
        .split(/[\n,]+/)
        .map((u) => u.trim())
        .filter(Boolean)
        .map((url) => ({ url, name: url.split("/").pop() }));
    }
    const next = { ...(row.props || {}), [prop.id]: files };
    await updateNote(row.id, { props: next });
    return;
  }
  if (prop.type === "relation") {
    const ids = Array.isArray(value)
      ? value.map(String).filter(Boolean)
      : String(value || "")
          .split(/[\s,，]+/)
          .map((t) => t.trim())
          .filter(Boolean);
    const next = { ...(row.props || {}), [prop.id]: ids };
    await updateNote(row.id, { props: next });
    return;
  }
  const next = { ...(row.props || {}), [prop.id]: value };
  const extra: Partial<Pick<Note, "status">> = {};
  if (prop.type === "status" && typeof value === "string") {
    if (value === "doing" || value === "done" || value === "todo" || value === "backlog") {
      extra.status = value === "todo" ? "backlog" : (value as Note["status"]);
    }
  }
  await updateNote(row.id, { props: next, ...extra });
}

export function addDatabaseView(
  views: DbView[],
  type: DbViewType,
  name?: string
): DbView[] {
  const labels: Record<DbViewType, string> = {
    table: "表格",
    list: "列表",
    board: "看板",
    calendar: "日曆",
    gallery: "畫廊",
    form: "表單",
  };
  const view: DbView = {
    id: uid("v"),
    name: name || labels[type],
    type,
  };
  if (type === "board") view.groupBy = "status";
  if (type === "calendar") view.dateProp = "due";
  return [...views, view];
}

export async function listUserDatabasesOnce(uid: string): Promise<CadenceDatabase[]> {
  const q = query(collection(db, "databases"), where("user_id", "==", uid));
  const snap = await getDocs(q);
  return snap.docs.map((d) => mapDb(d.id, d.data() as Record<string, unknown>));
}
