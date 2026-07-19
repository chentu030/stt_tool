"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import { loginWithGoogle } from "@/lib/firebase";
import { ensureDefaultGraph } from "@/lib/graphStore";
import ScrambleText from "@/components/motion/ScrambleText";
import ShinyPill from "@/components/motion/ShinyPill";

export default function GraphIndexPage() {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    void (async () => {
      try {
        const id = await ensureDefaultGraph(user.uid);
        if (!cancelled) router.replace(`/graph/${id}`);
      } catch {
        if (!cancelled) router.replace("/graph");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, router]);

  if (loading || user) {
    return <p style={{ color: "var(--text-muted)" }}>載入中…</p>;
  }

  return (
    <div className="gp-page gp-guest">
      <ScrambleText words="圖譜" as="h1" className="page-title font-display" />
      <p className="page-sub">登入後查看圖譜。</p>
      <ShinyPill onClick={() => loginWithGoogle()}>登入</ShinyPill>
    </div>
  );
}
