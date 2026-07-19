"use client";

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

export default function BoardRedirectPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [error, setError] = useState("");

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    let unsub: (() => void) | undefined;

    const go = async (list: BoardConfig[]) => {
      if (cancelled) return;
      try {
        let boards = list;
        if (boards.length === 0) {
          const id = await createBoard(user.uid, "主看板");
          if (cancelled) return;
          try {
            localStorage.setItem(lastBoardKey(user.uid), id);
          } catch {
            /* ignore */
          }
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
        router.replace(`/board/${target}${window.location.search}`);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "無法開啟看板");
      }
    };

    unsub = listenBoards(user.uid, (list) => {
      void go(list);
      unsub?.();
      unsub = undefined;
    });

    return () => {
      cancelled = true;
      unsub?.();
    };
  }, [user, router]);

  if (loading) return <p style={{ color: "var(--text-muted)" }}>載入中…</p>;
  if (!user) {
    return (
      <div className="bd-page bd-guest">
        <ScrambleText words="看板" as="h1" className="page-title font-display" />
        <p className="page-sub">登入後使用看板。</p>
        <ShinyPill onClick={() => loginWithGoogle()}>登入</ShinyPill>
      </div>
    );
  }

  return (
    <div className="bd-page bd-guest">
      <p style={{ color: "var(--text-muted)" }}>{error || "開啟看板中…"}</p>
    </div>
  );
}
