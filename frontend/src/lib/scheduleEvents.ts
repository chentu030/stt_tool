/**
 * Timed schedule events for Journal day timeline (local + synced Google overlays).
 */

import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  updateDoc,
  where,
  writeBatch,
  type Unsubscribe,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { dateKeyFromDate, parseDateKey, shiftDateKey } from "@/lib/journalMeta";

export type ScheduleProvider = "local" | "google";

export type ScheduleRecurrenceFreq = "daily" | "weekly" | "monthly";

/** Google Calendar–style end: after N occurrences, or until a date. */
export type ScheduleRecurrence = {
  freq: ScheduleRecurrenceFreq;
  /** Every N days / weeks / months (min 1). */
  interval: number;
  endType: "count" | "until";
  /** Including the first occurrence (2–100). */
  count?: number;
  untilDateKey?: string;
};

export type ScheduleEvent = {
  id: string;
  dateKey: string;
  startMin: number;
  endMin: number;
  allDay?: boolean;
  title: string;
  conferenceUrl?: string;
  /** Optional calendar description (e.g. Google) for pre-meeting brief */
  description?: string;
  provider: ScheduleProvider;
  externalId?: string;
  noteId?: string;
  /** Shared id for materialized recurring instances. */
  seriesId?: string;
  recurrence?: ScheduleRecurrence | null;
  /**
   * Minutes before start to notify.
   * null/undefined = off; 0 = at start; common: 5, 15, 30, 60, 1440.
   */
  remindMinutesBefore?: number | null;
  updated_at?: Date;
};

export type ScheduleEventInput = {
  dateKey: string;
  startMin: number;
  endMin: number;
  allDay?: boolean;
  title: string;
  conferenceUrl?: string;
  provider?: ScheduleProvider;
  externalId?: string;
  noteId?: string;
  seriesId?: string | null;
  recurrence?: ScheduleRecurrence | null;
  remindMinutesBefore?: number | null;
};

export type SeriesDeleteScope = "one" | "following" | "all";
export type SeriesEditScope = "one" | "all";

const MAX_RECURRENCE = 100;

function eventsCol(uid: string) {
  return collection(db, "users", uid, "schedule_events");
}

export function clampMin(n: number) {
  return Math.max(0, Math.min(24 * 60, Math.round(n)));
}

export function snapMin(n: number, step = 15) {
  return clampMin(Math.round(n / step) * step);
}

export function formatClock(min: number) {
  const m = clampMin(min);
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${String(h).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

/** Extract Meet / Teams / Zoom join URL from free text. */
export function extractConferenceUrl(text: string): string | undefined {
  const s = text || "";
  const patterns = [
    /https?:\/\/meet\.google\.com\/[a-z0-9-]+/i,
    /https?:\/\/teams\.microsoft\.com\/l\/meetup-join\/[^\s<>"']+/i,
    /https?:\/\/[a-z0-9.-]*zoom\.us\/j\/[^\s<>"']+/i,
  ];
  for (const re of patterns) {
    const m = s.match(re);
    if (m?.[0]) return m[0].replace(/[),.;]+$/, "");
  }
  return undefined;
}

function normalizeRecurrence(
  rec: ScheduleRecurrence | null | undefined
): ScheduleRecurrence | null {
  if (!rec) return null;
  const interval = Math.max(1, Math.min(30, Math.round(rec.interval || 1)));
  const freq = rec.freq === "weekly" || rec.freq === "monthly" ? rec.freq : "daily";
  if (rec.endType === "until") {
    const until = String(rec.untilDateKey || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(until)) return null;
    return { freq, interval, endType: "until", untilDateKey: until };
  }
  const count = Math.max(2, Math.min(MAX_RECURRENCE, Math.round(rec.count || 2)));
  return { freq, interval, endType: "count", count };
}

function nextDateKey(dateKey: string, freq: ScheduleRecurrenceFreq, interval: number): string {
  if (freq === "daily") return shiftDateKey(dateKey, interval);
  if (freq === "weekly") return shiftDateKey(dateKey, 7 * interval);
  const d = parseDateKey(dateKey);
  if (!d) return shiftDateKey(dateKey, 30 * interval);
  const day = d.getDate();
  const next = new Date(d.getFullYear(), d.getMonth() + interval, 1);
  const last = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate();
  next.setDate(Math.min(day, last));
  return dateKeyFromDate(next);
}

/** Date keys for a recurrence series (includes the start day). */
export function expandRecurrenceDateKeys(
  startDateKey: string,
  rec: ScheduleRecurrence
): string[] {
  const norm = normalizeRecurrence(rec);
  if (!norm) return [startDateKey];
  const keys = [startDateKey];
  let cur = startDateKey;
  const limit =
    norm.endType === "count"
      ? Math.min(MAX_RECURRENCE, norm.count || 2)
      : MAX_RECURRENCE;
  while (keys.length < limit) {
    cur = nextDateKey(cur, norm.freq, norm.interval);
    if (norm.endType === "until" && norm.untilDateKey && cur > norm.untilDateKey) break;
    keys.push(cur);
  }
  return keys;
}

function mapRecurrence(raw: unknown): ScheduleRecurrence | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  return normalizeRecurrence({
    freq: o.freq as ScheduleRecurrenceFreq,
    interval: Number(o.interval) || 1,
    endType: o.endType === "until" ? "until" : "count",
    count: o.count != null ? Number(o.count) : undefined,
    untilDateKey: o.untilDateKey ? String(o.untilDateKey) : undefined,
  });
}

function mapDoc(id: string, data: Record<string, unknown>): ScheduleEvent {
  const remindRaw = data.remindMinutesBefore;
  const remindMinutesBefore =
    remindRaw === null || remindRaw === undefined
      ? null
      : Number.isFinite(Number(remindRaw))
        ? Number(remindRaw)
        : null;
  return {
    id,
    dateKey: String(data.dateKey || ""),
    startMin: Number(data.startMin) || 0,
    endMin: Number(data.endMin) || 0,
    allDay: Boolean(data.allDay),
    title: String(data.title || "未命名"),
    conferenceUrl: data.conferenceUrl ? String(data.conferenceUrl) : undefined,
    description: data.description ? String(data.description) : undefined,
    provider: (data.provider as ScheduleProvider) || "local",
    externalId: data.externalId ? String(data.externalId) : undefined,
    noteId: data.noteId ? String(data.noteId) : undefined,
    seriesId: data.seriesId ? String(data.seriesId) : undefined,
    recurrence: mapRecurrence(data.recurrence),
    remindMinutesBefore,
    updated_at:
      data.updated_at &&
      typeof data.updated_at === "object" &&
      "toDate" in (data.updated_at as object)
        ? (data.updated_at as { toDate: () => Date }).toDate()
        : undefined,
  };
}

function payloadFromInput(input: ScheduleEventInput, seriesId?: string | null) {
  const startMin = input.allDay ? 0 : snapMin(input.startMin);
  let endMin = input.allDay ? 24 * 60 : snapMin(input.endMin);
  if (!input.allDay && endMin <= startMin) endMin = Math.min(24 * 60, startMin + 30);
  const recurrence = normalizeRecurrence(input.recurrence ?? null);
  const remind =
    input.remindMinutesBefore === undefined
      ? undefined
      : input.remindMinutesBefore === null
        ? null
        : Math.max(0, Math.round(Number(input.remindMinutesBefore)));
  return {
    dateKey: input.dateKey,
    startMin,
    endMin,
    allDay: Boolean(input.allDay),
    title: (input.title || "未命名").trim() || "未命名",
    conferenceUrl: input.conferenceUrl || null,
    provider: input.provider || "local",
    externalId: input.externalId || null,
    noteId: input.noteId || null,
    seriesId: seriesId === undefined ? input.seriesId || null : seriesId,
    recurrence,
    remindMinutesBefore: remind === undefined ? null : remind,
    updated_at: serverTimestamp(),
  };
}

export function listenScheduleEvents(
  uid: string,
  dateKey: string,
  onData: (events: ScheduleEvent[]) => void,
  onError?: (e: Error) => void
): Unsubscribe {
  const q = query(eventsCol(uid), where("dateKey", "==", dateKey));
  return onSnapshot(
    q,
    (snap) => {
      const rows = snap.docs
        .map((d) => mapDoc(d.id, d.data() as Record<string, unknown>))
        .sort((a, b) => a.startMin - b.startMin || a.title.localeCompare(b.title));
      onData(rows);
    },
    (err) => onError?.(err as Error)
  );
}

/** Merge live listeners across multiple dateKeys (e.g. week view). */
export function listenScheduleEventsForDates(
  uid: string,
  dateKeys: string[],
  onData: (events: ScheduleEvent[]) => void,
  onError?: (e: Error) => void
): Unsubscribe {
  const byDate = new Map<string, ScheduleEvent[]>();
  const keys = [...new Set(dateKeys.filter(Boolean))];
  const emit = () => {
    const rows = keys.flatMap((k) => byDate.get(k) || []);
    rows.sort(
      (a, b) =>
        a.dateKey.localeCompare(b.dateKey) ||
        a.startMin - b.startMin ||
        a.title.localeCompare(b.title)
    );
    onData(rows);
  };
  const unsubs = keys.map((dk) =>
    listenScheduleEvents(
      uid,
      dk,
      (rows) => {
        byDate.set(dk, rows);
        emit();
      },
      onError
    )
  );
  if (!keys.length) onData([]);
  return () => unsubs.forEach((u) => u());
}

export async function listSeriesEvents(
  uid: string,
  seriesId: string
): Promise<ScheduleEvent[]> {
  const q = query(eventsCol(uid), where("seriesId", "==", seriesId));
  const snap = await getDocs(q);
  return snap.docs
    .map((d) => mapDoc(d.id, d.data() as Record<string, unknown>))
    .sort((a, b) => a.dateKey.localeCompare(b.dateKey) || a.startMin - b.startMin);
}

/** Create one event, or a materialized recurring series. Returns the first event id. */
export async function createScheduleEvent(uid: string, input: ScheduleEventInput) {
  const recurrence = normalizeRecurrence(input.recurrence ?? null);
  if (!recurrence) {
    const ref = await addDoc(eventsCol(uid), payloadFromInput({ ...input, recurrence: null }));
    return ref.id;
  }

  const dateKeys = expandRecurrenceDateKeys(input.dateKey, recurrence);
  const seriesId = crypto.randomUUID();
  const batch = writeBatch(db);
  let firstId = "";
  for (let i = 0; i < dateKeys.length; i++) {
    const ref = doc(eventsCol(uid));
    if (i === 0) firstId = ref.id;
    batch.set(
      ref,
      payloadFromInput(
        {
          ...input,
          dateKey: dateKeys[i],
          recurrence: i === 0 ? recurrence : recurrence,
        },
        seriesId
      )
    );
  }
  await batch.commit();
  return firstId;
}

export async function updateScheduleEvent(
  uid: string,
  eventId: string,
  patch: Partial<ScheduleEventInput>
) {
  const data: Record<string, unknown> = { updated_at: serverTimestamp() };
  if (patch.dateKey != null) data.dateKey = patch.dateKey;
  if (patch.startMin != null) data.startMin = snapMin(patch.startMin);
  if (patch.endMin != null) data.endMin = snapMin(patch.endMin);
  if (patch.allDay != null) data.allDay = patch.allDay;
  if (patch.title != null) data.title = patch.title.trim() || "未命名";
  if (patch.conferenceUrl !== undefined) data.conferenceUrl = patch.conferenceUrl || null;
  if (patch.noteId !== undefined) data.noteId = patch.noteId || null;
  if (patch.provider != null) data.provider = patch.provider;
  if (patch.externalId !== undefined) data.externalId = patch.externalId || null;
  if (patch.seriesId !== undefined) data.seriesId = patch.seriesId || null;
  if (patch.recurrence !== undefined) data.recurrence = normalizeRecurrence(patch.recurrence);
  if (patch.remindMinutesBefore !== undefined) {
    data.remindMinutesBefore =
      patch.remindMinutesBefore === null
        ? null
        : Math.max(0, Math.round(Number(patch.remindMinutesBefore)));
  }
  await updateDoc(doc(eventsCol(uid), eventId), data);
}

/**
 * Save edits for a local event. When part of a series, `scope` controls whether
 * only this instance or the whole series is updated (shared fields).
 */
export async function updateScheduleEventScoped(
  uid: string,
  event: ScheduleEvent,
  patch: Partial<ScheduleEventInput>,
  scope: SeriesEditScope = "one"
) {
  if (!event.seriesId || scope === "one") {
    // Turning a single into a series: rebuild via create after delete? Keep simple —
    // if recurrence newly set on a non-series event, create remaining instances.
    const nextRec = patch.recurrence !== undefined ? normalizeRecurrence(patch.recurrence) : event.recurrence;
    const becomingSeries = !event.seriesId && nextRec;
    if (becomingSeries && nextRec) {
      const merged: ScheduleEventInput = {
        dateKey: patch.dateKey ?? event.dateKey,
        startMin: patch.startMin ?? event.startMin,
        endMin: patch.endMin ?? event.endMin,
        allDay: patch.allDay ?? event.allDay,
        title: patch.title ?? event.title,
        conferenceUrl:
          patch.conferenceUrl !== undefined ? patch.conferenceUrl : event.conferenceUrl,
        remindMinutesBefore:
          patch.remindMinutesBefore !== undefined
            ? patch.remindMinutesBefore
            : event.remindMinutesBefore ?? null,
        recurrence: nextRec,
        provider: "local",
      };
      await deleteScheduleEvent(uid, event.id);
      return createScheduleEvent(uid, merged);
    }
    await updateScheduleEvent(uid, event.id, patch);
    return event.id;
  }

  const siblings = await listSeriesEvents(uid, event.seriesId);
  const shared: Partial<ScheduleEventInput> = {
    title: patch.title,
    startMin: patch.startMin,
    endMin: patch.endMin,
    allDay: patch.allDay,
    conferenceUrl: patch.conferenceUrl,
    remindMinutesBefore: patch.remindMinutesBefore,
    recurrence: patch.recurrence,
  };
  // Drop undefined keys so we don't wipe fields.
  const clean = Object.fromEntries(
    Object.entries(shared).filter(([, v]) => v !== undefined)
  ) as Partial<ScheduleEventInput>;

  const batch = writeBatch(db);
  for (const s of siblings) {
    const data: Record<string, unknown> = { updated_at: serverTimestamp() };
    if (clean.title != null) data.title = clean.title.trim() || "未命名";
    if (clean.startMin != null) data.startMin = s.allDay || clean.allDay ? 0 : snapMin(clean.startMin);
    if (clean.endMin != null)
      data.endMin = s.allDay || clean.allDay ? 24 * 60 : snapMin(clean.endMin);
    if (clean.allDay != null) {
      data.allDay = clean.allDay;
      if (clean.allDay) {
        data.startMin = 0;
        data.endMin = 24 * 60;
      }
    }
    if (clean.conferenceUrl !== undefined) data.conferenceUrl = clean.conferenceUrl || null;
    if (clean.remindMinutesBefore !== undefined) {
      data.remindMinutesBefore =
        clean.remindMinutesBefore === null
          ? null
          : Math.max(0, Math.round(Number(clean.remindMinutesBefore)));
    }
    if (clean.recurrence !== undefined) data.recurrence = normalizeRecurrence(clean.recurrence);
    // dateKey change only applies to "one"
    batch.update(doc(eventsCol(uid), s.id), data);
  }
  await batch.commit();
  return event.id;
}

export async function deleteScheduleEvent(uid: string, eventId: string) {
  await deleteDoc(doc(eventsCol(uid), eventId));
}

export async function deleteScheduleEventScoped(
  uid: string,
  event: ScheduleEvent,
  scope: SeriesDeleteScope = "one"
) {
  if (!event.seriesId || scope === "one") {
    await deleteScheduleEvent(uid, event.id);
    return;
  }
  const siblings = await listSeriesEvents(uid, event.seriesId);
  const targets =
    scope === "all"
      ? siblings
      : siblings.filter((s) => s.dateKey >= event.dateKey);
  const batch = writeBatch(db);
  for (const s of targets) {
    batch.delete(doc(eventsCol(uid), s.id));
  }
  await batch.commit();
}

export function openConferenceWindow(url: string) {
  if (!/^https:\/\//i.test(url)) {
    throw new Error("會議連結必須是 https://");
  }
  const w = Math.min(960, Math.floor(window.screen.availWidth * 0.48));
  const h = Math.min(800, Math.floor(window.screen.availHeight * 0.9));
  const left = Math.max(0, Math.floor(window.screen.availWidth * 0.02));
  const top = Math.max(0, Math.floor(window.screen.availHeight * 0.04));
  window.open(
    url,
    "_blank",
    `noopener,noreferrer,width=${w},height=${h},left=${left},top=${top}`
  );
}

export function recurrenceLabel(rec: ScheduleRecurrence | null | undefined): string {
  if (!rec) return "不重複";
  const every =
    rec.interval <= 1
      ? rec.freq === "daily"
        ? "每天"
        : rec.freq === "weekly"
          ? "每週"
          : "每月"
      : rec.freq === "daily"
        ? `每 ${rec.interval} 天`
        : rec.freq === "weekly"
          ? `每 ${rec.interval} 週`
          : `每 ${rec.interval} 個月`;
  if (rec.endType === "count") return `${every} · 共 ${rec.count} 次`;
  return `${every} · 直到 ${rec.untilDateKey}`;
}
