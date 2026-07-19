"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/components/AuthProvider";
import {
  listenToUserJobs, listenToUserNotes, deleteJob, deleteNote,
  createNote, loginWithGoogle, Job, Note,
} from "@/lib/firebase";

export default function LibraryPage() {
  const { user, loading } = useAuth();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [q, setQ] = useState("");
  const [tab, setTab] = useState<"all" | "notes" | "jobs">("all");

  useEffect(() => {
    if (!user) return;
    const u1 = listenToUserJobs(user.uid, setJobs);
    const u2 = listenToUserNotes(user.uid, setNotes);
    return () => { u1(); u2(); };
  }, [user]);

  const filteredNotes = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return notes;
    return notes.filter((n) => n.title.toLowerCase().includes(s) || n.body_md.toLowerCase().includes(s));
  }, [notes, q]);

  const filteredJobs = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return jobs;
    return jobs.filter((j) =>
      (j.filenames || []).join(" ").toLowerCase().includes(s) ||
      (j.youtube_url || "").toLowerCase().includes(s) ||
      j.status.includes(s)
    );
  }, [jobs, q]);

  if (loading) return <p style={{ color: "var(--text-muted)" }}>載入中…</p>;
  if (!user) {
    return (
      <div style={{ textAlign: "center", padding: "3rem 1rem" }}>
        <h1 className="page-title font-display">知識庫</h1>
        <p className="page-sub">登入後即可查看筆記與轉錄。</p>
        <button className="btn" onClick={() => loginWithGoogle()}>登入</button>
      </div>
    );
  }

  return (
    <div>
      <h1 className="page-title font-display">知識庫</h1>
      <p className="page-sub">搜尋、開啟編輯，或把轉錄整理成筆記。</p>

      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginBottom: "1rem" }}>
        <input className="input" style={{ flex: 1, minWidth: 180 }} placeholder="搜尋標題、內容、狀態…" value={q} onChange={(e) => setQ(e.target.value)} />
        {(["all", "notes", "jobs"] as const).map((t) => (
          <button key={t} className={`btn btn-sm ${tab === t ? "" : "btn-ghost"}`} onClick={() => setTab(t)}>
            {t === "all" ? "全部" : t === "notes" ? "筆記" : "轉錄"}
          </button>
        ))}
        <button
          className="btn btn-sm btn-soft"
          onClick={async () => {
            const id = await createNote(user.uid, "新筆記", "");
            window.location.href = `/notes/${id}`;
          }}
        >
          + 新筆記
        </button>
      </div>

      {(tab === "all" || tab === "notes") && (
        <section style={{ marginBottom: "1.4rem" }}>
          <h2 className="font-display" style={{ fontSize: "1.05rem", marginBottom: "0.6rem" }}>筆記</h2>
          {filteredNotes.length === 0 ? (
            <p style={{ color: "var(--text-muted)", fontSize: "0.9rem" }}>沒有符合的筆記。</p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "0.45rem" }}>
              {filteredNotes.map((n) => (
                <div key={n.id} className="card" style={{ padding: "0.9rem 1rem", display: "flex", justifyContent: "space-between", gap: "0.8rem" }}>
                  <Link href={`/notes/${n.id}`} style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 650 }}>{n.title}</div>
                    <div style={{ fontSize: "0.78rem", color: "var(--text-muted)", marginTop: "0.25rem" }}>
                      {n.updated_at.toLocaleString("zh-TW")}
                    </div>
                  </Link>
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => { if (confirm("刪除此筆記？")) deleteNote(n.id); }}
                  >刪除</button>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {(tab === "all" || tab === "jobs") && (
        <section>
          <h2 className="font-display" style={{ fontSize: "1.05rem", marginBottom: "0.6rem" }}>轉錄</h2>
          {filteredJobs.length === 0 ? (
            <p style={{ color: "var(--text-muted)", fontSize: "0.9rem" }}>沒有符合的轉錄。</p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "0.45rem" }}>
              {filteredJobs.map((j) => (
                <div key={j.id} className="card" style={{ padding: "0.9rem 1rem", display: "flex", justifyContent: "space-between", gap: "0.8rem", alignItems: "center" }}>
                  <Link href={`/job/${j.id}`} style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 650, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {j.filenames?.[0] || j.youtube_url || "未命名"}
                    </div>
                    <div style={{ fontSize: "0.78rem", color: "var(--text-muted)", marginTop: "0.25rem" }}>
                      {j.status} · {j.created_at.toLocaleString("zh-TW")}
                    </div>
                  </Link>
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => {
                      if (confirm("刪除此轉錄？")) deleteJob(j.id, j.storage_paths || [], j.result_paths || []);
                    }}
                  >刪除</button>
                </div>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
