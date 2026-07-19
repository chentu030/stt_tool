"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import {
  createDatabase,
  listenUserDatabases,
  type CadenceDatabase,
} from "@/lib/database";
import { askPrompt } from "@/lib/dialogs";
import { loginWithGoogle } from "@/lib/firebase";
import ScrambleText from "@/components/motion/ScrambleText";
import ContinueChips, { siloContinueChips } from "@/components/shell/ContinueChips";

export default function DatabasesIndexPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [list, setList] = useState<CadenceDatabase[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!user) return;
    return listenUserDatabases(user.uid, setList);
  }, [user]);

  const create = async () => {
    if (!user) return;
    setBusy(true);
    try {
      const name = (await askPrompt("資料庫名稱", "任務清單"))?.trim() || "未命名資料庫";
      const id = await createDatabase(user.uid, name, "tasks");
      router.push(`/db/${id}`);
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <p style={{ color: "var(--text-muted)" }}>載入中…</p>;
  if (!user) {
    return (
      <div>
        <ScrambleText words="資料庫" as="h1" className="page-title font-display" />
        <p className="page-sub">登入後建立 Notion 式資料庫。</p>
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
      <ContinueChips className="cdb-continue" chips={siloContinueChips()} />
      {list.length === 0 ? (
        <p className="cdb-empty">尚無資料庫。建立一個，或在筆記輸入 /database。</p>
      ) : (
        <div className="cdb-index-grid">
          {list.map((d) => (
            <Link key={d.id} href={`/db/${d.id}`} className="cdb-index-card">
              <span className="cdb-icon">{d.icon || "▦"}</span>
              <strong>{d.name}</strong>
              <span>{d.properties.length} 個屬性 · {d.views.length} 個視圖</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
