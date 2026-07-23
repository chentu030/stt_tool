"use client";

import { useEffect, useMemo, useRef, useState, type PointerEvent as REPointerEvent } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import { type Note } from "@/lib/firebase";
import { useNotesList } from "@/components/notes/NotesListProvider";
import { packLibraryContext, AI_SUGGESTIONS } from "@/lib/libraryIndex";
import { usePrefsOptional } from "@/components/PrefsProvider";
import { buildResearchUrl } from "@/lib/researchBridge";
import {
  JOB_AI_SUGGESTIONS,
  packTranscriptForAi,
  subscribeJobAiContext,
  type JobAiContext,
} from "@/lib/jobAiContext";
import AiMarkdown from "@/components/AiMarkdown";
import AiThinkingMorph from "@/components/motion/AiThinkingMorph";
import {
  dispatchNoteAiEdit,
  parseNoteAiEdit,
  readNoteLiveDraft,
  type NoteAiEdit,
} from "@/lib/noteAiEdit";
import {
  applyDbAiEdit,
  packDbContextForAi,
  parseDbAiEdit,
  readDbLiveSnapshot,
  type DbAiEdit,
} from "@/lib/dbAiEdit";
import { getDatabase, listDatabaseRowsOnce } from "@/lib/database";
import { toast } from "@/lib/toast";
import {
  buildChatApiHistory,
  buildSummaryPrompt,
  nextSummaryBatch,
  withChatSummaryContext,
  type ChatMemoryState,
} from "@/lib/aiChatMemory";

type Msg = {
  id: string;
  role: "user" | "assistant";
  text: string;
  edit?: NoteAiEdit | null;
  editNoteId?: string;
  dbEdit?: DbAiEdit | null;
  editApplied?: boolean;
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

const LIBRARY_SUGGESTIONS = AI_SUGGESTIONS;

const CANVAS_SUGGESTIONS = [
  { label: "分析白板", prompt: "請分析目前這張白板的結構與內容，給 3 點改進建議" },
  { label: "整理區塊", prompt: "幫我把白板上的內容整理成幾個清楚的區塊框架" },
  { label: "建議連線", prompt: "依內容建議該連結或釘上哪些筆記" },
  { label: "擴寫便利貼", prompt: "為選取或重點便利貼擴寫更完整的內容" },
];

function uid() {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
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
    localStorage.setItem(THREADS_KEY, JSON.stringify(threads.slice(0, 40)));
    localStorage.setItem(ACTIVE_KEY, activeId);
  } catch {
    /* ignore */
  }
}

/** Open/toggle the global AI right rail from anywhere */
export function openGlobalAiRail() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("cadence-ai-rail", { detail: { open: true } }));
}

export function toggleGlobalAiRail() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("cadence-ai-rail", { detail: { toggle: true } }));
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
  const [dbLiveTick, setDbLiveTick] = useState(0);
  const [isMobile, setIsMobile] = useState(false);
  const [sheetH, setSheetH] = useState(48); // vh units on mobile
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const hydrated = useRef(false);
  const sheetDrag = useRef<{ startY: number; startH: number } | null>(null);

  const onNotePage = pathname?.startsWith("/notes/");
  const onLibraryPage = pathname === "/library" || pathname?.startsWith("/library/");
  const onCanvasPage = pathname?.startsWith("/canvas/");
  const onJobPage = pathname?.startsWith("/job/");
  const onDbPage = pathname?.startsWith("/db/");
  const allowNoteEdit = prefsCtx?.prefs.aiAllowNoteEdit !== false;
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
  const activeDbSnap =
    liveDb && (!focusDatabaseId || liveDb.databaseId === focusDatabaseId) ? liveDb : null;
  const dockSuggestions =
    activeDbSnap || onDbPage
      ? DB_PAGE_SUGGESTIONS
      : onJobPage && jobCtx
      ? JOB_AI_SUGGESTIONS
      : onNotePage && focusNote
        ? NOTE_PAGE_SUGGESTIONS
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
    persistThreads(threads, activeId);
  }, [threads, activeId]);

  useEffect(() => {
    const onEvt = (e: Event) => {
      const d = (e as CustomEvent<{ open?: boolean; toggle?: boolean }>).detail || {};
      if (d.toggle) setOpen((v) => !v);
      else if (typeof d.open === "boolean") setOpen(d.open);
    };
    window.addEventListener("cadence-ai-rail", onEvt);
    return () => window.removeEventListener("cadence-ai-rail", onEvt);
  }, []);

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
    const on = () => setDbLiveTick((n) => n + 1);
    window.addEventListener("albireus:db-live", on);
    return () => window.removeEventListener("albireus:db-live", on);
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
    if (activeDbSnap) {
      const t = activeDbSnap.name || "資料庫";
      return t.length > 28 ? `${t.slice(0, 28)}…` : t;
    }
    if (onJobPage && jobCtx) {
      const t = jobCtx.filename || jobCtx.title || "逐字稿";
      return t.length > 28 ? `${t.slice(0, 28)}…` : t;
    }
    if (pinnedNotes.length) return `已 @ ${pinnedNotes.length} 篇`;
    if (focusNote) return focusNote.title || "筆記";
    if (onNotePage) return "跨庫提問 · 本篇可用 Ctrl+J";
    return `知識庫 ${notes.length} 篇`;
  }, [activeDbSnap, onJobPage, jobCtx, onNotePage, notes.length, pinnedNotes.length, focusNote]);

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

  const send = async (text: string) => {
    const prompt = text.trim();
    if (!prompt || busy) return;
    const tid = ensureActive();
    setBusy(true);
    setError("");
    setInput("");
    setAtOpen(false);
    const userMsg: Msg = { id: uid(), role: "user", text: prompt };
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
        const sumRes = await fetch("/api/ai/generate", {
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
      const dbSnap =
        readDbLiveSnapshot(focusDatabaseId) ||
        (focusDatabaseId ? null : readDbLiveSnapshot());
      if (focusDatabaseId && !dbSnap) {
        throw new Error("資料庫脈絡尚未就緒，請等表格載入後再試");
      }
      const canEditDb = allowNoteEdit && !!dbSnap;
      const canEditHere = allowNoteEdit && !!focusNote && onNotePage && !dbSnap;

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
        const packed = packLibraryContext(libNotes, prompt, {
          selectedIds: snapshotPins.length ? snapshotPins : undefined,
          maxNotes: snapshotPins.length ? Math.min(snapshotPins.length, 12) : 10,
          maxChars: 14000,
        });
        body = {
          action: "library",
          prompt,
          context: withChatSummaryContext(packed.context, memory),
          assistant,
          messages: history,
          allowNoteEdit: false,
        };
      }

      const res = await fetch("/api/ai/generate", {
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
      let editApplied = false;

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
        if (parsed.edit && focusNote) {
          dispatchNoteAiEdit({
            noteId: focusNote.id,
            mode: parsed.edit.mode,
            bodyMd: parsed.edit.bodyMd,
            title: parsed.edit.title,
            source: "global-ai",
          });
          editApplied = true;
          toast(parsed.edit.mode === "append" ? "已追加到筆記" : "已更新筆記內容");
        }
      }

      const assistantMsg: Msg = {
        id: uid(),
        role: "assistant",
        text: displayText,
        edit: noteEdit,
        editNoteId: noteEdit && focusNote ? focusNote.id : undefined,
        dbEdit,
        editApplied,
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
              <span className="cadence-ai-dock-scope" title={scopeLabel}>
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
              </div>
            )}

            <div className="cadence-ai-dock-msgs" ref={listRef}>
              {msgs.map((m) => (
                <div key={m.id} className={`note-ai-msg note-ai-msg--${m.role}`}>
                  <span className="note-ai-msg-role">{m.role === "user" ? "你" : assistantName}</span>
                  {m.role === "assistant" ? (
                    <AiMarkdown text={m.text} />
                  ) : (
                    <p>{m.text}</p>
                  )}
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
                  {m.role === "assistant" && m.edit && m.editNoteId ? (
                    <div className="cadence-ai-edit-bar">
                      <span>
                        {m.editApplied
                          ? m.edit.mode === "append"
                            ? "已追加到筆記"
                            : "已寫入筆記"
                          : "建議修改筆記"}
                      </span>
                      <button
                        type="button"
                        className="btn btn-sm"
                        onClick={() => applyEdit(m.id, m.edit!, m.editNoteId!)}
                      >
                        {m.editApplied ? "再次套用" : "套用到筆記"}
                      </button>
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
              className="cadence-ai-dock-compose"
              onSubmit={(e) => {
                e.preventDefault();
                void send(input);
              }}
            >
              {(onJobPage && jobCtx
                ? jobCtx.filename || jobCtx.title || "逐字稿"
                : focusNote || pinnedNotes[0]
                  ? pinnedNotes[0]?.title || focusNote?.title || "筆記"
                  : null) && (
                <div className="cadence-ai-ctx-chip">
                  {onJobPage && jobCtx
                    ? jobCtx.filename || jobCtx.title || "逐字稿"
                    : pinnedNotes[0]?.title || focusNote?.title || "筆記"}
                </div>
              )}
              <textarea
                ref={inputRef}
                className="input"
                rows={3}
                placeholder="使用 AI 完成任何事情…"
                value={input}
                disabled={busy}
                onChange={(e) => setInput(e.target.value)}
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
                <button type="button" className="doc-cmd" onClick={() => router.push("/library")}>
                  知識庫
                </button>
                <button
                  type="button"
                  className="doc-cmd"
                  onClick={() => router.push("/settings#st-ai")}
                >
                  偏好
                </button>
                <button type="submit" className="btn btn-sm" disabled={busy || !input.trim()}>
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
