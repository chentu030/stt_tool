"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { libraryJobsUrl } from "@/lib/navApps";

/** Legacy route — redirect into library transcription tab. */
export default function HistoryRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace(libraryJobsUrl());
  }, [router]);
  return <p style={{ color: "var(--text-muted)" }}>正在導向轉錄紀錄…</p>;
}
