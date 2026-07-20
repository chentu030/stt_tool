"use client";

import PageLoading from "@/components/motion/PageLoading";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import { loginWithGoogle } from "@/lib/firebase";
import {
  listenBoards,
  createBoard,
  lastBoardKey,
  type BoardConfig,
} from "@/lib/boardStore";
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

function boardErrMessage(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e || "無法開啟看板");
  if (/permission|insufficient|Missing/i.test(msg)) {
    return "沒有權限讀寫看板（請確認已部署含 boards 的 Firestore rules）";
  }
  return msg;
}

export default function BoardRedirectPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    let unsub: (() => void) | undefined;
    setError("");

    const timer = window.setTimeout(() => {
      if (cancelled) return;
      unsub?.();
      unsub = undefined;
      setError("開啟逾時，請重試");
    }, OPEN_TIMEOUT_MS);

    const go = async (list: BoardConfig[]) => {
      if (cancelled) return;
      try {
        let boards = list;
        if (boards.length === 0) {
          const id = await withTimeout(
            createBoard(user.uid, "主看板"),
            OPEN_TIMEOUT_MS,
            "建立看板逾時"
          );
          if (cancelled) return;
          try {
            localStorage.setItem(lastBoardKey(user.uid), id);
          } catch {
            /* ignore */
          }
          window.clearTimeout(timer);
          router.replace(`/board/${id}${window.location.search}`);
          return;
        }
        let target = "";
        try {
          target = localStorage.getItem(lastBoardKey(user.uid)) || "";
        } catch {
          target = "";
        }
        if (!target || !boards.some((b) => b.id === target)) {
          target = boards[0].id;
        }
        try {
          localStorage.setItem(lastBoardKey(user.uid), target);
        } catch {
          /* ignore */
        }
        window.clearTimeout(timer);
        router.replace(`/board/${target}${window.location.search}`);
      } catch (e) {
        if (!cancelled) setError(boardErrMessage(e));
      }
    };

    unsub = listenBoards(
      user.uid,
      (list) => {
        void go(list);
        unsub?.();
        unsub = undefined;
      },
      (err) => {
        if (!cancelled) {
          window.clearTimeout(timer);
          setError(boardErrMessage(err));
        }
      }
    );

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      unsub?.();
    };
  }, [user, router, retry]);

  if (loading) return <PageLoading />;
  if (!user) {
    return (
      <div className="bd-page bd-guest">
        <ScrambleText words="看板" as="h1" className="page-title font-display" />
        <p className="page-sub">登入後使用看板。</p>
        <ShinyPill onClick={() => loginWithGoogle()}>登入</ShinyPill>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bd-page bd-guest" style={{ padding: "1.5rem" }}>
        <p style={{ color: "var(--text-muted)", marginBottom: "1rem" }}>{error}</p>
        <ShinyPill onClick={() => setRetry((n) => n + 1)}>重試</ShinyPill>
      </div>
    );
  }

  return (
    <div className="bd-page bd-guest">
      <PageLoading label="開啟看板中…" />
    </div>
  );
}
