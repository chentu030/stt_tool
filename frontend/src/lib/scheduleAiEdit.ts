/** Parse / emit structured schedule edits from the global AI rail. */

import {
  clampMin,
  createScheduleEvent,
  deleteScheduleEvent,
  formatClock,
  updateScheduleEvent,
  type ScheduleEvent,
  type ScheduleEventInput,
  type ScheduleProvider,
} from "@/lib/scheduleEvents";
import { shiftDateKey } from "@/lib/journalMeta";

export type ScheduleAiEventSnap = {
  id: string;
  dateKey: string;
  title: string;
  startMin: number;
  endMin: number;
  allDay?: boolean;
  description?: string;
  remindMinutesBefore?: number | null;
  provider: ScheduleProvider;
};

export type ScheduleAiLiveSnapshot = {
  selectedDate: string;
  rangeStart: string;
  rangeEnd: string;
  events: ScheduleAiEventSnap[];
  updatedAt: number;
};

export type ScheduleAiAddOp = {
  op: "add";
  title: string;
  dateKey: string;
  startMin: number;
  endMin: number;
  allDay?: boolean;
  description?: string;
  remindMinutesBefore?: number | null;
};

export type ScheduleAiUpdateOp = {
  op: "update";
  id: string;
  title?: string;
  dateKey?: string;
  startMin?: number;
  endMin?: number;
  allDay?: boolean;
  description?: string | null;
  remindMinutesBefore?: number | null;
};

export type ScheduleAiDeleteOp = {
  op: "delete";
  id: string;
};

export type ScheduleAiOp = ScheduleAiAddOp | ScheduleAiUpdateOp | ScheduleAiDeleteOp;

export type ScheduleAiEdit = {
  ops: ScheduleAiOp[];
};

export const SCHEDULE_AI_LIVE_EVENT = "albireus:schedule-live";

let liveSnap: ScheduleAiLiveSnapshot | null = null;

export function publishScheduleLiveSnapshot(snap: ScheduleAiLiveSnapshot) {
  liveSnap = { ...snap, updatedAt: Date.now() };
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(SCHEDULE_AI_LIVE_EVENT));
  }
}

export function clearScheduleLiveSnapshot() {
  liveSnap = null;
}

export function readScheduleLiveSnapshot(): ScheduleAiLiveSnapshot | null {
  if (!liveSnap) return null;
  if (Date.now() - liveSnap.updatedAt > 120_000) return null;
  return liveSnap;
}

export function buildScheduleLiveSnapshot(
  selectedDate: string,
  events: ScheduleEvent[],
  rangeDays = 14
): ScheduleAiLiveSnapshot {
  const rangeStart = shiftDateKey(selectedDate, -rangeDays) || selectedDate;
  const rangeEnd = shiftDateKey(selectedDate, rangeDays) || selectedDate;
  const packed: ScheduleAiEventSnap[] = events
    .filter((e) => e.dateKey >= rangeStart && e.dateKey <= rangeEnd)
    .slice(0, 200)
    .map((e) => ({
      id: e.id,
      dateKey: e.dateKey,
      title: e.title || "未命名",
      startMin: e.startMin,
      endMin: e.endMin,
      allDay: e.allDay,
      description: e.description,
      remindMinutesBefore: e.remindMinutesBefore ?? null,
      provider: e.provider,
    }));
  packed.sort(
    (a, b) =>
      a.dateKey.localeCompare(b.dateKey) ||
      a.startMin - b.startMin ||
      a.title.localeCompare(b.title, "zh-Hant")
  );
  return {
    selectedDate,
    rangeStart,
    rangeEnd,
    events: packed,
    updatedAt: Date.now(),
  };
}

export function packScheduleContextForAi(snap: ScheduleAiLiveSnapshot, maxChars = 12000): string {
  const header =
    `—— 目前日誌行程（可編輯目標）——\n` +
    `選取日：${snap.selectedDate}\n` +
    `範圍：${snap.rangeStart} ～ ${snap.rangeEnd}\n` +
    `時間單位：startMin／endMin 為當日 0 起算的分鐘（例 09:30 = 570）；也可用 "HH:MM"。\n` +
    `provider=local 可增刪改；provider=google 為唯讀同步，不可改。\n` +
    `行程（共 ${snap.events.length} 筆）：\n`;

  const lines: string[] = [];
  let used = header.length;
  for (const e of snap.events) {
    const clock = e.allDay
      ? "全天"
      : `${formatClock(e.startMin)}–${formatClock(e.endMin)}`;
    const remind =
      e.remindMinutesBefore == null ? "" : ` | 提醒=${e.remindMinutesBefore}分前`;
    const desc = e.description
      ? ` | 備註=${e.description.length > 60 ? `${e.description.slice(0, 57)}…` : e.description}`
      : "";
    const line = `• id=${e.id} | ${e.dateKey} | ${clock} | ${e.title} | ${e.provider}${remind}${desc}`;
    if (used + line.length + 24 > maxChars) {
      lines.push("…（其餘行程省略）");
      break;
    }
    lines.push(line);
    used += line.length + 1;
  }
  if (!lines.length) lines.push("（此範圍尚無行程）");
  return `${header}${lines.join("\n")}\n—— 結束 ——`;
}

/** Heuristic: user clearly asked to change schedule / calendar events. */
export function userAskedToEditSchedule(prompt: string): boolean {
  const t = prompt.trim();
  if (!t) return false;
  return /行程|排程|日曆|提醒|會議|約會|安排|改時間|調時間|延後|提前|新增.*事|刪掉.*會|刪除.*程|取消.*會|加一場|幫我排|空檔|衝突/.test(
    t
  );
}

const FENCE_RE = /```albireus-schedule-edit\s*\n([\s\S]*?)```/i;

export function parseScheduleAiEdit(raw: string): {
  edit: ScheduleAiEdit | null;
  displayText: string;
} {
  const m = raw.match(FENCE_RE);
  if (!m) return { edit: null, displayText: raw };

  const block = m[1].trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(block);
  } catch {
    const jsonStart = block.indexOf("{");
    if (jsonStart < 0) return { edit: null, displayText: raw };
    try {
      parsed = JSON.parse(block.slice(jsonStart));
    } catch {
      return { edit: null, displayText: raw };
    }
  }

  const obj = parsed as Record<string, unknown>;
  const opsRaw = Array.isArray(obj.ops) ? obj.ops : [];
  const ops = opsRaw
    .map((x) => normalizeOp(x))
    .filter((x): x is ScheduleAiOp => x != null)
    .slice(0, 40);

  if (ops.length === 0) {
    return { edit: null, displayText: raw };
  }

  const displayText = raw.replace(FENCE_RE, "").trim();
  return {
    edit: { ops },
    displayText: displayText || `已準備套用 ${ops.length} 項行程修改。`,
  };
}

function parseClockOrMin(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return clampMin(v);
  const s = String(v ?? "").trim();
  if (!s) return null;
  if (/^\d+$/.test(s)) return clampMin(Number(s));
  const m = s.match(/^(\d{1,2})[:：](\d{2})$/);
  if (m) return clampMin(Number(m[1]) * 60 + Number(m[2]));
  return null;
}

function parseDateKey(v: unknown): string | null {
  const s = String(v ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  return s;
}

function normalizeOp(raw: unknown): ScheduleAiOp | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const op = String(o.op || "").trim();

  if (op === "add") {
    const title = String(o.title || "").trim() || "未命名";
    const dateKey = parseDateKey(o.dateKey || o.date || o.day);
    if (!dateKey) return null;
    const allDay = o.allDay === true || o.all_day === true;
    let startMin = parseClockOrMin(o.startMin ?? o.start ?? o.start_min);
    let endMin = parseClockOrMin(o.endMin ?? o.end ?? o.end_min);
    if (allDay) {
      startMin = 0;
      endMin = 24 * 60;
    }
    if (startMin == null || endMin == null) return null;
    if (endMin <= startMin) endMin = Math.min(24 * 60, startMin + 60);
    const description =
      o.description != null || o.note != null
        ? String(o.description ?? o.note ?? "").trim() || undefined
        : undefined;
    let remindMinutesBefore: number | null | undefined;
    if (o.remindMinutesBefore !== undefined || o.remind != null) {
      const r = o.remindMinutesBefore ?? o.remind;
      if (r === null || r === "" || r === "off" || r === "none") remindMinutesBefore = null;
      else {
        const n = Number(r);
        remindMinutesBefore = Number.isFinite(n) ? Math.max(0, Math.round(n)) : null;
      }
    }
    return {
      op: "add",
      title: title.slice(0, 200),
      dateKey,
      startMin,
      endMin,
      allDay,
      description,
      remindMinutesBefore,
    };
  }

  if (op === "update") {
    const id = String(o.id || o.event_id || o.eventId || "").trim();
    if (!id) return null;
    const patch: ScheduleAiUpdateOp = { op: "update", id };
    if (o.title != null) patch.title = String(o.title).trim().slice(0, 200) || "未命名";
    const dk = parseDateKey(o.dateKey || o.date || o.day);
    if (dk) patch.dateKey = dk;
    const sm = parseClockOrMin(o.startMin ?? o.start ?? o.start_min);
    if (sm != null) patch.startMin = sm;
    const em = parseClockOrMin(o.endMin ?? o.end ?? o.end_min);
    if (em != null) patch.endMin = em;
    if (o.allDay === true || o.all_day === true) {
      patch.allDay = true;
      patch.startMin = 0;
      patch.endMin = 24 * 60;
    } else if (o.allDay === false || o.all_day === false) {
      patch.allDay = false;
    }
    if (o.description !== undefined || o.note !== undefined) {
      const d = o.description ?? o.note;
      patch.description = d == null || d === "" ? null : String(d).trim();
    }
    if (o.remindMinutesBefore !== undefined || o.remind !== undefined) {
      const r = o.remindMinutesBefore ?? o.remind;
      if (r === null || r === "" || r === "off" || r === "none") patch.remindMinutesBefore = null;
      else {
        const n = Number(r);
        patch.remindMinutesBefore = Number.isFinite(n) ? Math.max(0, Math.round(n)) : null;
      }
    }
    const hasField =
      patch.title != null ||
      patch.dateKey != null ||
      patch.startMin != null ||
      patch.endMin != null ||
      patch.allDay != null ||
      patch.description !== undefined ||
      patch.remindMinutesBefore !== undefined;
    return hasField ? patch : null;
  }

  if (op === "delete") {
    const id = String(o.id || o.event_id || o.eventId || "").trim();
    if (!id) return null;
    return { op: "delete", id };
  }

  return null;
}

export type ApplyScheduleAiEditResult = {
  ok: number;
  failed: number;
  skipped: number;
  messages: string[];
};

export async function applyScheduleAiEdit(
  uid: string,
  edit: ScheduleAiEdit,
  events: ScheduleEvent[]
): Promise<ApplyScheduleAiEditResult> {
  let ok = 0;
  let failed = 0;
  let skipped = 0;
  const messages: string[] = [];
  const byId = new Map(events.map((e) => [e.id, e]));

  for (const op of edit.ops) {
    try {
      if (op.op === "add") {
        const input: ScheduleEventInput = {
          dateKey: op.dateKey,
          startMin: op.startMin,
          endMin: op.endMin,
          allDay: op.allDay,
          title: op.title,
          description: op.description ?? null,
          remindMinutesBefore: op.remindMinutesBefore ?? null,
          provider: "local",
        };
        const id = await createScheduleEvent(uid, input);
        messages.push(`已新增「${op.title}」（${op.dateKey}）`);
        byId.set(id, {
          id,
          dateKey: op.dateKey,
          startMin: op.startMin,
          endMin: op.endMin,
          allDay: op.allDay,
          title: op.title,
          description: op.description,
          remindMinutesBefore: op.remindMinutesBefore ?? null,
          provider: "local",
        });
        ok++;
        continue;
      }

      if (op.op === "update") {
        const existing = byId.get(op.id);
        if (!existing) {
          skipped++;
          messages.push(`略過更新：找不到 id=${op.id}`);
          continue;
        }
        if (existing.provider !== "local") {
          skipped++;
          messages.push(`略過更新「${existing.title}」：Google 同步行程唯讀`);
          continue;
        }
        const patch: Partial<ScheduleEventInput> = {};
        if (op.title != null) patch.title = op.title;
        if (op.dateKey != null) patch.dateKey = op.dateKey;
        if (op.startMin != null) patch.startMin = op.startMin;
        if (op.endMin != null) patch.endMin = op.endMin;
        if (op.allDay != null) patch.allDay = op.allDay;
        if (op.description !== undefined) patch.description = op.description;
        if (op.remindMinutesBefore !== undefined) {
          patch.remindMinutesBefore = op.remindMinutesBefore;
        }
        await updateScheduleEvent(uid, op.id, patch);
        byId.set(op.id, {
          ...existing,
          id: op.id,
          provider: "local",
          title: patch.title ?? existing.title,
          dateKey: patch.dateKey ?? existing.dateKey,
          startMin: patch.startMin ?? existing.startMin,
          endMin: patch.endMin ?? existing.endMin,
          allDay: patch.allDay ?? existing.allDay,
          description:
            patch.description === null
              ? undefined
              : patch.description !== undefined
                ? patch.description
                : existing.description,
          remindMinutesBefore:
            patch.remindMinutesBefore !== undefined
              ? patch.remindMinutesBefore
              : existing.remindMinutesBefore,
        });
        messages.push(`已更新「${op.title ?? existing.title}」`);
        ok++;
        continue;
      }

      if (op.op === "delete") {
        const existing = byId.get(op.id);
        if (!existing) {
          skipped++;
          messages.push(`略過刪除：找不到 id=${op.id}`);
          continue;
        }
        if (existing.provider !== "local") {
          skipped++;
          messages.push(`略過刪除「${existing.title}」：Google 同步行程唯讀`);
          continue;
        }
        await deleteScheduleEvent(uid, op.id);
        byId.delete(op.id);
        messages.push(`已刪除「${existing.title}」`);
        ok++;
      }
    } catch (e) {
      failed++;
      messages.push(e instanceof Error ? e.message : String(e));
    }
  }

  return { ok, failed, skipped, messages };
}

export const SCHEDULE_EDIT_SYSTEM_RULES = `
當使用者明確要求新增／修改／刪除／調整「日誌行程／排程／會議時間」時，除了簡短說明外，必須另外輸出一個可被套用的 JSON 編輯區塊（只在有改行程意圖時才輸出）：
\`\`\`albireus-schedule-edit
{
  "ops": [
    {"op":"add","title":"會議","dateKey":"2026-07-24","startMin":570,"endMin":630,"allDay":false,"description":"可選備註","remindMinutesBefore":15},
    {"op":"update","id":"既有行程id","startMin":"14:00","endMin":"15:00","title":"可選新標題"},
    {"op":"delete","id":"既有行程id"}
  ]
}
\`\`\`
規則：
- dateKey 用 YYYY-MM-DD；startMin／endMin 用當日分鐘數或 "HH:MM"。
- update／delete 的 id 必須來自脈絡中 provider=local 的行程；不可改 google 行程。
- 新建預設不重複（不要輸出 recurrence）。
- 一次最多 40 個 ops；只改使用者要求的範圍。
- 不要輸出筆記或資料庫編輯區塊。
- 使用者只是提問、討論而未要求改行程時，不要輸出編輯區塊。
- 編輯區塊以外用繁體中文說明你改了什麼；實際寫入需使用者按下「套用到行程」。
`.trim();
