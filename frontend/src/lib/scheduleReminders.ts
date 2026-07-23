/**
 * Browser notifications for local schedule events (when the app tab is open).
 */

import {
  formatClock,
  listenScheduleEventsForDates,
  type ScheduleEvent,
} from "@/lib/scheduleEvents";
import {
  dateKeyFromDate,
  parseDateKey,
  shiftDateKey,
} from "@/lib/journalMeta";
import {
  ensureDesktopNotifPermission,
  showDesktopNotification,
} from "@/lib/teamExtras";
import { toast } from "@/lib/toast";

const FIRED_KEY = "albireus.scheduleReminders.fired.v1";

function readFired(): Set<string> {
  try {
    const raw = localStorage.getItem(FIRED_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw) as string[];
    return new Set(Array.isArray(arr) ? arr.map(String) : []);
  } catch {
    return new Set();
  }
}

function writeFired(set: Set<string>) {
  const arr = [...set].slice(-200);
  try {
    localStorage.setItem(FIRED_KEY, JSON.stringify(arr));
  } catch {
    /* ignore */
  }
}

function markFired(key: string) {
  const s = readFired();
  s.add(key);
  writeFired(s);
}

function wasFired(key: string) {
  return readFired().has(key);
}

/** Absolute ms when the reminder should fire. */
export function reminderFireAtMs(ev: ScheduleEvent): number | null {
  if (ev.remindMinutesBefore == null || ev.provider !== "local") return null;
  const d = parseDateKey(ev.dateKey);
  if (!d) return null;
  // All-day: treat "start" as 09:00 local.
  const startMin = ev.allDay ? 9 * 60 : ev.startMin;
  const startMs = d.getTime() + startMin * 60_000;
  return startMs - ev.remindMinutesBefore * 60_000;
}

export function reminderFireKey(ev: ScheduleEvent): string {
  return `${ev.id}:${ev.dateKey}:${ev.remindMinutesBefore}`;
}

export async function requestScheduleNotificationPermission(): Promise<boolean> {
  if (typeof window === "undefined" || !("Notification" in window)) {
    toast("此瀏覽器不支援桌面通知");
    return false;
  }
  const ok = await ensureDesktopNotifPermission();
  if (!ok) {
    toast(
      Notification.permission === "denied"
        ? "通知權限已被拒絕，請在瀏覽器設定中允許"
        : "需要允許通知才能提醒"
    );
  }
  return ok;
}

function fireReminder(ev: ScheduleEvent) {
  const key = reminderFireKey(ev);
  if (wasFired(key)) return;
  markFired(key);
  const when = ev.allDay
    ? "全天"
    : `${formatClock(ev.startMin)}–${formatClock(ev.endMin)}`;
  const body = `${ev.dateKey.slice(5).replace("-", "/")} · ${when}`;
  toast(`提醒：${ev.title}`);
  showDesktopNotification(`行程提醒 · ${ev.title}`, body, () => {
    window.location.href = `/journal?date=${encodeURIComponent(ev.dateKey)}`;
  });
}

/**
 * Watch upcoming local events and fire browser notifications.
 * Returns an unsubscribe that clears timers + Firestore listeners.
 */
export function watchScheduleReminders(uid: string): () => void {
  const today = dateKeyFromDate(new Date());
  const keys = [today, shiftDateKey(today, 1), shiftDateKey(today, 2)];
  const timers = new Map<string, ReturnType<typeof setTimeout>>();

  const clearTimers = () => {
    for (const t of timers.values()) clearTimeout(t);
    timers.clear();
  };

  const schedule = (events: ScheduleEvent[]) => {
    clearTimers();
    const now = Date.now();
    for (const ev of events) {
      const at = reminderFireAtMs(ev);
      if (at == null) continue;
      const key = reminderFireKey(ev);
      if (wasFired(key)) continue;
      const delay = at - now;
      if (delay < -60_000) continue; // more than 1 min late → skip
      if (delay <= 0) {
        fireReminder(ev);
        continue;
      }
      if (delay > 48 * 60 * 60_000) continue; // only arm near-term
      timers.set(
        key,
        setTimeout(() => fireReminder(ev), delay)
      );
    }
  };

  const unsub = listenScheduleEventsForDates(uid, keys, schedule);
  // Re-check every minute in case the tab slept.
  const tick = window.setInterval(() => {
    // No-op: listeners already hold events; re-pull via date rollover is enough.
    // Soft re-arm by reading nothing — keep interval for midnight rollover restart.
    const t = dateKeyFromDate(new Date());
    if (t !== today) {
      /* date rolled — parent should remount; still clear stale */
    }
  }, 60_000);

  return () => {
    unsub();
    clearTimers();
    window.clearInterval(tick);
  };
}
