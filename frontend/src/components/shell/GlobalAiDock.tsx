"use client";
import { aiFetch } from "@/lib/aiFetch";

import { useEffect, useMemo, useRef, useState, type PointerEvent as REPointerEvent } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/components/AuthProvider";
import { type Note } from "@/lib/firebase";
import { useNotesList } from "@/components/notes/NotesListProvider";
import { packLibraryContext, AI_SUGGESTIONS } from "@/lib/libraryIndex";
import { extractOutline, slugifyHeading } from "@/lib/noteMeta";
import { usePrefsOptional } from "@/components/PrefsProvider";
import { buildResearchUrl } from "@/lib/researchBridge";
import {
  JOB_AI_SUGGESTIONS,
  packTranscriptForAi,
  subscribeJobAiContext,
  type JobAiContext,
} from "@/lib/jobAiContext";
import {
  MEETING_AI_SUGGESTIONS,
  subscribeMeetingAiContext,
  type MeetingAiContext,
} from "@/lib/meetingSession";
import AiMarkdown from "@/components/AiMarkdown";
import AiThinkingMorph from "@/components/motion/AiThinkingMorph";
import {
  dispatchNoteAiEdit,
  parseNoteAiEdit,
  previewNoteAiEditBody,
  readNoteLiveDraft,
  type NoteAiEdit,
} from "@/lib/noteAiEdit";
import { expandDiffPreview, summarizeLineOps, diffLines } from "@/lib/textDiff";
import {
  applyDbAiEdit,
  packDbContextForAi,
  parseDbAiEdit,
  readDbLiveSnapshot,
  type DbAiEdit,
} from "@/lib/dbAiEdit";
import {
  applyScheduleAiEdit,
  packScheduleContextForAi,
  parseScheduleAiEdit,
  readScheduleLiveSnapshot,
  SCHEDULE_AI_LIVE_EVENT,
  type ScheduleAiEdit,
} from "@/lib/scheduleAiEdit";
import type { ScheduleEvent } from "@/lib/scheduleEvents";
import {
  CANVAS_AI_LIVE_EVENT,
  parseCanvasAiEdit,
  readCanvasLiveSnapshot,
  requestApplyCanvasOps,
  summarizeCanvasOps,
  type CanvasAiEdit,
} from "@/lib/canvasAiEdit";
import { getDatabase, listDatabaseRowsOnce } from "@/lib/database";
import { toast } from "@/lib/toast";
import {
  buildChatApiHistory,
  buildSummaryPrompt,
  nextSummaryBatch,
  withChatSummaryContext,
  type ChatMemoryState,
} from "@/lib/aiChatMemory";
import { AiAttachmentChips, useAiAttachments } from "@/components/ai/AiAttachComposer";
import {
  attachmentSourceLabel,
  toAttachmentPayloads,
  type AiAttachment,
} from "@/lib/aiAttachments";
import {
  AI_RAIL_CONTEXT_EVENT,
  AI_RAIL_EVENT,
  openGlobalAiRail as openRail,
  toggleGlobalAiRail as toggleRail,
  type AiRailOpenDetail,
} from "@/lib/aiRailBridge";
import type { CanvasAiMediaRef } from "@/lib/canvasAiContext";

type Msg = {
  id: string;
  role: "user" | "assistant";
  text: string;
  edit?: NoteAiEdit | null;
  editNoteId?: string;
  dbEdit?: DbAiEdit | null;
  scheduleEdit?: ScheduleAiEdit | null;
  canvasEdit?: CanvasAiEdit | null;
  editApplied?: boolean;
  /** Knowledge-base sources used for this answer (標題＋錨點). */
  sources?: { title: string; href: string; heading?: string }[];
  attachmentLabels?: string[];
};
type RailMode = "dock" | "float";
type ChatThread = {
  id: string;
  title: string;
  updatedAt: number;
  msgs: Msg[];
  pinnedIds: string[];
  contextSummary?: string;
  summaryCovered?: number;
};

const OPEN_KEY = "cadence_ai_rail_open";
const MODE_KEY = "cadence_ai_rail_mode";
const THREADS_KEY = "cadence_ai_threads_v1";
const ACTIVE_KEY = "cadence_ai_active_thread";
const FIRST_VISIT_KEY = "cadence_ai_rail_welcome_seen_v1";

const WELCOME_CHIPS = [
  { label: "整理結構", prompt: "請把目前這篇或對焦內容重新整理成清楚的標題與條列" },
  { label: "抽出待辦", prompt: "請從目前內容抽出待辦清單" },
  { label: "今日摘要", prompt: "請用繁體中文給我一段今日重點摘要" },
] as const;

const DOCK_SUGGESTIONS = [
  { label: "總結此頁面", prompt: "請總結目前對焦或知識庫裡最相關的筆記重點" },
  { label: "修改本篇", prompt: "請改寫並整理目前這篇筆記，讓結構更清楚、重點更突出，並直接更新筆記內容" },
  { label: "本週重點", prompt: "根據我的知識庫，整理本週最值得關注的 5 件事" },
  { label: "找相關筆記", prompt: "幫我找出彼此相關的筆記主題，並說明可如何串起來" },
  { label: "靈感草稿", prompt: "從最近筆記抽出靈感，寫一段可發展的草稿開頭" },
  { label: "待辦催收", prompt: "從筆記裡找出未完成待辦，按緊急程度排序" },
  { label: "會議準備", prompt: "幫我準備一場會議的議程與要帶的問題" },
];

const NOTE_PAGE_SUGGESTIONS = [
  { label: "總結此頁", prompt: "請總結目前這篇筆記的重點" },
  { label: "改寫本篇", prompt: "請改寫目前這篇筆記，讓文字更清楚，並直接更新筆記內容" },
  { label: "整理結構", prompt: "請把目前這篇筆記重新整理成清楚的標題與條列，並直接更新筆記" },
  { label: "抽出待辦", prompt: "請從目前這篇筆記抽出待辦清單，追加到筆記文末" },
  { label: "補細節", prompt: "請擴寫目前這篇筆記不足的地方，並直接更新筆記內容" },
  { label: "只問不改", prompt: "先不要改筆記，只說明這篇在講什麼" },
];

const DB_PAGE_SUGGESTIONS = [
  { label: "總結資料庫", prompt: "請總結目前這個資料庫有哪些欄位與資料概況" },
  { label: "整理狀態", prompt: "請檢視各列狀態，把明顯已完成的改成完成，並直接更新資料庫" },
  { label: "補缺漏", prompt: "找出空白或明顯缺漏的欄位，合理補上後直接更新資料庫" },
  { label: "批次改欄", prompt: "依我的描述批次修改多列的同一個欄位，並直接寫入資料庫" },
  { label: "新增一列", prompt: "依我的描述新增一列到資料庫並填好欄位" },
  { label: "只問不改", prompt: "先不要改資料庫，只說明目前表格內容" },
];

const JOURNAL_PAGE_SUGGESTIONS = [
  { label: "今日摘要", prompt: "請用繁體中文為今日日誌寫一段重點摘要，條列 3–5 點" },
  { label: "抽出待辦", prompt: "請從今日日誌抽出待辦清單，用 Markdown 核取方塊列出" },
  { label: "整理結構", prompt: "請把今日日誌重新整理成清楚標題與條列，保留原意" },
  { label: "幫我安排明天", prompt: "根據我最近的行程與空檔，幫我安排明天的待辦與會議，並產出可套用的行程修改" },
  { label: "本週空檔", prompt: "先不要改行程，只說明這週哪些時段較空、適合安排工作" },
  { label: "只問不改", prompt: "先不要改內容，只說明今日日誌與附近行程重點" },
];

const LIBRARY_SUGGESTIONS = AI_SUGGESTIONS;

const CANVAS_SUGGESTIONS = [
  { label: "分析白板", prompt: "請分析目前這張白板的結構與內容，給 3 點改進建議（先不要改畫布）" },
  { label: "整理區塊", prompt: "幫我把白板上的內容整理成幾個清楚的區塊框架，並產出可套用的白板修改" },
  { label: "建議連線", prompt: "依內容建議並建立該有的連線，產出可套用的白板修改" },
  { label: "擴寫便利貼", prompt: "為選取或重點便利貼擴寫更完整的內容，並更新畫布上的便利貼" },
  { label: "補便利貼", prompt: "依目前白板主題新增 3–5 張重點便利貼，排在現有內容附近" },
  { label: "只問不改", prompt: "先不要改白板，只說明這張畫布在講什麼" },
];

function uid() {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

function noteSourceHref(note: { id: string; body_md?: string; title?: string }, preferHeading?: string) {
  const outline = extractOutline(note.body_md || "");
  const heading =
    (preferHeading && outline.find((h) => h.text.includes(preferHeading))) || outline[0];
  if (heading) {
    return `/notes/${note.id}#${slugifyHeading(heading.text)}`;
  }
  return `/notes/${note.id}`;
}

function sourcesFromNotes(list: Note[]): { title: string; href: string; heading?: string }[] {
  const out: { title: string; href: string; heading?: string }[] = [];
  const seen = new Set<string>();
  for (const n of list) {
    if (!n?.id || seen.has(n.id)) continue;
    seen.add(n.id);
    const outline = extractOutline(n.body_md || "");
    const heading = outline[0]?.text;
    out.push({
      title: (n.title || "未命名").trim() || "未命名",
      href: noteSourceHref(n),
      heading,
    });
  }
  return out.slice(0, 10);
}

function readFocusNoteId(pathname: string | null): string | null {
  const m = pathname?.match(/^\/notes\/([^/?#]+)/);
  if (m?.[1]) return m[1];
  if (typeof window === "undefined") return null;
  try {
    return new URLSearchParams(window.location.search).get("note");
  } catch {
    return null;
  }
}

function readFocusDatabaseId(
  pathname: string | null,
  focusNote: Note | null | undefined
): string | null {
  const m = pathname?.match(/^\/db\/([^/?#]+)/);
  if (m?.[1]) return m[1];
  if (focusNote?.app_link?.type === "database" && focusNote.app_link.id) {
    return focusNote.app_link.id;
  }
  return null;
}

function saveOpen(open: boolean) {
  try {
    localStorage.setItem(OPEN_KEY, open ? "1" : "0");
  } catch {
    /* ignore */
  }
}

function loadMode(): RailMode {
  try {
    return localStorage.getItem(MODE_KEY) === "float" ? "float" : "dock";
  } catch {
    return "dock";
  }
}

function saveMode(mode: RailMode) {
  try {
    localStorage.setItem(MODE_KEY, mode);
  } catch {
    /* ignore */
  }
}

function threadTitleFromMsgs(msgs: Msg[]): string {
  const first = msgs.find((m) => m.role === "user")?.text?.trim();
  if (!first) return "新 AI 對話";
  return first.length > 28 ? `${first.slice(0, 28)}…` : first;
}

function loadThreads(): { threads: ChatThread[]; activeId: string } {
  try {
    const raw = localStorage.getItem(THREADS_KEY);
    let threads: ChatThread[] = [];
    if (raw) {
      const parsed = JSON.parse(raw) as ChatThread[];
      if (Array.isArray(parsed)) {
        threads = parsed
          .filter((t) => t && typeof t.id === "string" && Array.isArray(t.msgs))
          .map((t) => ({
            id: t.id,
            title: t.title || "對話",
            updatedAt: t.updatedAt || Date.now(),
            msgs: t.msgs.slice(-60),
            pinnedIds: Array.isArray(t.pinnedIds) ? t.pinnedIds.slice(0, 8) : [],
            contextSummary:
              typeof t.contextSummary === "string" ? t.contextSummary : undefined,
            summaryCovered:
              typeof t.summaryCovered === "number" ? t.summaryCovered : undefined,
          }));
      }
    }
    // migrate legacy session
    if (!threads.length) {
      const legacy = sessionStorage.getItem("cadence-ai-dock");
      if (legacy) {
        const parsed = JSON.parse(legacy) as { msgs?: Msg[]; pinned?: string[] };
        if (Array.isArray(parsed.msgs) && parsed.msgs.length) {
          const id = uid();
          threads = [
            {
              id,
              title: threadTitleFromMsgs(parsed.msgs),
              updatedAt: Date.now(),
              msgs: parsed.msgs.slice(-40),
              pinnedIds: Array.isArray(parsed.pinned) ? parsed.pinned.slice(0, 8) : [],
            },
          ];
        }
      }
    }
    const activeStored = localStorage.getItem(ACTIVE_KEY);
    const activeId =
      (activeStored && threads.some((t) => t.id === activeStored) && activeStored) ||
      threads[0]?.id ||
      "";
    return { threads, activeId };
  } catch {
    return { threads: [], activeId: "" };
  }
}

function persistThreads(threads: ChatThread[], activeId: string) {
  try {
    // Guard against boot race: never wipe non-empty history with an empty array.
    if (threads.length === 0) {
      const existing = localStorage.getItem(THREADS_KEY);
      if (existing && existing !== "[]") return;
    }
    const payload = JSON.stringify(threads.slice(0, 40));
    localStorage.setItem(THREADS_KEY, payload);
    localStorage.setItem(ACTIVE_KEY, activeId);
  } catch {
    // Quota or private mode — try a leaner payload once.
    try {
      const lean = threads.slice(0, 12).map((t) => ({
        ...t,
        msgs: t.msgs.slice(-20),
      }));
      localStorage.setItem(THREADS_KEY, JSON.stringify(lean));
      localStorage.setItem(ACTIVE_KEY, activeId);
    } catch {
      /* ignore */
    }
  }
}

/** Open/toggle the global AI right rail from anywhere (re-export bridge). */
export function openGlobalAiRail(detail?: Parameters<typeof openRail>[0]) {
  openRail(detail);
}

export function toggleGlobalAiRail() {
  toggleRail();
}

export default function GlobalAiDock() {
  const { user } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const prefsCtx = usePrefsOptional();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<RailMode>("dock");
  const [input, setInput] = useState("");
  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [activeId, setActiveId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const { notes } = useNotesList();
  const [atOpen, setAtOpen] = useState(false);
  const [atQ, setAtQ] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [webSearch, setWebSearch] = useState(false);
  const [focusNoteId, setFocusNoteId] = useState<string | null>(null);
  const [jobCtx, setJobCtx] = useState<JobAiContext | null>(null);
  const [meetingCtx, setMeetingCtx] = useState<MeetingAiContext | null>(null);
  const [dbLiveTick, setDbLiveTick] = useState(0);
  const [scheduleLiveTick, setScheduleLiveTick] = useState(0);
  const [canvasLiveTick, setCanvasLiveTick] = useState(0);
  const [isMobile, setIsMobile] = useState(false);
  const [sheetH, setSheetH] = useState(48); // vh units on mobile
  const [showWelcome, setShowWelcome] = useState(false);
  const [bridgeLabel, setBridgeLabel] = useState("");
  const [bridgeExtra, setBridgeExtra] = useState("");
  const [bridgeMediaRefs, setBridgeMediaRefs] = useState<CanvasAiMediaRef[]>([]);
  const [forceCanvasSelection, setForceCanvasSelection] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const hydrated = useRef(false);
  const skipNextPersist = useRef(true);
  const sheetDrag = useRef<{ startY: number; startH: number } | null>(null);
  const pendingAttachRef = useRef<AiAttachment[] | null>(null);
  const attach = useAiAttachments({
    onError: (msg) => {
      setError(msg);
      toast(msg);
    },
  });

  const onNotePage = pathname?.startsWith("/notes/");
  const onLibraryPage = pathname === "/library" || pathname?.startsWith("/library/");
  const onCanvasPage = pathname?.startsWith("/canvas/");
  const onJobPage = pathname?.startsWith("/job/");
  const onDbPage = pathname?.startsWith("/db/");
  const onJournalPage = pathname === "/journal" || pathname?.startsWith("/journal/");
  const allowNoteEdit = prefsCtx?.prefs.aiAllowNoteEdit !== false;
  const allowCanvasEdit = prefsCtx?.prefs.aiAllowCanvasEdit !== false;
  const focusNote = useMemo(
    () => (focusNoteId ? notes.find((n) => n.id === focusNoteId) : null),
    [focusNoteId, notes]
  );
  const focusDatabaseId = useMemo(
    () => readFocusDatabaseId(pathname, focusNote),
    [pathname, focusNote]
  );
  const liveDb = useMemo(() => {
    return readDbLiveSnapshot(focusDatabaseId) || (focusDatabaseId ? null : readDbLiveSnapshot());
  }, [focusDatabaseId, dbLiveTick, open]);
  const scheduleSnap = useMemo(() => {
    if (!onJournalPage) return null;
    return readScheduleLiveSnapshot();
  }, [onJournalPage, scheduleLiveTick, open, pathname]);
  const canvasSnap = useMemo(() => {
    if (!onCanvasPage) return null;
    return readCanvasLiveSnapshot();
  }, [onCanvasPage, canvasLiveTick, open, pathname]);
  const activeDbSnap =
    liveDb && (!focusDatabaseId || liveDb.databaseId === focusDatabaseId) ? liveDb : null;
  const dockSuggestions =
    activeDbSnap || onDbPage
      ? DB_PAGE_SUGGESTIONS
      : meetingCtx
        ? MEETING_AI_SUGGESTIONS
      : onJobPage && jobCtx
      ? JOB_AI_SUGGESTIONS
      : onNotePage && focusNote
        ? NOTE_PAGE_SUGGESTIONS
        : onJournalPage
          ? JOURNAL_PAGE_SUGGESTIONS
        : onLibraryPage
          ? LIBRARY_SUGGESTIONS
          : onCanvasPage
            ? CANVAS_SUGGESTIONS
            : DOCK_SUGGESTIONS;
  const assistantName = prefsCtx?.prefs.aiAssistantName || "Albireus AI";

  const active = useMemo(
    () => threads.find((t) => t.id === activeId) || null,
    [threads, activeId]
  );
  const msgs = active?.msgs || [];
  const pinnedIds = active?.pinnedIds || [];

  const patchActive = (fn: (t: ChatThread) => ChatThread, idOverride?: string) => {
    setThreads((prev) => {
      const want = idOverride || activeId;
      let idx = want ? prev.findIndex((t) => t.id === want) : -1;
      if (idx < 0) {
        idx = prev.findIndex((t) => t.msgs.length === 0);
      }
      if (idx < 0) {
        const created = fn({
          id: want || uid(),
          title: "新 AI 對話",
          updatedAt: Date.now(),
          msgs: [],
          pinnedIds: [],
        });
        setActiveId(created.id);
        return [created, ...prev];
      }
      const next = [...prev];
      next[idx] = fn({ ...next[idx], updatedAt: Date.now() });
      if (!activeId) setActiveId(next[idx].id);
      return next;
    });
  };

  const ensureActive = (): string => {
    if (activeId && threads.some((t) => t.id === activeId)) return activeId;
    const id = uid();
    setActiveId(id);
    setThreads((prev) => {
      if (prev.some((t) => t.id === id)) return prev;
      return [
        {
          id,
          title: "新 AI 對話",
          updatedAt: Date.now(),
          msgs: [],
          pinnedIds: [],
        },
        ...prev,
      ];
    });
    return id;
  };

  useEffect(() => {
    // Never auto-reopen the rail on mount — restoring float+open from
    // localStorage left a document-level closer that raced with real clicks
    // ("hover works, buttons dead"). Mode preference still restores.
    setMode(loadMode());
    const loaded = loadThreads();
    setThreads(loaded.threads);
    setActiveId(loaded.activeId);
    // Skip the persist effect that runs for this hydration commit (empty → loaded),
    // otherwise the empty initial state can wipe localStorage in the same tick.
    skipNextPersist.current = true;
    hydrated.current = true;
  }, []);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 900px)");
    const apply = () => setIsMobile(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  useEffect(() => {
    if (!isMobile || !open) {
      document.documentElement.style.removeProperty("--ai-sheet-h");
      return;
    }
    document.documentElement.style.setProperty("--ai-sheet-h", `${sheetH}dvh`);
    return () => {
      document.documentElement.style.removeProperty("--ai-sheet-h");
    };
  }, [isMobile, open, sheetH]);

  useEffect(() => {
    saveOpen(open);
  }, [open]);

  useEffect(() => {
    saveMode(mode);
  }, [mode]);

  useEffect(() => {
    if (!hydrated.current) return;
    if (skipNextPersist.current) {
      skipNextPersist.current = false;
      return;
    }
    persistThreads(threads, activeId);
  }, [threads, activeId]);

  useEffect(() => {
    const applyDetail = (d: AiRailOpenDetail) => {
      if (typeof d.prompt === "string") setInput(d.prompt);
      if (typeof d.contextLabel === "string") setBridgeLabel(d.contextLabel);
      const extra =
        (typeof d.contextExtra === "string" && d.contextExtra.trim()) ||
        (typeof d.selectionText === "string" && d.selectionText.trim()
          ? `—— 目前選取 ——\n${d.selectionText.trim().slice(0, 12000)}\n—— 結束 ——`
          : "");
      if (extra) setBridgeExtra(extra);
      if (d.mediaRefs?.length) setBridgeMediaRefs(d.mediaRefs);
      if (d.useCanvasSelection) setForceCanvasSelection(true);
      if (d.attachments?.length) {
        // Rare path: pre-encoded payloads — ignore here; File attach uses composer.
      }
      setTimeout(() => inputRef.current?.focus(), 40);
    };

    const onEvt = (e: Event) => {
      const d = ((e as CustomEvent<AiRailOpenDetail>).detail || {}) as AiRailOpenDetail;
      if (d.toggle) setOpen((v) => !v);
      else if (typeof d.open === "boolean") setOpen(d.open);
      else if (d.open !== false) setOpen(true);
      applyDetail(d);
    };
    const onCtx = (e: Event) => {
      const d = ((e as CustomEvent<AiRailOpenDetail>).detail || {}) as AiRailOpenDetail;
      applyDetail(d);
    };
    window.addEventListener(AI_RAIL_EVENT, onEvt);
    window.addEventListener(AI_RAIL_CONTEXT_EVENT, onCtx);
    return () => {
      window.removeEventListener(AI_RAIL_EVENT, onEvt);
      window.removeEventListener(AI_RAIL_CONTEXT_EVENT, onCtx);
    };
  }, []);

  const clearBridgeContext = () => {
    setBridgeLabel("");
    setBridgeExtra("");
    setBridgeMediaRefs([]);
    setForceCanvasSelection(false);
  };

  useEffect(() => {
    if (!open) return;
    try {
      setShowWelcome(localStorage.getItem(FIRST_VISIT_KEY) !== "1");
    } catch {
      setShowWelcome(false);
    }
  }, [open]);

  const dismissWelcome = () => {
    setShowWelcome(false);
    try {
      localStorage.setItem(FIRST_VISIT_KEY, "1");
    } catch {
      /* ignore */
    }
  };

  // Float mode: no full-screen backdrop and no document-level outside closer.
  // Both previously swallowed clicks (mousedown race / invisible hit layer).
  // Close via the X button, Escape, or toggling the rail explicitly.

  useEffect(() => {
    setFocusNoteId(readFocusNoteId(pathname));
  }, [pathname, open]);

  useEffect(() => {
    return subscribeJobAiContext(setJobCtx);
  }, []);

  useEffect(() => {
    return subscribeMeetingAiContext(setMeetingCtx);
  }, []);

  useEffect(() => {
    const on = () => setDbLiveTick((n) => n + 1);
    window.addEventListener("albireus:db-live", on);
    return () => window.removeEventListener("albireus:db-live", on);
  }, []);

  useEffect(() => {
    const on = () => setScheduleLiveTick((n) => n + 1);
    window.addEventListener(SCHEDULE_AI_LIVE_EVENT, on);
    return () => window.removeEventListener(SCHEDULE_AI_LIVE_EVENT, on);
  }, []);

  useEffect(() => {
    const on = () => setCanvasLiveTick((n) => n + 1);
    window.addEventListener(CANVAS_AI_LIVE_EVENT, on);
    return () => window.removeEventListener(CANVAS_AI_LIVE_EVENT, on);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "a") {
        e.preventDefault();
        setOpen((v) => !v);
      }
      if (e.key === "Escape" && open) {
        if (historyOpen) {
          setHistoryOpen(false);
          return;
        }
        const tag = (document.activeElement as HTMLElement | null)?.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA") return;
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, historyOpen]);

  useEffect(() => {
    setWebSearch(!!prefsCtx?.prefs.aiGrounding);
  }, [prefsCtx?.prefs.aiGrounding]);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 40);
  }, [open]);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [msgs, busy, open, activeId]);

  useEffect(() => {
    document.documentElement.dataset.aiRail =
      open && mode === "dock" ? "dock-open" : open && mode === "float" ? "float-open" : "closed";
    return () => {
      delete document.documentElement.dataset.aiRail;
    };
  }, [open, mode]);

  const pinnedNotes = useMemo(
    () => pinnedIds.map((id) => notes.find((n) => n.id === id)).filter(Boolean) as Note[],
    [pinnedIds, notes]
  );

  const atCandidates = useMemo(() => {
    const q = atQ.trim().toLowerCase();
    const list = notes.filter((n) => !pinnedIds.includes(n.id));
    if (!q) return list.slice(0, 8);
    return list.filter((n) => n.title.toLowerCase().includes(q)).slice(0, 8);
  }, [notes, pinnedIds, atQ]);

  const scopeLabel = useMemo(() => {
    if (bridgeLabel.trim()) {
      const t = bridgeLabel.trim();
      return t.length > 36 ? `${t.slice(0, 36)}…` : t;
    }
    if (activeDbSnap) {
      const t = activeDbSnap.name || "資料庫";
      return `正在看：資料庫 · ${t.length > 22 ? `${t.slice(0, 22)}…` : t}`;
    }
    if (meetingCtx) {
      const t = meetingCtx.title || "會議";
      return `正在看：會議 · ${t.length > 22 ? `${t.slice(0, 22)}…` : t}`;
    }
    if (onCanvasPage && canvasSnap) {
      const name = canvasSnap.name || "白板";
      const short = name.length > 18 ? `${name.slice(0, 18)}…` : name;
      const sel =
        (canvasSnap.selectedIds?.length || 0) > 0
          ? ` · 選取 ${canvasSnap.selectedIds.length}`
          : "";
      return `正在看：白板 · ${short}${sel}`;
    }
    if (onCanvasPage) return "正在看：白板";
    if (onJournalPage) return "正在看：日誌";
    if (onJobPage && jobCtx) {
      const t = jobCtx.filename || jobCtx.title || "逐字稿";
      return `正在看：${t.length > 24 ? `${t.slice(0, 24)}…` : t}`;
    }
    if (pinnedNotes.length) return `已 @ ${pinnedNotes.length} 篇`;
    if (focusNote) {
      const t = focusNote.title || "筆記";
      return `正在看：筆記 · ${t.length > 22 ? `${t.slice(0, 22)}…` : t}`;
    }
    if (onNotePage) return "正在看：筆記";
    if (onLibraryPage) return "正在看：知識庫";
    return `知識庫 ${notes.length} 篇`;
  }, [
    bridgeLabel,
    activeDbSnap,
    meetingCtx,
    onCanvasPage,
    canvasSnap,
    onJournalPage,
    onJobPage,
    jobCtx,
    onNotePage,
    onLibraryPage,
    notes.length,
    pinnedNotes.length,
    focusNote,
  ]);

  const useLiveSelection = () => {
    if (onCanvasPage && canvasSnap && (canvasSnap.selectedIds?.length || 0) > 0) {
      setForceCanvasSelection(true);
      setBridgeLabel(`白板 · ${canvasSnap.name || "白板"} · 選取 ${canvasSnap.selectedIds.length}`);
      setBridgeExtra((prev) =>
        [
          prev,
          `—— 白板選取（${canvasSnap.selectedIds.length}）——\n請優先依據畫布摘要中標記為選取的物件作答。\nID：${canvasSnap.selectedIds.slice(0, 24).join(", ")}\n—— 結束 ——`,
        ]
          .filter(Boolean)
          .join("\n\n")
      );
      toast("已綁定目前白板選取");
      return;
    }
    if (onNotePage) {
      let sel = "";
      try {
        sel = window.getSelection()?.toString()?.trim() || "";
      } catch {
        sel = "";
      }
      if (!sel) {
        toast("請先在筆記中選取文字");
        return;
      }
      setBridgeLabel(focusNote?.title ? `筆記 · ${focusNote.title}` : "目前選取");
      setBridgeExtra(`—— 目前選取 ——\n${sel.slice(0, 12000)}\n—— 結束 ——`);
      toast("已帶入目前選取");
    }
  };

  const historySorted = useMemo(
    () => [...threads].sort((a, b) => b.updatedAt - a.updatedAt),
    [threads]
  );

  const startNewChat = () => {
    setHistoryOpen(false);
    setError("");
    const id = uid();
    const blank: ChatThread = {
      id,
      title: "新 AI 對話",
      updatedAt: Date.now(),
      msgs: [],
      pinnedIds: focusNoteId ? [focusNoteId] : [],
    };
    setThreads((prev) => {
      // drop empty drafts except keep history with content
      const kept = prev.filter((t) => t.msgs.length > 0 || t.id === activeId);
      return [blank, ...kept.filter((t) => t.msgs.length > 0)].slice(0, 40);
    });
    setActiveId(id);
    setInput("");
    setTimeout(() => inputRef.current?.focus(), 40);
  };

  const loadThread = (id: string) => {
    setActiveId(id);
    setHistoryOpen(false);
    setError("");
    setTimeout(() => inputRef.current?.focus(), 40);
  };

  const deleteThread = (id: string) => {
    setThreads((prev) => {
      const next = prev.filter((t) => t.id !== id);
      if (id === activeId) {
        const fallback = next[0];
        if (fallback) setActiveId(fallback.id);
        else {
          const blankId = uid();
          setActiveId(blankId);
          return [
            {
              id: blankId,
              title: "新 AI 對話",
              updatedAt: Date.now(),
              msgs: [],
              pinnedIds: [],
            },
          ];
        }
      }
      return next;
    });
  };

  const togglePin = (id: string) => {
    ensureActive();
    patchActive((t) => ({
      ...t,
      pinnedIds: t.pinnedIds.includes(id)
        ? t.pinnedIds.filter((x) => x !== id)
        : [...t.pinnedIds, id].slice(0, 8),
    }));
  };

  const applyEdit = (msgId: string, edit: NoteAiEdit, noteId: string) => {
    dispatchNoteAiEdit({
      noteId,
      mode: edit.mode,
      bodyMd: edit.bodyMd,
      title: edit.title,
      source: "global-ai",
    });
    patchActive((t) => ({
      ...t,
      msgs: t.msgs.map((m) =>
        m.id === msgId ? { ...m, editApplied: true } : m
      ),
    }));
    toast(edit.mode === "append" ? "已追加到筆記" : "已更新筆記內容");
  };

  const applyDbEdit = async (msgId: string, edit: DbAiEdit) => {
    if (!user) {
      toast("請先登入");
      return;
    }
    try {
      const dbDoc = await getDatabase(edit.databaseId);
      if (!dbDoc) throw new Error("找不到資料庫");
      const rows = await listDatabaseRowsOnce(user.uid, edit.databaseId);
      const result = await applyDbAiEdit(edit, {
        db: dbDoc,
        rows,
        userId: user.uid,
      });
      patchActive((t) => ({
        ...t,
        msgs: t.msgs.map((m) =>
          m.id === msgId ? { ...m, editApplied: true } : m
        ),
      }));
      if (result.ok && !result.failed) {
        toast(`已更新資料庫（${result.ok} 項）`);
      } else if (result.ok) {
        toast(`已套用 ${result.ok} 項，失敗 ${result.failed} 項`);
      } else {
        toast(result.messages[0] || "無法套用資料庫修改");
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : "無法套用資料庫修改");
    }
  };

  const applyScheduleEdit = async (msgId: string, edit: ScheduleAiEdit) => {
    if (!user) {
      toast("請先登入");
      return;
    }
    try {
      const snap = readScheduleLiveSnapshot();
      const events: ScheduleEvent[] = (snap?.events || []).map((e) => ({
        id: e.id,
        dateKey: e.dateKey,
        title: e.title,
        startMin: e.startMin,
        endMin: e.endMin,
        allDay: e.allDay,
        description: e.description,
        remindMinutesBefore: e.remindMinutesBefore,
        provider: e.provider,
      }));
      const result = await applyScheduleAiEdit(user.uid, edit, events);
      patchActive((t) => ({
        ...t,
        msgs: t.msgs.map((m) =>
          m.id === msgId ? { ...m, editApplied: true } : m
        ),
      }));
      if (result.ok && !result.failed && !result.skipped) {
        toast(`已更新行程（${result.ok} 項）`);
      } else if (result.ok) {
        toast(
          `已套用 ${result.ok} 項` +
            (result.skipped ? `，略過 ${result.skipped}` : "") +
            (result.failed ? `，失敗 ${result.failed}` : "")
        );
      } else {
        toast(result.messages[0] || "無法套用行程修改");
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : "無法套用行程修改");
    }
  };

  const applyCanvasEdit = (msgId: string, edit: CanvasAiEdit) => {
    if (!edit.ops.length) return;
    if (!allowCanvasEdit) {
      toast("已關閉「可改白板」");
      return;
    }
    const ok = requestApplyCanvasOps(edit.ops);
    if (!ok) {
      toast("白板尚未就緒，請回到白板頁再試");
      return;
    }
    patchActive((t) => ({
      ...t,
      msgs: t.msgs.map((m) => (m.id === msgId ? { ...m, editApplied: true } : m)),
    }));
    toast(`已套用白板修改（${edit.ops.length} 項：${summarizeCanvasOps(edit.ops)}）`);
  };

  const send = async (text: string) => {
    const trimmed = text.trim();
    const attachSnapshot = attach.attachments.slice();
    const hasAttach = attachSnapshot.length > 0;
    if ((!trimmed && !hasAttach) || busy) return;
    const displayPrompt =
      trimmed ||
      (hasAttach
        ? `請根據附件（${attachSnapshot.map((a) => a.name).join("、")}）說明重點`
        : "");
    const prompt = displayPrompt;
    const attachPayloads = toAttachmentPayloads(attachSnapshot);
    const attachLabels = attachSnapshot.map((a) => attachmentSourceLabel(a));
    const bridgeExtraSnap = bridgeExtra;
    const bridgeMediaSnap = bridgeMediaRefs.slice();
    const forceSelSnap = forceCanvasSelection;
    const tid = ensureActive();
    setBusy(true);
    setError("");
    setInput("");
    setAtOpen(false);
    pendingAttachRef.current = attachSnapshot;
    attach.clearAttachments();
    if (forceSelSnap) setForceCanvasSelection(false);
    const userMsg: Msg = {
      id: uid(),
      role: "user",
      text: prompt,
      attachmentLabels: attachLabels.length ? attachLabels : undefined,
    };
    let snapshotMsgs: Msg[] = [];
    let snapshotPins: string[] = [];
    let memory: ChatMemoryState = { contextSummary: "", summaryCovered: 0 };
    patchActive((t) => {
      snapshotPins = t.pinnedIds;
      snapshotMsgs = [...t.msgs, userMsg];
      memory = {
        contextSummary: t.contextSummary || "",
        summaryCovered: t.summaryCovered || 0,
      };
      return {
        ...t,
        msgs: snapshotMsgs,
        title: t.msgs.length === 0 ? threadTitleFromMsgs(snapshotMsgs) : t.title,
      };
    }, tid);
    try {
      const assistant = {
        name: prefsCtx?.prefs.aiAssistantName,
        style: prefsCtx?.prefs.aiStyle,
        model: prefsCtx?.prefs.aiModel,
        grounding: webSearch,
      };

      // Rolling memory: every 15 turns → condense; afterward API gets summary + last 5.
      const batchInfo = nextSummaryBatch(snapshotMsgs, memory);
      if (batchInfo) {
        const sumRes = await aiFetch("/api/ai/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "chat",
            prompt: buildSummaryPrompt(memory.contextSummary, batchInfo.batch),
            context: "（內部任務：只輸出對話摘要，不要回答使用者）",
            messages: [],
            assistant: { ...assistant, grounding: false },
            allowNoteEdit: false,
          }),
        });
        const sumData = await sumRes.json();
        if (sumRes.ok && typeof sumData.text === "string" && sumData.text.trim()) {
          memory = {
            contextSummary: sumData.text.trim(),
            summaryCovered: batchInfo.nextCovered,
          };
          patchActive(
            (t) => ({
              ...t,
              contextSummary: memory.contextSummary,
              summaryCovered: memory.summaryCovered,
            }),
            tid
          );
        }
      }

      const history = buildChatApiHistory(snapshotMsgs, memory);

      let body: Record<string, unknown>;
      let pendingSources: Msg["sources"] = undefined;
      const dbSnap =
        readDbLiveSnapshot(focusDatabaseId) ||
        (focusDatabaseId ? null : readDbLiveSnapshot());
      if (focusDatabaseId && !dbSnap) {
        throw new Error("資料庫脈絡尚未就緒，請等表格載入後再試");
      }
      const liveSchedule = onJournalPage ? readScheduleLiveSnapshot() : null;
      const liveCanvas = onCanvasPage ? readCanvasLiveSnapshot() : null;
      const canEditDb = allowNoteEdit && !!dbSnap;
      const canEditHere = allowNoteEdit && !!focusNote && onNotePage && !dbSnap;
      const canEditSchedule = onJournalPage && !!liveSchedule && !dbSnap;
      const canEditCanvas = onCanvasPage && !!liveCanvas && !dbSnap;
      const canvasSelectedIds =
        forceSelSnap && liveCanvas?.selectedIds?.length
          ? liveCanvas.selectedIds
          : liveCanvas?.selectedIds;

      if (dbSnap) {
        body = {
          action: "note",
          title: dbSnap.name,
          prompt,
          context: withChatSummaryContext(packDbContextForAi(dbSnap), memory),
          messages: history,
          assistant,
          allowNoteEdit: false,
          allowDbEdit: canEditDb,
          focusDatabaseId: dbSnap.databaseId,
        };
      } else if (canEditCanvas && liveCanvas) {
        const pinExtra = snapshotPins.length
          ? `\n\n使用者 @ 的筆記（可 pin_note）：\n${snapshotPins
              .map((id) => {
                const n = notes.find((x) => x.id === id);
                return n ? `- ${n.id}｜${n.title || "未命名"}` : null;
              })
              .filter(Boolean)
              .join("\n")}`
          : "";
        body = {
          action: "canvas",
          prompt:
            (allowCanvasEdit
              ? prompt
              : `${prompt}\n\n（使用者已關閉「可改白板」——只給建議，ops 必須為空陣列）`) + pinExtra,
          canvasSummary: liveCanvas.summary,
          selectedIds: canvasSelectedIds,
          messages: history,
          assistant,
        };
      } else if (meetingCtx) {
        const packed = packTranscriptForAi(meetingCtx.transcript || "");
        const note = notes.find((n) => n.id === meetingCtx.noteId);
        const bodyMd = note?.body_md || "";
        body = {
          action: "note",
          title: meetingCtx.title || "會議",
          prompt,
          context: withChatSummaryContext(
            `來源：會議模式\n標題：${meetingCtx.title}\n日期：${meetingCtx.dateKey || "—"}\n\n${
              packed.trim()
                ? `—— 會議脈絡（暫存）——\n${packed}\n`
                : ""
            }—— 會議筆記 ——\n${bodyMd.slice(0, 14000)}`,
            memory
          ),
          messages: history,
          assistant,
          allowNoteEdit: allowNoteEdit,
          focusNoteId: meetingCtx.noteId,
        };
        const meetingNote = notes.find((n) => n.id === meetingCtx.noteId);
        if (meetingNote) {
          pendingSources = sourcesFromNotes([meetingNote]);
        } else {
          pendingSources = [
            {
              title: meetingCtx.title || "會議筆記",
              href: `/notes/${meetingCtx.noteId}`,
            },
          ];
        }
      } else if (onJobPage && jobCtx) {
        const packed = packTranscriptForAi(jobCtx.transcript);
        if (!packed.trim()) throw new Error("尚無逐字稿內容可詢問");
        body = {
          action: "note",
          title: jobCtx.filename || jobCtx.title || "逐字稿",
          prompt,
          context: withChatSummaryContext(
            `來源：逐字稿\n檔名：${jobCtx.filename || "—"}\n\n${packed}`,
            memory
          ),
          messages: history,
          assistant,
          allowNoteEdit: false,
        };
      } else if (focusNote && onNotePage) {
        const live = readNoteLiveDraft(focusNote.id);
        const noteTitle = live?.title || focusNote.title || "未命名";
        const noteBody = live?.body ?? focusNote.body_md ?? "";
        const pinExtra = snapshotPins
          .filter((id) => id !== focusNote.id)
          .map((id) => notes.find((n) => n.id === id))
          .filter(Boolean) as Note[];
        const extraCtx =
          pinExtra.length > 0
            ? `\n\n—— 額外釘選參考 ——\n${pinExtra
                .map((n) => `### ${n.title}\n${(n.body_md || "").slice(0, 2500)}`)
                .join("\n\n")}\n—— 結束 ——`
            : "";
        pendingSources = sourcesFromNotes([
          { ...focusNote, title: noteTitle, body_md: noteBody },
          ...pinExtra,
        ]);
        body = {
          action: "note",
          title: noteTitle,
          body: noteBody,
          prompt,
          context: withChatSummaryContext(
            `—— 目前筆記（可編輯目標）——\nID：${focusNote.id}\n標題：${noteTitle}\n路徑：${focusNote.folder || "（根目錄）"}\n\n${noteBody}\n—— 結束 ——${extraCtx}`,
            memory
          ),
          messages: history,
          assistant,
          allowNoteEdit: canEditHere,
          focusNoteId: focusNote.id,
        };
      } else if (canEditSchedule && liveSchedule) {
        body = {
          action: "note",
          title: `日誌 ${liveSchedule.selectedDate}`,
          prompt,
          context: withChatSummaryContext(packScheduleContextForAi(liveSchedule), memory),
          messages: history,
          assistant,
          allowNoteEdit: false,
          allowDbEdit: false,
          allowScheduleEdit: true,
          focusScheduleDate: liveSchedule.selectedDate,
        };
      } else {
        const libNotes = notes.map((n) => ({
          id: n.id,
          title: n.title,
          body_md: n.body_md,
          tags: n.tags,
          folder: n.folder,
          updated_at: n.updated_at,
          created_at: n.created_at,
        }));
        const packed = packLibraryContext(libNotes, displayPrompt, {
          selectedIds: snapshotPins.length ? snapshotPins : undefined,
          maxNotes: snapshotPins.length ? Math.min(snapshotPins.length, 12) : 10,
          maxChars: 14000,
        });
        pendingSources = sourcesFromNotes(
          packed.usedIds
            .map((id) => notes.find((n) => n.id === id))
            .filter(Boolean) as Note[]
        );
        body = {
          action: "library",
          prompt: displayPrompt,
          context: withChatSummaryContext(packed.context, memory),
          assistant,
          messages: history,
          allowNoteEdit: false,
        };
      }

      // Inject bridge selection / context into every path
      if (bridgeExtraSnap.trim() && typeof body.context === "string") {
        body.context = `${body.context}\n\n${bridgeExtraSnap}`.slice(0, 28000);
      } else if (bridgeExtraSnap.trim()) {
        body.context = bridgeExtraSnap.slice(0, 28000);
      }
      if (canEditCanvas && liveCanvas && bridgeExtraSnap.trim() && typeof body.prompt === "string") {
        body.prompt = `${body.prompt}\n\n${bridgeExtraSnap}`.slice(0, 16000);
      }
      if (attachPayloads.length) {
        body.attachments = attachPayloads;
      }
      if (bridgeMediaSnap.length) {
        body.mediaRefs = bridgeMediaSnap;
      }
      if (!("prompt" in body) || body.prompt === trimmed || !trimmed) {
        body.prompt = displayPrompt;
      }

      const attachSources = attachLabels.map((label, i) => ({
        title: `附件 · ${label}`,
        href: `#attachment-${i + 1}`,
        heading: attachSnapshot[i]?.kind === "pdf" ? "PDF" : "圖片",
      }));
      if (attachSources.length) {
        pendingSources = [...(pendingSources || []), ...attachSources];
      }
      if (bridgeExtraSnap.trim() || bridgeLabel.trim()) {
        pendingSources = [
          ...(pendingSources || []),
          {
            title: bridgeLabel.trim() || "目前選取",
            href: pathname || "#",
          },
        ];
      }
      if (onCanvasPage && liveCanvas) {
        pendingSources = [
          ...(pendingSources || []),
          {
            title: liveCanvas.name || "白板",
            href: `/canvas/${liveCanvas.canvasId}`,
            heading:
              liveCanvas.selectedIds?.length
                ? `選取 ${liveCanvas.selectedIds.length}`
                : undefined,
          },
        ];
      }

      const res = await aiFetch("/api/ai/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "失敗");
      const rawText = String(data.text || "（無回覆）");

      let displayText = rawText;
      let noteEdit: NoteAiEdit | null = null;
      let dbEdit: DbAiEdit | null = null;
      let scheduleEdit: ScheduleAiEdit | null = null;
      let canvasEdit: CanvasAiEdit | null = null;
      let editApplied = false;
      const answerSources = pendingSources;

      if (canEditDb && dbSnap) {
        const parsedDb = parseDbAiEdit(rawText);
        displayText = parsedDb.displayText;
        dbEdit = parsedDb.edit;
        if (dbEdit && dbEdit.databaseId === dbSnap.databaseId && user) {
          const dbDoc = await getDatabase(dbEdit.databaseId);
          if (dbDoc) {
            const rows = await listDatabaseRowsOnce(user.uid, dbEdit.databaseId);
            const result = await applyDbAiEdit(dbEdit, {
              db: dbDoc,
              rows,
              userId: user.uid,
            });
            editApplied = result.ok > 0;
            if (result.ok && !result.failed) {
              toast(`已更新資料庫（${result.ok} 項）`);
            } else if (result.ok) {
              toast(`已套用 ${result.ok} 項，失敗 ${result.failed} 項`);
            }
          }
        }
      } else if (canEditHere) {
        const parsed = parseNoteAiEdit(rawText);
        displayText = parsed.displayText;
        noteEdit = parsed.edit;
      } else if (canEditSchedule) {
        const parsedSched = parseScheduleAiEdit(rawText);
        displayText = parsedSched.displayText;
        scheduleEdit = parsedSched.edit;
      } else if (canEditCanvas) {
        const parsedCanvas = parseCanvasAiEdit(rawText);
        displayText = parsedCanvas.displayText;
        canvasEdit = allowCanvasEdit ? parsedCanvas.edit : null;
      }

      const assistantMsg: Msg = {
        id: uid(),
        role: "assistant",
        text: displayText,
        edit: noteEdit,
        editNoteId: noteEdit && focusNote ? focusNote.id : undefined,
        dbEdit,
        scheduleEdit,
        canvasEdit,
        editApplied,
        sources: answerSources?.length ? answerSources : undefined,
      };
      patchActive((t) => ({
        ...t,
        msgs: [...t.msgs, assistantMsg],
      }), tid);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      patchActive((t) => ({
        ...t,
        msgs: [...t.msgs, { id: uid(), role: "assistant", text: `無法回答：${msg}` }],
      }), tid);
    } finally {
      pendingAttachRef.current = null;
      setBusy(false);
    }
  };

  if (!user) return null;

  const headTitle = active?.title || "新 AI 對話";

  const onSheetPointerDown = (e: REPointerEvent<HTMLButtonElement>) => {
    if (!isMobile) return;
    e.preventDefault();
    const startY = e.clientY;
    const startH = sheetH;
    sheetDrag.current = { startY, startH };
    const onMove = (ev: PointerEvent) => {
      if (!sheetDrag.current) return;
      const dy = startY - ev.clientY;
      const vh = window.innerHeight || 1;
      const next = Math.min(72, Math.max(28, startH + (dy / vh) * 100));
      setSheetH(Math.round(next));
    };
    const onUp = () => {
      sheetDrag.current = null;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  };

  return (
    <>
      <aside
        className={`cadence-ai-rail${open ? " is-open" : " is-collapsed"} is-${mode}`}
        aria-label={assistantName}
      >
        {!open ? (
          <button
            type="button"
            className="cadence-ai-rail-tab"
            title={`${assistantName}（Ctrl+Shift+A）`}
            onClick={() => setOpen(true)}
          >
            <span>AI</span>
          </button>
        ) : (
          <div className="cadence-ai-rail-inner">
            <button
              type="button"
              className="cadence-ai-sheet-handle"
              aria-label="拖曳調整 AI 高度"
              title="拖曳調整高度"
              onPointerDown={onSheetPointerDown}
            />
            <div className="cadence-ai-dock-head">
              <button
                type="button"
                className="cadence-ai-title-btn"
                title="對話標題"
                onClick={() => setHistoryOpen((v) => !v)}
              >
                <strong>{headTitle}</strong>
                <span className="cadence-ai-title-caret">▾</span>
              </button>
              <button
                type="button"
                className="doc-cmd cadence-ai-ico"
                title="新對話"
                onClick={startNewChat}
              >
                +
              </button>
              <button
                type="button"
                className={`doc-cmd cadence-ai-ico${historyOpen ? " is-on" : ""}`}
                title="歷史紀錄"
                onClick={() => setHistoryOpen((v) => !v)}
              >
                ⏱
              </button>
              <button
                type="button"
                className={`doc-cmd cadence-ai-ico cadence-ai-mode-toggle${mode === "float" ? " is-on" : ""}`}
                title={mode === "dock" ? "改為浮動視窗" : "釘選到右側"}
                onClick={() => setMode((m) => (m === "dock" ? "float" : "dock"))}
              >
                {mode === "dock" ? "⧉" : "▥"}
              </button>
              <button
                type="button"
                className="doc-cmd cadence-ai-ico"
                title="關閉"
                onClick={() => setOpen(false)}
              >
                {isMobile ? "∨" : "››"}
              </button>
            </div>

            {historyOpen && (
              <div className="cadence-ai-history">
                <div className="cadence-ai-history-head">
                  <span>歷史紀錄</span>
                  <button type="button" className="doc-cmd" onClick={startNewChat}>
                    新對話
                  </button>
                </div>
                {historySorted.length === 0 ? (
                  <p className="note-aside-empty">尚無對話</p>
                ) : (
                  historySorted.map((t) => (
                    <div
                      key={t.id}
                      className={`cadence-ai-history-item${t.id === activeId ? " is-on" : ""}`}
                    >
                      <button
                        type="button"
                        className="cadence-ai-history-main"
                        onClick={() => loadThread(t.id)}
                      >
                        <strong>{t.title || "對話"}</strong>
                        <span>
                          {t.msgs.length} 則 ·{" "}
                          {new Date(t.updatedAt).toLocaleString("zh-TW", {
                            month: "numeric",
                            day: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                      </button>
                      <button
                        type="button"
                        className="doc-cmd"
                        title="刪除"
                        onClick={() => deleteThread(t.id)}
                      >
                        ×
                      </button>
                    </div>
                  ))
                )}
              </div>
            )}

            <div className="cadence-ai-dock-scope-row">
              <span className="cadence-ai-dock-scope cadence-ai-focus-label" title={scopeLabel}>
                {scopeLabel}
              </span>
              <button
                type="button"
                className="doc-cmd"
                title="深度研究"
                onClick={() => {
                  const from = focusNoteId || undefined;
                  const lastUser = [...msgs].reverse().find((m) => m.role === "user");
                  const pinnedTitles = pinnedNotes
                    .map((n) => n.title)
                    .filter(Boolean)
                    .slice(0, 3)
                    .join("、");
                  const topic =
                    lastUser?.text?.trim().slice(0, 120) ||
                    focusNote?.title ||
                    pinnedTitles ||
                    undefined;
                  router.push(
                    buildResearchUrl({
                      from,
                      notes: pinnedIds.length ? pinnedIds : undefined,
                      topic,
                      returnTo: !!from,
                    })
                  );
                }}
              >
                研究
              </button>
            </div>

            <div className="cadence-ai-ctx-row" aria-label="脈絡">
              {bridgeLabel ? (
                <button
                  type="button"
                  className="cadence-ai-ctx-chip"
                  title="清除脈絡"
                  onClick={clearBridgeContext}
                >
                  {bridgeLabel.length > 28 ? `${bridgeLabel.slice(0, 28)}…` : bridgeLabel} ×
                </button>
              ) : null}
              {onCanvasPage && canvasSnap && (canvasSnap.selectedIds?.length || 0) > 0 ? (
                <span className="cadence-ai-ctx-chip" title="白板目前選取">
                  白板選取 · {canvasSnap.selectedIds.length}
                </span>
              ) : null}
              {((onCanvasPage && canvasSnap && (canvasSnap.selectedIds?.length || 0) > 0) ||
                onNotePage) && (
                <button
                  type="button"
                  className="doc-cmd"
                  title="把目前選取加入對話脈絡"
                  onClick={useLiveSelection}
                >
                  使用目前選取
                </button>
              )}
            </div>

            <div className="cadence-ai-dock-pins">
              <button
                type="button"
                className="doc-cmd"
                onClick={() => {
                  setAtOpen((v) => !v);
                  setAtQ("");
                }}
              >
                @ 筆記
              </button>
              {focusNote && !pinnedIds.includes(focusNote.id) && (
                <button
                  type="button"
                  className="cadence-ai-pin cadence-ai-pin--ctx"
                  title="加入目前頁面"
                  onClick={() => togglePin(focusNote.id)}
                >
                  {focusNote.title.slice(0, 14) || "此頁"}
                  {(focusNote.title.length || 2) > 14 ? "…" : ""} +
                </button>
              )}
              {pinnedNotes.map((n) => (
                <button
                  key={n.id}
                  type="button"
                  className="cadence-ai-pin"
                  title="再點移除"
                  onClick={() => togglePin(n.id)}
                >
                  {n.title.slice(0, 16)}
                  {n.title.length > 16 ? "…" : ""} ×
                </button>
              ))}
            </div>
            {atOpen && (
              <div className="cadence-ai-at-menu">
                <input
                  className="input"
                  placeholder="搜尋筆記標題…"
                  value={atQ}
                  onChange={(e) => setAtQ(e.target.value)}
                  autoFocus
                />
                {atCandidates.length === 0 ? (
                  <p className="note-aside-empty">沒有可加入的筆記</p>
                ) : (
                  atCandidates.map((n) => (
                    <button
                      key={n.id}
                      type="button"
                      className="cadence-ai-at-item"
                      onClick={() => {
                        togglePin(n.id);
                        setAtOpen(false);
                      }}
                    >
                      <strong>{n.title}</strong>
                      <span>{n.folder || "未分類"}</span>
                    </button>
                  ))
                )}
              </div>
            )}

            {msgs.length === 0 && !historyOpen && (
              <div className="cadence-ai-dock-empty">
                {showWelcome ? (
                  <>
                    <p className="cadence-ai-greet">先從這三件事開始</p>
                    <p className="cadence-ai-welcome-hint">
                      整理結構、抽出待辦、或要一段摘要。之後可用 ⌘K 捕捉、⌘J 再開此面板。
                    </p>
                    <div className="cadence-ai-dock-suggest">
                      {WELCOME_CHIPS.map((s) => (
                        <button
                          key={s.label}
                          type="button"
                          className="note-ai-chip"
                          disabled={busy}
                          onClick={() => {
                            dismissWelcome();
                            void send(s.prompt);
                          }}
                        >
                          {s.label}
                        </button>
                      ))}
                    </div>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      style={{ marginTop: "0.5rem" }}
                      onClick={dismissWelcome}
                    >
                      看全部建議
                    </button>
                  </>
                ) : (
                  <>
                    <p className="cadence-ai-greet">想做些什麼？</p>
                    <div className="cadence-ai-dock-suggest">
                      {dockSuggestions.map((s) => (
                        <button
                          key={s.label}
                          type="button"
                          className="note-ai-chip"
                          disabled={busy}
                          onClick={() => void send(s.prompt)}
                        >
                          {s.label}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}

            <div className="cadence-ai-dock-msgs" ref={listRef}>
              {msgs.map((m) => (
                <div key={m.id} className={`note-ai-msg note-ai-msg--${m.role}`}>
                  <span className="note-ai-msg-role">{m.role === "user" ? "你" : assistantName}</span>
                  {m.role === "assistant" ? (
                    <AiMarkdown text={m.text} />
                  ) : (
                    <>
                      <p>{m.text}</p>
                      {m.attachmentLabels?.length ? (
                        <div className="cadence-ai-msg-attach" aria-label="附件">
                          {m.attachmentLabels.map((lab) => (
                            <span key={lab} className="cadence-ai-msg-attach-chip">
                              {lab}
                            </span>
                          ))}
                        </div>
                      ) : null}
                    </>
                  )}
                  {m.role === "assistant" && m.sources && m.sources.length > 0 ? (
                    <div className="cadence-ai-sources" aria-label="來源">
                      <span className="cadence-ai-sources-label">來源</span>
                      <ul>
                        {m.sources.map((s) => (
                          <li key={s.href}>
                            <Link href={s.href} className="cadence-ai-source-link">
                              {s.title}
                              {s.heading ? (
                                <span className="cadence-ai-source-anchor"> · {s.heading}</span>
                              ) : null}
                            </Link>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                  {m.role === "assistant" && m.dbEdit ? (
                    <div className="cadence-ai-edit-bar">
                      <span>
                        {m.editApplied
                          ? `已寫入資料庫（${m.dbEdit.ops.length} 項）`
                          : `建議修改資料庫（${m.dbEdit.ops.length} 項）`}
                      </span>
                      <button
                        type="button"
                        className="btn btn-sm"
                        onClick={() => void applyDbEdit(m.id, m.dbEdit!)}
                      >
                        {m.editApplied ? "再次套用" : "套用到資料庫"}
                      </button>
                    </div>
                  ) : null}
                  {m.role === "assistant" && m.scheduleEdit ? (
                    <div className="cadence-ai-edit-bar">
                      <span>
                        {m.editApplied
                          ? `已寫入行程（${m.scheduleEdit.ops.length} 項）`
                          : `建議修改行程（${m.scheduleEdit.ops.length} 項）`}
                      </span>
                      <button
                        type="button"
                        className="btn btn-sm"
                        onClick={() => void applyScheduleEdit(m.id, m.scheduleEdit!)}
                      >
                        {m.editApplied ? "再次套用" : "套用到行程"}
                      </button>
                    </div>
                  ) : null}
                  {m.role === "assistant" && m.canvasEdit?.ops?.length ? (
                    <div className="cadence-ai-edit-bar">
                      <span>
                        {m.editApplied
                          ? `已寫入白板（${m.canvasEdit.ops.length} 項）`
                          : `建議修改白板（${m.canvasEdit.ops.length} 項：${summarizeCanvasOps(m.canvasEdit.ops)}）`}
                      </span>
                      <button
                        type="button"
                        className="btn btn-sm"
                        onClick={() => applyCanvasEdit(m.id, m.canvasEdit!)}
                      >
                        {m.editApplied ? "再次套用" : "套用到白板"}
                      </button>
                    </div>
                  ) : null}
                  {m.role === "assistant" && m.edit && m.editNoteId ? (
                    <div className="cadence-ai-edit-bar cadence-ai-edit-bar--review">
                      <div className="cadence-ai-edit-head">
                        <span>
                          {m.editApplied
                            ? m.edit.mode === "append"
                              ? "已追加到筆記"
                              : "已寫入筆記"
                            : "建議修改筆記（請先檢視）"}
                        </span>
                        <span className="cadence-ai-edit-summary">
                          {(() => {
                            const live = readNoteLiveDraft(m.editNoteId!);
                            const before = live?.body ?? focusNote?.body_md ?? "";
                            const after = previewNoteAiEditBody(before, m.edit!);
                            return summarizeLineOps(diffLines(before, after));
                          })()}
                        </span>
                      </div>
                      {!m.editApplied && (
                        <pre className="cadence-ai-diff" aria-label="修改預覽">
                          {(() => {
                            const live = readNoteLiveDraft(m.editNoteId!);
                            const before = live?.body ?? focusNote?.body_md ?? "";
                            const after = previewNoteAiEditBody(before, m.edit!);
                            const rows = expandDiffPreview(before, after, 1, 36);
                            if (!rows.length) return "（無文字變更）";
                            return rows
                              .map((r) =>
                                r.kind === "add"
                                  ? `+ ${r.text}`
                                  : r.kind === "del"
                                    ? `− ${r.text}`
                                    : `  ${r.text}`
                              )
                              .join("\n");
                          })()}
                        </pre>
                      )}
                      <div className="cadence-ai-edit-actions">
                        <button
                          type="button"
                          className="btn btn-sm"
                          onClick={() => applyEdit(m.id, m.edit!, m.editNoteId!)}
                        >
                          {m.editApplied ? "再次套用" : "套用到筆記"}
                        </button>
                      </div>
                    </div>
                  ) : null}
                </div>
              ))}
              {busy && (
                <div className="note-ai-msg note-ai-msg--assistant cadence-ai-thinking">
                  <span className="note-ai-msg-role">{assistantName}</span>
                  <AiThinkingMorph />
                </div>
              )}
            </div>
            {error && <p className="note-aside-error">{error}</p>}
            <form
              className={`cadence-ai-dock-compose${attach.dragOver ? " is-drag" : ""}`}
              onSubmit={(e) => {
                e.preventDefault();
                void send(input);
              }}
              onDragEnter={attach.onDragEnter}
              onDragLeave={attach.onDragLeave}
              onDragOver={attach.onDragOver}
              onDrop={attach.onDrop}
            >
              {attach.fileInput}
              <AiAttachmentChips
                attachments={attach.attachments}
                onRemove={attach.removeAttachment}
                disabled={busy}
              />
              {attach.dragOver ? (
                <div className="cadence-ai-drop-hint">放開以加入圖片或 PDF</div>
              ) : null}
              <textarea
                ref={inputRef}
                className="input"
                rows={3}
                placeholder="使用 AI 完成任何事情…（可拖放／貼上圖片）"
                value={input}
                disabled={busy}
                onChange={(e) => setInput(e.target.value)}
                onPaste={attach.onPaste}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void send(input);
                  }
                }}
              />
              <div className="cadence-ai-dock-actions">
                <button
                  type="button"
                  className="doc-cmd"
                  title="附加圖片或 PDF"
                  disabled={busy}
                  onClick={attach.openPicker}
                  aria-label="附加檔案"
                >
                  附加
                </button>
                <button
                  type="button"
                  className={`doc-cmd${webSearch ? " is-on" : ""}`}
                  title="啟用 Google 搜尋 grounding（上網）"
                  aria-pressed={webSearch}
                  onClick={() => setWebSearch((v) => !v)}
                >
                  {webSearch ? "上網 · 開" : "上網"}
                </button>
                {onNotePage ? (
                  <button
                    type="button"
                    className={`doc-cmd${allowNoteEdit ? " is-on" : ""}`}
                    title={
                      allowNoteEdit
                        ? "已允許 AI 在你要求時修改本篇筆記"
                        : "目前不允許 AI 修改筆記"
                    }
                    aria-pressed={allowNoteEdit}
                    onClick={() => {
                      prefsCtx?.setPrefs({ aiAllowNoteEdit: !allowNoteEdit });
                      toast(
                        !allowNoteEdit
                          ? "已允許 AI 修改筆記（需在對話中明確要求）"
                          : "已關閉 AI 修改筆記權限"
                      );
                    }}
                  >
                    {allowNoteEdit ? "可改筆記" : "禁改筆記"}
                  </button>
                ) : null}
                {onCanvasPage ? (
                  <button
                    type="button"
                    className={`doc-cmd${allowCanvasEdit ? " is-on" : ""}`}
                    title={
                      allowCanvasEdit
                        ? "AI 可產出白板修改，需按「套用到白板」才會寫入"
                        : "AI 只能分析白板，不會產出修改"
                    }
                    aria-pressed={allowCanvasEdit}
                    onClick={() => {
                      prefsCtx?.setPrefs({ aiAllowCanvasEdit: !allowCanvasEdit });
                      toast(
                        !allowCanvasEdit
                          ? "已允許 AI 修改白板（需按套用）"
                          : "已關閉 AI 修改白板"
                      );
                    }}
                  >
                    {allowCanvasEdit ? "可改白板" : "禁改白板"}
                  </button>
                ) : null}
                <button
                  type="submit"
                  className="btn btn-sm"
                  disabled={busy || (!input.trim() && !attach.attachments.length)}
                >
                  送出
                </button>
              </div>
            </form>
          </div>
        )}
      </aside>
    </>
  );
}
