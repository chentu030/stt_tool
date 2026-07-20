"use client";

import { useEffect, useMemo, useRef, useState, type PointerEvent as REPointerEvent } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import { listenToUserNotes, type Note } from "@/lib/firebase";
import { packLibraryContext, AI_SUGGESTIONS } from "@/lib/libraryIndex";
import { usePrefsOptional } from "@/components/PrefsProvider";
import { buildResearchUrl } from "@/lib/researchBridge";
import {
  JOB_AI_SUGGESTIONS,
  packTranscriptForAi,
  subscribeJobAiContext,
  type JobAiContext,
} from "@/lib/jobAiContext";

type Msg = { id: string; role: "user" | "assistant"; text: string };
type RailMode = "dock" | "float";
type ChatThread = {
  id: string;
  title: string;
  updatedAt: number;
  msgs: Msg[];
  pinnedIds: string[];
};

const OPEN_KEY = "cadence_ai_rail_open";
const MODE_KEY = "cadence_ai_rail_mode";
const THREADS_KEY = "cadence_ai_threads_v1";
const ACTIVE_KEY = "cadence_ai_active_thread";

const DOCK_SUGGESTIONS = [
  { label: "總結此頁面", prompt: "請總結目前對焦或知識庫裡最相關的筆記重點" },
  { label: "本週重點", prompt: "根據我的知識庫，整理本週最值得關注的 5 件事" },
  { label: "找相關筆記", prompt: "幫我找出彼此相關的筆記主題，並說明可如何串起來" },
  { label: "靈感草稿", prompt: "從最近筆記抽出靈感，寫一段可發展的草稿開頭" },
  { label: "待辦催收", prompt: "從筆記裡找出未完成待辦，按緊急程度排序" },
  { label: "會議準備", prompt: "幫我準備一場會議的議程與要帶的問題" },
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
  const [notes, setNotes] = useState<Note[]>([]);
  const [atOpen, setAtOpen] = useState(false);
  const [atQ, setAtQ] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [webSearch, setWebSearch] = useState(false);
  const [focusNoteId, setFocusNoteId] = useState<string | null>(null);
  const [jobCtx, setJobCtx] = useState<JobAiContext | null>(null);
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
  const dockSuggestions = onJobPage && jobCtx
    ? JOB_AI_SUGGESTIONS
    : onLibraryPage
      ? LIBRARY_SUGGESTIONS
      : onCanvasPage
        ? CANVAS_SUGGESTIONS
        : DOCK_SUGGESTIONS;
  const focusNote = useMemo(
    () => (focusNoteId ? notes.find((n) => n.id === focusNoteId) : null),
    [focusNoteId, notes]
  );
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
    if (!user) {
      setNotes([]);
      return;
    }
    return listenToUserNotes(user.uid, setNotes);
  }, [user]);

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
    if (onJobPage && jobCtx) {
      const t = jobCtx.filename || jobCtx.title || "逐字稿";
      return t.length > 28 ? `${t.slice(0, 28)}…` : t;
    }
    if (pinnedNotes.length) return `已 @ ${pinnedNotes.length} 篇`;
    if (focusNote) return focusNote.title || "筆記";
    if (onNotePage) return "跨庫提問 · 本篇可用 Ctrl+J";
    return `知識庫 ${notes.length} 篇`;
  }, [onJobPage, jobCtx, onNotePage, notes.length, pinnedNotes.length, focusNote]);

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
    patchActive((t) => {
      snapshotPins = t.pinnedIds;
      snapshotMsgs = [...t.msgs, userMsg];
      return {
        ...t,
        msgs: snapshotMsgs,
        title: t.msgs.length === 0 ? threadTitleFromMsgs(snapshotMsgs) : t.title,
      };
    }, tid);
    try {
      const history = snapshotMsgs
        .slice(-8)
        .map((m) => ({
          role: m.role === "assistant" ? "model" : "user",
          text: m.text,
        }))
        .slice(0, -1);
      const assistant = {
        name: prefsCtx?.prefs.aiAssistantName,
        style: prefsCtx?.prefs.aiStyle,
        model: prefsCtx?.prefs.aiModel,
        grounding: webSearch,
      };

      let body: Record<string, unknown>;
      if (onJobPage && jobCtx) {
        const packed = packTranscriptForAi(jobCtx.transcript);
        if (!packed.trim()) throw new Error("尚無逐字稿內容可詢問");
        body = {
          action: "note",
          title: jobCtx.filename || jobCtx.title || "逐字稿",
          prompt,
          context: `來源：逐字稿\n檔名：${jobCtx.filename || "—"}\n\n${packed}`,
          messages: history,
          assistant,
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
          context: packed.context,
          assistant,
          messages: history,
        };
      }

      const res = await fetch("/api/ai/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "失敗");
      patchActive((t) => ({
        ...t,
        msgs: [...t.msgs, { id: uid(), role: "assistant", text: data.text || "（無回覆）" }],
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
                  <span>{m.role === "user" ? "你" : assistantName}</span>
                  <p>{m.text}</p>
                </div>
              ))}
              {busy && <p className="note-aside-hint">思考中…</p>}
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
