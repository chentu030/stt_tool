"use client";

import { useEffect } from "react";
import { flushOfflineQueue } from "@/lib/offlineSync";

/** Listens for connectivity and flushes IndexedDB offline outbox. */
export default function OfflineSyncBootstrap() {
  useEffect(() => {
    const run = () => {
      void flushOfflineQueue();
    };
    run();
    window.addEventListener("online", run);
    const onVis = () => {
      if (document.visibilityState === "visible") run();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.removeEventListener("online", run);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  return null;
}
