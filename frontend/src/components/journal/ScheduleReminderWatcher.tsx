"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { dateKeyFromDate } from "@/lib/journalMeta";
import { watchScheduleReminders } from "@/lib/scheduleReminders";

/** Arms browser notifications for upcoming local schedule events. */
export default function ScheduleReminderWatcher() {
  const { user } = useAuth();
  const [dayKey, setDayKey] = useState(() => dateKeyFromDate(new Date()));

  useEffect(() => {
    const id = window.setInterval(() => {
      const next = dateKeyFromDate(new Date());
      setDayKey((prev) => (prev === next ? prev : next));
    }, 60_000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (!user) return;
    return watchScheduleReminders(user.uid);
  }, [user, dayKey]);

  return null;
}
