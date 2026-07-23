/**
 * Timed schedule events for Journal day timeline (local + synced Google overlays).
 */

import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  updateDoc,
  where,
  type Unsubscribe,
} from "firebase/firestore";
import { db } from "@/lib/firebase";

export type ScheduleProvider = "local" | "google";

export type ScheduleEvent = {
  id: string;
  dateKey: string;
  startMin: number;
  endMin: number;
  allDay?: boolean;
  title: string;
  conferenceUrl?: string;
  provider: ScheduleProvider;
  externalId?: string;
  noteId?: string;
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
};

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

function mapDoc(id: string, data: Record<string, unknown>): ScheduleEvent {
  return {
    id,
    dateKey: String(data.dateKey || ""),
    startMin: Number(data.startMin) || 0,
    endMin: Number(data.endMin) || 0,
    allDay: Boolean(data.allDay),
    title: String(data.title || "未命名"),
    conferenceUrl: data.conferenceUrl ? String(data.conferenceUrl) : undefined,
    provider: (data.provider as ScheduleProvider) || "local",
    externalId: data.externalId ? String(data.externalId) : undefined,
    noteId: data.noteId ? String(data.noteId) : undefined,
    updated_at:
      data.updated_at &&
      typeof data.updated_at === "object" &&
      "toDate" in (data.updated_at as object)
        ? (data.updated_at as { toDate: () => Date }).toDate()
        : undefined,
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

export async function createScheduleEvent(uid: string, input: ScheduleEventInput) {
  const startMin = input.allDay ? 0 : snapMin(input.startMin);
  let endMin = input.allDay ? 24 * 60 : snapMin(input.endMin);
  if (!input.allDay && endMin <= startMin) endMin = Math.min(24 * 60, startMin + 30);
  const ref = await addDoc(eventsCol(uid), {
    dateKey: input.dateKey,
    startMin,
    endMin,
    allDay: Boolean(input.allDay),
    title: (input.title || "未命名").trim() || "未命名",
    conferenceUrl: input.conferenceUrl || null,
    provider: input.provider || "local",
    externalId: input.externalId || null,
    noteId: input.noteId || null,
    updated_at: serverTimestamp(),
  });
  return ref.id;
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
  await updateDoc(doc(eventsCol(uid), eventId), data);
}

export async function deleteScheduleEvent(uid: string, eventId: string) {
  await deleteDoc(doc(eventsCol(uid), eventId));
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
