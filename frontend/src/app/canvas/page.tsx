"use client";

import PageLoading from "@/components/motion/PageLoading";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import { listenToUserNotes, loginWithGoogle, type Note } from "@/lib/firebase";
import { listenCanvases, type CanvasMeta } from "@/lib/canvasCloud";
import { createWorkspacePage, noteOpenHref } from "@/lib/workspacePages";
import ScrambleText from "@/components/motion/ScrambleText";
import { toast } from "@/lib/toast";

export default function CanvasIndexPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [list, setList] = useState<CanvasMeta[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!user) return;
    return listenCanvases(user.uid, setList);
  }, [user]);

  useEffect(() => {
    if (!user) return;
    return listenToUserNotes(user.uid, setNotes);
  }, [user]);

  const noteByCanvas = useMemo(() => {
    const m = new Map<string, Note>();
    for (const n of notes) {
      if (n.app_link?.type === "canvas" && n.app_link.id) m.set(n.app_link.id, n);
    }
    return m;
  }, [notes]);

  const create = async () => {
    if (!user) return;
    setBusy(true);
    try {
      const { href } = await createWorkspacePage(user.uid, "canvas");
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
        <ScrambleText words="白板" as="h1" className="page-title font-display" />
        <p className="page-sub">登入後建立白板頁面。</p>
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
          <ScrambleText words="白板" as="h1" className="page-title font-display" />
          <p className="page-sub">無限畫布總覽 — 與筆記同分頁列，也可插入筆記中。</p>
        </div>
        <button type="button" className="btn" disabled={busy} onClick={() => void create()}>
          {busy ? "…" : "新建白板"}
        </button>
      </div>
      {list.length === 0 ? (
        <div className="cdb-empty cdb-empty--cta">
          <p>尚無白板。建立一個，或在側欄按 + 選「新白板」。</p>
          <button type="button" className="btn" disabled={busy} onClick={() => void create()}>
            {busy ? "…" : "建立第一個白板"}
          </button>
        </div>
      ) : (
        <div className="cdb-index-grid">
          {list.map((c) => {
            const note = noteByCanvas.get(c.id);
            const href = note ? noteOpenHref(note) : `/canvas/${c.id}`;
            return (
              <Link key={c.id} href={href} className="cdb-index-card">
                <span className="cdb-icon">◇</span>
                <strong>{note?.title || c.name || "未命名白板"}</strong>
                <span>白板頁面</span>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
