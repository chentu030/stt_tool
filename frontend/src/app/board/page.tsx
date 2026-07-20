"use client";

import PageLoading from "@/components/motion/PageLoading";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import { listenToUserNotes, loginWithGoogle, type Note } from "@/lib/firebase";
import { listenBoards, type BoardConfig } from "@/lib/boardStore";
import { createWorkspacePage, noteOpenHref } from "@/lib/workspacePages";
import ScrambleText from "@/components/motion/ScrambleText";
import { toast } from "@/lib/toast";

export default function BoardIndexPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [boards, setBoards] = useState<BoardConfig[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!user) return;
    return listenBoards(user.uid, setBoards);
  }, [user]);

  useEffect(() => {
    if (!user) return;
    return listenToUserNotes(user.uid, setNotes);
  }, [user]);

  const noteByBoard = useMemo(() => {
    const m = new Map<string, Note>();
    for (const n of notes) {
      if (n.app_link?.type === "board" && n.app_link.id) m.set(n.app_link.id, n);
    }
    return m;
  }, [notes]);

  const create = async () => {
    if (!user) return;
    setBusy(true);
    try {
      const { href } = await createWorkspacePage(user.uid, "board");
      router.push(href);
    } catch (e) {
      toast(e instanceof Error ? e.message : "建立失敗");
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <PageLoading />;
  if (!user) {
    return (
      <div>
        <ScrambleText words="看板" as="h1" className="page-title font-display" />
        <p className="page-sub">登入後建立看板頁面。</p>
        <button type="button" className="btn" onClick={() => void loginWithGoogle()}>
          登入
        </button>
      </div>
    );
  }

  return (
    <div className="cdb-index">
      <div className="cdb-index-head page-chrome">
        <div>
          <ScrambleText words="看板" as="h1" className="page-title font-display" />
          <p className="page-sub">Kanban 總覽 — 與筆記同分頁列，也可插入筆記中。</p>
        </div>
        <button type="button" className="btn" disabled={busy} onClick={() => void create()}>
          {busy ? "…" : "新建看板"}
        </button>
      </div>
      {boards.length === 0 ? (
        <div className="cdb-empty cdb-empty--cta">
          <p>尚無看板。建立一個，或在側欄按 + 選「新看板」。</p>
          <button type="button" className="btn" disabled={busy} onClick={() => void create()}>
            {busy ? "…" : "建立第一個看板"}
          </button>
        </div>
      ) : (
        <div className="cdb-index-grid">
          {boards.map((b) => {
            const note = noteByBoard.get(b.id);
            const href = note
              ? noteOpenHref(note)
              : `/board/${b.id}`;
            return (
              <Link key={b.id} href={href} className="cdb-index-card">
                <span className="cdb-icon">▦</span>
                <strong>{note?.title || b.name || "未命名看板"}</strong>
                <span>看板頁面</span>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
