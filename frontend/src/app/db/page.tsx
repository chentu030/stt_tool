"use client";

import PageLoading from "@/components/motion/PageLoading";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import { listenToUserNotes, loginWithGoogle, type Note } from "@/lib/firebase";
import {
  listenUserDatabases,
  type CadenceDatabase,
} from "@/lib/database";
import { createWorkspacePage, noteOpenHref } from "@/lib/workspacePages";
import ScrambleText from "@/components/motion/ScrambleText";
import { toast } from "@/lib/toast";

export default function DatabasesIndexPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [list, setList] = useState<CadenceDatabase[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!user) return;
    return listenUserDatabases(user.uid, setList);
  }, [user]);

  useEffect(() => {
    if (!user) return;
    return listenToUserNotes(user.uid, setNotes);
  }, [user]);

  const noteByDb = useMemo(() => {
    const m = new Map<string, Note>();
    for (const n of notes) {
      if (n.app_link?.type === "database" && n.app_link.id) m.set(n.app_link.id, n);
    }
    return m;
  }, [notes]);

  const create = async () => {
    if (!user) return;
    setBusy(true);
    try {
      const { href } = await createWorkspacePage(user.uid, "database");
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
        <ScrambleText words="資料庫" as="h1" className="page-title font-display" />
        <p className="page-sub">登入後建立屬性表格與多視圖資料庫。</p>
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
          <ScrambleText words="資料庫" as="h1" className="page-title font-display" />
          <p className="page-sub">表格、屬性、多視圖 — 也可插入筆記中。</p>
        </div>
        <button type="button" className="btn" disabled={busy} onClick={() => void create()}>
          {busy ? "…" : "新建資料庫"}
        </button>
      </div>
      {list.length === 0 ? (
        <div className="cdb-empty cdb-empty--cta">
          <p>尚無資料庫。建立一個，或在筆記輸入 /database。</p>
          <button type="button" className="btn" disabled={busy} onClick={() => void create()}>
            {busy ? "…" : "建立第一個資料庫"}
          </button>
        </div>
      ) : (
        <div className="cdb-index-grid">
          {list.map((d) => {
            const note = noteByDb.get(d.id);
            const href = note ? noteOpenHref(note) : `/db/${d.id}`;
            return (
              <Link key={d.id} href={href} className="cdb-index-card">
                <span className="cdb-icon">{d.icon || "▦"}</span>
                <strong>{note?.title || d.name}</strong>
                <span>
                  {d.properties.length} 個屬性 · {d.views.length} 個視圖
                </span>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
