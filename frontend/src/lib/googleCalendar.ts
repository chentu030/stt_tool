/**
 * Browser-side Google Calendar readonly sync (GIS token client).
 * Requires NEXT_PUBLIC_GOOGLE_CALENDAR_CLIENT_ID (OAuth Web client).
 */

import type { ScheduleEvent } from "@/lib/scheduleEvents";
import { extractConferenceUrl } from "@/lib/scheduleEvents";

const SCOPE = "https://www.googleapis.com/auth/calendar.readonly";
const TOKEN_KEY = "cadence_gcal_token";
const TOKEN_EXP_KEY = "cadence_gcal_token_exp";

declare global {
  interface Window {
    google?: {
      accounts: {
        oauth2: {
          initTokenClient: (cfg: {
            client_id: string;
            scope: string;
            callback: (resp: { access_token?: string; error?: string; expires_in?: number }) => void;
          }) => { requestAccessToken: (opts?: { prompt?: string }) => void };
          revoke: (token: string, done: () => void) => void;
        };
      };
    };
  }
}

function clientId() {
  return (process.env.NEXT_PUBLIC_GOOGLE_CALENDAR_CLIENT_ID || "").trim();
}

export function googleCalendarConfigured() {
  return Boolean(clientId());
}

export function getStoredGoogleAccessToken(): string | null {
  if (typeof window === "undefined") return null;
  const exp = Number(sessionStorage.getItem(TOKEN_EXP_KEY) || 0);
  if (exp && Date.now() > exp - 60_000) {
    sessionStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(TOKEN_EXP_KEY);
    return null;
  }
  return sessionStorage.getItem(TOKEN_KEY);
}

function storeToken(token: string, expiresIn = 3600) {
  sessionStorage.setItem(TOKEN_KEY, token);
  sessionStorage.setItem(TOKEN_EXP_KEY, String(Date.now() + expiresIn * 1000));
}

function loadGis(): Promise<void> {
  if (typeof window === "undefined") return Promise.reject(new Error("no window"));
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const existing = document.querySelector("script[data-cadence-gis]");
    if (existing) {
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () => reject(new Error("GIS load failed")));
      return;
    }
    const s = document.createElement("script");
    s.src = "https://accounts.google.com/gsi/client";
    s.async = true;
    s.dataset.cadenceGis = "1";
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("無法載入 Google 登入元件"));
    document.head.appendChild(s);
  });
}

export async function connectGoogleCalendar(opts?: { forcePrompt?: boolean }): Promise<string> {
  const id = clientId();
  if (!id) throw new Error("尚未設定 Google 日曆 Client ID（NEXT_PUBLIC_GOOGLE_CALENDAR_CLIENT_ID）");
  await loadGis();
  return new Promise((resolve, reject) => {
    const client = window.google!.accounts.oauth2.initTokenClient({
      client_id: id,
      scope: SCOPE,
      callback: (resp) => {
        if (resp.error || !resp.access_token) {
          reject(new Error(resp.error || "授權失敗"));
          return;
        }
        storeToken(resp.access_token, resp.expires_in || 3600);
        resolve(resp.access_token);
      },
    });
    client.requestAccessToken(opts?.forcePrompt ? { prompt: "consent" } : {});
  });
}

export function disconnectGoogleCalendar() {
  const token = getStoredGoogleAccessToken();
  if (token && window.google?.accounts?.oauth2) {
    window.google.accounts.oauth2.revoke(token, () => {});
  }
  sessionStorage.removeItem(TOKEN_KEY);
  sessionStorage.removeItem(TOKEN_EXP_KEY);
}

type GCalEvent = {
  id?: string;
  summary?: string;
  description?: string;
  location?: string;
  hangoutLink?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  conferenceData?: {
    entryPoints?: { entryPointType?: string; uri?: string }[];
  };
};

function minsFromDate(d: Date) {
  return d.getHours() * 60 + d.getMinutes();
}

function conferenceFromEvent(ev: GCalEvent): string | undefined {
  const entries = ev.conferenceData?.entryPoints || [];
  const video = entries.find((e) => e.entryPointType === "video" && e.uri);
  if (video?.uri) return video.uri;
  if (ev.hangoutLink) return ev.hangoutLink;
  return (
    extractConferenceUrl(ev.location || "") ||
    extractConferenceUrl(ev.description || "") ||
    extractConferenceUrl(ev.summary || "")
  );
}

/** Map Google Calendar events for a dateKey into ScheduleEvent overlays. */
export async function fetchGoogleDayEvents(dateKey: string): Promise<ScheduleEvent[]> {
  const rows = await fetchGoogleRangeEvents([dateKey]);
  return rows.filter((e) => e.dateKey === dateKey);
}

/** Fetch Google events spanning multiple local dateKeys (one API call). */
export async function fetchGoogleRangeEvents(dateKeys: string[]): Promise<ScheduleEvent[]> {
  const keys = [...new Set(dateKeys.filter(Boolean))].sort();
  if (!keys.length) return [];
  let token = getStoredGoogleAccessToken();
  if (!token) token = await connectGoogleCalendar();
  const dayStart = new Date(`${keys[0]}T00:00:00`);
  const dayEnd = new Date(`${keys[keys.length - 1]}T23:59:59`);
  const params = new URLSearchParams({
    timeMin: dayStart.toISOString(),
    timeMax: dayEnd.toISOString(),
    singleEvents: "true",
    orderBy: "startTime",
    maxResults: "250",
    conferenceDataVersion: "1",
  });
  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (res.status === 401) {
    disconnectGoogleCalendar();
    token = await connectGoogleCalendar({ forcePrompt: true });
    const retry = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!retry.ok) throw new Error("無法讀取 Google 日曆");
    const data = (await retry.json()) as { items?: GCalEvent[] };
    return mapItemsRange(keys, data.items || []);
  }
  if (!res.ok) {
    const err = await res.text();
    throw new Error(err.slice(0, 200) || "無法讀取 Google 日曆");
  }
  const data = (await res.json()) as { items?: GCalEvent[] };
  return mapItemsRange(keys, data.items || []);
}

function mapItems(dateKey: string, items: GCalEvent[]): ScheduleEvent[] {
  return mapItemsRange([dateKey], items).filter((e) => e.dateKey === dateKey);
}

function eventDateKey(ev: GCalEvent): string | null {
  if (ev.start?.date) return ev.start.date.slice(0, 10);
  if (ev.start?.dateTime) {
    const d = new Date(ev.start.dateTime);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }
  return null;
}

function mapItemsRange(dateKeys: string[], items: GCalEvent[]): ScheduleEvent[] {
  const allow = new Set(dateKeys);
  const out: ScheduleEvent[] = [];
  for (const ev of items) {
    const dateKey = eventDateKey(ev);
    if (!dateKey || !allow.has(dateKey)) continue;
    const allDay = Boolean(ev.start?.date && !ev.start?.dateTime);
    let startMin = 0;
    let endMin = 24 * 60;
    if (!allDay && ev.start?.dateTime && ev.end?.dateTime) {
      startMin = minsFromDate(new Date(ev.start.dateTime));
      endMin = minsFromDate(new Date(ev.end.dateTime));
      if (endMin <= startMin) endMin = startMin + 30;
    }
    out.push({
      id: `gcal:${ev.id || `${dateKey}-${startMin}`}`,
      dateKey,
      startMin,
      endMin,
      allDay,
      title: (ev.summary || "（無標題）").trim(),
      conferenceUrl: conferenceFromEvent(ev),
      description: (ev.description || "").trim().slice(0, 2000) || undefined,
      provider: "google",
      externalId: ev.id,
    });
  }
  return out;
}
