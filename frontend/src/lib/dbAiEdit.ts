/** Parse / emit structured database edits from the global AI rail. */

import type { Note } from "@/lib/firebase";
import { deleteNote } from "@/lib/firebase";
import {
  addProperty,
  createDatabaseRow,
  setCellValue,
  updateDatabase,
  type CadenceDatabase,
  type DbPropType,
  type DbProperty,
} from "@/lib/database";

export type DbAiCellValue = string | number | boolean | null | string[];

export type DbAiLiveSnapshot = {
  databaseId: string;
  name: string;
  icon?: string;
  properties: Array<{
    id: string;
    name: string;
    type: string;
    options?: Array<{ id: string; label: string }>;
  }>;
  rows: Array<{
    id: string;
    title: string;
    cells: Record<string, DbAiCellValue>;
  }>;
  updatedAt: number;
};

export type DbAiOp =
  | { op: "set_cell"; row: string; prop: string; value: DbAiCellValue }
  | { op: "set_cells"; row: string; values: Record<string, DbAiCellValue> }
  | { op: "add_row"; title: string; values?: Record<string, DbAiCellValue> }
  | { op: "delete_row"; row: string }
  | { op: "add_property"; type: string; name: string }
  | { op: "rename_property"; prop: string; name: string }
  | { op: "rename_database"; name: string };

export type DbAiEdit = {
  databaseId: string;
  ops: DbAiOp[];
};

export type DbAiEditEventDetail = DbAiEdit & { source?: string };

export const DB_AI_EDIT_EVENT = "albireus:ai-db-edit";

let liveSnap: DbAiLiveSnapshot | null = null;

export function publishDbLiveSnapshot(snap: DbAiLiveSnapshot) {
  liveSnap = { ...snap, updatedAt: Date.now() };
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("albireus:db-live"));
  }
}

export function clearDbLiveSnapshot(databaseId?: string) {
  if (!liveSnap) return;
  if (!databaseId || liveSnap.databaseId === databaseId) liveSnap = null;
}

export function readDbLiveSnapshot(databaseId?: string | null): DbAiLiveSnapshot | null {
  if (!liveSnap) return null;
  if (databaseId && liveSnap.databaseId !== databaseId) return null;
  // Stale after 2 minutes without refresh
  if (Date.now() - liveSnap.updatedAt > 120_000) return null;
  return liveSnap;
}

export function buildDbLiveSnapshot(db: CadenceDatabase, rows: Note[]): DbAiLiveSnapshot {
  const props = (db.properties || []).filter((p) => p.type !== "formula" && p.type !== "rollup");
  const packedRows = rows.slice(0, 120).map((row) => {
    const cells: Record<string, DbAiCellValue> = {};
    for (const p of props) {
      if (p.type === "title") continue;
      const raw =
        p.type === "tags"
          ? row.tags || []
          : p.type === "created_time" ||
              p.type === "last_edited_time" ||
              p.type === "created_by" ||
              p.type === "last_edited_by" ||
              p.type === "unique_id"
            ? null
            : row.props?.[p.id];
      cells[p.id] = normalizeCellForSnap(raw);
    }
    return {
      id: row.id,
      title: row.title || "未命名",
      cells,
    };
  });
  return {
    databaseId: db.id,
    name: db.name || "未命名資料庫",
    icon: db.icon,
    properties: props.map((p) => ({
      id: p.id,
      name: p.name,
      type: p.type,
      options: p.options?.map((o) => ({ id: o.id, label: o.label })),
    })),
    rows: packedRows,
    updatedAt: Date.now(),
  };
}

function normalizeCellForSnap(raw: unknown): DbAiCellValue {
  if (raw == null) return null;
  if (typeof raw === "string" || typeof raw === "number" || typeof raw === "boolean") return raw;
  if (Array.isArray(raw)) {
    if (raw.every((x) => typeof x === "string")) return raw as string[];
    // files / relation objects → urls or ids
    return raw
      .map((x) => {
        if (typeof x === "string") return x;
        if (x && typeof x === "object") {
          const o = x as Record<string, unknown>;
          if (typeof o.url === "string") return o.url;
          if (typeof o.id === "string") return o.id;
        }
        return "";
      })
      .filter(Boolean);
  }
  return String(raw);
}

export function packDbContextForAi(snap: DbAiLiveSnapshot, maxChars = 14000): string {
  const propLines = snap.properties
    .map((p) => {
      const opts = p.options?.length
        ? ` options=[${p.options.map((o) => `${o.label}=${o.id}`).join(", ")}]`
        : "";
      return `- ${p.name} (id=${p.id}, type=${p.type})${opts}`;
    })
    .join("\n");

  const header =
    `—— 目前資料庫（可編輯目標）——\n` +
    `ID：${snap.databaseId}\n` +
    `名稱：${snap.name}\n` +
    `屬性：\n${propLines}\n` +
    `列（共 ${snap.rows.length} 筆，可能截斷）：\n`;

  const rowChunks: string[] = [];
  let used = header.length;
  for (const row of snap.rows) {
    const cellParts = Object.entries(row.cells)
      .map(([pid, v]) => {
        const prop = snap.properties.find((p) => p.id === pid);
        const label = prop?.name || pid;
        let shown: string;
        if (v == null) shown = "";
        else if (Array.isArray(v)) shown = v.join(", ");
        else shown = String(v);
        if (shown.length > 80) shown = `${shown.slice(0, 77)}…`;
        return `${label}=${shown}`;
      })
      .filter((s) => !s.endsWith("="));
    const line = `• row_id=${row.id} | 標題=${row.title}${cellParts.length ? ` | ${cellParts.join(" | ")}` : ""}`;
    if (used + line.length + 20 > maxChars) {
      rowChunks.push("…（其餘列省略）");
      break;
    }
    rowChunks.push(line);
    used += line.length + 1;
  }

  return `${header}${rowChunks.join("\n")}\n—— 結束 ——`;
}

/** Heuristic: user clearly asked to change the open database. */
export function userAskedToEditDb(prompt: string): boolean {
  const t = prompt.trim();
  if (!t) return false;
  return /修改資料庫|改資料庫|更新資料庫|寫入資料庫|套用到資料庫|編輯資料庫|幫我改|請改|改成|改寫|刪除列|刪掉列|新增列|加一列|加一欄|新增屬性|改狀態|改標題|填入|把.*改|更新.*列|批次|全部改/.test(
    t
  );
}

const FENCE_RE = /```albireus-db-edit\s*\n([\s\S]*?)```/i;

export function parseDbAiEdit(raw: string): {
  edit: DbAiEdit | null;
  displayText: string;
} {
  const m = raw.match(FENCE_RE);
  if (!m) return { edit: null, displayText: raw };

  const block = m[1].trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(block);
  } catch {
    // Allow optional header lines before JSON
    const jsonStart = block.indexOf("{");
    if (jsonStart < 0) return { edit: null, displayText: raw };
    try {
      parsed = JSON.parse(block.slice(jsonStart));
    } catch {
      return { edit: null, displayText: raw };
    }
  }

  const obj = parsed as Record<string, unknown>;
  const databaseId = String(obj.database_id || obj.databaseId || "").trim();
  const opsRaw = Array.isArray(obj.ops) ? obj.ops : [];
  const ops = opsRaw
    .map((x) => normalizeOp(x))
    .filter((x): x is DbAiOp => x != null)
    .slice(0, 40);

  if (!databaseId || ops.length === 0) {
    return { edit: null, displayText: raw };
  }

  const displayText = raw.replace(FENCE_RE, "").trim();
  return {
    edit: { databaseId, ops },
    displayText: displayText || `已準備套用 ${ops.length} 項資料庫修改。`,
  };
}

function normalizeOp(raw: unknown): DbAiOp | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const op = String(o.op || "").trim();
  if (op === "set_cell") {
    const row = String(o.row || o.row_id || o.rowId || "").trim();
    const prop = String(o.prop || o.prop_id || o.propId || o.property || "").trim();
    if (!row || !prop) return null;
    return { op: "set_cell", row, prop, value: o.value as DbAiCellValue };
  }
  if (op === "set_cells") {
    const row = String(o.row || o.row_id || o.rowId || "").trim();
    const values =
      o.values && typeof o.values === "object" && !Array.isArray(o.values)
        ? (o.values as Record<string, DbAiCellValue>)
        : null;
    if (!row || !values) return null;
    return { op: "set_cells", row, values };
  }
  if (op === "add_row") {
    const title = String(o.title || "未命名").trim() || "未命名";
    const values =
      o.values && typeof o.values === "object" && !Array.isArray(o.values)
        ? (o.values as Record<string, DbAiCellValue>)
        : o.props && typeof o.props === "object" && !Array.isArray(o.props)
          ? (o.props as Record<string, DbAiCellValue>)
          : undefined;
    return { op: "add_row", title, values };
  }
  if (op === "delete_row") {
    const row = String(o.row || o.row_id || o.rowId || "").trim();
    if (!row) return null;
    return { op: "delete_row", row };
  }
  if (op === "add_property") {
    const type = String(o.type || "text").trim() || "text";
    const name = String(o.name || "").trim();
    if (!name) return null;
    return { op: "add_property", type, name };
  }
  if (op === "rename_property") {
    const prop = String(o.prop || o.prop_id || o.propId || "").trim();
    const name = String(o.name || "").trim();
    if (!prop || !name) return null;
    return { op: "rename_property", prop, name };
  }
  if (op === "rename_database") {
    const name = String(o.name || "").trim();
    if (!name) return null;
    return { op: "rename_database", name };
  }
  return null;
}

function resolveRow(rows: Note[], ref: string): Note | null {
  const r = ref.trim();
  if (!r) return null;
  const byId = rows.find((x) => x.id === r);
  if (byId) return byId;
  const exact = rows.find((x) => (x.title || "").trim() === r);
  if (exact) return exact;
  const lower = r.toLowerCase();
  return rows.find((x) => (x.title || "").trim().toLowerCase() === lower) || null;
}

function resolveProp(properties: DbProperty[], ref: string): DbProperty | null {
  const r = ref.trim();
  if (!r) return null;
  const byId = properties.find((p) => p.id === r);
  if (byId) return byId;
  const exact = properties.find((p) => p.name === r);
  if (exact) return exact;
  const lower = r.toLowerCase();
  return properties.find((p) => p.name.toLowerCase() === lower) || null;
}

function coerceValue(prop: DbProperty, value: DbAiCellValue): unknown {
  if (prop.type === "checkbox") {
    if (typeof value === "boolean") return value;
    const s = String(value ?? "").toLowerCase();
    return s === "true" || s === "1" || s === "yes" || s === "是" || s === "勾選";
  }
  if (prop.type === "number") {
    const n = typeof value === "number" ? value : Number(value);
    return Number.isFinite(n) ? n : null;
  }
  if (prop.type === "select" || prop.type === "status") {
    const s = String(value ?? "").trim();
    if (!s) return "";
    const opt =
      prop.options?.find((o) => o.id === s) ||
      prop.options?.find((o) => o.label === s) ||
      prop.options?.find((o) => o.label.toLowerCase() === s.toLowerCase());
    return opt?.id ?? s;
  }
  if (prop.type === "multi_select" || prop.type === "tags") {
    const parts = Array.isArray(value)
      ? value.map(String)
      : String(value ?? "")
          .split(/[,，]/)
          .flatMap((x) => x.split("、"))
          .map((x) => x.trim())
          .filter(Boolean);
    if (prop.type === "tags") return parts;
    return parts.map((s) => {
      const opt =
        prop.options?.find((o) => o.id === s) ||
        prop.options?.find((o) => o.label === s) ||
        prop.options?.find((o) => o.label.toLowerCase() === s.toLowerCase());
      return opt?.id ?? s;
    });
  }
  if (value == null) return "";
  if (Array.isArray(value)) return value.join(", ");
  return value;
}

export type ApplyDbAiEditResult = {
  ok: number;
  failed: number;
  messages: string[];
};

export async function applyDbAiEdit(
  edit: DbAiEdit,
  ctx: { db: CadenceDatabase; rows: Note[]; userId: string }
): Promise<ApplyDbAiEditResult> {
  let ok = 0;
  let failed = 0;
  const messages: string[] = [];
  let properties = [...ctx.db.properties];
  let rows = [...ctx.rows];

  for (const op of edit.ops) {
    try {
      if (op.op === "rename_database") {
        await updateDatabase(ctx.db.id, { name: op.name.slice(0, 120) });
        messages.push(`已重新命名資料庫為「${op.name}」`);
        ok++;
        continue;
      }
      if (op.op === "add_property") {
        const type = (op.type || "text") as DbPropType;
        properties = addProperty(properties, type, op.name);
        await updateDatabase(ctx.db.id, { properties });
        messages.push(`已新增屬性「${op.name}」`);
        ok++;
        continue;
      }
      if (op.op === "rename_property") {
        const prop = resolveProp(properties, op.prop);
        if (!prop) throw new Error(`找不到屬性「${op.prop}」`);
        properties = properties.map((p) =>
          p.id === prop.id ? { ...p, name: op.name.slice(0, 80) } : p
        );
        await updateDatabase(ctx.db.id, { properties });
        messages.push(`已將屬性改名為「${op.name}」`);
        ok++;
        continue;
      }
      if (op.op === "add_row") {
        const props: Record<string, unknown> = {};
        const values = op.values || {};
        for (const [k, v] of Object.entries(values)) {
          const prop = resolveProp(properties, k);
          if (!prop || prop.type === "title") continue;
          props[prop.id] = coerceValue(prop, v);
        }
        const id = await createDatabaseRow(ctx.userId, ctx.db.id, op.title, props);
        rows = [
          {
            id,
            user_id: ctx.userId,
            title: op.title,
            body_md: "",
            tags: Array.isArray(props.tags) ? (props.tags as string[]) : [],
            folder: "",
            props,
            database_id: ctx.db.id,
            status: "backlog",
            created_at: new Date(),
            updated_at: new Date(),
          } as Note,
          ...rows,
        ];
        messages.push(`已新增列「${op.title}」`);
        ok++;
        continue;
      }
      if (op.op === "delete_row") {
        const row = resolveRow(rows, op.row);
        if (!row) throw new Error(`找不到列「${op.row}」`);
        await deleteNote(row.id);
        rows = rows.filter((r) => r.id !== row.id);
        messages.push(`已刪除列「${row.title || row.id}」`);
        ok++;
        continue;
      }
      if (op.op === "set_cell") {
        const row = resolveRow(rows, op.row);
        if (!row) throw new Error(`找不到列「${op.row}」`);
        const prop = resolveProp(properties, op.prop);
        if (!prop) throw new Error(`找不到屬性「${op.prop}」`);
        const value = coerceValue(prop, op.value);
        await setCellValue(row, prop, value);
        if (prop.type === "title") {
          rows = rows.map((r) =>
            r.id === row.id ? { ...r, title: String(value || "未命名") } : r
          );
        } else if (prop.type === "tags") {
          rows = rows.map((r) =>
            r.id === row.id ? { ...r, tags: Array.isArray(value) ? value.map(String) : [] } : r
          );
        } else {
          rows = rows.map((r) =>
            r.id === row.id
              ? { ...r, props: { ...(r.props || {}), [prop.id]: value } }
              : r
          );
        }
        messages.push(`已更新「${row.title}」· ${prop.name}`);
        ok++;
        continue;
      }
      if (op.op === "set_cells") {
        const row = resolveRow(rows, op.row);
        if (!row) throw new Error(`找不到列「${op.row}」`);
        let working = row;
        for (const [k, v] of Object.entries(op.values)) {
          const prop = resolveProp(properties, k);
          if (!prop) continue;
          const value = coerceValue(prop, v);
          await setCellValue(working, prop, value);
          if (prop.type === "title") {
            working = { ...working, title: String(value || "未命名") };
          } else if (prop.type === "tags") {
            working = {
              ...working,
              tags: Array.isArray(value) ? value.map(String) : [],
            };
          } else {
            working = {
              ...working,
              props: { ...(working.props || {}), [prop.id]: value },
            };
          }
        }
        rows = rows.map((r) => (r.id === row.id ? working : r));
        messages.push(`已更新「${row.title}」多個欄位`);
        ok++;
      }
    } catch (e) {
      failed++;
      messages.push(e instanceof Error ? e.message : String(e));
    }
  }

  return { ok, failed, messages };
}

export function dispatchDbAiEdit(detail: DbAiEditEventDetail) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(DB_AI_EDIT_EVENT, { detail }));
}

export const DB_EDIT_SYSTEM_RULES = `
當使用者明確要求修改／更新／新增／刪除「目前這個資料庫」的列或屬性時，除了簡短說明外，必須另外輸出一個可被套用的 JSON 編輯區塊（只在有改資料庫意圖時才輸出）：
\`\`\`albireus-db-edit
{
  "database_id": "（必須等於目前資料庫 ID）",
  "ops": [
    {"op":"set_cell","row":"列id或完整標題","prop":"屬性id或屬性名稱","value":"新值"},
    {"op":"set_cells","row":"列id或標題","values":{"狀態":"已完成","優先級":"高"}},
    {"op":"add_row","title":"新列標題","values":{"狀態":"未開始"}},
    {"op":"delete_row","row":"列id或標題"},
    {"op":"add_property","type":"text|number|select|status|date|checkbox|tags|url","name":"屬性名稱"},
    {"op":"rename_property","prop":"屬性id或名稱","name":"新名稱"},
    {"op":"rename_database","name":"新資料庫名稱"}
  ]
}
\`\`\`
規則：
- database_id 必須是目前資料庫 ID，不可捏造。
- row / prop 可用 id 或顯示名稱；select／status 的 value 可用選項標籤或 id。
- 一次最多 40 個 ops；只改使用者要求的範圍。
- 不要輸出筆記編輯區塊（albireus-note-edit）。
- 使用者只是提問、統計、討論而未要求改資料庫時，不要輸出編輯區塊。
- 編輯區塊以外用繁體中文說明你改了什麼。
`.trim();
