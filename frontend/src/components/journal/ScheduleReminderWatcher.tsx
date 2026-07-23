"use client";

import { useEffect } from "react";
import { useAuth } from "@/components/AuthProvider";
import { watchScheduleReminders } from "@/lib/scheduleReminders";

/** Arms browser notifications for upcoming local schedule events. */
export default function ScheduleReminderWatcher() {
  const { user } = useAuth();

  useEffect(() => {
    if (!user) return;
    return watchScheduleReminders(user.uid);
  }, [user]);

  return null;
}
