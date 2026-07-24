/**
 * Workspace-level property catalog — shared by notes, databases, and boards.
 * Stable system ids: ws_type, ws_status, ws_priority, ws_due.
 */

import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  setDoc,
  updateDoc,
  Timestamp,
  type Unsubscribe,
} from "firebase/firestore";
import { db, updateNote, type Note } from "@/lib/firebase";
import type { DbProperty, DbPropType, DbSelectOption, CadenceDatabase } from "@/lib/database";
import { getCellValue } from "@/lib/database";
import {
  FM_STATUS_PROP,
  TYPE_PROP,
  noteTypeOf,
} from "@/lib/noteKnowledge";
import { parseBoardMeta, type BoardStatus, type Priority } from "@/lib/boardMeta";

export type WorkspacePropSystemKey = "type" | "status" | "priority" | "due";

export type WorkspacePropertyDef = DbProperty & {
  systemKey?: WorkspacePropSystemKey;
  archived?: boolean;
  updated_at?: Date;
};

export const WS_TYPE_ID = "ws_type";
export const WS_STATUS_ID = "ws_status";
export const WS_PRIORITY_ID = "ws_priority";
export const WS_DUE_ID = "ws_due";

export const WORKSPACE_SYSTEM_IDS = [WS_TYPE_ID, WS_STATUS_ID, WS_PRIORITY_ID, WS_DUE_ID] as const;

const SELECT_COLORS = ["#0F766E", "#0369A1", "#B45309", "#7C3AED", "#BE123C", "#3F6212", "#94A3B8"];

function defsCol(uid: string) {
  return collection(db, "users", uid, "propertyDefs");
}

function defRef(uid: string, id: string) {
  return doc(db, "users", uid, "propertyDefs", id);
}

export function seedWorkspacePropertyDefs(): WorkspacePropertyDef[] {
  const statusOpts: DbSelectOption[] = [
    { id: "backlog", label: "待辦", color: SELECT_COLORS[6] },
    { id: "doing", label: "進行中", color: SELECT_COLORS[0] },
    { id: "done", label: "完成", color: SELECT_COLORS[5] },
  ];
  const priorityOpts: DbSelectOption[] = [
    { id: "urgent", label: "緊急", color: SELECT_COLORS[4] },
    { id: "high", label: "高", color: SELECT_COLORS[2] },
    { id: "normal", label: "普通", color: SELECT_COLORS[6] },
    { id: "low", label: "低", color: SELECT_COLORS[1] },
  ];
  const typeOpts: DbSelectOption[] = [
    { id: "note", label: "筆記", color: SELECT_COLORS[0] },
    { id: "meeting", label: "會議", color: SELECT_COLORS[1] },
    { id: "project", label: "專案", color: SELECT_COLORS[3] },
    { id: "reference", label: "參考", color: SELECT_COLORS[2] },
  ];
  return [
    {
      id: WS_TYPE_ID,
      name: "類型",
      type: "select",
      systemKey: "type",
      options: typeOpts,
    },
    {
      id: WS_STATUS_ID,
      name: "狀態",
      type: "status",
      systemKey: "status",
      options: statusOpts,
      statusGroups: [
        { name: "待辦", optionIds: ["backlog"] },
        { name: "進行中", optionIds: ["doing"] },
        { name: "完成", optionIds: ["done"] },
      ],
    },
    {
      id: WS_PRIORITY_ID,
      name: "優先級",
      type: "select",
      systemKey: "priority",
      options: priorityOpts,
    },
    {
      id: WS_DUE_ID,
      name: "期限",
      type: "date",
      systemKey: "due",
    },
  ];
}

function parseDef(id: string, data: Record<string, unknown>): WorkspacePropertyDef {
  return {
    id,
    name: String(data.name || id),
    type: (data.type as DbPropType) || "text",
    options: Array.isArray(data.options) ? (data.options as DbSelectOption[]) : undefined,
    statusGroups: Array.isArray(data.statusGroups)
      ? (data.statusGroups as WorkspacePropertyDef["statusGroups"])
      : undefined,
    formula: typeof data.formula === "string" ? data.formula : undefined,
    relationDbId: typeof data.relationDbId === "string" ? data.relationDbId : undefined,
    rollup: data.rollup as WorkspacePropertyDef["rollup"],
    numberFormat: data.numberFormat as WorkspacePropertyDef["numberFormat"],
    systemKey: data.systemKey as WorkspacePropSystemKey | undefined,
    archived: !!data.archived,
    workspaceDefId: typeof data.workspaceDefId === "string" ? data.workspaceDefId : undefined,
    updated_at: (data.updated_at as { toDate?: () => Date })?.toDate?.() || undefined,
  };
}

function serializeDef(def: WorkspacePropertyDef): Record<string, unknown> {
  const out: Record<string, unknown> = {
    name: def.name,
    type: def.type,
    updated_at: Timestamp.now(),
  };
  if (def.options) out.options = def.options;
  if (def.statusGroups) out.statusGroups = def.statusGroups;
  if (def.formula) out.formula = def.formula;
  if (def.relationDbId) out.relationDbId = def.relationDbId;
  if (def.rollup) out.rollup = def.rollup;
  if (def.numberFormat) out.numberFormat = def.numberFormat;
  if (def.systemKey) out.systemKey = def.systemKey;
  if (def.archived) out.archived = true;
  return out;
}

/** Ensure system defs exist; returns full catalog (including user defs). */
export async function ensureWorkspacePropertyDefs(uid: string): Promise<WorkspacePropertyDef[]> {
  const seeds = seedWorkspacePropertyDefs();
  await Promise.all(
    seeds.map(async (seed) => {
      const ref = defRef(uid, seed.id);
      const snap = await getDoc(ref);
      if (!snap.exists()) {
        await setDoc(ref, { ...serializeDef(seed), created_at: Timestamp.now() });
      }
    })
  );
  return listWorkspacePropertyDefs(uid);
}

export async function listWorkspacePropertyDefs(uid: string): Promise<WorkspacePropertyDef[]> {
  const snap = await getDocs(defsCol(uid));
  const list = snap.docs.map((d) => parseDef(d.id, d.data() as Record<string, unknown>));
  list.sort((a, b) => {
    const ai = WORKSPACE_SYSTEM_IDS.indexOf(a.id as (typeof WORKSPACE_SYSTEM_IDS)[number]);
    const bi = WORKSPACE_SYSTEM_IDS.indexOf(b.id as (typeof WORKSPACE_SYSTEM_IDS)[number]);
    if (ai >= 0 && bi >= 0) return ai - bi;
    if (ai >= 0) return -1;
    if (bi >= 0) return 1;
    return a.name.localeCompare(b.name, "zh-TW");
  });
  return list;
}

export function listenWorkspacePropertyDefs(
  uid: string,
  cb: (defs: WorkspacePropertyDef[]) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  return onSnapshot(
    defsCol(uid),
    (snap) => {
      const list = snap.docs.map((d) => parseDef(d.id, d.data() as Record<string, unknown>));
      list.sort((a, b) => {
        const ai = WORKSPACE_SYSTEM_IDS.indexOf(a.id as (typeof WORKSPACE_SYSTEM_IDS)[number]);
        const bi = WORKSPACE_SYSTEM_IDS.indexOf(b.id as (typeof WORKSPACE_SYSTEM_IDS)[number]);
        if (ai >= 0 && bi >= 0) return ai - bi;
        if (ai >= 0) return -1;
        if (bi >= 0) return 1;
        return a.name.localeCompare(b.name, "zh-TW");
      });
      cb(list);
    },
    (err) => onError?.(err instanceof Error ? err : new Error(String(err)))
  );
}

export async function upsertWorkspacePropertyDef(
  uid: string,
  def: WorkspacePropertyDef
): Promise<void> {
  const ref = defRef(uid, def.id);
  const snap = await getDoc(ref);
  if (snap.exists()) {
    await updateDoc(ref, serializeDef(def));
  } else {
    await setDoc(ref, { ...serializeDef(def), created_at: Timestamp.now() });
  }
}

export async function archiveWorkspacePropertyDef(uid: string, id: string): Promise<void> {
  if ((WORKSPACE_SYSTEM_IDS as readonly string[]).includes(id)) {
    throw new Error("系統屬性不可封存");
  }
  await updateDoc(defRef(uid, id), { archived: true, updated_at: Timestamp.now() });
}

export function asDbProperty(def: WorkspacePropertyDef): DbProperty {
  const { systemKey: _s, archived: _a, updated_at: _u, ...rest } = def;
  return { ...rest, workspaceDefId: def.id };
}

/** Resolve DB column against catalog when bound. */
export function resolveDbProperty(
  prop: DbProperty,
  catalog: WorkspacePropertyDef[]
): DbProperty {
  const defId = prop.workspaceDefId || ((WORKSPACE_SYSTEM_IDS as readonly string[]).includes(prop.id) ? prop.id : "");
  if (!defId) return prop;
  const def = catalog.find((d) => d.id === defId && !d.archived);
  if (!def) return prop;
  return {
    ...prop,
    id: prop.id,
    workspaceDefId: defId,
    name: def.name,
    type: def.type,
    options: def.options,
    statusGroups: def.statusGroups,
    formula: def.formula,
    relationDbId: def.relationDbId,
    rollup: def.rollup,
    numberFormat: def.numberFormat,
  };
}

export function resolveDatabaseProperties(
  properties: DbProperty[],
  catalog: WorkspacePropertyDef[]
): DbProperty[] {
  return properties.map((p) => resolveDbProperty(p, catalog));
}

/** Map board status ↔ ws_status option id (aligned by design). */
export function boardStatusFromWs(value: unknown): BoardStatus {
  const v = String(value || "").trim();
  if (v === "doing" || v === "done") return v;
  if (v === "todo") return "backlog";
  return "backlog";
}

export function wsStatusFromBoard(status: BoardStatus | string | undefined): string {
  if (status === "doing" || status === "done") return status;
  return "backlog";
}

export function priorityFromWs(value: unknown): Priority {
  const v = String(value || "").trim() as Priority;
  if (v === "urgent" || v === "high" || v === "normal" || v === "low") return v;
  return "normal";
}

/**
 * Heal legacy type/status/board meta into ws_* props.
 * Returns props patch (and optional note.status) if anything changed.
 */
export function healWorkspaceProps(note: Note): {
  props?: Record<string, unknown>;
  status?: Note["status"];
  changed: boolean;
} {
  const props = { ...(note.props || {}) };
  let changed = false;
  let statusExtra: Note["status"] | undefined;

  // type
  if (props[WS_TYPE_ID] == null || props[WS_TYPE_ID] === "") {
    const t = noteTypeOf(note);
    if (t) {
      props[WS_TYPE_ID] = t;
      changed = true;
    }
  }

  // status from note.status or fm_status — only when never set on props
  if (!Object.prototype.hasOwnProperty.call(props, WS_STATUS_ID)) {
    if (note.status === "doing" || note.status === "done" || note.status === "backlog") {
      props[WS_STATUS_ID] = note.status;
      changed = true;
    } else {
      const fm = props[FM_STATUS_PROP] != null ? String(props[FM_STATUS_PROP]).trim() : "";
      const map: Record<string, string> = {
        待辦: "backlog",
        未開始: "backlog",
        進行中: "doing",
        完成: "done",
        已完成: "done",
        backlog: "backlog",
        doing: "doing",
        done: "done",
        todo: "backlog",
      };
      if (fm && map[fm]) {
        props[WS_STATUS_ID] = map[fm];
        changed = true;
      } else if (fm) {
        props[WS_STATUS_ID] = fm;
        changed = true;
      }
    }
  }

  // board HTML meta → priority / due — only when never set
  const meta = parseBoardMeta(note.body_md || "", note.tags);
  if (!Object.prototype.hasOwnProperty.call(props, WS_PRIORITY_ID)) {
    if (meta.priority) {
      props[WS_PRIORITY_ID] = meta.priority;
      changed = true;
    }
  }
  if (!Object.prototype.hasOwnProperty.call(props, WS_DUE_ID) && meta.due) {
    props[WS_DUE_ID] = meta.due;
    changed = true;
  }

  // dual-write note.status from ws_status when board-compatible (skip cleared)
  const wsSt = props[WS_STATUS_ID];
  if (typeof wsSt === "string" && wsSt.trim()) {
    const mapped = boardStatusFromWs(wsSt);
    if (note.status !== mapped) {
      statusExtra = mapped;
      changed = true;
    }
  }

  if (!changed) return { changed: false };
  return { props, status: statusExtra, changed: true };
}

export async function applyHealWorkspaceProps(note: Note): Promise<boolean> {
  const healed = healWorkspaceProps(note);
  if (!healed.changed || !healed.props) return false;
  await updateNote(note.id, {
    props: healed.props,
    ...(healed.status ? { status: healed.status } : {}),
  });
  return true;
}

/** Patch props for a workspace field + dual-write board/note.status / legacy keys. */
export function patchWorkspaceField(
  note: Note,
  defId: string,
  value: unknown
): { props: Record<string, unknown>; status?: Note["status"]; body_md?: string } {
  const cleared = value == null || value === "";
  const props = { ...(note.props || {}), [defId]: cleared ? "" : value };

  let status: Note["status"] | undefined;
  if (defId === WS_STATUS_ID) {
    if (cleared) {
      // Keep explicit empty; do not fall back to backlog via dual-write.
      delete props[FM_STATUS_PROP];
    } else {
      status = boardStatusFromWs(value);
      // keep fm_status in sync as label when possible
      const label =
        typeof value === "string"
          ? value === "backlog"
            ? "待辦"
            : value === "doing"
              ? "進行中"
              : value === "done"
                ? "完成"
                : String(value)
          : "";
      if (label) props[FM_STATUS_PROP] = label;
    }
  }
  if (defId === WS_TYPE_ID && !cleared && value != null && String(value).trim()) {
    props[TYPE_PROP] = String(value).trim();
  }
  if (defId === WS_TYPE_ID && cleared) {
    delete props[TYPE_PROP];
  }

  // Stop writing board HTML meta (P2); strip existing tag when updating priority/due via props
  let body_md: string | undefined;
  if (defId === WS_PRIORITY_ID || defId === WS_DUE_ID) {
    const cleaned = (note.body_md || "").replace(/<!--\s*cadence-board\s+[^>]*-->\s*/gi, "");
    if (cleaned !== (note.body_md || "")) body_md = cleaned;
  }

  return { props, status, body_md };
}

export async function setWorkspaceFieldValue(
  note: Note,
  defId: string,
  value: unknown
): Promise<void> {
  const patch = patchWorkspaceField(note, defId, value);
  await updateNote(note.id, {
    props: patch.props,
    ...(patch.status ? { status: patch.status } : {}),
    ...(patch.body_md != null ? { body_md: patch.body_md } : {}),
  });
}

export function getWorkspaceFieldValue(note: Note, defId: string): unknown {
  const props = note.props || {};
  const hasExplicit = Object.prototype.hasOwnProperty.call(props, defId);

  // Explicit empty string means user cleared the field — do not resurrect defaults.
  if (hasExplicit) {
    const v = props[defId];
    if (v == null || v === "") return "";
    if (defId === WS_STATUS_ID || defId === WS_PRIORITY_ID || defId === WS_DUE_ID || defId === WS_TYPE_ID) {
      return v;
    }
  }

  const prop = { id: defId, name: defId, type: "text" as DbPropType };
  // Prefer healed view without mutating (legacy notes missing ws_* keys)
  const healed = healWorkspaceProps(note);
  const row = healed.props ? { ...note, props: healed.props } : note;
  if (defId === WS_STATUS_ID) {
    const v = row.props?.[WS_STATUS_ID];
    if (v != null && v !== "") return v;
    return wsStatusFromBoard(note.status);
  }
  if (defId === WS_PRIORITY_ID) {
    const v = row.props?.[WS_PRIORITY_ID];
    if (v != null && v !== "") return v;
    return parseBoardMeta(note.body_md || "", note.tags).priority || "";
  }
  if (defId === WS_DUE_ID) {
    const v = row.props?.[WS_DUE_ID];
    if (v != null && v !== "") return v;
    return parseBoardMeta(note.body_md || "", note.tags).due || "";
  }
  if (defId === WS_TYPE_ID) {
    const v = row.props?.[WS_TYPE_ID];
    if (v != null && v !== "") return v;
    return noteTypeOf(note) || "";
  }
  return getCellValue(row, prop);
}

/** YAML frontmatter keys for system workspace fields. */
export function workspaceFieldsForFrontmatter(
  props: Record<string, unknown> | undefined
): Record<string, string> {
  const out: Record<string, string> = {};
  if (!props) return out;
  if (props[WS_TYPE_ID] != null && String(props[WS_TYPE_ID]).trim()) {
    out.type = String(props[WS_TYPE_ID]).trim();
  }
  if (props[WS_STATUS_ID] != null && String(props[WS_STATUS_ID]).trim()) {
    out.status = String(props[WS_STATUS_ID]).trim();
  }
  if (props[WS_PRIORITY_ID] != null && String(props[WS_PRIORITY_ID]).trim()) {
    out.priority = String(props[WS_PRIORITY_ID]).trim();
  }
  if (props[WS_DUE_ID] != null && String(props[WS_DUE_ID]).trim()) {
    out.due = String(props[WS_DUE_ID]).trim();
  }
  return out;
}

/** Import YAML type/status/priority/due into ws_* props. */
export function mergeFrontmatterIntoWorkspaceProps(
  props: Record<string, unknown>,
  fm: Record<string, unknown>
): Record<string, unknown> {
  const next = { ...props };
  if (fm.type != null && String(fm.type).trim()) next[WS_TYPE_ID] = String(fm.type).trim();
  if (fm.status != null && String(fm.status).trim()) {
    const s = String(fm.status).trim();
    const map: Record<string, string> = {
      待辦: "backlog",
      未開始: "backlog",
      進行中: "doing",
      完成: "done",
      已完成: "done",
    };
    next[WS_STATUS_ID] = map[s] || s;
  }
  if (fm.priority != null && String(fm.priority).trim()) {
    next[WS_PRIORITY_ID] = String(fm.priority).trim();
  }
  if (fm.due != null && String(fm.due).trim()) {
    next[WS_DUE_ID] = String(fm.due).trim().slice(0, 10);
  }
  return next;
}

/** Bind default task/project DB properties to workspace defs. */
export function bindDefaultsToWorkspace(properties: DbProperty[]): DbProperty[] {
  return properties.map((p) => {
    if (p.id === "status" || p.workspaceDefId === WS_STATUS_ID) {
      return { ...p, id: WS_STATUS_ID, workspaceDefId: WS_STATUS_ID, name: p.name || "狀態", type: "status" };
    }
    if (p.id === "priority" || p.workspaceDefId === WS_PRIORITY_ID) {
      return {
        ...p,
        id: WS_PRIORITY_ID,
        workspaceDefId: WS_PRIORITY_ID,
        name: p.name || "優先級",
        type: "select",
      };
    }
    if (p.id === "due" || p.workspaceDefId === WS_DUE_ID) {
      return { ...p, id: WS_DUE_ID, workspaceDefId: WS_DUE_ID, name: p.name || "期限", type: "date" };
    }
    return p;
  });
}

/** Align existing DB props to workspace catalog by name / systemKey / id. */
export function alignDatabaseToWorkspace(
  database: CadenceDatabase,
  catalog: WorkspacePropertyDef[]
): DbProperty[] {
  const byKey = new Map(catalog.filter((d) => !d.archived).map((d) => [d.systemKey || d.id, d]));
  const byName = new Map(catalog.filter((d) => !d.archived).map((d) => [d.name, d]));

  return database.properties.map((p) => {
    if (p.workspaceDefId) return p;
    if (p.type === "title" || p.type === "formula" || p.type === "rollup") return p;
    let def: WorkspacePropertyDef | undefined;
    if (p.id === "status" || p.name === "狀態") def = byKey.get("status") || byName.get("狀態");
    else if (p.id === "priority" || p.name === "優先級") def = byKey.get("priority") || byName.get("優先級");
    else if (p.id === "due" || p.name === "截止日期" || p.name === "期限" || p.name === "目標日") {
      def = byKey.get("due") || byName.get("期限");
    } else {
      def = byName.get(p.name);
    }
    if (!def) return p;
    return {
      ...p,
      id: def.id,
      workspaceDefId: def.id,
      name: def.name,
      type: def.type,
      options: def.options,
      statusGroups: def.statusGroups,
    };
  });
}

export function createCustomWorkspaceDef(
  name: string,
  type: DbPropType = "text"
): WorkspacePropertyDef {
  const id = `ws_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  return { id, name: name.trim() || "未命名屬性", type };
}
