"use client";

import PageLoading from "@/components/motion/PageLoading";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import { listenToUserNotes, loginWithGoogle, type Note } from "@/lib/firebase";
import { listenGraphs, type GraphConfig } from "@/lib/graphStore";
import { createWorkspacePage, noteOpenHref } from "@/lib/workspacePages";
import ScrambleText from "@/components/motion/ScrambleText";
import { toast } from "@/lib/toast";

export default function GraphIndexPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [list, setList] = useState<GraphConfig[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!user) return;
    return listenGraphs(user.uid, setList);
  }, [user]);

  useEffect(() => {
    if (!user) return;
    return listenToUserNotes(user.uid, setNotes);
  }, [user]);

  const noteByGraph = useMemo(() => {
    const m = new Map<string, Note>();
    for (const n of notes) {
      if (n.app_link?.type === "graph" && n.app_link.id) m.set(n.app_link.id, n);
    }
    return m;
  }, [notes]);

  const create = async () => {
    if (!user) return;
    setBusy(true);
    try {
      const { href } = await createWorkspacePage(user.uid, "graph");
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
        <ScrambleText words="圖譜" as="h1" className="page-title font-display" />
        <p className="page-sub">登入後建立知識圖譜頁面。</p>
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
          <ScrambleText words="圖譜" as="h1" className="page-title font-display" />
          <p className="page-sub">知識圖譜總覽 — 與筆記同分頁列，也可插入筆記中。</p>
        </div>
        <button type="button" className="btn" disabled={busy} onClick={() => void create()}>
          {busy ? "…" : "新建圖譜"}
        </button>
      </div>
      {list.length === 0 ? (
        <div className="cdb-empty cdb-empty--cta">
          <p>尚無圖譜。建立一個，或在側欄按 + 選「新圖譜」。</p>
          <button type="button" className="btn" disabled={busy} onClick={() => void create()}>
            {busy ? "…" : "建立第一個圖譜"}
          </button>
        </div>
      ) : (
        <div className="cdb-index-grid">
          {list.map((g) => {
            const note = noteByGraph.get(g.id);
            const href = note ? noteOpenHref(note) : `/graph/${g.id}`;
            return (
              <Link key={g.id} href={href} className="cdb-index-card">
                <span className="cdb-icon">◎</span>
                <strong>{note?.title || g.name || "未命名圖譜"}</strong>
                <span>圖譜頁面</span>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
