"use client";

import PageLoading from "@/components/motion/PageLoading";

import { askConfirm, askPrompt } from "@/lib/dialogs";
import { toast } from "@/lib/toast";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { useAuth } from "@/components/AuthProvider";
import {
  listenToUserJobs,
  deleteJob,
  deleteNote,
  createNote,
  updateNote,
  loginWithGoogle,
  Job,
  jobDisplayTitle,
} from "@/lib/firebase";
import { useNotesList } from "@/components/notes/NotesListProvider";
import ScrambleText from "@/components/motion/ScrambleText";
import ShinyPill from "@/components/motion/ShinyPill";
import { NOTE_TEMPLATES, journalTitle } from "@/lib/templates";
import LibraryRail from "@/components/library/LibraryRail";
import MenuSelect, { noteStatusLabel } from "@/components/MenuSelect";
import { usePrefs } from "@/components/PrefsProvider";
import { parseDefaultTags } from "@/lib/userPrefs";
import { buildResearchUrl } from "@/lib/researchBridge";
import { openGlobalAiRail } from "@/components/shell/GlobalAiDock";
import PageChromeIcon from "@/components/PageChromeIcon";
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
import {
  dataTransferHasFiles,
  filesFromDataTransfer,
  importMarkdownFilesAsNotes,
  pickMarkdownFiles,
  pickMarkdownFolder,
} from "@/lib/importMarkdownNotes";

const SORT_OPTIONS = [
  { value: "updated" as const, label: "最近更新" },
  { value: "created" as const, label: "最近建立" },
  { value: "title" as const, label: "標題" },
  { value: "length" as const, label: "篇幅" },
  { value: "relevance" as const, label: "相關度" },
];

function LibraryPageInner() {
  const { user, loading } = useAuth();
  const { prefs, setPrefs } = usePrefs();
  const router = useRouter();
  const searchParams = useSearchParams();
  const folderFromUrl = searchParams.get("folder") || "";
  const [jobs, setJobs] = useState<Job[]>([]);
  const { notes } = useNotesList();
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
  const [bulkFolder, setBulkFolder] = useState("");
  const [mdDropOver, setMdDropOver] = useState(false);
  const mdDragDepth = useRef(0);
  const searchRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setFolderFilter(folderFromUrl);
  }, [folderFromUrl]);

  useEffect(() => {
    const t = searchParams.get("tab");
    if (t === "jobs" || t === "notes") setTab(t);
  }, [searchParams]);

  useEffect(() => {
    if (prefsReady) return;
    setSort(prefs.librarySort);
    setView(prefs.libraryView);
    setPrefsReady(true);
  }, [prefs.librarySort, prefs.libraryView, prefsReady]);

  useEffect(() => {
    if (!user) return;
    return listenToUserJobs(user.uid, setJobs);
  }, [user]);

  const scopedNotes = useMemo(() => {
    if (!folderFilter) return notes;
    if (folderFilter === "__none__") {
      return notes.filter((n) => !(n.folder || "").trim());
    }
    const f = folderFilter.trim().replace(/\\/g, "/");
    return notes.filter((n) => {
      const nf = (n.folder || "").trim().replace(/\\/g, "/");
      return nf === f || nf.startsWith(`${f}/`);
    });
  }, [notes, folderFilter]);

  const stats = useMemo(
    () => computeLibraryStats(scopedNotes, folderFilter ? [] : jobs),
    [scopedNotes, jobs, folderFilter]
  );
  const folders = useMemo(() => folderBuckets(notes), [notes]);
  const tags = useMemo(() => tagBuckets(scopedNotes), [scopedNotes]);
  const activity = useMemo(
    () => recentActivity(scopedNotes, folderFilter ? [] : jobs, 10),
    [scopedNotes, jobs, folderFilter]
  );

  const folderLabel =
    folderFilter === "__none__" ? "未分類" : folderFilter.trim();

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
        (j.title || "").toLowerCase().includes(s) ||
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

  const importDroppedMarkdown = async (files: File[]) => {
    if (!user || creating || !files.length) return;
    setCreating(true);
    setCreateError("");
    try {
      const tags = parseDefaultTags(prefs.defaultTags);
      const folder = folderFilter || prefs.defaultFolder || "";
      const { createdIds, skipped } = await importMarkdownFilesAsNotes(user.uid, files, {
        folder,
        defaultTags: tags,
        defaultStatus: prefs.defaultStatus || "backlog",
      });
      if (createdIds.length) {
        toast(
          createdIds.length === 1
            ? "已從 Markdown 建立筆記"
            : `已匯入 ${createdIds.length} 篇 Markdown 筆記`
        );
        router.push(`/notes/${createdIds[0]}`);
      } else if (skipped.length) {
        setCreateError(skipped[0]?.reason || "無法匯入");
      } else {
        setCreateError("沒有可匯入的 .md 檔案");
      }
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : "匯入失敗");
    } finally {
      setCreating(false);
    }
  };

  const importMarkdownPicker = async () => {
    const files = await pickMarkdownFiles();
    if (!files.length) return;
    await importDroppedMarkdown(files);
  };

  const importFolderPicker = async () => {
    const files = await pickMarkdownFolder();
    if (!files.length) return;
    await importDroppedMarkdown(files);
  };

  const toggleSelect = (id: string) => {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const selectVisible = () => {
    setSelected(filteredNotes.map((n) => n.id));
  };

  const runBulkFolder = async () => {
    if (!selected.length) return;
    const next = await askPrompt({
      title: `移動 ${selected.length} 篇筆記`,
      message: "輸入資料夾路徑（空白＝未分類；可用 / 建立子資料夾）",
      defaultValue: bulkFolder,
      placeholder: "例如：專案/客戶A",
      confirmLabel: "移動",
    });
    if (next == null) return;
    const folder = next.trim();
    setBulkFolder(folder);
    await Promise.all(selected.map((id) => updateNote(id, { folder })));
    toast(`已移動 ${selected.length} 篇`);
  };

  const runBulkDelete = async () => {
    if (!selected.length) return;
    if (prefs.askBeforeDelete && !(await askConfirm({ title: `刪除選取的 ${selected.length} 篇筆記？`, danger: true, confirmLabel: "刪除" }))) return;
    const n = selected.length;
    await Promise.all(selected.map((id) => deleteNote(id)));
    setSelected([]);
    toast(`已刪除 ${n} 篇`);
  };

  const exportSelectedOrFiltered = () => {
    const pool = selected.length
      ? notes.filter((n) => selected.includes(n.id))
      : filteredNotes;
    const md = exportNotesMarkdown(pool, selected.length ? "Albireus 選取匯出" : "Albireus 篩選匯出");
    downloadText(`cadence-library-${Date.now()}.md`, md);
    toast(selected.length ? `已匯出 ${selected.length} 篇` : "已匯出篩選結果");
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (document.activeElement as HTMLElement | null)?.tagName;
      const inField = tag === "INPUT" || tag === "TEXTAREA" || (document.activeElement as HTMLElement | null)?.isContentEditable;
      if (e.key === "/" && !inField && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
        return;
      }
      if (e.key !== "Delete" && e.key !== "Backspace") return;
      if (inField) return;
      if (!selected.length || tab !== "notes") return;
      e.preventDefault();
      void runBulkDelete();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, tab, prefs.askBeforeDelete]);

  if (loading) return <PageLoading />;
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
    <div
      className={`kb-page${mdDropOver ? " is-md-drop" : ""}`}
      onDragEnter={(e) => {
        if (!dataTransferHasFiles(e.dataTransfer)) return;
        e.preventDefault();
        mdDragDepth.current += 1;
        setMdDropOver(true);
      }}
      onDragOver={(e) => {
        if (!dataTransferHasFiles(e.dataTransfer)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
      }}
      onDragLeave={(e) => {
        if (!dataTransferHasFiles(e.dataTransfer)) return;
        mdDragDepth.current = Math.max(0, mdDragDepth.current - 1);
        if (mdDragDepth.current === 0) setMdDropOver(false);
      }}
      onDrop={(e) => {
        if (!dataTransferHasFiles(e.dataTransfer)) return;
        e.preventDefault();
        mdDragDepth.current = 0;
        setMdDropOver(false);
        void importDroppedMarkdown(filesFromDataTransfer(e.dataTransfer));
      }}
    >
      {mdDropOver ? (
        <div className="kb-md-drop-overlay" aria-live="polite">
          放開以匯入 Markdown／資料夾
          {folderFilter ? `到「${folderFilter}」` : ""}
        </div>
      ) : null}
      <header className="kb-hero">
        <div>
          <ScrambleText
            words={folderLabel || "知識庫"}
            as="h1"
            className="page-title font-display"
            speed={22}
          />
          <p className="page-sub">
            {folderFilter
              ? `${stats.noteCount} 筆記 · ${stats.tagCount} 標籤`
              : `${stats.noteCount} 筆記 · ${stats.jobCount} 轉錄`}
          </p>
        </div>
        <div className="kb-hero-actions">
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            title="Albireus AI（Ctrl+Shift+A）"
            onClick={() => openGlobalAiRail()}
          >
            AI
          </button>
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            disabled={creating}
            title="選擇多個 .md 檔"
            onClick={() => {
              void importMarkdownPicker();
            }}
          >
            匯入 Markdown
          </button>
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            disabled={creating}
            title="選擇資料夾，保留子資料夾結構（含 YAML）"
            onClick={() => {
              void importFolderPicker();
            }}
          >
            匯入資料夾
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

      <div className="kb-layout">
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
          <div className="kb-controls">
            <div className="kb-toolbar">
              <input
                ref={searchRef}
                className="input kb-ctrl"
                placeholder="搜尋…（/）"
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
                {(["list", "grid", "compact", "table"] as ViewMode[]).map((v) => (
                  <button
                    key={v}
                    type="button"
                    className={view === v ? "is-active" : ""}
                    onClick={() => {
                      setView(v);
                      setPrefs({ libraryView: v });
                    }}
                  >
                    {v === "list" ? "列表" : v === "grid" ? "網格" : v === "compact" ? "緊湊" : "表格"}
                  </button>
                ))}
              </div>
            </div>

            {(tagFilter || folderFilter || statusFilter || q) && (
              <div className="kb-filters">
                {folderFilter && (
                  <span className="kb-chip">
                    資料夾：{folderFilter === "__none__" ? "未分類" : folderFilter}
                  </span>
                )}
                {tagFilter && <span className="kb-chip">#{tagFilter}</span>}
                {statusFilter && <span className="kb-chip">狀態：{noteStatusLabel(statusFilter)}</span>}
                {q && <span className="kb-chip">搜尋：{q}</span>}
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => {
                    setTagFilter("");
                    setFolderFilter("");
                    setStatusFilter("");
                    setQ("");
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
                {selected.length > 0 && (
                  <>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm kb-ctrl-btn"
                      onClick={() => setSelected([])}
                    >
                      取消選取 ({selected.length})
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm kb-ctrl-btn"
                      onClick={() => {
                        void runBulkFolder();
                      }}
                    >
                      移動至…
                    </button>
                    <button type="button" className="btn btn-ghost btn-sm kb-ctrl-btn" onClick={exportSelectedOrFiltered}>
                      匯出 MD
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm kb-ctrl-btn"
                      title="用已選筆記作為深度研究範圍"
                      onClick={() =>
                        router.push(
                          buildResearchUrl({
                            notes: selected,
                            from: selected[0],
                            returnTo: true,
                          })
                        )
                      }
                    >
                      深度研究
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm kb-ctrl-btn kb-ctrl-btn--danger"
                      onClick={() => {
                        void runBulkDelete();
                      }}
                    >
                      刪除選取
                    </button>
                  </>
                )}
                {!selected.length && (
                  <button type="button" className="btn btn-ghost btn-sm kb-ctrl-btn" onClick={exportSelectedOrFiltered}>
                    匯出篩選
                  </button>
                )}
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
          </div>

          <div className="kb-scroll">
          {tab === "notes" && (
            <section>
              {filteredNotes.length === 0 ? (
                <div className="kb-empty">
                  {notes.length === 0 ? (
                    <>
                      <p>還沒有筆記</p>
                      <button
                        type="button"
                        className="btn btn-sm"
                        onClick={() => {
                          void createFromTemplate("blank");
                        }}
                      >
                        建立第一篇
                      </button>
                    </>
                  ) : (
                    <>
                      <p>沒有符合的結果</p>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => {
                          setTagFilter("");
                          setFolderFilter("");
                          setStatusFilter("");
                          setQ("");
                          router.replace("/library");
                        }}
                      >
                        清除篩選／搜尋
                      </button>
                    </>
                  )}
                </div>
              ) : view === "table" ? (
                <div className="kb-table-wrap">
                  <table className="kb-table">
                    <thead>
                      <tr>
                        <th></th>
                        <th>標題</th>
                        <th>資料夾</th>
                        <th>標籤</th>
                        <th>狀態</th>
                        <th>來源</th>
                        <th>更新</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredNotes.map((n) => (
                        <tr key={n.id} className={selected.includes(n.id) ? "is-selected" : ""}>
                          <td>
                            <input
                              type="checkbox"
                              checked={selected.includes(n.id)}
                              onChange={() => toggleSelect(n.id)}
                            />
                          </td>
                          <td>
                            <Link href={`/notes/${n.id}`} className="kb-title-link">
                              <PageChromeIcon
                                icon={n.icon}
                                color={n.color}
                                hideWhenEmpty
                                className="kb-note-icon"
                              />
                              {n.title || "未命名"}
                            </Link>
                          </td>
                          <td>{n.folder || "—"}</td>
                          <td>{(n.tags || []).slice(0, 3).map((t) => `#${t}`).join(" ") || "—"}</td>
                          <td>{n.status ? noteStatusLabel(n.status) : "—"}</td>
                          <td>
                            {n.source_job_id ? (
                              <Link href={`/job/${n.source_job_id}`}>逐字稿</Link>
                            ) : (
                              "—"
                            )}
                          </td>
                          <td>{n.updated_at.toLocaleDateString("zh-TW")}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
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
                              void (async () => {
                                if (await askConfirm({ title: "刪除此筆記？", danger: true, confirmLabel: "刪除" })) deleteNote(n.id);
                              })();
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
            <section>
              {filteredJobs.length === 0 ? (
                <div className="kb-empty">
                  {jobs.length === 0 ? (
                    <>
                      <p>還沒有轉錄</p>
                      <Link href="/capture" className="btn btn-sm">
                        去捕捉
                      </Link>
                    </>
                  ) : (
                    <p className="kb-rail-muted">沒有符合的轉錄。</p>
                  )}
                </div>
              ) : view === "table" ? (
                <div className="kb-table-wrap">
                  <table className="kb-table">
                    <thead>
                      <tr>
                        <th>名稱</th>
                        <th>狀態</th>
                        <th>建立時間</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredJobs.map((j) => (
                        <tr key={j.id}>
                          <td>
                            <Link href={`/job/${j.id}`} className="kb-title-link">
                              {jobDisplayTitle(j)}
                            </Link>
                          </td>
                          <td>{j.status}</td>
                          <td>{j.created_at.toLocaleString("zh-TW")}</td>
                          <td>
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm"
                              onClick={() => {
                                void (async () => {
                                  if (
                                    await askConfirm({
                                      title: "刪除此轉錄？",
                                      danger: true,
                                      confirmLabel: "刪除",
                                    })
                                  ) {
                                    deleteJob(j.id, j.storage_paths || [], j.result_paths || []);
                                  }
                                })();
                              }}
                            >
                              刪除
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className={`kb-jobs kb-jobs--${view}`}>
                  {filteredJobs.map((j) => (
                    <div key={j.id} className="kb-job">
                      <Link href={`/job/${j.id}`}>
                        <strong>{jobDisplayTitle(j)}</strong>
                        {view !== "compact" && (
                          <span>
                            {j.status} · {j.created_at.toLocaleString("zh-TW")}
                          </span>
                        )}
                        {view === "compact" && <span>{j.status}</span>}
                      </Link>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => {
                          void (async () => {
                            if (
                              await askConfirm({
                                title: "刪除此轉錄？",
                                danger: true,
                                confirmLabel: "刪除",
                              })
                            ) {
                              deleteJob(j.id, j.storage_paths || [], j.result_paths || []);
                            }
                          })();
                        }}
                      >
                        刪除
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}
          </div>
        </main>
      </div>
    </div>
  );
}

export default function LibraryPage() {
  return (
    <Suspense fallback={<PageLoading />}>
      <LibraryPageInner />
    </Suspense>
  );
}
