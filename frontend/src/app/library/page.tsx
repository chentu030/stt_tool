"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { useAuth } from "@/components/AuthProvider";
import {
  listenToUserJobs, listenToUserNotes, deleteJob, deleteNote,
  createNote, loginWithGoogle, Job, Note,
} from "@/lib/firebase";
import ScrambleText from "@/components/motion/ScrambleText";
import ShinyPill from "@/components/motion/ShinyPill";
import { NOTE_TEMPLATES, journalTitle } from "@/lib/templates";
import { extractTagsFromText } from "@/lib/wiki";

export default function LibraryPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [q, setQ] = useState("");
  const [tab, setTab] = useState<"all" | "notes" | "jobs">("all");
  const [tagFilter, setTagFilter] = useState("");
  const [folderFilter, setFolderFilter] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");
  const [showTemplates, setShowTemplates] = useState(false);

  useEffect(() => {
    if (!user) return;
    const u1 = listenToUserJobs(user.uid, setJobs);
    const u2 = listenToUserNotes(user.uid, setNotes);
    return () => { u1(); u2(); };
  }, [user]);

  const allTags = useMemo(() => {
    const set = new Set<string>();
    for (const n of notes) {
      (n.tags || []).forEach((t) => set.add(t));
      extractTagsFromText(n.body_md).forEach((t) => set.add(t));
    }
    return Array.from(set).sort();
  }, [notes]);

  const allFolders = useMemo(() => {
    const set = new Set<string>();
    for (const n of notes) if (n.folder) set.add(n.folder);
    return Array.from(set).sort();
  }, [notes]);

  const createFromTemplate = async (templateId: string) => {
    if (!user || creating) return;
    setCreating(true);
    setCreateError("");
    try {
      const t = NOTE_TEMPLATES.find((x) => x.id === templateId) || NOTE_TEMPLATES[0];
      const title = t.id === "daily" ? journalTitle() : t.title;
      const id = await createNote(user.uid, title || "新筆記", t.body, undefined, t.tags, {
        journal_date: t.id === "daily" ? journalTitle() : undefined,
      });
      setShowTemplates(false);
      router.push(`/notes/${id}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setCreateError(/permission|insufficient/i.test(msg)
        ? "無法建立筆記：Firestore 權限不足。"
        : `無法建立筆記：${msg}`);
    } finally {
      setCreating(false);
    }
  };

  const filteredNotes = useMemo(() => {
    const s = q.trim().toLowerCase();
    return notes.filter((n) => {
      if (tagFilter && !(n.tags || []).includes(tagFilter) && !extractTagsFromText(n.body_md).includes(tagFilter)) return false;
      if (folderFilter && (n.folder || "") !== folderFilter) return false;
      if (!s) return true;
      return (
        n.title.toLowerCase().includes(s) ||
        n.body_md.toLowerCase().includes(s) ||
        (n.tags || []).some((t) => t.toLowerCase().includes(s)) ||
        (n.folder || "").toLowerCase().includes(s)
      );
    });
  }, [notes, q, tagFilter, folderFilter]);

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
        <ScrambleText words="知識庫" as="h1" className="page-title font-display" />
        <p className="page-sub">登入後即可查看筆記與轉錄。</p>
        <ShinyPill onClick={() => loginWithGoogle()}>登入</ShinyPill>
      </div>
    );
  }

  return (
    <div>
      <ScrambleText words="知識庫" as="h1" className="page-title font-display" speed={22} />
      <p className="page-sub">搜尋、標籤、資料夾、範本 — 把轉錄整理成可連結的知識。</p>

      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginBottom: "0.75rem" }}>
        <input className="input" style={{ flex: 1, minWidth: 180 }} placeholder="搜尋標題、內容、標籤、資料夾…" value={q} onChange={(e) => setQ(e.target.value)} />
        {(["all", "notes", "jobs"] as const).map((t) => (
          <button key={t} className={`btn btn-sm ${tab === t ? "" : "btn-ghost"}`} onClick={() => setTab(t)}>
            {t === "all" ? "全部" : t === "notes" ? "筆記" : "轉錄"}
          </button>
        ))}
        <button className="btn btn-sm btn-ghost" type="button" onClick={() => setShowTemplates((v) => !v)}>
          範本
        </button>
        <ShinyPill
          style={{ padding: "0.4rem 0.85rem", fontSize: "0.8rem" }}
          disabled={creating}
          onClick={() => { void createFromTemplate("blank"); }}
        >
          {creating ? "建立中…" : "+ 新筆記"}
        </ShinyPill>
      </div>

      <div style={{ display: "flex", gap: "0.45rem", flexWrap: "wrap", marginBottom: "1rem" }}>
        <select className="input" style={{ width: "auto", padding: "0.4rem 0.7rem" }} value={folderFilter} onChange={(e) => setFolderFilter(e.target.value)}>
          <option value="">全部資料夾</option>
          {allFolders.map((f) => <option key={f} value={f}>{f}</option>)}
        </select>
        <select className="input" style={{ width: "auto", padding: "0.4rem 0.7rem" }} value={tagFilter} onChange={(e) => setTagFilter(e.target.value)}>
          <option value="">全部標籤</option>
          {allTags.map((t) => <option key={t} value={t}>#{t}</option>)}
        </select>
        {(tagFilter || folderFilter) && (
          <button className="btn btn-ghost btn-sm" type="button" onClick={() => { setTagFilter(""); setFolderFilter(""); }}>清除篩選</button>
        )}
      </div>

      {showTemplates && (
        <div className="card" style={{ padding: "1rem", marginBottom: "1rem" }}>
          <h2 className="font-display" style={{ fontSize: "1rem", marginBottom: "0.7rem" }}>從範本建立</h2>
          <div className="grid-3">
            {NOTE_TEMPLATES.map((t) => (
              <button
                key={t.id}
                type="button"
                className="surface"
                disabled={creating}
                onClick={() => { void createFromTemplate(t.id); }}
                style={{ padding: "0.9rem", textAlign: "left", cursor: "pointer", border: "1px solid var(--border)" }}
              >
                <div style={{ fontWeight: 650 }}>{t.label}</div>
                <div style={{ fontSize: "0.78rem", color: "var(--text-muted)", marginTop: 4 }}>{t.hint}</div>
              </button>
            ))}
          </div>
        </div>
      )}

      {createError && (
        <p style={{ color: "var(--danger)", fontSize: "0.85rem", marginBottom: "0.85rem" }}>{createError}</p>
      )}

      {(tab === "all" || tab === "notes") && (
        <section style={{ marginBottom: "1.4rem" }}>
          <h2 className="font-display" style={{ fontSize: "1.05rem", marginBottom: "0.6rem" }}>
            筆記 <span style={{ color: "var(--text-muted)", fontWeight: 500, fontSize: "0.85rem" }}>({filteredNotes.length})</span>
          </h2>
          {filteredNotes.length === 0 ? (
            <p style={{ color: "var(--text-muted)", fontSize: "0.9rem" }}>沒有符合的筆記。</p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "0.45rem" }}>
              <AnimatePresence>
                {filteredNotes.map((n, i) => (
                  <motion.div
                    key={n.id}
                    layout
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.98 }}
                    transition={{ delay: Math.min(i * 0.03, 0.24) }}
                    whileHover={{ y: -2 }}
                    className="card"
                    style={{ padding: "0.9rem 1rem", display: "flex", justifyContent: "space-between", gap: "0.8rem" }}
                  >
                    <Link href={`/notes/${n.id}`} style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 650 }}>{n.title}</div>
                      <div style={{ fontSize: "0.78rem", color: "var(--text-muted)", marginTop: "0.25rem" }}>
                        {n.folder ? `${n.folder} · ` : ""}
                        {n.updated_at.toLocaleString("zh-TW")}
                        {(n.tags || []).length > 0 && ` · ${(n.tags || []).map((t) => `#${t}`).join(" ")}`}
                      </div>
                    </Link>
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={() => { if (confirm("刪除此筆記？")) deleteNote(n.id); }}
                    >刪除</button>
                  </motion.div>
                ))}
              </AnimatePresence>
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
              {filteredJobs.map((j, i) => (
                <motion.div
                  key={j.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: Math.min(i * 0.03, 0.24) }}
                  whileHover={{ y: -2 }}
                  className="card"
                  style={{ padding: "0.9rem 1rem", display: "flex", justifyContent: "space-between", gap: "0.8rem", alignItems: "center" }}
                >
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
                </motion.div>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
