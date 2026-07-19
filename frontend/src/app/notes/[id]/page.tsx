"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/components/AuthProvider";
import {
  getNote,
  updateNote,
  listenToUserNotes,
  pushNoteVersion,
  listNoteVersions,
  createNote,
  deleteNote,
  Note,
  NoteVersion,
} from "@/lib/firebase";
import RichNoteEditor from "@/components/RichNoteEditor";
import MenuSelect, { NOTE_STATUS_OPTIONS } from "@/components/MenuSelect";
import NoteAside from "@/components/notes/NoteAside";
import {
  downloadDocx,
  downloadMarkdown,
  downloadPdfViaPrint,
  downloadPptOutline,
} from "@/lib/exportNote";
import SlideStudio, { SlideStudioActions } from "@/components/slides/SlideStudio";
import {
  SlideDeck,
  deckFromMarkdown,
  getTheme,
  isDeckStale,
  loadDeckLocal,
  normalizeDeck,
  saveDeckLocal,
  splitMarkdownSections,
} from "@/lib/slideDeck";
import { extractTagsFromText, extractWikiLinks, findBacklinks, findNoteByTitle } from "@/lib/wiki";
import {
  NOTE_AI_ACTIONS,
  NoteAiActionId,
  HeadingItem,
  computeNoteStats,
  extractOutline,
  findRelatedNotes,
} from "@/lib/noteMeta";
import { usePrefsOptional } from "@/components/PrefsProvider";
import { toggleFavoriteId, touchRecentId } from "@/lib/userPrefs";
import { NOTE_TEMPLATES } from "@/lib/templates";
import { splitFolderPath } from "@/lib/noteTree";

const PAGE_ICONS = ["📄", "📝", "💡", "📌", "🎯", "📚", "🔬", "🎤", "🗂", "⭐"];

export default function NotePage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { user, loading } = useAuth();
  const prefsCtx = usePrefsOptional();
  const [note, setNote] = useState<Note | null>(null);
  const [allNotes, setAllNotes] = useState<Note[]>([]);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [folder, setFolder] = useState("");
  const [icon, setIcon] = useState("");
  const [cover, setCover] = useState("");
  const [parentId, setParentId] = useState("");
  const [tagInput, setTagInput] = useState("");
  const [dirty, setDirty] = useState(false);
  const [status, setStatus] = useState<"idle" | "dirty" | "saving" | "saved" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [findOpen, setFindOpen] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState("");
  const [moreOpen, setMoreOpen] = useState(false);
  const [viewMode, setViewMode] = useState<"write" | "slides">("write");
  const [deck, setDeck] = useState<SlideDeck | null>(null);
  const [slideActions, setSlideActions] = useState<SlideStudioActions | null>(null);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [slideFocusIndex, setSlideFocusIndex] = useState<number | null>(null);
  const [slideFocusNonce, setSlideFocusNonce] = useState(0);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [versions, setVersions] = useState<NoteVersion[]>([]);
  const [ribbonHost, setRibbonHost] = useState<HTMLDivElement | null>(null);
  const [asideOpen, setAsideOpen] = useState(true);
  const [asideTab, setAsideTab] = useState<"outline" | "ai" | "info">("outline");
  const [asideWidth, setAsideWidth] = useState(() => {
    if (typeof window === "undefined") return 300;
    try {
      const n = Number(localStorage.getItem("cadence_note_aside_w"));
      if (Number.isFinite(n) && n >= 220 && n <= 560) return n;
    } catch {
      /* ignore */
    }
    return 300;
  });
  const [focusMode, setFocusMode] = useState(false);
  const [pageMode, setPageMode] = useState(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem("cadence_page_mode") === "1";
  });
  const [linkPicker, setLinkPicker] = useState("");
  const [toast, setToast] = useState("");
  const [iconOpen, setIconOpen] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef({
    title: "",
    body: "",
    tags: [] as string[],
    folder: "",
    icon: "",
    cover: "",
    parent_id: "",
  });

  useEffect(() => {
    if (!id) return;
    getNote(id).then((n) => {
      if (!n) return;
      setNote(n);
      setTitle(n.title);
      setBody(n.body_md);
      setTags(n.tags || []);
      setFolder(n.folder || "");
      setIcon(n.icon || "");
      setCover(n.cover || "");
      setParentId(n.parent_id || "");
      const fromCloud = normalizeDeck(n.deck);
      const fromLocal = loadDeckLocal(n.id);
      setDeck(fromCloud || fromLocal);
      latest.current = {
        title: n.title,
        body: n.body_md,
        tags: n.tags || [],
        folder: n.folder || "",
        icon: n.icon || "",
        cover: n.cover || "",
        parent_id: n.parent_id || "",
      };
    });
  }, [id]);

  useEffect(() => {
    if (!user) return;
    return listenToUserNotes(user.uid, setAllNotes);
  }, [user]);

  useEffect(() => {
    if (!id || !prefsCtx) return;
    prefsCtx.setPrefs((p) => touchRecentId(p, id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    latest.current = { title, body, tags, folder, icon, cover, parent_id: parentId };
  }, [title, body, tags, folder, icon, cover, parentId]);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 1100px)");
    const apply = () => setAsideOpen(!mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  const flash = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(""), 2200);
  };

  const save = async (silent = false) => {
    if (!note) return;
    setStatus("saving");
    try {
      const inlineTags = extractTagsFromText(latest.current.body);
      const mergedTags = Array.from(new Set([...latest.current.tags, ...inlineTags]));
      await updateNote(note.id, {
        title: latest.current.title,
        body_md: latest.current.body,
        tags: mergedTags,
        folder: latest.current.folder,
        icon: latest.current.icon,
        cover: latest.current.cover,
        parent_id: latest.current.parent_id,
      });
      try {
        await pushNoteVersion(note.id, latest.current.title, latest.current.body);
      } catch { /* best-effort */ }
      setTags(mergedTags);
      setDirty(false);
      setStatus("saved");
      if (!silent) setTimeout(() => setStatus((s) => (s === "saved" ? "idle" : s)), 1800);
    } catch (e) {
      setStatus("error");
      setErrorMsg(e instanceof Error ? e.message : "儲存失敗");
    }
  };

  const markDirty = () => {
    setDirty(true);
    setStatus("dirty");
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => { void save(true); }, 1200);
  };

  useEffect(() => () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
  }, []);

  const runAi = async (action: NoteAiActionId) => {
    if (!body.trim() || aiBusy) return;
    setAiBusy(true);
    setAiError("");
    setAsideTab("ai");
    setAsideOpen(true);
    try {
      const res = await fetch("/api/ai/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, title, body }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "AI 失敗");
      const meta = NOTE_AI_ACTIONS.find((a) => a.id === action);
      const next =
        meta?.mode === "replace"
          ? data.text
          : `${body.trim()}\n\n---\n\n## AI ${meta?.label || action}\n\n${data.text}`;
      setBody(next);
      markDirty();
      flash(`已套用：${meta?.label || action}`);
    } catch (e) {
      setAiError(e instanceof Error ? e.message : "AI 失敗");
    } finally {
      setAiBusy(false);
    }
  };

  const stats = useMemo(() => computeNoteStats(body), [body]);
  const outline = useMemo(() => extractOutline(body), [body]);
  const related = useMemo(
    () =>
      note
        ? findRelatedNotes(
            { id: note.id, title, body_md: body, tags, folder },
            allNotes,
            6
          )
        : [],
    [note, title, body, tags, folder, allNotes]
  );

  const backlinks = useMemo(() => {
    if (!note) return [];
    return findBacklinks(allNotes, { id: note.id, title, body_md: body, tags });
  }, [allNotes, note, title, body, tags]);

  const outbound = useMemo(() => extractWikiLinks(body), [body]);

  useEffect(() => {
    if (!id) return;
    try {
      const m = sessionStorage.getItem(`cadence_view_${id}`);
      if (m === "slides" || m === "write") setViewMode(m);
      if (m === "slides") {
        setAsideOpen(true);
        setAsideTab("outline");
      }
    } catch {
      /* ignore */
    }
  }, [id]);

  const setMode = (mode: "write" | "slides") => {
    setViewMode(mode);
    if (id) {
      try {
        sessionStorage.setItem(`cadence_view_${id}`, mode);
      } catch {
        /* ignore */
      }
    }
  };

  const ensureDeck = (): SlideDeck => {
    if (deck?.slides?.length) return deck;
    const generated = deckFromMarkdown(title, body);
    setDeck(generated);
    if (note) {
      saveDeckLocal(note.id, generated);
      void updateNote(note.id, { deck: generated as unknown as Record<string, unknown> }).catch(
        () => undefined
      );
    }
    return generated;
  };

  const enterSlidesAt = (index?: number) => {
    let next = deck;
    const staleNow = isDeckStale(deck, title, body);
    if (!next?.slides?.length || staleNow) {
      next = deckFromMarkdown(title, body, deck?.theme || "teal");
      onDeckChange(next);
      if (staleNow && deck?.slides?.length) flash("已依筆記更新投影片");
    } else {
      next = ensureDeck();
    }
    const safeIdx =
      typeof index === "number"
        ? Math.max(0, Math.min(index, (next?.slides.length || 1) - 1))
        : null;
    if (safeIdx != null && note) {
      try {
        sessionStorage.setItem(`cadence_slide_idx_${note.id}`, String(safeIdx));
      } catch {
        /* ignore */
      }
      setSlideFocusIndex(safeIdx);
      setSlideFocusNonce((n) => n + 1);
    } else {
      setSlideFocusIndex(null);
    }
    setMode("slides");
    // Keep outline available for jump ↔ slides
    setAsideOpen(true);
    setAsideTab("outline");
  };

  const enterSlides = () => enterSlidesAt();

  const enterWrite = () => {
    setMode("write");
    setSlideFocusIndex(null);
  };

  const findSlideIndexForHeading = (heading: string): number => {
    const sections = splitMarkdownSections(title, body);
    let idx = sections.findIndex((s) => s.title.trim() === heading.trim());
    if (idx < 0) {
      idx = sections.findIndex(
        (s) => s.title.includes(heading) || heading.includes(s.title)
      );
    }
    if (idx >= 0) return idx;
    if (deck?.slides?.length) {
      idx = deck.slides.findIndex((s) =>
        (s.blocks.find((b) => b.role === "title")?.text || "").includes(heading)
      );
      if (idx >= 0) return idx;
    }
    return 0;
  };

  const onDeckChange = (next: SlideDeck) => {
    setDeck(next);
    if (note) {
      saveDeckLocal(note.id, next);
      void updateNote(note.id, { deck: next as unknown as Record<string, unknown> }).catch(() => {
        /* local still ok */
      });
    }
  };

  useEffect(() => {
    if (viewMode !== "slides" || !note) return;
    if (deck?.slides?.length) return;
    const generated = deckFromMarkdown(title, body);
    setDeck(generated);
    saveDeckLocal(note.id, generated);
  }, [viewMode, note, deck, title, body]);

  const linkCandidates = useMemo(() => {
    const q = linkPicker.trim().toLowerCase();
    const list = allNotes.filter((n) => n.id !== note?.id);
    if (!q) return list.slice(0, 8);
    return list.filter((n) => n.title.toLowerCase().includes(q)).slice(0, 8);
  }, [allNotes, linkPicker, note?.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void save(false);
      }
      if (mod && e.key.toLowerCase() === "f") {
        e.preventDefault();
        setFindOpen(true);
      }
      if (mod && e.key === "\\") {
        e.preventDefault();
        setAsideOpen((v) => !v);
      }
      if (mod && e.shiftKey && e.key.toLowerCase() === "f") {
        e.preventDefault();
        setFocusMode((v) => !v);
      }
      // Toggle write / slides
      if (mod && e.key === ".") {
        e.preventDefault();
        if (viewMode === "slides") enterWrite();
        else enterSlides();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note?.id, viewMode, deck, title, body]);

  const insertWiki = (noteTitle: string) => {
    setBody((b) => `${b.trim()}${b.trim() ? "\n\n" : ""}[[${noteTitle}]]\n`);
    markDirty();
    setLinkPicker("");
    flash(`已插入 [[${noteTitle}]]`);
  };

  const duplicate = async () => {
    if (!user || !note) return;
    const newId = await createNote(
      user.uid,
      `${title || "未命名"}（副本）`,
      body,
      note.source_job_id,
      tags,
      { folder, status: note.status }
    );
    flash("已建立副本");
    router.push(`/notes/${newId}`);
  };

  const remove = async () => {
    if (!note) return;
    if (!confirm("刪除此筆記？此操作無法復原。")) return;
    await deleteNote(note.id);
    router.push("/library");
  };

  const copyMd = async () => {
    await navigator.clipboard.writeText(`# ${title}\n\n${body}`);
    flash("已複製 Markdown");
  };

  const copyLink = async () => {
    await navigator.clipboard.writeText(window.location.href);
    flash("已複製頁面連結");
  };

  const jumpHeading = (item: HeadingItem) => {
    if (viewMode === "slides") {
      enterSlidesAt(findSlideIndexForHeading(item.text));
      return;
    }
    const root = document.querySelector(".rich-prose");
    if (!root) return;
    const tag = `H${item.level}`;
    const nodes = Array.from(root.querySelectorAll(tag));
    const hit = nodes.find((n) => (n.textContent || "").trim() === item.text.trim());
    hit?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const openSlideForHeading = (item: HeadingItem) => {
    enterSlidesAt(findSlideIndexForHeading(item.text));
  };

  const onAsideResize = (px: number) => {
    setAsideWidth(px);
    try {
      localStorage.setItem("cadence_note_aside_w", String(px));
    } catch {
      /* ignore */
    }
  };

  const deckStale = isDeckStale(deck, title, body);
  const slideCountHint =
    deck?.slides?.length ||
    Math.max(1, splitMarkdownSections(title, body).length);
  const previewTheme = getTheme(deck?.theme || "teal");
  const previewSlides = useMemo(() => {
    if (deck?.slides?.length && !deckStale) {
      return deck.slides.map((s, i) => ({
        id: s.id,
        index: i,
        label: s.blocks.find((b) => b.role === "title")?.text || `第 ${i + 1} 頁`,
      }));
    }
    return splitMarkdownSections(title, body).map((s, i) => ({
      id: `pv_${i}`,
      index: i,
      label: s.title || `第 ${i + 1} 頁`,
    }));
  }, [deck, deckStale, title, body]);

  if (loading) return <p style={{ color: "var(--text-muted)", padding: "2rem" }}>載入中…</p>;
  if (!user) return <p style={{ padding: "2rem" }}>請先登入。</p>;
  if (!note) return <p style={{ color: "var(--text-muted)", padding: "2rem" }}>載入筆記中或找不到。</p>;
  if (note.user_id !== user.uid) return <p style={{ padding: "2rem" }}>無權限。</p>;

  const statusLabel =
    status === "saving" ? "儲存中"
      : status === "saved" ? "已儲存"
        : status === "dirty" ? "未儲存變更"
          : status === "error" ? errorMsg
            : "";

  const addTag = () => {
    const t = tagInput.trim().replace(/^#/, "");
    if (!t || tags.includes(t)) return;
    setTags([...tags, t]);
    setTagInput("");
    markDirty();
  };

  return (
    <div
      className={`doc-workspace${focusMode ? " is-focus" : ""}${asideOpen ? " has-aside" : ""}${pageMode ? " is-page" : ""}${viewMode === "slides" ? " is-slides" : ""}`}
      style={{ ["--note-aside-w" as string]: `${asideWidth}px` }}
    >
      <div className={`doc-ribbon${viewMode === "slides" ? " is-hidden" : ""}`} ref={setRibbonHost} />

      <div className="doc-command">
        <div className="doc-command-left">
          <Link href="/library" className="doc-crumb">知識庫</Link>
          {splitFolderPath(folder).map((seg, i, arr) => {
            const path = arr.slice(0, i + 1).join("/");
            return (
              <span key={path} style={{ display: "contents" }}>
                <span className="doc-crumb-sep">/</span>
                <Link
                  href={`/library?folder=${encodeURIComponent(path)}`}
                  className="doc-crumb"
                >
                  {seg}
                </Link>
              </span>
            );
          })}
          {parentId && (() => {
            const parent = allNotes.find((n) => n.id === parentId);
            return parent ? (
              <>
                <span className="doc-crumb-sep">/</span>
                <Link href={`/notes/${parent.id}`} className="doc-crumb">
                  {parent.icon ? `${parent.icon} ` : ""}{parent.title || "上層"}
                </Link>
              </>
            ) : null;
          })()}
          <span className="doc-crumb-sep">/</span>
          <span className="doc-crumb-current">{title || "未命名"}</span>
          {statusLabel && (
            <span className={`doc-save-pill${status === "error" ? " is-error" : ""}`}>{statusLabel}</span>
          )}
          <div className="doc-view-switch" role="tablist" aria-label="檢視模式">
            <button
              type="button"
              role="tab"
              aria-selected={viewMode === "write"}
              className={viewMode === "write" ? "is-on" : ""}
              onClick={enterWrite}
              title="寫作 ⌘."
            >
              寫作
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={viewMode === "slides"}
              className={viewMode === "slides" ? "is-on" : ""}
              onClick={enterSlides}
              title="簡報 ⌘."
            >
              簡報
            </button>
          </div>
        </div>
        <div className="doc-command-actions">
          {viewMode === "slides" && slideActions && (
            <>
              {slideActions.busy && <span className="slide-busy">{slideActions.busy}</span>}
              {slideActions.stale && (
                <button type="button" className="doc-cmd is-on" onClick={() => slideActions.sync()}>
                  同步筆記
                </button>
              )}
              <div className="slide-export-wrap">
                <button
                  type="button"
                  className={`doc-cmd${exportMenuOpen ? " is-on" : ""}`}
                  onClick={() => setExportMenuOpen((v) => !v)}
                >
                  匯出
                </button>
                {exportMenuOpen && (
                  <div className="slide-export-menu">
                    <button
                      type="button"
                      onClick={() => {
                        setExportMenuOpen(false);
                        void slideActions.exportPng();
                      }}
                    >
                      目前頁 PNG
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setExportMenuOpen(false);
                        slideActions.exportPdf();
                      }}
                    >
                      全部 PDF
                    </button>
                  </div>
                )}
              </div>
              <button type="button" className="doc-cmd slide-play-btn" onClick={() => slideActions.play()}>
                播放
              </button>
            </>
          )}
          <button
            type="button"
            className={`doc-cmd${(prefsCtx?.prefs.favoriteNoteIds || []).includes(note.id) ? " is-on" : ""}`}
            title="收藏"
            onClick={() => prefsCtx?.setPrefs((p) => toggleFavoriteId(p, note.id))}
          >
            ★
          </button>
          {viewMode === "write" && (
            <>
              <button
                type="button"
                className="doc-cmd"
                title="新增子頁面"
                onClick={() => {
                  if (!user) return;
                  void (async () => {
                    const name = window.prompt("子頁面標題", "未命名子頁");
                    if (name == null) return;
                    const t = name.trim() || "未命名子頁";
                    const id = await createNote(user.uid, t, "", undefined, [], {
                      parent_id: note.id,
                      status: "backlog",
                      folder: folder || "",
                    });
                    const nextBody = `${body.trim()}${body.trim() ? "\n\n" : ""}[[${t}]]\n`;
                    setBody(nextBody);
                    latest.current = { ...latest.current, body: nextBody };
                    try {
                      await updateNote(note.id, {
                        title: latest.current.title,
                        body_md: nextBody,
                        tags: latest.current.tags,
                        folder: latest.current.folder,
                        icon: latest.current.icon,
                        cover: latest.current.cover,
                        parent_id: latest.current.parent_id,
                      });
                    } catch {
                      markDirty();
                    }
                    flash(`已建立子頁：${t}`);
                    router.push(`/notes/${id}`);
                  })();
                }}
              >
                子頁
              </button>
              <button type="button" className="doc-cmd" onClick={() => setFindOpen(true)}>尋找</button>
              <button type="button" className="doc-cmd" disabled={aiBusy || !body.trim()} onClick={() => void runAi("summarize")}>
                {aiBusy ? "AI…" : "摘要"}
              </button>
              <button type="button" className="doc-cmd" disabled={aiBusy || !body.trim()} onClick={() => void runAi("actions")}>
                抽待辦
              </button>
              <button type="button" className={`doc-cmd${focusMode ? " is-on" : ""}`} onClick={() => setFocusMode((v) => !v)}>
                專注
              </button>
              <button
                type="button"
                className={`doc-cmd${pageMode ? " is-on" : ""}`}
                title="頁面模式（A4）"
                onClick={() => {
                  setPageMode((v) => {
                    const next = !v;
                    try {
                      localStorage.setItem("cadence_page_mode", next ? "1" : "0");
                    } catch {
                      /* ignore */
                    }
                    return next;
                  });
                }}
              >
                頁面
              </button>
            </>
          )}
          <button type="button" className={`doc-cmd${asideOpen ? " is-on" : ""}`} onClick={() => setAsideOpen((v) => !v)}>
            側欄
          </button>
          <div className="doc-more-wrap">
            <button type="button" className="doc-cmd" onClick={() => setMoreOpen((v) => !v)}>更多</button>
            {moreOpen && (
              <div className="doc-more-menu">
                {[
                  { label: "改寫", fn: () => runAi("rewrite") },
                  { label: "擴寫", fn: () => runAi("expand") },
                  { label: "產出大綱", fn: () => runAi("outline") },
                  { label: "出測驗題", fn: () => runAi("quiz") },
                  { label: "白話說明", fn: () => runAi("explain") },
                  {
                    label: "版本歷史",
                    fn: async () => {
                      setVersionsOpen(true);
                      setVersions(await listNoteVersions(note.id));
                    },
                  },
                  { label: "複製 Markdown", fn: () => copyMd() },
                  { label: "複製連結", fn: () => copyLink() },
                  { label: "複製筆記", fn: () => duplicate() },
                  { label: "匯出 Markdown", fn: () => downloadMarkdown(title, body) },
                  { label: "匯出 PDF", fn: () => downloadPdfViaPrint(title, body) },
                  { label: "匯出 DOCX", fn: () => { void downloadDocx(title, body); } },
                  { label: "匯出簡報大綱", fn: () => downloadPptOutline(title, body) },
                  { label: "手動儲存", fn: () => save(false) },
                  { label: "刪除筆記", fn: () => remove(), danger: true },
                ].map((item) => (
                  <button
                    key={item.label}
                    type="button"
                    className={`doc-more-item${item.danger ? " is-danger" : ""}`}
                    onClick={() => { void item.fn(); setMoreOpen(false); }}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="doc-body-row">
        <div className={`doc-page${viewMode === "slides" ? " doc-page--slides" : ""}`}>
          {aiError && viewMode === "write" && <p className="doc-banner-error">{aiError}</p>}
          {toast && <p className="doc-toast">{toast}</p>}

          {viewMode === "write" && versionsOpen && (
            <div className="doc-versions">
              <div className="doc-versions-head">
                <strong>版本歷史</strong>
                <button type="button" className="doc-cmd" onClick={() => setVersionsOpen(false)}>關閉</button>
              </div>
              {versions.length === 0 ? (
                <p className="note-aside-empty">尚無快照。</p>
              ) : versions.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  className="doc-version-row"
                  onClick={() => {
                    if (!confirm("還原此版本？")) return;
                    setTitle(v.title);
                    setBody(v.body_md);
                    markDirty();
                    setVersionsOpen(false);
                  }}
                >
                  <span>{v.title || "（無標題）"}</span>
                  <span>{v.created_at.toLocaleString("zh-TW")}</span>
                </button>
              ))}
            </div>
          )}

          {viewMode === "write" && cover && (
            <div
              className="doc-cover"
              style={{ backgroundImage: `url(${cover})` }}
              title="封面"
            >
              <button
                type="button"
                className="doc-cover-clear"
                onClick={() => {
                  setCover("");
                  markDirty();
                }}
              >
                移除封面
              </button>
            </div>
          )}

          <div className={`doc-title-row${viewMode === "slides" ? " is-compact" : ""}`}>
            <div className="doc-icon-wrap">
              <button
                type="button"
                className="doc-icon-btn"
                onClick={() => viewMode === "write" && setIconOpen((v) => !v)}
                title="頁面圖示"
              >
                {icon || "📄"}
              </button>
              {iconOpen && viewMode === "write" && (
                <div className="doc-icon-menu">
                  <button
                    type="button"
                    onClick={() => {
                      setIcon("");
                      setIconOpen(false);
                      markDirty();
                    }}
                  >
                    無
                  </button>
                  {PAGE_ICONS.map((ic) => (
                    <button
                      key={ic}
                      type="button"
                      onClick={() => {
                        setIcon(ic);
                        setIconOpen(false);
                        markDirty();
                      }}
                    >
                      {ic}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <input
              className="doc-title"
              value={title}
              onChange={(e) => { setTitle(e.target.value); markDirty(); }}
              placeholder="無標題"
            />
          </div>

          {viewMode === "write" && (
            <>
              <div className="doc-chrome-actions">
                {!cover && (
                  <button
                    type="button"
                    className="doc-cmd"
                    onClick={() => {
                      const url = window.prompt("封面圖片網址", "https://");
                      if (!url) return;
                      setCover(url.trim());
                      markDirty();
                    }}
                  >
                    加封面
                  </button>
                )}
              </div>

              <div className="doc-props">
                <input
                  className="doc-prop-input"
                  placeholder="資料夾"
                  value={folder}
                  onChange={(e) => { setFolder(e.target.value); markDirty(); }}
                />
                {tags.map((t) => (
                  <button
                    key={t}
                    type="button"
                    className="badge"
                    style={{ cursor: "pointer", border: "none", fontWeight: 500 }}
                    onClick={() => { setTags(tags.filter((x) => x !== t)); markDirty(); }}
                  >
                    #{t}
                  </button>
                ))}
                <input
                  className="doc-prop-input"
                  placeholder="加標籤…"
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addTag(); } }}
                />
                <MenuSelect
                  variant="pill"
                  ariaLabel="筆記狀態"
                  value={note.status === "doing" || note.status === "done" ? note.status : "backlog"}
                  options={NOTE_STATUS_OPTIONS}
                  onChange={(v) => {
                    void updateNote(note.id, { status: v as Note["status"] });
                    setNote({ ...note, status: v as Note["status"] });
                  }}
                />
                <span className="doc-meta-chip">{stats.words} 字 · {stats.readingMins} 分</span>
                {note.source_job_id && (
                  <Link href={`/job/${note.source_job_id}`} className="doc-prop-input" style={{ color: "var(--accent-2)" }}>
                    來源逐字稿
                  </Link>
                )}
              </div>

              <div className="doc-slide-bridge-block">
                <button
                  type="button"
                  className={`doc-slide-bridge${deckStale ? " is-stale" : ""}`}
                  onClick={() => enterSlidesAt()}
                >
                  <span className="doc-slide-bridge-main">
                    {deck?.slides?.length ? `編輯簡報 · ${slideCountHint} 頁` : `產生簡報 · 約 ${slideCountHint} 頁`}
                  </span>
                  <span className="doc-slide-bridge-hint">
                    {deckStale && deck?.slides?.length ? "進入時會自動同步筆記 · " : ""}
                    點下方縮圖直達該頁 · ⌘.
                  </span>
                </button>
                <div className="doc-slide-strip" role="list" aria-label="投影片預覽">
                  {previewSlides.slice(0, 12).map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      role="listitem"
                      className="doc-slide-strip-item"
                      style={{
                        background: previewTheme.bg,
                        color: previewTheme.fg,
                        borderColor: previewTheme.accent,
                      }}
                      onClick={() => enterSlidesAt(s.index)}
                      title={s.label}
                    >
                      <span className="doc-slide-strip-accent" style={{ background: previewTheme.accent }} />
                      <span className="doc-slide-strip-num">{s.index + 1}</span>
                      <span className="doc-slide-strip-label">{s.label}</span>
                    </button>
                  ))}
                  {previewSlides.length > 12 && (
                    <button
                      type="button"
                      className="doc-slide-strip-more"
                      onClick={() => enterSlidesAt(12)}
                    >
                      +{previewSlides.length - 12}
                    </button>
                  )}
                </div>
              </div>
            </>
          )}

          {viewMode === "slides" && (
            <div className="doc-slide-back">
              <button type="button" className="doc-cmd" onClick={enterWrite}>
                ← 回寫作
              </button>
              <span>同一則筆記 · 左側大綱可跳投影片</span>
            </div>
          )}

          <div className={`doc-pane doc-pane--write${viewMode === "write" ? " is-active" : ""}`} aria-hidden={viewMode !== "write"}>
            <div className="doc-link-insert">
            <input
              className="doc-prop-input"
              style={{ flex: 1, minWidth: 160 }}
              placeholder="插入雙向連結 [[筆記標題]]…"
              value={linkPicker}
              onChange={(e) => setLinkPicker(e.target.value)}
            />
            {linkPicker && (
              <div className="doc-link-menu">
                {linkCandidates.length === 0 ? (
                  <button type="button" onClick={() => insertWiki(linkPicker.trim())}>
                    {`建立 [[${linkPicker.trim()}]]`}
                  </button>
                ) : (
                  linkCandidates.map((n) => (
                    <button key={n.id} type="button" onClick={() => insertWiki(n.title)}>
                      {n.title}
                    </button>
                  ))
                )}
              </div>
            )}
          </div>

          <div className="doc-editor-shell">
            <RichNoteEditor
              valueMd={body}
              onChangeMd={(md) => { setBody(md); markDirty(); }}
              placeholder="輸入文字，或輸入 / 插入區塊…"
              findOpen={findOpen}
              onFindOpenChange={setFindOpen}
              toolbarHost={ribbonHost}
              userId={user.uid}
              noteId={note.id}
              wikiNotes={allNotes}
              pageMode={pageMode}
              showEmptyTemplates
              onEmptyTemplate={(tid) => {
                const tpl = NOTE_TEMPLATES.find((t) => t.id === tid);
                if (!tpl) return;
                if (tpl.title && !title.trim()) setTitle(tpl.title);
                setBody(tpl.body);
                if (tpl.tags.length) setTags(Array.from(new Set([...tags, ...tpl.tags])));
                markDirty();
                flash(`已套用範本：${tpl.label}`);
              }}
              onCreateSubpage={async (pageTitle) => {
                if (!user || !note) return null;
                try {
                  const t = pageTitle.trim() || "未命名子頁";
                  const id = await createNote(user.uid, t, "", undefined, [], {
                    parent_id: note.id,
                    status: "backlog",
                    folder: folder || "",
                  });
                  flash(`已建立子頁：${t}`);
                  return { id, title: t };
                } catch (e) {
                  flash(e instanceof Error ? e.message : "建立子頁失敗");
                  return null;
                }
              }}
            />
          </div>

          <section className="doc-backlinks">
            <h3>連結圖譜</h3>
            <div className="doc-link-grid">
              <div>
                <p className="doc-link-label">此頁連出</p>
                {outbound.length === 0 ? (
                  <p className="note-aside-empty">尚無 [[連結]]</p>
                ) : outbound.map((t) => {
                  const hit = findNoteByTitle(allNotes, t);
                  return hit ? (
                    <div key={t}><Link href={`/notes/${hit.id}`} className="doc-link-item">{t}</Link></div>
                  ) : (
                    <div key={t} className="doc-link-missing">{t}（未建立）</div>
                  );
                })}
              </div>
              <div>
                <p className="doc-link-label">連到此頁</p>
                {backlinks.length === 0 ? (
                  <p className="note-aside-empty">尚無反向連結</p>
                ) : backlinks.map((n) => (
                  <div key={n.id}><Link href={`/notes/${n.id}`} className="doc-link-item">{n.title}</Link></div>
                ))}
              </div>
            </div>
          </section>
          </div>

          <div className={`doc-pane doc-pane--slides${viewMode === "slides" ? " is-active" : ""}`} aria-hidden={viewMode !== "slides"}>
            {deck ? (
              <SlideStudio
                open={viewMode === "slides"}
                noteId={note.id}
                noteTitle={title}
                noteBody={body}
                deck={deck}
                onChange={onDeckChange}
                onBackToWrite={enterWrite}
                onSynced={() => flash("已依筆記更新投影片")}
                onActionsChange={setSlideActions}
                focusIndex={slideFocusIndex}
                focusNonce={slideFocusNonce}
              />
            ) : (
              <p className="slide-loading">正在準備投影片…</p>
            )}
          </div>
        </div>

        <NoteAside
          open={asideOpen && !focusMode}
          tab={asideTab}
          onTab={setAsideTab}
          title={title}
          body={body}
          stats={stats}
          outline={outline}
          related={related}
          aiBusy={aiBusy}
          onAiAction={(a) => { void runAi(a); }}
          onInsertMarkdown={(md) => { setBody((b) => b + md); markDirty(); flash("已插入 AI 內容"); }}
          onJumpHeading={jumpHeading}
          onOpenSlideForHeading={openSlideForHeading}
          widthPx={asideWidth}
          onResizeWidth={onAsideResize}
        />
      </div>
    </div>
  );
}