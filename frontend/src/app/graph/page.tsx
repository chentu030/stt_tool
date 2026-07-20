"use client";

import PageLoading from "@/components/motion/PageLoading";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import { loginWithGoogle } from "@/lib/firebase";
import { ensureDefaultGraph } from "@/lib/graphStore";
import ScrambleText from "@/components/motion/ScrambleText";
import ShinyPill from "@/components/motion/ShinyPill";

const OPEN_TIMEOUT_MS = 20_000;

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error(message)), ms);
    }),
  ]);
}

export default function GraphIndexPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    setError("");

    void (async () => {
      try {
        const id = await withTimeout(
          ensureDefaultGraph(user.uid),
          OPEN_TIMEOUT_MS,
          "載入逾時，請重試"
        );
        if (!cancelled) router.replace(`/graph/${id}${window.location.search}`);
      } catch (e) {
        if (!cancelled) {
          const msg = e instanceof Error ? e.message : "無法開啟圖譜";
          setError(
            /permission|insufficient|Missing/i.test(msg)
              ? "沒有權限讀寫圖譜（請確認已部署含 graphs 的 Firestore rules）"
              : msg
          );
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [user, router, retry]);

  if (loading) {
    return <PageLoading />;
  }

  if (!user) {
    return (
      <div className="gp-page gp-guest">
        <ScrambleText words="圖譜" as="h1" className="page-title font-display" />
        <p className="page-sub">登入後查看圖譜。</p>
        <ShinyPill onClick={() => loginWithGoogle()}>登入</ShinyPill>
      </div>
    );
  }

  if (error) {
    return (
      <div className="gp-page gp-guest" style={{ padding: "1.5rem" }}>
        <p style={{ color: "var(--text-muted)", marginBottom: "1rem" }}>{error}</p>
        <ShinyPill onClick={() => setRetry((n) => n + 1)}>重試</ShinyPill>
      </div>
    );
  }

  return <PageLoading />;
}
