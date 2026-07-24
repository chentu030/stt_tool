/**
 * Cadence note frontmatter / props conventions:
 * type, status-like fields, [[wikilink]] relations, 待整理 heuristics.
 */

import { LIVE_SEGMENTS_PROP } from "@/lib/liveSegments";
import { extractWikiLinks } from "@/lib/wiki";

export const TYPE_PROP = "type";
export const ORGANIZED_PROP = "organized";
/** Custom status text when not mapped to kanban backlog/doing/done */
export const FM_STATUS_PROP = "fm_status";
/** Mirrors importMarkdownNotes.ALIASES_PROP — keep in sync */
const ALIASES_PROP = "aliases";
/** Mirrors importMarkdownNotes.FRONTMATTER_PROP — keep in sync */
const FRONTMATTER_PROP = "frontmatter";

/** Props that are system / chrome — not user FM attributes or relations. */
export const INTERNAL_NOTE_PROP_KEYS = new Set([
  ALIASES_PROP,
  FRONTMATTER_PROP,
  LIVE_SEGMENTS_PROP,
  ORGANIZED_PROP,
  "web_url",
  "extension_entry",
  "extension_id",
  "writing_goal",
  "is_source_material",
  "ws_type",
  "ws_status",
  "ws_priority",
  "ws_due",
]);

const RELATION_KEY_HINTS = new Set([
  "related",
  "related_to",
  "relates",
  "see_also",
  "seealso",
  "links",
  "link",
  "people",
  "person",
  "projects",
  "project",
  "parent",
  "parents",
  "child",
  "children",
  "supports",
  "supported_by",
  "depends_on",
  "dependency",
  "dependencies",
  "mentions",
  "refs",
  "references",
  "source",
  "sources",
  "next",
  "prev",
  "previous",
  "up",
  "down",
  "關係",
  "相關",
  "人物",
  "專案",
  "belongs_to",
  "belongs",
  "belong",
  "has",
  "has_notes",
  "owned_by",
  "owner",
  "屬於",
  "歸屬",
  "擁有",
  "下屬",
]);

const STATUS_FM_KEYS = new Set(["status", "state", "progress", "狀態"]);

export type NoteKnowledgeLite = {
  id: string;
  title: string;
  body_md?: string;
  tags?: string[];
  folder?: string;
  status?: string;
  source_job_id?: string;
  parent_id?: string;
  props?: Record<string, unknown>;
  created_at?: Date;
  updated_at?: Date;
};

export type PropRelation = {
  key: string;
  label: string;
  titles: string[];
};

export type ReverseRelation = {
  noteId: string;
  title: string;
  via: string;
  kind: "body" | "prop";
};

export type StructuredFrontmatter = {
  type?: string;
  /** Mapped kanban status when recognized */
  kanbanStatus?: "backlog" | "doing" | "done";
  /** Free-form status string stored on props */
  fmStatus?: string;
  /** First-class prop fields (type, relations, custom status, etc.) */
  promoted: Record<string, unknown>;
  /** Leftover unknown keys for props.frontmatter */
  extras: Record<string, unknown>;
};

function relationLabel(key: string): string {
  const map: Record<string, string> = {
    related: "相關",
    related_to: "相關",
    relates: "相關",
    see_also: "另見",
    seealso: "另見",
    links: "連結",
    link: "連結",
    people: "人物",
    person: "人物",
    projects: "專案",
    project: "專案",
    parent: "上層",
    parents: "上層",
    child: "子項",
    children: "子項",
    supports: "支持",
    supported_by: "被支持",
    depends_on: "依賴",
    dependency: "依賴",
    dependencies: "依賴",
    mentions: "提及",
    refs: "參考",
    references: "參考",
    source: "來源",
    sources: "來源",
    next: "下一則",
    prev: "上一則",
    previous: "上一則",
    up: "上層",
    down: "下層",
    belongs_to: "屬於",
    belongs: "屬於",
    belong: "屬於",
    has: "擁有",
    has_notes: "擁有筆記",
    owned_by: "歸屬",
    owner: "擁有者",
  };
  return map[key.toLowerCase()] || key;
}

export function valueHasWikiLinks(v: unknown): boolean {
  if (v == null) return false;
  if (Array.isArray(v)) return v.some((x) => valueHasWikiLinks(x));
  return /\[\[[^\]]+\]\]/.test(String(v));
}

export function wikiTitlesFromValue(v: unknown): string[] {
  if (v == null) return [];
  if (Array.isArray(v)) {
    const out: string[] = [];
    for (const item of v) {
      for (const t of wikiTitlesFromValue(item)) {
        if (!out.includes(t)) out.push(t);
      }
    }
    return out;
  }
  const s = String(v);
  const fromWiki = extractWikiLinks(s);
  if (fromWiki.length) return fromWiki;
  // Bare title list without brackets (comma / newline)
  if (/[\[\]]/.test(s)) return [];
  return s
    .split(/[,;\n]+/)
    .map((x) => x.trim())
    .filter(Boolean);
}

export function isRelationField(key: string, value: unknown): boolean {
  if (INTERNAL_NOTE_PROP_KEYS.has(key)) return false;
  if (key === TYPE_PROP || key === FM_STATUS_PROP) return false;
  if (STATUS_FM_KEYS.has(key.toLowerCase())) return false;
  if (RELATION_KEY_HINTS.has(key.toLowerCase())) return true;
  return valueHasWikiLinks(value);
}

export function mapKanbanStatus(
  raw: unknown
): "backlog" | "doing" | "done" | undefined {
  if (raw == null) return undefined;
  const s = String(raw).trim().toLowerCase();
  if (!s) return undefined;
  if (
    ["backlog", "todo", "to-do", "to_do", "pending", "open", "待辦", "未開始"].includes(s)
  ) {
    return "backlog";
  }
  if (
    ["doing", "in-progress", "in_progress", "wip", "active", "進行中", "處理中"].includes(s)
  ) {
    return "doing";
  }
  if (
    ["done", "complete", "completed", "closed", "finished", "完成", "已完成"].includes(s)
  ) {
    return "done";
  }
  return undefined;
}

/**
 * Split unknown YAML extras into Cadence first-class props + leftover FM bag.
 */
export function structureFrontmatterExtras(
  extras: Record<string, unknown>
): StructuredFrontmatter {
  const promoted: Record<string, unknown> = {};
  const rest: Record<string, unknown> = {};
  let type: string | undefined;
  let kanbanStatus: StructuredFrontmatter["kanbanStatus"];
  let fmStatus: string | undefined;

  for (const [k, v] of Object.entries(extras)) {
    const lk = k.toLowerCase();
    if (lk === "type" || lk === "note_type" || lk === "類型") {
      const t = String(v ?? "").trim();
      if (t) {
        type = t;
        promoted[TYPE_PROP] = t;
      }
      continue;
    }
    if (STATUS_FM_KEYS.has(lk)) {
      const mapped = mapKanbanStatus(v);
      if (mapped) {
        kanbanStatus = mapped;
      } else {
        const s = String(v ?? "").trim();
        if (s) {
          fmStatus = s;
          promoted[FM_STATUS_PROP] = s;
        }
      }
      continue;
    }
    if (isRelationField(k, v)) {
      promoted[k] = v;
      continue;
    }
    rest[k] = v;
  }

  return { type, kanbanStatus, fmStatus, promoted, extras: rest };
}

export function noteTypeOf(note: NoteKnowledgeLite): string {
  const ws = note.props?.ws_type;
  if (ws != null && String(ws).trim()) return String(ws).trim();
  const raw = note.props?.[TYPE_PROP];
  return raw != null ? String(raw).trim() : "";
}

export function isOrganized(note: NoteKnowledgeLite): boolean {
  const v = note.props?.[ORGANIZED_PROP];
  return v === true || v === "true" || v === 1;
}

export function extractPropRelations(
  props?: Record<string, unknown> | null
): PropRelation[] {
  if (!props) return [];
  const out: PropRelation[] = [];
  for (const [key, value] of Object.entries(props)) {
    if (!isRelationField(key, value)) continue;
    const titles = wikiTitlesFromValue(value);
    if (!titles.length) continue;
    out.push({ key, label: relationLabel(key), titles });
  }
  return out;
}

/** All outbound wiki titles from body + relation props. */
export function extractAllOutboundTitles(note: NoteKnowledgeLite): string[] {
  const out: string[] = [];
  for (const t of extractWikiLinks(note.body_md || "")) {
    if (!out.includes(t)) out.push(t);
  }
  for (const rel of extractPropRelations(note.props)) {
    for (const t of rel.titles) {
      if (!out.includes(t)) out.push(t);
    }
  }
  return out;
}

export function findReverseRelations(
  notes: NoteKnowledgeLite[],
  current: NoteKnowledgeLite
): ReverseRelation[] {
  const titles = [
    current.title.trim().toLowerCase(),
    ...(Array.isArray(current.props?.[ALIASES_PROP])
      ? (current.props![ALIASES_PROP] as unknown[]).map((a) => String(a).trim().toLowerCase())
      : []),
  ].filter(Boolean);
  if (!titles.length) return [];

  const hits: ReverseRelation[] = [];
  for (const n of notes) {
    if (n.id === current.id) continue;
    const bodyLinks = extractWikiLinks(n.body_md || "").map((x) => x.toLowerCase());
    if (titles.some((t) => bodyLinks.includes(t))) {
      hits.push({
        noteId: n.id,
        title: n.title || "未命名",
        via: "內文",
        kind: "body",
      });
      continue;
    }
    for (const rel of extractPropRelations(n.props)) {
      const linked = rel.titles.map((t) => t.toLowerCase());
      if (titles.some((t) => linked.includes(t))) {
        hits.push({
          noteId: n.id,
          title: n.title || "未命名",
          via: rel.label,
          kind: "prop",
        });
        break;
      }
    }
  }
  return hits;
}

/**
 * 待整理 heuristics: missing organization signals, not explicitly marked organized.
 * Fits voice-capture → later triage (source_job_id / empty folder / no type / no links).
 */
export function isInboxCandidate(note: NoteKnowledgeLite): boolean {
  if (isOrganized(note)) return false;
  if ((note.parent_id || "").trim()) return false;

  const folder = (note.folder || "").trim();
  const type = noteTypeOf(note);
  const tags = (note.tags || []).filter(Boolean);
  const hasBodyLinks = extractWikiLinks(note.body_md || "").length > 0;
  const hasPropRels = extractPropRelations(note.props).length > 0;
  const hasRelations = hasBodyLinks || hasPropRels;
  const fromCapture = !!(note.source_job_id || "").trim();

  // Organized enough
  if (folder && (type || tags.length > 0 || hasRelations)) return false;
  if (type && (folder || tags.length > 0 || hasRelations)) return false;

  // Needs triage
  if (!folder && !type && tags.length === 0 && !hasRelations) return true;
  if (fromCapture && !folder && !type) return true;
  return false;
}

export function listInboxNotes<T extends NoteKnowledgeLite>(notes: T[]): T[] {
  return notes
    .filter(isInboxCandidate)
    .sort((a, b) => {
      const ta = a.updated_at?.getTime?.() || 0;
      const tb = b.updated_at?.getTime?.() || 0;
      return tb - ta;
    });
}

export function withOrganizedFlag(
  props: Record<string, unknown> | undefined,
  organized: boolean
): Record<string, unknown> {
  const next = { ...(props || {}) };
  if (organized) next[ORGANIZED_PROP] = true;
  else delete next[ORGANIZED_PROP];
  return next;
}

export function withNoteType(
  props: Record<string, unknown> | undefined,
  type: string
): Record<string, unknown> {
  const next = { ...(props || {}) };
  const t = type.trim();
  if (t) next[TYPE_PROP] = t;
  else delete next[TYPE_PROP];
  return next;
}

export function withFmStatus(
  props: Record<string, unknown> | undefined,
  status: string
): Record<string, unknown> {
  const next = { ...(props || {}) };
  const s = status.trim();
  if (s) next[FM_STATUS_PROP] = s;
  else delete next[FM_STATUS_PROP];
  return next;
}

/** Serialize relation titles as `[[Title]]` list (YAML-friendly). */
export function encodeRelationTitles(titles: string[]): string[] {
  const out: string[] = [];
  for (const raw of titles) {
    const t = raw.trim().replace(/^\[\[|\]\]$/g, "").trim();
    if (!t) continue;
    const encoded = `[[${t}]]`;
    if (!out.includes(encoded)) out.push(encoded);
  }
  return out;
}

export function withRelationTitles(
  props: Record<string, unknown> | undefined,
  key: string,
  titles: string[],
  opts?: { keepEmpty?: boolean }
): Record<string, unknown> {
  const k = key.trim();
  if (!k || INTERNAL_NOTE_PROP_KEYS.has(k) || k === TYPE_PROP || k === FM_STATUS_PROP) {
    return { ...(props || {}) };
  }
  const next = { ...(props || {}) };
  const encoded = encodeRelationTitles(titles);
  if (encoded.length) next[k] = encoded.length === 1 ? encoded[0] : encoded;
  else if (opts?.keepEmpty) next[k] = [];
  else delete next[k];
  return next;
}

/** Create an empty relationship field (shows「新增」slot in UI). */
export function ensureRelationField(
  props: Record<string, unknown> | undefined,
  key: string
): Record<string, unknown> {
  const k = key.trim();
  if (!k || INTERNAL_NOTE_PROP_KEYS.has(k) || k === TYPE_PROP || k === FM_STATUS_PROP) {
    return { ...(props || {}) };
  }
  const next = { ...(props || {}) };
  if (!(k in next)) next[k] = [];
  return next;
}

export function addRelationTitle(
  props: Record<string, unknown> | undefined,
  key: string,
  title: string
): Record<string, unknown> {
  const existing = wikiTitlesFromValue(props?.[key]);
  const t = title.trim().replace(/^\[\[|\]\]$/g, "").trim();
  if (!t) return { ...(props || {}) };
  if (existing.some((x) => x.toLowerCase() === t.toLowerCase())) {
    return withRelationTitles(props, key, existing);
  }
  return withRelationTitles(props, key, [...existing, t]);
}

export function removeRelationTitle(
  props: Record<string, unknown> | undefined,
  key: string,
  title: string
): Record<string, unknown> {
  const t = title.trim().toLowerCase();
  const existing = wikiTitlesFromValue(props?.[key]).filter(
    (x) => x.trim().toLowerCase() !== t
  );
  return withRelationTitles(props, key, existing, { keepEmpty: true });
}

/** Custom scalar / text props stored in the frontmatter bag (not relations). */
export function withFrontmatterExtra(
  props: Record<string, unknown> | undefined,
  key: string,
  value: string
): Record<string, unknown> {
  const k = key.trim();
  if (!k || INTERNAL_NOTE_PROP_KEYS.has(k)) return { ...(props || {}) };
  const next = { ...(props || {}) };
  const bag =
    typeof next[FRONTMATTER_PROP] === "object" && next[FRONTMATTER_PROP]
      ? { ...(next[FRONTMATTER_PROP] as Record<string, unknown>) }
      : {};
  const v = value.trim();
  if (v) bag[k] = v;
  else delete bag[k];
  if (Object.keys(bag).length) next[FRONTMATTER_PROP] = bag;
  else delete next[FRONTMATTER_PROP];
  return next;
}

export function removeFrontmatterExtra(
  props: Record<string, unknown> | undefined,
  key: string
): Record<string, unknown> {
  return withFrontmatterExtra(props, key, "");
}

/** Remove a scalar from frontmatter bag and/or top-level props. */
export function removeScalarProp(
  props: Record<string, unknown> | undefined,
  key: string
): Record<string, unknown> {
  let next = removeFrontmatterExtra(props, key);
  if (key in next && key !== TYPE_PROP && key !== FM_STATUS_PROP && !INTERNAL_NOTE_PROP_KEYS.has(key)) {
    next = { ...next };
    delete next[key];
  }
  return next;
}

export type ScalarPropView = {
  key: string;
  label: string;
  value: string;
  source: "frontmatter" | "prop";
};

/** Non-relation custom fields for the 屬性 panel (frontmatter bag + loose strings). */
export function listScalarProps(
  props?: Record<string, unknown> | null
): ScalarPropView[] {
  if (!props) return [];
  const out: ScalarPropView[] = [];
  const seen = new Set<string>();

  const bag =
    typeof props[FRONTMATTER_PROP] === "object" && props[FRONTMATTER_PROP]
      ? (props[FRONTMATTER_PROP] as Record<string, unknown>)
      : {};
  for (const [k, v] of Object.entries(bag)) {
    const lk = k.toLowerCase();
    if (["created", "updated", "date", "organized"].includes(lk)) continue;
    if (STATUS_FM_KEYS.has(lk)) continue;
    if (isRelationField(k, v)) continue;
    const s = Array.isArray(v) ? v.map(String).join(", ") : String(v ?? "").trim();
    if (!s) continue;
    seen.add(k.toLowerCase());
    out.push({ key: k, label: k, value: s, source: "frontmatter" });
  }

  for (const [k, v] of Object.entries(props)) {
    if (INTERNAL_NOTE_PROP_KEYS.has(k)) continue;
    if (k === TYPE_PROP || k === FM_STATUS_PROP) continue;
    if (isRelationField(k, v)) continue;
    if (seen.has(k.toLowerCase())) continue;
    if (typeof v === "object" && v != null && !Array.isArray(v)) continue;
    const s = Array.isArray(v) ? v.map(String).join(", ") : String(v ?? "").trim();
    if (!s) continue;
    out.push({ key: k, label: k, value: s, source: "prop" });
  }
  return out;
}

export type DatePill = {
  key: string;
  label: string;
  text: string;
  /** System timestamps (created/updated) vs frontmatter date */
  kind?: "system" | "frontmatter";
};

function formatDateOnly(raw: unknown): string | null {
  if (raw == null || raw === "") return null;
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) {
    return raw.toLocaleDateString("zh-TW", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  }
  if (typeof raw === "object" && raw && "toDate" in raw && typeof (raw as { toDate: () => Date }).toDate === "function") {
    try {
      return formatDateOnly((raw as { toDate: () => Date }).toDate());
    } catch {
      /* fall through */
    }
  }
  const s = String(raw).trim();
  if (!s) return null;
  const d = new Date(s);
  if (!Number.isNaN(d.getTime()) && /^\d{4}/.test(s)) {
    return d.toLocaleDateString("zh-TW", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  }
  return s;
}

/** Full date+time for 建立／修改屬性列. */
function formatDateTime(raw: unknown): string | null {
  if (raw == null || raw === "") return null;
  let d: Date | null = null;
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) d = raw;
  else if (
    typeof raw === "object" &&
    raw &&
    "toDate" in raw &&
    typeof (raw as { toDate: () => Date }).toDate === "function"
  ) {
    try {
      d = (raw as { toDate: () => Date }).toDate();
    } catch {
      d = null;
    }
  } else {
    const s = String(raw).trim();
    if (!s) return null;
    const parsed = new Date(s);
    if (!Number.isNaN(parsed.getTime())) d = parsed;
  }
  if (!d || Number.isNaN(d.getTime())) return null;
  return d.toLocaleString("zh-TW", {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Key dates for properties: FM date + note created/updated (system). */
export function listNoteDatePills(note: NoteKnowledgeLite): DatePill[] {
  const out: DatePill[] = [];
  const bag =
    note.props &&
    typeof note.props[FRONTMATTER_PROP] === "object" &&
    note.props[FRONTMATTER_PROP]
      ? (note.props[FRONTMATTER_PROP] as Record<string, unknown>)
      : {};
  const fmDate = formatDateOnly(bag.date ?? bag.Date);
  if (fmDate) out.push({ key: "fm-date", label: "日期", text: fmDate, kind: "frontmatter" });
  if (note.created_at) {
    const t = formatDateTime(note.created_at);
    if (t) out.push({ key: "created", label: "建立時間", text: t, kind: "system" });
  }
  if (note.updated_at) {
    const t = formatDateTime(note.updated_at);
    if (t) out.push({ key: "updated", label: "修改時間", text: t, kind: "system" });
  }
  return out;
}

/** Relation rows including empty slots (key present but no titles yet). */
export function listPropRelationFields(
  props?: Record<string, unknown> | null
): PropRelation[] {
  if (!props) return [];
  const out: PropRelation[] = [];
  for (const [key, value] of Object.entries(props)) {
    if (INTERNAL_NOTE_PROP_KEYS.has(key)) continue;
    if (key === TYPE_PROP || key === FM_STATUS_PROP) continue;
    if (STATUS_FM_KEYS.has(key.toLowerCase())) continue;

    const titles = wikiTitlesFromValue(value);
    const emptySlot =
      (Array.isArray(value) && value.length === 0) ||
      value === "" ||
      value == null;
    if (emptySlot) {
      // Empty array marks a user-created relationship field; hint keys also count.
      if (Array.isArray(value) || RELATION_KEY_HINTS.has(key.toLowerCase())) {
        out.push({ key, label: relationLabel(key), titles: [] });
      }
      continue;
    }
    if (!isRelationField(key, value)) continue;
    out.push({ key, label: relationLabel(key), titles });
  }
  return out;
}

/** Stable teal/slate tone index for relationship chip color (0–5). */
export function relationToneIndex(key: string): number {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return h % 6;
}

/** Merge first-class props into YAML extras for export round-trip. */
export function frontmatterExtrasFromProps(
  props?: Record<string, unknown> | null
): Record<string, unknown> {
  if (!props) return {};
  const bag =
    typeof props[FRONTMATTER_PROP] === "object" && props[FRONTMATTER_PROP]
      ? { ...(props[FRONTMATTER_PROP] as Record<string, unknown>) }
      : {};
  // Prefer workspace catalog fields for YAML round-trip
  const wsType = props.ws_type ?? props[TYPE_PROP];
  if (wsType != null && String(wsType).trim()) bag.type = String(wsType).trim();
  const wsStatus = props.ws_status ?? props[FM_STATUS_PROP];
  if (wsStatus != null && String(wsStatus).trim()) bag.status = String(wsStatus).trim();
  if (props.ws_priority != null && String(props.ws_priority).trim()) {
    bag.priority = String(props.ws_priority).trim();
  }
  if (props.ws_due != null && String(props.ws_due).trim()) {
    bag.due = String(props.ws_due).trim().slice(0, 10);
  }
  if (props[ORGANIZED_PROP] === true || props[ORGANIZED_PROP] === "true") {
    bag.organized = true;
  }
  for (const rel of extractPropRelations(props)) {
    bag[rel.key] = props[rel.key];
  }
  return bag;
}

export function groupNotesByType<T extends NoteKnowledgeLite>(
  notes: T[]
): { type: string; notes: T[] }[] {
  const map = new Map<string, T[]>();
  for (const n of notes) {
    const t = noteTypeOf(n) || "未分類類型";
    if (!map.has(t)) map.set(t, []);
    map.get(t)!.push(n);
  }
  return Array.from(map.entries())
    .map(([type, list]) => ({ type, notes: list }))
    .sort((a, b) => b.notes.length - a.notes.length || a.type.localeCompare(b.type, "zh-Hant"));
}
