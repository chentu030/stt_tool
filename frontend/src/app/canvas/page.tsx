"use client";

import PageLoading from "@/components/motion/PageLoading";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import { loginWithGoogle } from "@/lib/firebase";
import ScrambleText from "@/components/motion/ScrambleText";
import ShinyPill from "@/components/motion/ShinyPill";
import { createCanvas, ensureCanvasesMigrated, lastCanvasKey } from "@/lib/canvasCloud";

const OPEN_TIMEOUT_MS = 20_000;

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error(message)), ms);
    }),
  ]);
}

export default function CanvasIndexPage() {
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
          ensureCanvasesMigrated(user.uid),
          OPEN_TIMEOUT_MS,
          "開啟逾時，請重試"
        );
        if (cancelled) return;
        const target =
          id ||
          (await withTimeout(createCanvas(user.uid, "主白板"), OPEN_TIMEOUT_MS, "建立白板逾時"));
        if (cancelled) return;
        try {
          localStorage.setItem(lastCanvasKey(user.uid), target);
        } catch {
          /* ignore */
        }
        router.replace(`/canvas/${target}${window.location.search}`);
      } catch (e) {
        if (!cancelled) {
          const msg = e instanceof Error ? e.message : "無法開啟白板";
          setError(
            /permission|insufficient|Missing/i.test(msg)
              ? "沒有權限讀寫白板（請確認已部署含 canvases 的 Firestore rules）"
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
      <div className="cv-page cv-guest">
        <ScrambleText words="白板" as="h1" className="page-title font-display" />
        <p className="page-sub">登入後使用白板。</p>
        <ShinyPill onClick={() => loginWithGoogle()}>登入</ShinyPill>
      </div>
    );
  }

  if (error) {
    return (
      <div className="cv-page cv-guest" style={{ padding: "1.5rem" }}>
        <p style={{ color: "var(--text-muted)", marginBottom: "1rem" }}>{error}</p>
        <ShinyPill onClick={() => setRetry((n) => n + 1)}>重試</ShinyPill>
      </div>
    );
  }

  return <PageLoading label="開啟白板…" />;
}
