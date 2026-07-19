"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { useAuth } from "@/components/AuthProvider";
import {
  listenToUserJobs,
  listenToUserNotes,
  deleteJob,
  deleteNote,
  createNote,
  updateNote,
  loginWithGoogle,
  Job,
  Note,
} from "@/lib/firebase";
import ScrambleText from "@/components/motion/ScrambleText";
import ShinyPill from "@/components/motion/ShinyPill";
import { NOTE_TEMPLATES, journalTitle } from "@/lib/templates";
import KnowledgeChat from "@/components/library/KnowledgeChat";
import LibraryRail from "@/components/library/LibraryRail";
import MenuSelect, { noteStatusLabel } from "@/components/MenuSelect";
import { usePrefs } from "@/components/PrefsProvider";
import { parseDefaultTags } from "@/lib/userPrefs";
import {
  SortKey,
  ViewMode,
  computeLibraryStats,
  downloadText,
  exportNotesMarkdown,
  folderBuckets,
  recentActivity,
  searchNotes,
  tagBuckets,
} from "@/lib/libraryIndex";

const SORT_OPTIONS = [
  { value: "updated" as const, label: "最近更新" },
  { value: "created" as const, label: "最近建立" },
  { value: "title" as const, label: "標題" },
  { value: "length" as const, label: "篇幅" },
  { value: "relevance" as const, label: "相關度" },
];

function LibraryPageInner() {
  const { user, loading } = useAuth();
  const { prefs } = usePrefs();
  const router = useRouter();
  const searchParams = useSearchParams();
  const folderFromUrl = searchParams.get("folder") || "";
  const [jobs, setJobs] = useState<Job[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [q, setQ] = useState("");
  const [tab, setTab] = useState<"notes" | "jobs">("notes");
  const [tagFilter, setTagFilter] = useState("");
  const [folderFilter, setFolderFilter] = useState(folderFromUrl);
  const [statusFilter, setStatusFilter] = useState("");
  const [sort, setSort] = useState<SortKey>(prefs.librarySort);
  const [view, setView] = useState<ViewMode>(prefs.libraryView);
  const [prefsReady, setPrefsReady] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");
  const [showTemplates, setShowTemplates] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [chatOpen, setChatOpen] = useState(true);
  const [bulkFolder, setBulkFolder] = useState("");

  useEffect(() => {
    setFolderFilter(folderFromUrl);
  }, [folderFromUrl]);

  useEffect(() => {
    if (prefsReady) return;
    setSort(prefs.librarySort);
    setView(prefs.libraryView);
    setPrefsReady(true);
  }, [prefs.librarySort, prefs.libraryView, prefsReady]);

  useEffect(() => {
    if (!user) return;
    const u1 = listenToUserJobs(user.uid, setJobs);
    const u2 = listenToUserNotes(user.uid, setNotes);
    return () => {
      u1();
      u2();
    };
  }, [user]);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 1100px)");
    const apply = () => setChatOpen(!mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  const stats = useMemo(() => computeLibraryStats(notes, jobs), [notes, jobs]);
  const folders = useMemo(() => folderBuckets(notes), [notes]);
  const tags = useMemo(() => tagBuckets(notes), [notes]);
  const activity = useMemo(() => recentActivity(notes, jobs, 10), [notes, jobs]);

  const filteredNotes = useMemo(() => {
    let list = searchNotes(notes, q, {
      tag: tagFilter,
      folder: folderFilter,
      status: statusFilter,
      sort: q.trim() && sort === "updated" ? "relevance" : sort,
    });
    if (!prefs.libraryShowEmpty) {
      list = list.filter((n) => (n.body_md || "").trim().length > 0);
    }
    return list;
  }, [notes, q, tagFilter, folderFilter, statusFilter, sort, prefs.libraryShowEmpty]);

  const filteredJobs = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return jobs;
    return jobs.filter(
      (j) =>
        (j.filenames || []).join(" ").toLowerCase().includes(s) ||
        (j.youtube_url || "").toLowerCase().includes(s) ||
        j.status.includes(s)
    );
  }, [jobs, q]);

  const createFromTemplate = async (templateId: string) => {
    if (!user || creating) return;
    setCreating(true);
    setCreateError("");
    try {
      const t = NOTE_TEMPLATES.find((x) => x.id === templateId) || NOTE_TEMPLATES[0];
      const title = t.id === "daily" ? journalTitle() : t.title;
      const tags = [...new Set([...t.tags, ...parseDefaultTags(prefs.defaultTags)])];
      const id = await createNote(user.uid, title || "新筆記", t.body, undefined, tags, {
        journal_date: t.id === "daily" ? journalTitle() : undefined,
        folder: prefs.defaultFolder || undefined,
        status: prefs.defaultStatus || "backlog",
      });
      setShowTemplates(false);
      router.push(`/notes/${id}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setCreateError(
        /permission|insufficient/i.test(msg)
          ? "無法建立筆記：Firestore 權限不足。"
          : `無法建立筆記：${msg}`
      );
    } finally {
      setCreating(false);
    }
  };

  const toggleSelect = (id: string) => {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const selectVisible = () => {
    setSelected(filteredNotes.map((n) => n.id));
  };

  const runBulkFolder = async () => {
    const folder = bulkFolder.trim();
    if (!folder || !selected.length) return;
    await Promise.all(selected.map((id) => updateNote(id, { folder })));
    setBulkFolder("");
  };

  const runBulkDelete = async () => {
    if (!selected.length) return;
    if (prefs.askBeforeDelete && !window.confirm(`確定刪除選取的 ${selected.length} 篇筆記？`)) return;
    await Promise.all(selected.map((id) => deleteNote(id)));
    setSelected([]);
  };

  const exportSelectedOrFiltered = () => {
    const pool = selected.length
      ? notes.filter((n) => selected.includes(n.id))
      : filteredNotes;
    const md = exportNotesMarkdown(pool, selected.length ? "Cadence 選取匯出" : "Cadence 篩選匯出");
    downloadText(`cadence-library-${Date.now()}.md`, md);
  };

  if (loading) return <p style={{ color: "var(--text-muted)" }}>載入中…</p>;
  if (!user) {
    return (
      <div style={{ textAlign: "center", padding: "3rem 1rem" }}>
        <ScrambleText words="知識庫" as="h1" className="page-title font-display" />
          <p className="page-sub">登入後瀏覽筆記與轉錄。</p>
        <ShinyPill onClick={() => loginWithGoogle()}>登入</ShinyPill>
      </div>
    );
  }

  return (
    <div className="kb-page">
      <header className="kb-hero">
        <div>
          <ScrambleText words="知識庫" as="h1" className="page-title font-display" speed={22} />
          <p className="page-sub">
            {stats.noteCount} 筆記 · {stats.jobCount} 轉錄
          </p>
        </div>
        <div className="kb-hero-actions">
          <button
            type="button"
            className={`btn btn-sm ${chatOpen ? "" : "btn-ghost"}`}
            onClick={() => setChatOpen((v) => !v)}
          >
            {chatOpen ? "收合助手" : "知識助手"}
          </button>
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            onClick={() => setShowTemplates((v) => !v)}
          >
            範本
          </button>
          <ShinyPill
            style={{ padding: "0.4rem 0.85rem", fontSize: "0.8rem" }}
            disabled={creating}
            onClick={() => {
              void createFromTemplate("blank");
            }}
          >
            {creating ? "建立中…" : "+ 新筆記"}
          </ShinyPill>
        </div>
      </header>

      <div className={`kb-layout${chatOpen ? " kb-layout--chat" : ""}`}>
        <LibraryRail
          stats={stats}
          folders={folders}
          tags={tags}
          activity={activity}
          folderFilter={folderFilter}
          tagFilter={tagFilter}
          statusFilter={statusFilter}
          onFolder={(v) => {
            setFolderFilter(v);
            const params = new URLSearchParams(searchParams.toString());
            if (v) params.set("folder", v);
            else params.delete("folder");
            const qs = params.toString();
            router.replace(qs ? `/library?${qs}` : "/library");
          }}
          onTag={setTagFilter}
          onStatus={setStatusFilter}
        />

        <main className="kb-main">
          <div className="kb-toolbar">
            <input
              className="input kb-ctrl"
              placeholder="搜尋…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <div className="kb-seg">
              <button
                type="button"
                className={tab === "notes" ? "is-active" : ""}
                onClick={() => setTab("notes")}
              >
                筆記 {filteredNotes.length}
              </button>
              {prefs.libraryShowJobs && (
                <button
                  type="button"
                  className={tab === "jobs" ? "is-active" : ""}
                  onClick={() => setTab("jobs")}
                >
                  轉錄 {filteredJobs.length}
                </button>
              )}
            </div>
            <MenuSelect
              variant="soft"
              className="kb-menu"
              ariaLabel="排序"
              value={sort}
              options={SORT_OPTIONS}
              onChange={setSort}
            />
            <div className="kb-seg">
              {(["list", "grid", "compact"] as ViewMode[]).map((v) => (
                <button
                  key={v}
                  type="button"
                  className={view === v ? "is-active" : ""}
                  onClick={() => setView(v)}
                >
                  {v === "list" ? "列表" : v === "grid" ? "網格" : "緊湊"}
                </button>
              ))}
            </div>
          </div>

          {(tagFilter || folderFilter || statusFilter) && (
            <div className="kb-filters">
              {folderFilter && (
                <span className="kb-chip">
                  資料夾：{folderFilter === "__none__" ? "未分類" : folderFilter}
                </span>
              )}
              {tagFilter && <span className="kb-chip">#{tagFilter}</span>}
              {statusFilter && <span className="kb-chip">狀態：{noteStatusLabel(statusFilter)}</span>}
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  setTagFilter("");
                  setFolderFilter("");
                  setStatusFilter("");
                  router.replace("/library");
                }}
              >
                清除篩選
              </button>
            </div>
          )}

          {tab === "notes" && (
            <div className="kb-bulk">
              <button type="button" className="btn btn-ghost btn-sm kb-ctrl-btn" onClick={selectVisible}>
                全選可見
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm kb-ctrl-btn"
                onClick={() => setSelected([])}
                disabled={!selected.length}
              >
                取消選取 ({selected.length})
              </button>
              <input
                className="input kb-ctrl kb-ctrl--folder"
                placeholder="批量資料夾"
                value={bulkFolder}
                onChange={(e) => setBulkFolder(e.target.value)}
              />
              <button
                type="button"
                className="btn btn-ghost btn-sm kb-ctrl-btn"
                disabled={!selected.length || !bulkFolder.trim()}
                onClick={() => {
                  void runBulkFolder();
                }}
              >
                套用資料夾
              </button>
              <button type="button" className="btn btn-ghost btn-sm kb-ctrl-btn" onClick={exportSelectedOrFiltered}>
                匯出 MD
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm kb-ctrl-btn kb-ctrl-btn--danger"
                disabled={!selected.length}
                onClick={() => {
                  void runBulkDelete();
                }}
              >
                刪除選取
              </button>
            </div>
          )}

          {showTemplates && (
            <div className="card kb-templates">
              <h2 className="font-display" style={{ fontSize: "1rem", marginBottom: "0.7rem" }}>
                從範本建立
              </h2>
              <div className="grid-3">
                {NOTE_TEMPLATES.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    className="surface"
                    disabled={creating}
                    onClick={() => {
                      void createFromTemplate(t.id);
                    }}
                    style={{
                      padding: "0.9rem",
                      textAlign: "left",
                      cursor: "pointer",
                      border: "1px solid var(--border)",
                    }}
                  >
                    <div style={{ fontWeight: 650 }}>{t.label}</div>
                    <div style={{ fontSize: "0.78rem", color: "var(--text-muted)", marginTop: 4 }}>
                      {t.hint}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {createError && (
            <p style={{ color: "var(--danger)", fontSize: "0.85rem", marginBottom: "0.85rem" }}>
              {createError}
            </p>
          )}

          {tab === "notes" && (
            <section>
              {filteredNotes.length === 0 ? (
                <div className="kb-empty">
                  <p>沒有符合的筆記。</p>
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => {
                      void createFromTemplate("blank");
                    }}
                  >
                    建立第一篇
                  </button>
                </div>
              ) : (
                <div className={`kb-notes kb-notes--${view}`}>
                  <AnimatePresence>
                    {filteredNotes.map((n, i) => {
                      const checked = selected.includes(n.id);
                      return (
                        <motion.article
                          key={n.id}
                          layout
                          initial={{ opacity: 0, y: 8 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, scale: 0.98 }}
                          transition={{ delay: Math.min(i * 0.02, 0.2) }}
                          className={`kb-note${checked ? " is-selected" : ""}`}
                        >
                          <label className="kb-check">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggleSelect(n.id)}
                            />
                          </label>
                          <Link href={`/notes/${n.id}`} className="kb-note-body">
                            <h3>{n.title || "未命名"}</h3>
                            {view !== "compact" && <p>{n.snippet}</p>}
                            <div className="kb-note-meta">
                              {n.folder ? <span>{n.folder}</span> : null}
                              {(n.tags || []).slice(0, 4).map((t) => (
                                <span key={t}>#{t}</span>
                              ))}
                              {n.status ? <span>{noteStatusLabel(n.status)}</span> : null}
                              <span>{n.updated_at.toLocaleString("zh-TW")}</span>
                              {q.trim() && n.score > 0 ? <span>相關 {Math.round(n.score)}</span> : null}
                            </div>
                          </Link>
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            onClick={() => {
                              if (confirm("刪除此筆記？")) deleteNote(n.id);
                            }}
                          >
                            刪除
                          </button>
                        </motion.article>
                      );
                    })}
                  </AnimatePresence>
                </div>
              )}
            </section>
          )}

          {tab === "jobs" && (
            <section className="kb-jobs">
              {filteredJobs.length === 0 ? (
                <p className="kb-rail-muted">沒有符合的轉錄。</p>
              ) : (
                filteredJobs.map((j) => (
                  <div key={j.id} className="kb-job">
                    <Link href={`/job/${j.id}`}>
                      <strong>{j.filenames?.[0] || j.youtube_url || "未命名"}</strong>
                      <span>
                        {j.status} · {j.created_at.toLocaleString("zh-TW")}
                      </span>
                    </Link>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => {
                        if (confirm("刪除此轉錄？")) {
                          deleteJob(j.id, j.storage_paths || [], j.result_paths || []);
                        }
                      }}
                    >
                      刪除
                    </button>
                  </div>
                ))
              )}
            </section>
          )}
        </main>

        {chatOpen && (
          <KnowledgeChat
            notes={notes}
            selectedIds={selected}
            onClearSelection={() => setSelected([])}
            storageKey={`cadence-kb-chat-${user.uid}`}
          />
        )}
      </div>
    </div>
  );
}

export default function LibraryPage() {
  return (
    <Suspense fallback={<p style={{ color: "var(--text-muted)" }}>載入中…</p>}>
      <LibraryPageInner />
    </Suspense>
  );
}
