"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/components/AuthProvider";
import { listenToUserJobs, listenToUserNotes, loginWithGoogle, Job, Note } from "@/lib/firebase";

export default function HomePage() {
  const { user, loading } = useAuth();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);

  useEffect(() => {
    if (!user) return;
    const u1 = listenToUserJobs(user.uid, setJobs);
    const u2 = listenToUserNotes(user.uid, setNotes);
    return () => { u1(); u2(); };
  }, [user]);

  if (loading) {
    return <p style={{ color: "var(--text-muted)" }}>載入中…</p>;
  }

  if (!user) {
    return (
      <section style={{ maxWidth: 720, margin: "2rem auto", textAlign: "center" }}>
        <p className="badge" style={{ marginBottom: "1rem" }}>語音驅動的知識工作區</p>
        <h1 className="font-display" style={{ fontSize: "clamp(2.4rem, 6vw, 3.6rem)", lineHeight: 1.1, marginBottom: "0.8rem" }}>
          把說話寫成<span style={{ color: "var(--accent-2)" }}>知識</span>
        </h1>
        <p style={{ color: "var(--text-muted)", fontSize: "1.05rem", marginBottom: "1.6rem" }}>
          Cadence 結合轉錄、編輯與筆記——像 Notion 一樣整理，像 Obsidian 一樣帶走。
        </p>
        <div style={{ display: "flex", gap: "0.6rem", justifyContent: "center", flexWrap: "wrap" }}>
          <button className="btn" onClick={() => loginWithGoogle()}>開始使用</button>
          <Link href="/capture" className="btn btn-ghost">先看看捕捉頁</Link>
        </div>
      </section>
    );
  }

  const recentJobs = jobs.slice(0, 5);
  const recentNotes = notes.slice(0, 5);
  const active = jobs.filter((j) => ["uploading", "queued", "processing"].includes(j.status));

  return (
    <div>
      <h1 className="page-title font-display">總覽</h1>
      <p className="page-sub">歡迎回來。從捕捉一段聲音開始，或繼續編輯你的筆記。</p>

      <div className="grid-3" style={{ marginBottom: "1.25rem" }}>
        <Link href="/capture" className="card" style={{ padding: "1.25rem", display: "block" }}>
          <div className="badge">快捷</div>
          <h3 className="font-display" style={{ marginTop: "0.7rem", fontSize: "1.25rem" }}>捕捉語音</h3>
          <p style={{ color: "var(--text-muted)", fontSize: "0.88rem", marginTop: "0.35rem" }}>上傳、YouTube 或錄音</p>
        </Link>
        <div className="card" style={{ padding: "1.25rem" }}>
          <div className="badge">進行中</div>
          <h3 className="font-display" style={{ marginTop: "0.7rem", fontSize: "1.25rem" }}>{active.length}</h3>
          <p style={{ color: "var(--text-muted)", fontSize: "0.88rem", marginTop: "0.35rem" }}>正在處理的轉錄</p>
        </div>
        <div className="card" style={{ padding: "1.25rem" }}>
          <div className="badge">筆記</div>
          <h3 className="font-display" style={{ marginTop: "0.7rem", fontSize: "1.25rem" }}>{notes.length}</h3>
          <p style={{ color: "var(--text-muted)", fontSize: "0.88rem", marginTop: "0.35rem" }}>知識庫篇數</p>
        </div>
      </div>

      <div className="grid-2">
        <section className="card" style={{ padding: "1.2rem" }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.8rem" }}>
            <h2 className="font-display" style={{ fontSize: "1.15rem" }}>最近筆記</h2>
            <Link href="/library" style={{ color: "var(--accent-2)", fontSize: "0.85rem" }}>全部</Link>
          </div>
          {recentNotes.length === 0 ? (
            <p style={{ color: "var(--text-muted)", fontSize: "0.9rem" }}>還沒有筆記。轉錄完成後可一鍵轉成筆記。</p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "0.45rem" }}>
              {recentNotes.map((n) => (
                <Link key={n.id} href={`/notes/${n.id}`} className="surface" style={{ padding: "0.75rem 0.9rem", display: "block" }}>
                  <div style={{ fontWeight: 600 }}>{n.title}</div>
                  <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: "0.2rem" }}>
                    {n.updated_at.toLocaleString("zh-TW")}
                  </div>
                </Link>
              ))}
            </div>
          )}
        </section>

        <section className="card" style={{ padding: "1.2rem" }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.8rem" }}>
            <h2 className="font-display" style={{ fontSize: "1.15rem" }}>最近轉錄</h2>
            <Link href="/library" style={{ color: "var(--accent-2)", fontSize: "0.85rem" }}>全部</Link>
          </div>
          {recentJobs.length === 0 ? (
            <p style={{ color: "var(--text-muted)", fontSize: "0.9rem" }}>尚無轉錄紀錄。</p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "0.45rem" }}>
              {recentJobs.map((j) => (
                <Link key={j.id} href={`/job/${j.id}`} className="surface" style={{ padding: "0.75rem 0.9rem", display: "block" }}>
                  <div style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {j.filenames?.[0] || j.youtube_url || "未命名"}
                  </div>
                  <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: "0.2rem" }}>
                    {statusLabel(j.status)} · {j.created_at.toLocaleString("zh-TW")}
                  </div>
                </Link>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function statusLabel(s: string) {
  const map: Record<string, string> = {
    uploading: "上傳中", queued: "排隊中", processing: "處理中", done: "已完成", error: "失敗",
  };
  return map[s] || s;
}
