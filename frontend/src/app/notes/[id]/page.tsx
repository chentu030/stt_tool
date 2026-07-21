"use client";

import PageLoading from "@/components/motion/PageLoading";

import { askPrompt, askConfirm } from "@/lib/dialogs";
import { toast } from "@/lib/toast";
import {
  resolveMediaIngestChoice,
  formatIngestBlock,
  loadPendingIngests,
  removePendingIngest,
  replaceIngestMarker,
  startTranscriptionJob,
  summarizeTranscript,
  upsertPendingIngest,
  watchJob,
  loadJobPlainTranscript,
  finalizePendingIngest,
  type TranscribableMedia,
  type MediaIngestChoice,
  type PendingIngest,
} from "@/lib/noteMediaIngest";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
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
import { takeNoteBodySeed } from "@/lib/jobToNote";
import NoteAppSurface from "@/components/workspace/NoteAppSurface";
import RichNoteEditor from "@/components/RichNoteEditor";
import ShareDialog from "@/components/ShareDialog";
import MenuSelect, { NOTE_STATUS_OPTIONS } from "@/components/MenuSelect";
import { parseNoteShare, type NoteShare } from "@/lib/share";
import NoteAside from "@/components/notes/NoteAside";
import { openGlobalAiRail } from "@/components/shell/GlobalAiDock";
import NoteSplitPane from "@/components/notes/NoteSplitPane";
import NoteSplitResizer, { useNoteSplitLayout } from "@/components/notes/NoteSplitResizer";
import { useNoteTabsOptional } from "@/components/notes/NoteTabsProvider";
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
import { buildResearchUrl, takeResearchInsert } from "@/lib/researchBridge";
import {
  NOTE_AI_ACTIONS,
  NoteAiActionId,
  HeadingItem,
  computeNoteStats,
  extractOutline,
  findRelatedNotes,
} from "@/lib/noteMeta";
import { buildNoteAiContext } from "@/lib/noteAiContext";
import { findCadenceAiAction } from "@/lib/cadenceAiActions";
import { usePrefsOptional } from "@/components/PrefsProvider";
import { toggleFavoriteId, touchRecentId } from "@/lib/userPrefs";
import { NOTE_TEMPLATES } from "@/lib/templates";
import { allNoteTemplates } from "@/lib/community/templateBridge";
import { useCommunityOptional } from "@/components/community/CommunityProvider";
import { splitFolderPath } from "@/lib/noteTree";
import { FocusModeProvider, useFocusMode } from "@/components/notes/FocusModeProvider";
import NotePresence from "@/components/notes/NotePresence";
import NoteHuddle from "@/components/notes/NoteHuddle";
import NotePageLog from "@/components/notes/NotePageLog";
import BlockThreadPanel from "@/components/notes/BlockThreadPanel";
import IconColorPicker from "@/components/IconColorPicker";
import ColorSwatchUtility from "@/components/ColorSwatchUtility";
import PageChromeIcon from "@/components/PageChromeIcon";
import { fireConfetti } from "@/lib/confetti";
import { normalizePageColor, normalizePageIcon, pageColorMeta } from "@/lib/pageChrome";
import { isFullScreenAppLink, isNoteAppSurface, noteOpenHref } from "@/lib/workspacePages";

function countTaskCheckboxes(md: string): { total: number; checked: number } {
  const unchecked = md.match(/^\s*[-*]\s\[ \]/gim)?.length || 0;
  const checked = md.match(/^\s*[-*]\s\[[xX]\]/gim)?.length || 0;
  return { total: unchecked + checked, checked };
}

export default function NotePage() {
  return (
    <FocusModeProvider>
      <NotePageInner />
    </FocusModeProvider>
  );
}

function NotePageInner() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const tabs = useNoteTabsOptional();
  const splitId = tabs?.splitId || searchParams.get("split") || null;
  const [splitLayout, setSplitLayout] = useNoteSplitLayout();
  const { user, loading } = useAuth();
  const prefsCtx = usePrefsOptional();
  const community = useCommunityOptional();
  const noteTemplates = useMemo(
    () => allNoteTemplates(community?.enabledTemplates),
    [community?.enabledTemplates]
  );
  const [note, setNote] = useState<Note | null>(null);
  const [allNotes, setAllNotes] = useState<Note[]>([]);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [folder, setFolder] = useState("");
  const [icon, setIcon] = useState("");
  const [color, setColor] = useState("");
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
  const moreWrapRef = useRef<HTMLDivElement | null>(null);
  const exportWrapRef = useRef<HTMLDivElement | null>(null);
  const [viewMode, setViewMode] = useState<"write" | "slides">("write");
  const [deck, setDeck] = useState<SlideDeck | null>(null);
  const [slideActions, setSlideActions] = useState<SlideStudioActions | null>(null);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [slideFocusIndex, setSlideFocusIndex] = useState<number | null>(null);
  const [slideFocusNonce, setSlideFocusNonce] = useState(0);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [versions, setVersions] = useState<NoteVersion[]>([]);
  const [ribbonHost, setRibbonHost] = useState<HTMLDivElement | null>(null);
  const [asideOpen, setAsideOpen] = useState(() => {
    if (typeof window === "undefined") return true;
    try {
      const saved = localStorage.getItem("cadence_note_aside_open");
      if (saved === "0") return false;
      if (saved === "1") return true;
    } catch {
      /* ignore */
    }
    return true;
  });
  const [asideTab, setAsideTab] = useState<"outline" | "info">("outline");
  const asideManualRef = useRef(false);
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
  /** App surfaces (extension / specialty): fill content area below chrome */
  const [appFill, setAppFill] = useState(true);
  const [threadSelection, setThreadSelection] = useState<string | null>(null);
  const teamFocus = useFocusMode();
  const allCheckedRef = useRef(false);
  const [pageMode, setPageMode] = useState(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem("cadence_page_mode") === "1";
  });
  const [linkPicker, setLinkPicker] = useState("");
  const [ingestStatus, setIngestStatus] = useState("");
  const [ingestJobId, setIngestJobId] = useState<string | null>(null);
  const [ingestError, setIngestError] = useState("");
  const ingestBusy = useRef(false);
  const ingestQueue = useRef<TranscribableMedia[]>([]);
  const ingestAskTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ingestCancel = useRef<(() => void) | null>(null);
  const ingestWatching = useRef<Set<string>>(new Set());
  const [iconOpen, setIconOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [noteShare, setNoteShare] = useState<NoteShare | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mainScrollRef = useRef<HTMLDivElement | null>(null);
  const scrollRestored = useRef<string | null>(null);
  const insertMdRef = useRef<((md: string) => void) | null>(null);
  const latest = useRef({
    title: "",
    body: "",
    tags: [] as string[],
    folder: "",
    icon: "",
    color: "",
    cover: "",
    parent_id: "",
  });

  useEffect(() => {
    if (!id) return;
    getNote(id).then((n) => {
      if (!n) return;
      const seeded = takeNoteBodySeed(id);
      // Prefer non-empty seed / cloud body so we never paint an empty editor over fresh AI notes.
      const bodyMd = (seeded && seeded.trim()) || n.body_md || "";
      if (seeded && seeded.trim() && seeded.trim() !== (n.body_md || "").trim()) {
        void updateNote(id, { body_md: seeded }).catch(() => {});
      }
      setNote(n);
      setTitle(n.title);
      setBody(bodyMd);
      setTags(n.tags || []);
      setFolder(n.folder || "");
      setIcon(normalizePageIcon(n.icon || ""));
      setColor(normalizePageColor(n.color));
      setCover(n.cover || "");
      setParentId(n.parent_id || "");
      setNoteShare(parseNoteShare(n.share));
      const fromCloud = normalizeDeck(n.deck);
      const fromLocal = loadDeckLocal(n.id);
      setDeck(fromCloud || fromLocal);
      latest.current = {
        title: n.title,
        body: bodyMd,
        tags: n.tags || [],
        folder: n.folder || "",
        icon: normalizePageIcon(n.icon || ""),
        color: normalizePageColor(n.color),
        cover: n.cover || "",
        parent_id: n.parent_id || "",
      };
    });
  }, [id, router]);

  // Specialty apps own full-screen routes — leave the note shell (iframe) path.
  // Keep note shell when split-view is active so both panes can stay on /notes.
  useEffect(() => {
    if (!note || splitId) return;
    if (!isFullScreenAppLink(note.app_link)) return;
    router.replace(noteOpenHref(note));
  }, [note, splitId, router]);

  // Consume research insert handoff (when returning from /research)
  useEffect(() => {
    if (!id) return;
    const flag = searchParams.get("researchInserted");
    if (flag !== "1") return;

    const pending = takeResearchInsert(id);
    void getNote(id).then((n) => {
      if (!n) return;
      let next = n.body_md || "";
      if (pending && !next.includes(pending.trim().slice(0, 80))) {
        next = `${next.trim()}${pending}`;
        void updateNote(id, { body_md: next });
      }
      setBody(next);
      latest.current = { ...latest.current, body: next };
      toast("深度研究已寫入本篇");
    });

    const url = new URL(window.location.href);
    url.searchParams.delete("researchInserted");
    window.history.replaceState({}, "", url.pathname + (url.search || ""));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, searchParams]);

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
    latest.current = { title, body, tags, folder, icon, color, cover, parent_id: parentId };
  }, [title, body, tags, folder, icon, color, cover, parentId]);

  useEffect(() => {
    teamFocus.setFocusMode(focusMode);
  }, [focusMode, teamFocus]);

  useEffect(() => {
    if (!note?.id || !isNoteAppSurface(note.app_link)) return;
    try {
      const v = sessionStorage.getItem(`albireus_app_fill_${note.id}`);
      if (v === "0") setAppFill(false);
      else if (v === "1") setAppFill(true);
      else setAppFill(true);
    } catch {
      setAppFill(true);
    }
  }, [note?.id, note?.app_link]);

  useEffect(() => {
    if (!moreOpen && !exportMenuOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      const t = e.target as Node | null;
      if (!t) return;
      if (moreOpen && moreWrapRef.current && !moreWrapRef.current.contains(t)) {
        setMoreOpen(false);
      }
      if (exportMenuOpen && exportWrapRef.current && !exportWrapRef.current.contains(t)) {
        setExportMenuOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setMoreOpen(false);
        setExportMenuOpen(false);
      }
    };
    // capture so editor/stopPropagation inside main can't block dismiss
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [moreOpen, exportMenuOpen]);

  useEffect(() => {
    const { total, checked } = countTaskCheckboxes(body);
    const allDone = total > 0 && checked === total;
    if (allDone && !allCheckedRef.current) {
      fireConfetti();
    }
    allCheckedRef.current = allDone;
  }, [body]);

  useEffect(() => {
    // Prefer user setting when no explicit local override
    try {
      if (localStorage.getItem("cadence_note_aside_open") != null) return;
    } catch {
      /* ignore */
    }
    if (prefsCtx?.prefs.editorShowOutline === false) {
      setAsideOpen(false);
    } else if (prefsCtx?.prefs.editorShowOutline === true && !asideManualRef.current) {
      setAsideOpen(true);
    }
  }, [prefsCtx?.prefs.editorShowOutline]);

  useEffect(() => {
    // Only auto-collapse on true mobile widths; desktop stays open by default
    const mq = window.matchMedia("(max-width: 720px)");
    const apply = () => {
      if (asideManualRef.current) return;
      try {
        if (localStorage.getItem("cadence_note_aside_open") != null) return;
      } catch {
        /* ignore */
      }
      if (mq.matches) setAsideOpen(false);
      else if (prefsCtx?.prefs.editorShowOutline !== false) setAsideOpen(true);
    };
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [prefsCtx?.prefs.editorShowOutline]);

  const toggleAside = () => {
    asideManualRef.current = true;
    setAsideOpen((v) => {
      const next = !v;
      try {
        localStorage.setItem("cadence_note_aside_open", next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  const save = async (silent = false) => {
    if (!note) return;
    const nextBody = latest.current.body;
    // Never autosave an empty body over a note that already has content (race after AI create).
    if (!nextBody.trim() && (note.body_md || "").trim()) {
      setDirty(false);
      setStatus("idle");
      return;
    }
    setStatus("saving");
    try {
      const inlineTags = extractTagsFromText(nextBody);
      const mergedTags = Array.from(new Set([...latest.current.tags, ...inlineTags]));
      await updateNote(note.id, {
        title: latest.current.title,
        body_md: nextBody,
        tags: mergedTags,
        folder: latest.current.folder,
        icon: latest.current.icon,
        color: latest.current.color || "",
        cover: latest.current.cover,
        parent_id: latest.current.parent_id,
      });
      try {
        await pushNoteVersion(note.id, latest.current.title, nextBody);
      } catch { /* best-effort */ }
      setNote((n) => (n ? { ...n, body_md: nextBody } : n));
      setTags(mergedTags);
      setDirty(false);
      setStatus("saved");
      setTimeout(() => setStatus((s) => (s === "saved" ? "idle" : s)), silent ? 1800 : 2200);
    } catch (e) {
      setStatus("error");
      setErrorMsg(e instanceof Error ? e.message : "儲存失敗");
    }
  };

  const markDirty = () => {
    setDirty(true);
    setStatus("dirty");
    if (saveTimer.current) clearTimeout(saveTimer.current);
    const secs = Math.min(30, Math.max(1, prefsCtx?.prefs.autosaveSeconds ?? 2));
    saveTimer.current = setTimeout(() => { void save(true); }, secs * 1000);
  };

  const applyIngestBody = useCallback(
    (nextBody: string, jobId: string) => {
      setBody(nextBody);
      latest.current = { ...latest.current, body: nextBody };
      setNote((n) => (n ? { ...n, source_job_id: jobId, body_md: nextBody } : n));
      markDirty();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  const runIngestPipeline = useCallback(
    async (
      mediaList: TranscribableMedia[],
      choice: Exclude<MediaIngestChoice, "embed">
    ) => {
      if (!user || !note || !mediaList.length) return;
      ingestBusy.current = true;
      setIngestError("");

      for (let i = 0; i < mediaList.length; i++) {
        const media = mediaList[i];
        const label =
          mediaList.length > 1 ? `${media.label}（${i + 1}/${mediaList.length}）` : media.label;
        try {
          setIngestStatus(`啟動轉錄：${label}`);
          const jobId = await startTranscriptionJob({
            uid: user.uid,
            getIdToken: () => user.getIdToken(),
            media,
            language: prefsCtx?.prefs.captureLanguage,
            onProgress: (msg, pct) =>
              setIngestStatus(pct != null ? `${msg} ${pct}%` : msg),
          });
          setIngestJobId(jobId);
          setNote((n) => (n ? { ...n, source_job_id: jobId } : n));
          try {
            await updateNote(note.id, { source_job_id: jobId });
          } catch {
            /* ignore */
          }

          const pending: PendingIngest = {
            noteId: note.id,
            jobId,
            choice,
            label: media.label,
            title: title || media.label,
            createdAt: Date.now(),
          };
          upsertPendingIngest(pending);
          toast("轉錄已在背景進行，可離開本頁，完成後會自動寫回");

          if (ingestWatching.current.has(jobId)) continue;
          ingestWatching.current.add(jobId);

          const { promise, cancel } = watchJob(jobId, (j) => {
            if (j.status === "processing") {
              setIngestStatus(`轉錄中 ${j.progress || 0}% · ${media.label}`);
            } else if (j.status === "queued") {
              const ahead = j.queue_ahead ?? 0;
              setIngestStatus(
                ahead > 0 ? `排隊中 · 前面 ${ahead} · ${media.label}` : `排隊中 · ${media.label}`
              );
            }
          });
          ingestCancel.current = cancel;
          setIngestStatus(`轉錄處理中 · ${media.label}`);

          try {
            const job = await promise;
            setIngestStatus("整理逐字稿…");
            const transcript = await loadJobPlainTranscript(job);
            let summary = "";
            if (choice === "transcribe_summarize" && transcript) {
              setIngestStatus("產生 AI 摘要…");
              summary = await summarizeTranscript({
                title: title || media.label,
                transcript,
                assistant: {
                  name: prefsCtx?.prefs.aiAssistantName,
                  style: prefsCtx?.prefs.aiStyle,
                  model: prefsCtx?.prefs.aiModel,
                  grounding: prefsCtx?.prefs.aiGrounding,
                },
              });
            }
            const block = formatIngestBlock({
              label: media.label,
              transcript: transcript || "（無內容）",
              summary: summary || undefined,
              jobId,
            });
            const currentBody = latest.current.body;
            const nextBody = replaceIngestMarker(currentBody, jobId, block);
            applyIngestBody(nextBody, jobId);
            removePendingIngest(jobId);
            toast(summary ? "已寫入逐字稿與 AI 摘要" : "已寫入逐字稿");
            setIngestStatus("");
            setIngestJobId(null);
            setIngestError("");
          } catch (e) {
            setIngestError(e instanceof Error ? e.message : "轉錄失敗");
            setIngestStatus("");
            toast(e instanceof Error ? e.message : "媒體轉錄失敗");
          } finally {
            ingestWatching.current.delete(jobId);
            if (ingestCancel.current === cancel) ingestCancel.current = null;
          }
        } catch (e) {
          setIngestError(e instanceof Error ? e.message : "啟動轉錄失敗");
          toast(e instanceof Error ? e.message : "啟動轉錄失敗");
        }
      }

      ingestBusy.current = false;
      // Only clear banner if nothing left to track
      if (ingestWatching.current.size === 0) {
        setIngestStatus("");
        setIngestJobId(null);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [user, note, title, prefsCtx, applyIngestBody]
  );

  const handleTranscribableMedia = useCallback(
    (media: TranscribableMedia) => {
      if (!user || !note) return;
      ingestQueue.current.push(media);
      if (ingestAskTimer.current) clearTimeout(ingestAskTimer.current);
      ingestAskTimer.current = setTimeout(() => {
        void (async () => {
          const batch = ingestQueue.current.splice(0);
          if (!batch.length) return;
          if (ingestBusy.current) {
            ingestQueue.current.push(...batch);
            toast("已排入下一批轉錄");
            return;
          }
          const resolved = await resolveMediaIngestChoice({
            label: batch[0].label,
            count: batch.length,
            defaultPref: prefsCtx?.prefs.mediaIngestDefault || "ask",
          });
          if (!resolved || resolved.choice === "embed") return;
          if (resolved.remember && prefsCtx) {
            prefsCtx.setPrefs({ mediaIngestDefault: resolved.choice });
          }
          await runIngestPipeline(batch, resolved.choice);
        })();
      }, 180);
    },
    [user, note, prefsCtx, runIngestPipeline]
  );

  useEffect(() => {
    if (!user || !note) return;
    const pendings = loadPendingIngests(note.id);
    for (const p of pendings) {
      if (ingestWatching.current.has(p.jobId)) continue;
      ingestWatching.current.add(p.jobId);
      setIngestJobId(p.jobId);
      setIngestStatus(`恢復轉錄追蹤 · ${p.label}`);
      void (async () => {
        try {
          const result = await finalizePendingIngest(p, {
            assistant: {
              name: prefsCtx?.prefs.aiAssistantName,
              style: prefsCtx?.prefs.aiStyle,
              model: prefsCtx?.prefs.aiModel,
              grounding: prefsCtx?.prefs.aiGrounding,
            },
            onProgress: (label) => setIngestStatus(`${label} · ${p.label}`),
          });
          if (result) {
            applyIngestBody(result.body, p.jobId);
            toast(result.summary ? "已寫入逐字稿與 AI 摘要" : "已寫入逐字稿");
          }
          setIngestStatus("");
          setIngestJobId(null);
        } catch (e) {
          setIngestError(e instanceof Error ? e.message : "轉錄失敗");
          setIngestStatus("");
        } finally {
          ingestWatching.current.delete(p.jobId);
        }
      })();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.uid, note?.id]);

  useEffect(() => () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    if (ingestAskTimer.current) clearTimeout(ingestAskTimer.current);
  }, []);

  const runAi = async (action: NoteAiActionId | string, prompt?: string) => {
    if (aiBusy) return;
    const catalog = findCadenceAiAction(action) || findCadenceAiAction(action.replace(/^ai-/, ""));
    const apiAction = catalog?.apiAction || action;
    const meta = NOTE_AI_ACTIONS.find((a) => a.id === action);
    const needsBody = ["summarize", "rewrite", "outline", "expand", "actions", "quiz", "explain"].includes(apiAction);
    if (needsBody && !body.trim()) return;

    setAiBusy(true);
    setAiError("");
    try {
      const pack = buildNoteAiContext({
        title,
        body,
        folder,
        status: note?.status,
        tags,
        relatedTitles: related.map((r) => r.title),
      });
      const res = await fetch("/api/ai/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: apiAction,
          title,
          body,
          context: pack.context,
          prompt: prompt || catalog?.prompt,
          assistant: {
            name: prefsCtx?.prefs.aiAssistantName,
            style: prefsCtx?.prefs.aiStyle,
            model: prefsCtx?.prefs.aiModel,
            grounding: prefsCtx?.prefs.aiGrounding,
          },
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "AI 失敗");
      const text = String(data.text || "").trim();
      if (!text) throw new Error("AI 無回覆");

      const mode = catalog?.insertMode || meta?.mode || "append";
      if (mode === "replace" || meta?.mode === "replace") {
        setBody(text);
      } else if (mode === "cursor" && insertMdRef.current) {
        insertMdRef.current(text);
      } else {
        const label = catalog?.label || meta?.label || action;
        setBody((b) => `${b.trim()}\n\n---\n\n## AI ${label}\n\n${text}`);
      }
      markDirty();
      toast(`已套用：${catalog?.label || meta?.label || action}`);
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

  const aiPack = useMemo(
    () =>
      buildNoteAiContext({
        title,
        body,
        folder,
        status: note?.status,
        tags,
        relatedTitles: related.map((r) => r.title),
      }),
    [title, body, folder, note?.status, tags, related]
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

  useEffect(() => {
    if (!id || !note || viewMode !== "write") return;
    if (scrollRestored.current === id) return;
    if (typeof window !== "undefined" && window.location.hash) {
      scrollRestored.current = id;
      return;
    }
    const el = mainScrollRef.current;
    if (!el) return;
    let top = 0;
    try {
      top = Number(sessionStorage.getItem(`cadence_scroll_${id}`)) || 0;
    } catch {
      top = 0;
    }
    scrollRestored.current = id;
    if (top <= 0) return;
    const t = window.setTimeout(() => {
      if (mainScrollRef.current) mainScrollRef.current.scrollTop = top;
    }, 80);
    return () => window.clearTimeout(t);
  }, [id, note, viewMode]);

  useEffect(() => {
    const el = mainScrollRef.current;
    if (!el || !id) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const onScroll = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        try {
          sessionStorage.setItem(`cadence_scroll_${id}`, String(el.scrollTop));
        } catch {
          /* ignore */
        }
      }, 200);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      if (timer) clearTimeout(timer);
    };
  }, [id, note]);

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
      if (staleNow && deck?.slides?.length) toast("已依筆記更新投影片");
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
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!dirty && status !== "saving") return;
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty, status]);

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
        toggleAside();
      }
      if (mod && e.key.toLowerCase() === "j") {
        e.preventDefault();
        setFocusMode(false);
        openGlobalAiRail();
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
    const t = noteTitle.trim();
    if (!t) return;
    setBody((b) => `${b.trim()}${b.trim() ? "\n\n" : ""}[[${t}]]\n`);
    markDirty();
    setLinkPicker("");
    toast(`已插入雙向連結 [[${t}]]`);
  };

  const openWikiNote = useCallback(
    async (noteTitle: string) => {
      const t = noteTitle.trim();
      if (!t || !user) return;
      const hit = findNoteByTitle(
        allNotes.map((n) => ({
          id: n.id,
          title: n.title,
          body_md: n.body_md,
          tags: n.tags,
        })),
        t
      );
      if (hit && hit.id === note?.id) {
        toast("已在此筆記");
        setLinkPicker("");
        return;
      }
      if (hit) {
        if (dirty) await save(false);
        setLinkPicker("");
        router.push(`/notes/${hit.id}`);
        return;
      }
      const ok = await askConfirm({
        title: `尚未有「${t}」`,
        message: "要建立這則筆記並開啟嗎？",
        confirmLabel: "建立並開啟",
      });
      if (!ok) return;
      if (dirty) await save(false);
      const id = await createNote(user.uid, t, "", undefined, [], {
        folder: folder || undefined,
        status: "backlog",
      });
      setLinkPicker("");
      toast(`已建立「${t}」`);
      router.push(`/notes/${id}`);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [user, allNotes, note?.id, dirty, folder, router]
  );

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
    toast("已建立副本");
    router.push(`/notes/${newId}`);
  };

  const remove = async () => {
    if (!note) return;
    if (!(await askConfirm({ title: "刪除此筆記？", message: "此操作無法復原。", danger: true, confirmLabel: "刪除" }))) return;
    await deleteNote(note.id);
    router.push("/library");
  };

  const copyMd = async () => {
    await navigator.clipboard.writeText(`# ${title}\n\n${body}`);
    toast("已複製 Markdown");
  };

  const copyLink = async () => {
    await navigator.clipboard.writeText(window.location.href);
    toast("已複製頁面連結");
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

  if (loading) return <PageLoading />;
  if (!user) return <p style={{ padding: "2rem" }}>請先登入。</p>;
  if (!note) return <PageLoading label="載入筆記中…" />;
  if (note.user_id !== user.uid) return <p style={{ padding: "2rem" }}>無權限。</p>;

  const statusLabel =
    status === "saving" ? "儲存中…"
      : status === "saved" ? "已自動儲存"
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

  const editorWidth = prefsCtx?.prefs.editorWidth || "medium";
  const widthExtended = editorWidth === "full" || editorWidth === "wide";
  const isAppPage = isNoteAppSurface(note.app_link);
  const toggleAppFill = () => {
    setAppFill((prev) => {
      const next = !prev;
      try {
        sessionStorage.setItem(`albireus_app_fill_${note.id}`, next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  return (
    <div
      className={`doc-workspace${focusMode ? " is-focus" : ""}${asideOpen ? " has-aside" : ""}${pageMode ? " is-page" : ""}${viewMode === "slides" ? " is-slides" : ""}${splitId && splitId !== id ? " has-split" : ""}${isAppPage ? " is-app-page" : ""}${isAppPage && appFill ? " is-app-fill" : ""}`}
      style={{ ["--note-aside-w" as string]: `${asideWidth}px` }}
    >
      <div className="doc-chrome">
      <div className={`doc-ribbon${viewMode === "slides" || isAppPage ? " is-hidden" : ""}`} ref={setRibbonHost} />

      <div className="doc-command">
        <nav className="doc-command-path" aria-label="筆記路徑">
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
                  {parent.icon ? (
                    <>
                      <PageChromeIcon
                        icon={parent.icon}
                        color={parent.color}
                        className="doc-crumb-icon"
                      />{" "}
                    </>
                  ) : null}
                  {parent.title || "上層"}
                </Link>
              </>
            ) : null;
          })()}
          <span className="doc-crumb-sep">/</span>
          <span className="doc-crumb-current">{title || "未命名"}</span>
          {statusLabel && (
            <span className={`doc-save-pill${status === "error" ? " is-error" : ""}`}>{statusLabel}</span>
          )}
        </nav>
        <div className="doc-command-bar">
          {!isAppPage ? (
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
          ) : null}
          {viewMode === "write" && !isAppPage && prefsCtx ? (
            <div className="doc-view-switch doc-width-switch" role="tablist" aria-label="編輯區寬度">
              <button
                type="button"
                role="tab"
                aria-selected={!widthExtended}
                className={!widthExtended ? "is-on" : ""}
                title="置中寬度（閱讀舒適）"
                onClick={() => prefsCtx.setPrefs({ editorWidth: "medium" })}
              >
                置中
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={widthExtended}
                className={widthExtended ? "is-on" : ""}
                title="延伸兩邊"
                onClick={() => prefsCtx.setPrefs({ editorWidth: "full" })}
              >
                延伸
              </button>
            </div>
          ) : null}
          <div className="doc-command-actions">
          <NotePresence noteId={note.id} />
          <NoteHuddle noteId={note.id} />
          {isAppPage ? (
            <button
              type="button"
              className={`doc-cmd doc-cmd--keep${appFill ? " is-on" : ""}`}
              title={appFill ? "顯示標題與屬性" : "站滿內容區"}
              onClick={toggleAppFill}
            >
              {appFill ? "還原頁首" : "站滿畫面"}
            </button>
          ) : null}
          {viewMode === "slides" && slideActions && (
            <>
              {slideActions.busy && <span className="slide-busy">{slideActions.busy}</span>}
              {slideActions.stale && (
                <button type="button" className="doc-cmd is-on" onClick={() => slideActions.sync()}>
                  同步筆記
                </button>
              )}
              <div className="slide-export-wrap" ref={exportWrapRef}>
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
            className={`doc-cmd doc-cmd--keep${(prefsCtx?.prefs.favoriteNoteIds || []).includes(note.id) ? " is-on" : ""}`}
            title="收藏"
            onClick={() => prefsCtx?.setPrefs((p) => toggleFavoriteId(p, note.id))}
          >
            ★
          </button>
          {viewMode === "write" && (
            <button type="button" className="doc-cmd doc-cmd--keep" title="尋找 ⌘F" onClick={() => setFindOpen(true)}>
              尋找
            </button>
          )}
          <button
            type="button"
            className={`doc-cmd doc-cmd--keep${noteShare?.enabled ? " is-on" : ""}`}
            title="分享筆記"
            onClick={() => setShareOpen(true)}
          >
            分享
          </button>
          <button
            type="button"
            className={`doc-cmd doc-cmd--keep${asideOpen ? " is-on" : ""}`}
            title="側欄 ⌘\\"
            onClick={() => toggleAside()}
          >
            側欄
          </button>
          <div className="doc-more-wrap" ref={moreWrapRef}>
            <button type="button" className="doc-cmd doc-cmd--keep" onClick={() => setMoreOpen((v) => !v)}>
              更多
            </button>
            {moreOpen && (
              <div className="doc-more-menu">
                {[
                  ...(viewMode === "write"
                    ? [
                        {
                          label: "新增子頁面",
                          fn: () => {
                            if (!user) return;
                            void (async () => {
                              const name = await askPrompt("子頁面標題", "未命名子頁");
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
                                  color: latest.current.color || "",
                                  cover: latest.current.cover,
                                  parent_id: latest.current.parent_id,
                                });
                              } catch {
                                markDirty();
                              }
                              toast(`已建立子頁：${t}`);
                              router.push(`/notes/${id}`);
                            })();
                          },
                        },
                        { label: "摘要", fn: () => runAi("summarize") },
                        { label: "抽待辦", fn: () => runAi("actions") },
                        {
                          label: focusMode ? "離開專注" : "專注模式 ⌘⇧F",
                          fn: () => setFocusMode((v) => !v),
                        },
                        {
                          label: pageMode ? "關閉頁面模式" : "頁面模式（A4）",
                          fn: () => {
                            setPageMode((v) => {
                              const next = !v;
                              try {
                                localStorage.setItem("cadence_page_mode", next ? "1" : "0");
                              } catch {
                                /* ignore */
                              }
                              return next;
                            });
                          },
                        },
                      ]
                    : []),
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
                  { label: "手動儲存 ⌘S", fn: () => save(false) },
                  { label: "刪除筆記", fn: () => remove(), danger: true },
                ].map((item) => (
                  <button
                    key={item.label}
                    type="button"
                    className={`doc-more-item${"danger" in item && item.danger ? " is-danger" : ""}`}
                    onClick={() => {
                      void item.fn();
                      setMoreOpen(false);
                    }}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
        </div>
      </div>
      </div>

      <div className="doc-body-row">
        <div
          ref={mainScrollRef}
          className={`doc-main-stack${splitId && splitId !== id ? " is-split" : ""}${
            splitId && splitId !== id && splitLayout.collapse !== "none"
              ? ` is-collapse-${splitLayout.collapse}`
              : ""
          }`}
          style={
            splitId && splitId !== id && splitLayout.collapse === "none"
              ? ({ ["--split-left" as string]: `${splitLayout.leftPct}%` } as CSSProperties)
              : undefined
          }
        >
        <div className={`doc-page${viewMode === "slides" ? " doc-page--slides" : ""}`}>
          {splitLayout.collapse === "left" && splitId && splitId !== id ? (
            <button
              type="button"
              className="note-split-rail note-split-rail--left"
              title="展開左側主頁"
              aria-label="展開左側主頁"
              onClick={() => setSplitLayout({ ...splitLayout, collapse: "none" })}
            >
              <span>主頁</span>
            </button>
          ) : null}
          {viewMode === "write" && <NotePageLog noteId={note.id} />}
          {aiError && viewMode === "write" && <p className="doc-banner-error">{aiError}</p>}
          {(ingestStatus || ingestError || ingestJobId) && viewMode === "write" && (
            <div className={`doc-banner-ingest${ingestError ? " is-error" : ""}`}>
              <div className="doc-banner-ingest-main">
                <span>{ingestError || ingestStatus || "媒體轉錄進行中"}</span>
                <div className="doc-banner-ingest-actions">
                  {ingestJobId && (
                    <Link href={`/job/${ingestJobId}`} className="doc-banner-ingest-link">
                      開啟工作
                    </Link>
                  )}
                  {ingestError && ingestJobId && (
                    <button
                      type="button"
                      className="doc-cmd"
                      onClick={() => {
                        const pendings = loadPendingIngests(note.id).filter(
                          (p) => p.jobId === ingestJobId
                        );
                        setIngestError("");
                        for (const p of pendings) {
                          if (ingestWatching.current.has(p.jobId)) continue;
                          ingestWatching.current.add(p.jobId);
                          void (async () => {
                            try {
                              setIngestStatus(`重試 · ${p.label}`);
                              const result = await finalizePendingIngest(p, {
                                assistant: {
                                  name: prefsCtx?.prefs.aiAssistantName,
                                  style: prefsCtx?.prefs.aiStyle,
                                  model: prefsCtx?.prefs.aiModel,
                                  grounding: prefsCtx?.prefs.aiGrounding,
                                },
                                onProgress: (label) => setIngestStatus(`${label} · ${p.label}`),
                              });
                              if (result) {
                                applyIngestBody(result.body, p.jobId);
                                toast(result.summary ? "已寫入逐字稿與 AI 摘要" : "已寫入逐字稿");
                              }
                              setIngestStatus("");
                              setIngestJobId(null);
                            } catch (e) {
                              setIngestError(e instanceof Error ? e.message : "轉錄失敗");
                              setIngestStatus("");
                            } finally {
                              ingestWatching.current.delete(p.jobId);
                            }
                          })();
                        }
                      }}
                    >
                      重試
                    </button>
                  )}
                  <button
                    type="button"
                    className="doc-cmd"
                    onClick={() => {
                      ingestCancel.current?.();
                      ingestCancel.current = null;
                      setIngestStatus("");
                      setIngestError("");
                      setIngestJobId(null);
                      if (!ingestError) {
                        toast("已改為背景寫入，可繼續編輯或離開本頁");
                      }
                    }}
                  >
                    {ingestError ? "關閉" : "背景繼續"}
                  </button>
                </div>
              </div>
            </div>
          )}

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
                    void (async () => {
                      if (!(await askConfirm("還原此版本？"))) return;
                      setTitle(v.title);
                      setBody(v.body_md);
                      markDirty();
                      setVersionsOpen(false);
                    })();
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
                title="頁面圖示與顏色"
                style={
                  color
                    ? {
                        background: pageColorMeta(color).bg,
                        color: pageColorMeta(color).fg,
                        boxShadow: `inset 0 0 0 1px ${pageColorMeta(color).fg}33`,
                      }
                    : undefined
                }
              >
                <PageChromeIcon
                  icon={icon}
                  color={color || undefined}
                  fallback="description"
                />
              </button>
              {iconOpen && viewMode === "write" && (
                <IconColorPicker
                  mode="note"
                  icon={icon}
                  color={color}
                  onChange={(next) => {
                    setIcon(normalizePageIcon(next.icon));
                    setColor(normalizePageColor(next.color));
                    markDirty();
                  }}
                  onClose={() => setIconOpen(false)}
                />
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
                      void (async () => {
                        const url = await askPrompt("封面圖片網址", "https://");
                        if (!url) return;
                        setCover(url.trim());
                        markDirty();
                      })();
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

            </>
          )}

          {viewMode === "slides" && (
            <div className="doc-slide-back">
              <button type="button" className="doc-cmd" onClick={enterWrite}>
                ← 回寫作
              </button>
              <span>同一則筆記 · 右側大綱可跳投影片</span>
            </div>
          )}

          <div className={`doc-pane doc-pane--write${viewMode === "write" ? " is-active" : ""}`} aria-hidden={viewMode !== "write"}>
          <div className="doc-editor-shell">
            {note.app_link?.type && note.app_link.id ? (
              <NoteAppSurface
                note={note}
                userId={user.uid}
                onTitleHint={(t) => {
                  setTitle(t);
                  markDirty();
                }}
              />
            ) : (
            <RichNoteEditor
              valueMd={body}
              onChangeMd={(md) => {
                // Ignore spurious empty updates that would wipe a loaded note via autosave.
                if (!md.trim() && body.trim()) return;
                setBody(md);
                markDirty();
              }}
              placeholder="輸入文字，空白段按空白鍵或 /ai 呼叫助手…"
              findOpen={findOpen}
              onFindOpenChange={setFindOpen}
              toolbarHost={ribbonHost}
              userId={user.uid}
              noteId={note.id}
              wikiNotes={allNotes}
              pageMode={pageMode}
              noteTitle={title}
              aiContext={aiPack.context}
              insertMdRef={insertMdRef}
              onOpenAiAssistant={() => {
                setFocusMode(false);
                openGlobalAiRail();
              }}
              onDeepResearchSelection={(selection) => {
                router.push(
                  buildResearchUrl({
                    from: note.id,
                    topic: selection.slice(0, 80).replace(/\s+/g, " "),
                    selection,
                    returnTo: true,
                  })
                );
              }}
              onRunAiAction={(apiAction, prompt) => {
                void runAi(apiAction, prompt);
              }}
              onTranscribableMedia={(media) => {
                void handleTranscribableMedia(media);
              }}
              showEmptyTemplates
              onEmptyTemplate={(tid) => {
                const tpl = noteTemplates.find((t) => t.id === tid) || NOTE_TEMPLATES.find((t) => t.id === tid);
                if (!tpl) return;
                if (tpl.title && !title.trim()) setTitle(tpl.title);
                setBody(tpl.body);
                if (tpl.tags.length) setTags(Array.from(new Set([...tags, ...tpl.tags])));
                markDirty();
                toast(`已套用範本：${tpl.label}`);
              }}
              onOpenThread={(selection) => setThreadSelection(selection)}
              onOpenWikiNote={(t) => void openWikiNote(t)}
              onCreateSubpage={async (pageTitle) => {
                if (!user || !note) return null;
                try {
                  const t = pageTitle.trim() || "未命名子頁";
                  const id = await createNote(user.uid, t, "", undefined, [], {
                    parent_id: note.id,
                    status: "backlog",
                    folder: folder || "",
                  });
                  toast(`已建立子頁：${t}`);
                  return { id, title: t };
                } catch (e) {
                  toast(e instanceof Error ? e.message : "建立子頁失敗");
                  return null;
                }
              }}
            />
            )}
          </div>

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
                onSynced={() => toast("已依筆記更新投影片")}
                onActionsChange={setSlideActions}
                focusIndex={slideFocusIndex}
                focusNonce={slideFocusNonce}
              />
            ) : (
              <p className="slide-loading">正在準備投影片…</p>
            )}
          </div>
        </div>

        {splitId && splitId !== id && (
          <>
            <NoteSplitResizer layout={splitLayout} onChange={setSplitLayout} />
            <NoteSplitPane
              noteId={splitId}
              collapsed={splitLayout.collapse === "right"}
              onExpand={() => setSplitLayout({ ...splitLayout, collapse: "none" })}
              onCollapse={() => setSplitLayout({ ...splitLayout, collapse: "right" })}
              onClose={() => tabs?.setSplit(null)}
            />
          </>
        )}
        </div>

        <NoteAside
          open={asideOpen && !focusMode}
          tab={asideTab}
          onTab={setAsideTab}
          stats={stats}
          outline={outline}
          related={related}
          outbound={outbound.map((t) => {
            const hit = findNoteByTitle(allNotes, t);
            return hit ? { title: t, href: `/notes/${hit.id}` } : { title: t };
          })}
          backlinks={backlinks.map((n) => ({ id: n.id, title: n.title }))}
          onJumpHeading={jumpHeading}
          onOpenSlideForHeading={openSlideForHeading}
          linkPicker={linkPicker}
          onLinkPickerChange={setLinkPicker}
          linkCandidates={linkCandidates.map((n) => ({ id: n.id, title: n.title }))}
          onOpenWikiNote={(t) => void openWikiNote(t)}
          onInsertWiki={insertWiki}
          slidePreview={
            viewMode === "write"
              ? {
                  slides: previewSlides,
                  countHint: slideCountHint,
                  stale: deckStale,
                  theme: {
                    bg: previewTheme.bg,
                    fg: previewTheme.fg,
                    accent: previewTheme.accent,
                  },
                  onEnter: (index) => enterSlidesAt(index),
                }
              : undefined
          }
          widthPx={asideWidth}
          onResizeWidth={onAsideResize}
        />
      </div>

      {threadSelection != null && note && (
        <div className="block-thread-overlay">
          <BlockThreadPanel
            noteId={note.id}
            selectionText={threadSelection}
            onClose={() => setThreadSelection(null)}
          />
        </div>
      )}

      {viewMode === "write" && !focusMode && !isAppPage && (
        <ColorSwatchUtility
          onApply={(hex) => {
            setColor(normalizePageColor(hex));
            markDirty();
          }}
        />
      )}

      {user && note && (
        <ShareDialog
          open={shareOpen}
          onClose={() => setShareOpen(false)}
          noteId={note.id}
          ownerId={user.uid}
          noteTitle={note.title}
          share={noteShare}
          onUpdated={(s) => {
            setNoteShare(s);
            setNote((n) => (n ? { ...n, share: s || undefined } : n));
          }}
        />
      )}
    </div>
  );
}