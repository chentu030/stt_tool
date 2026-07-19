"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import { loginWithGoogle } from "@/lib/firebase";
import ScrambleText from "@/components/motion/ScrambleText";
import ShinyPill from "@/components/motion/ShinyPill";
import { ensureCanvasesMigrated, lastCanvasKey } from "@/lib/canvasCloud";

export default function CanvasIndexPage() {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!user) return;
    void (async () => {
      const last = localStorage.getItem(lastCanvasKey(user.uid));
      const id = (await ensureCanvasesMigrated(user.uid)) || last;
      if (id) router.replace(`/canvas/${id}${window.location.search}`);
    })();
  }, [user, router]);

  if (loading) return <p style={{ color: "var(--text-muted)", padding: "1rem" }}>載入中…</p>;
  if (!user) {
    return (
      <div className="cv-page cv-guest">
        <ScrambleText words="白板" as="h1" className="page-title font-display" />
        <p className="page-sub">登入後使用白板。</p>
        <ShinyPill onClick={() => loginWithGoogle()}>登入</ShinyPill>
      </div>
    );
  }

  return <p style={{ color: "var(--text-muted)", padding: "1rem" }}>開啟白板…</p>;
}
