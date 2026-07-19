"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Legacy route — redirect into the new library. */
export default function HistoryRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/library");
  }, [router]);
  return <p style={{ color: "var(--text-muted)" }}>正在導向知識庫…</p>;
}
