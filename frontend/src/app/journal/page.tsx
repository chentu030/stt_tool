"use client";

import PageLoading from "@/components/motion/PageLoading";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion } from "motion/react";
import { useAuth } from "@/components/AuthProvider";
import {
  createNote,
  deleteNote,
  loginWithGoogle,
  updateNote,
} from "@/lib/firebase";
import { useNotesList } from "@/components/notes/NotesListProvider";
import { NOTE_TEMPLATES, journalTitle } from "@/lib/templates";
import ScrambleText from "@/components/motion/ScrambleText";
import ShinyPill from "@/components/motion/ShinyPill";
import JournalCalendar from "@/components/journal/JournalCalendar";
import JournalComposer, { type JournalComposerHandle } from "@/components/journal/JournalComposer";
import JournalAside from "@/components/journal/JournalAside";
import JournalSchedulePanel from "@/components/journal/JournalSchedulePanel";
import QuickVoiceButton from "@/components/voice/QuickVoiceButton";
import { useLiveRecordingOptional } from "@/components/voice/LiveRecordingProvider";
import {
  buildMonthGrid,
  computeJournalStats,
  dateKeyFromDate,
  exportMonthMarkdown,
  parseDateKey,
  promptForDate,
  toJournalEntries,
  upsertJournalMeta,
  weekDateKeys,
} from "@/lib/journalMeta";
import {
  ensureMeetingNote,
  joinMeeting,
  setMeetingAiContext,
} from "@/lib/meetingSession";
import {
  listenScheduleEvents,
  type ScheduleEvent,
} from "@/lib/scheduleEvents";
import {
  connectGoogleCalendar,
  disconnectGoogleCalendar,
  fetchGoogleRangeEvents,
  getStoredGoogleAccessToken,
  googleCalendarConfigured,
} from "@/lib/googleCalendar";
import { downloadText } from "@/lib/libraryIndex";
import { usePrefsOptional } from "@/components/PrefsProvider";
import { askConfirm, askChoice } from "@/lib/dialogs";
import type { LiveAudioSource } from "@/components/voice/LiveNoteRecorder";
import { toast } from "@/lib/toast";

export default function JournalPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const prefsCtx = usePrefsOptional();
  const { notes } = useNotesList();
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState("");
  const [composerDirty, setComposerDirty] = useState(false);
  const composerRef = useRef<JournalComposerHandle>(null);
  const today = journalTitle();
  const [selected, setSelected] = useState(today);
  /** Which journal note is open in the composer (same day can have many). */
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [cursor, setCursor] = useState(() => {
    const d = new Date();
    return { year: d.getFullYear(), month: d.getMonth() };
  });
  const [composerKey, setComposerKey] = useState(0);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [gcalEvents, setGcalEvents] = useState<ScheduleEvent[]>([]);
  const [localEvents, setLocalEvents] = useState<ScheduleEvent[]>([]);
  const [gcalOn, setGcalOn] = useState(false);
  const [gcalStatus, setGcalStatus] = useState<"off" | "loading" | "ok" | "error">("off");
  const [railOpen, setRailOpen] = useState(false);
  const liveRec = useLiveRecordingOptional();
  const weekKeys = useMemo(() => weekDateKeys(selected), [selected]);
  const gcalRangeKeys = useMemo(() => {
    const d = parseDateKey(selected);
    if (!d) return weekKeys;
    const start = new Date(d.getFullYear(), d.getMonth(), 1);
    start.setDate(start.getDate() - 7);
    const end = new Date(d.getFullYear(), d.getMonth() + 1, 0);
    end.setDate(end.getDate() + 7);
    const keys: string[] = [];
    for (let cur = new Date(start); cur.getTime() <= end.getTime(); cur.setDate(cur.getDate() + 1)) {
      keys.push(dateKeyFromDate(cur));
    }
    return keys;
  }, [selected, weekKeys]);

  useEffect(() => {
    setGcalOn(Boolean(getStoredGoogleAccessToken()));
    try {
      setRailOpen(localStorage.getItem("cadence_jn_rail") === "1");
    } catch {
      /* ignore */
    }
  }, []);

  const toggleRail = () => {
    setRailOpen((v) => {
      const next = !v;
      try {
        localStorage.setItem("cadence_jn_rail", next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  useEffect(() => {
    if (!user) {
      setLocalEvents([]);
      return;
    }
    return listenScheduleEvents(user.uid, selected, setLocalEvents);
  }, [user, selected]);

  useEffect(() => {
    if (!gcalOn || !user) {
      setGcalEvents([]);
      setGcalStatus(gcalOn ? "ok" : "off");
      return;
    }
    let cancelled = false;
    setGcalStatus("loading");
    void (async () => {
      try {
        const rows = await fetchGoogleRangeEvents(gcalRangeKeys);
        if (!cancelled) {
          setGcalEvents(rows);
          setGcalStatus("ok");
        }
      } catch (e) {
        if (!cancelled) {
          toast(e instanceof Error ? e.message : "Google 日曆同步失敗");
          setGcalEvents([]);
          setGcalStatus("error");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [gcalOn, gcalRangeKeys, user]);

  const weekGcal = useMemo(
    () => gcalEvents.filter((e) => weekKeys.includes(e.dateKey)),
    [gcalEvents, weekKeys]
  );

  const agendaEvents = useMemo(() => {
    const map = new Map<string, ScheduleEvent>();
    for (const e of localEvents) map.set(e.id, e);
    for (const e of gcalEvents) {
      if (e.dateKey === selected) map.set(e.id, e);
    }
    return [...map.values()].sort(
      (a, b) =>
        Number(Boolean(b.allDay)) - Number(Boolean(a.allDay)) ||
        a.startMin - b.startMin ||
        a.title.localeCompare(b.title)
    );
  }, [localEvents, gcalEvents, selected]);

  const toggleGoogleCal = async () => {
    if (gcalOn) {
      disconnectGoogleCalendar();
      setGcalOn(false);
      setGcalEvents([]);
      toast("已解除 Google 日曆");
      return;
    }
    if (!googleCalendarConfigured()) {
      toast("尚未設定 NEXT_PUBLIC_GOOGLE_CALENDAR_CLIENT_ID，無法連結日曆");
      return;
    }
    try {
      await connectGoogleCalendar();
      setGcalOn(true);
      toast("已連結 Google 日曆");
    } catch (e) {
      toast(e instanceof Error ? e.message : "連結失敗");
    }
  };

  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!composerDirty && !busy) return;
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [composerDirty, busy]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "s") return;
      const tag = (document.activeElement as HTMLElement | null)?.tagName;
      if (tag === "INPUT") return;
      e.preventDefault();
      composerRef.current?.save();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const entries = useMemo(() => toJournalEntries(notes), [notes]);
  /** One representative entry per day (newest) — calendar / week strip. */
  const byDate = useMemo(() => {
    const m = new Map<string, (typeof entries)[0]>();
    for (const e of entries) {
      const prev = m.get(e.dateKey);
      if (!prev || e.updated_at.getTime() > prev.updated_at.getTime()) m.set(e.dateKey, e);
    }
    return m;
  }, [entries]);

  const wordsByDate = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of entries) {
      m.set(e.dateKey, (m.get(e.dateKey) || 0) + e.wordCount);
    }
    return m;
  }, [entries]);

  const stats = useMemo(() => computeJournalStats(entries), [entries]);
  const cells = useMemo(
    () => buildMonthGrid(cursor.year, cursor.month, byDate),
    [cursor, byDate]
  );

  const selectedEntry = useMemo(() => {
    if (selectedId) {
      const hit = entries.find((e) => e.id === selectedId);
      if (hit) return hit;
    }
    return byDate.get(selected) || null;
  }, [selectedId, entries, byDate, selected]);

  const tagDefs = prefsCtx?.prefs.journalTags || [];

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return entries;
    return entries.filter((e) => {
      if (e.dateKey.includes(s) || e.title.toLowerCase().includes(s) || e.body_md.toLowerCase().includes(s)) {
        return true;
      }
      const ids = e.meta.tags?.length ? e.meta.tags : e.meta.mood ? [e.meta.mood] : [];
      return ids.some((id) => {
        const def = tagDefs.find((t) => t.id === id);
        return def?.label.toLowerCase().includes(s) || id.toLowerCase().includes(s);
      });
    });
  }, [entries, q, tagDefs]);

  const confirmLeaveComposer = useCallback(async () => {
    if (!composerDirty) return true;
    return askConfirm({
      title: "捨棄未儲存的日誌？",
      message: "切換日期後，目前編輯區尚未儲存的內容會消失。",
      danger: true,
      confirmLabel: "捨棄",
      cancelLabel: "繼續編輯",
    });
  }, [composerDirty]);

  const ensureNote = async (
    dateKey: string,
    seedBody?: string,
    meta?: { tags?: string[] },
    opts?: { noteId?: string | null; forceNew?: boolean }
  ) => {
    if (!user) throw new Error("未登入");
    const existing = opts?.forceNew
      ? null
      : opts?.noteId
        ? entries.find((e) => e.id === opts.noteId) || null
        : byDate.get(dateKey);
    const daily = NOTE_TEMPLATES.find((x) => x.id === "daily")!;
    let body = seedBody ?? existing?.body_md ?? daily.body;
    if (meta) body = upsertJournalMeta(body, meta);
    else if (!existing) body = upsertJournalMeta(body, { tags: [] });

    if (existing) {
      await updateNote(existing.id, {
        body_md: body,
        title: dateKey,
        tags: Array.from(new Set([...(existing.tags || []), "journal"])),
        journal_date: dateKey,
        folder: existing.folder || "日誌",
      });
      return existing.id;
    }
    return createNote(user.uid, dateKey, body, undefined, ["journal"], {
      journal_date: dateKey,
      folder: "日誌",
    });
  };

  const openOrCreate = async (dateKey: string) => {
    if (!user || busy) return;
    if (!(await confirmLeaveComposer())) return;
    setBusy(true);
    try {
      const preferred =
        selectedEntry?.dateKey === dateKey
          ? selectedEntry.id
          : byDate.get(dateKey)?.id;
      const id = preferred || (await ensureNote(dateKey, undefined, undefined, { forceNew: true }));
      setSelected(dateKey);
      setSelectedId(id);
      router.push(`/notes/${id}`);
    } catch (e) {
      toast(e instanceof Error ? e.message : "無法開啟");
    } finally {
      setBusy(false);
    }
  };

  const saveComposer = async (payload: {
    text: string;
    tags: string[];
    appendTemplate?: string;
  }) => {
    if (!user || busy) return;
    setBusy(true);
    try {
      const existing = selectedEntry;
      let text = payload.text;
      if (payload.appendTemplate) {
        text = `${text.trim()}${text.trim() ? "\n\n" : ""}${payload.appendTemplate}`;
      }
      if (!text.trim() && existing) {
        text = existing.body_md.replace(/<!--\s*cadence-journal[^>]*-->/i, "").trim();
      }
      if (!text.trim()) {
        text = `${NOTE_TEMPLATES.find((x) => x.id === "daily")!.body}\n\n## 提問回應\n${promptForDate(selected)}\n\n`;
      }
      const body = upsertJournalMeta(text, { tags: payload.tags });
      const id = await ensureNote(selected, body, { tags: payload.tags }, {
        noteId: existing?.id ?? selectedId,
      });
      setSelectedId(id);
      toast(payload.appendTemplate ? "已插入段落並儲存" : "已儲存日誌");
      setComposerDirty(false);
      setComposerKey((k) => k + 1);
    } catch (e) {
      toast(e instanceof Error ? e.message : "儲存失敗");
    } finally {
      setBusy(false);
    }
  };

  const createNewForDay = async (dateKey: string) => {
    if (!user || busy) return;
    if (!(await confirmLeaveComposer())) return;
    setBusy(true);
    try {
      const id = await ensureNote(dateKey, undefined, undefined, { forceNew: true });
      const d = parseDateKey(dateKey);
      if (d) setCursor({ year: d.getFullYear(), month: d.getMonth() });
      setSelected(dateKey);
      setSelectedId(id);
      setComposerDirty(false);
      setComposerKey((k) => k + 1);
      toast("已新增日誌");
    } catch (e) {
      toast(e instanceof Error ? e.message : "無法新增");
    } finally {
      setBusy(false);
    }
  };

  const shiftMonth = (delta: number) => {
    setCursor((c) => {
      const d = new Date(c.year, c.month + delta, 1);
      return { year: d.getFullYear(), month: d.getMonth() };
    });
  };

  const goToday = async () => {
    if (!(await confirmLeaveComposer())) return;
    const d = new Date();
    setCursor({ year: d.getFullYear(), month: d.getMonth() });
    setSelected(today);
    setSelectedId(byDate.get(today)?.id ?? null);
    setComposerDirty(false);
    setComposerKey((k) => k + 1);
  };

  const onSelectDay = async (dateKey: string) => {
    const primary = byDate.get(dateKey);
    const nextId = primary?.id ?? null;
    if (dateKey === selected && nextId === selectedId) return;
    if (!(await confirmLeaveComposer())) return;
    setSelected(dateKey);
    setSelectedId(nextId);
    setSelectedEventId(null);
    const d = parseDateKey(dateKey);
    if (d) setCursor({ year: d.getFullYear(), month: d.getMonth() });
    setComposerDirty(false);
    setComposerKey((k) => k + 1);
  };

  const onSelectEntry = async (entry: (typeof entries)[0]) => {
    if (entry.id === selectedId) {
      if (!railOpen) toggleRail();
      return;
    }
    if (!(await confirmLeaveComposer())) return;
    setSelected(entry.dateKey);
    setSelectedId(entry.id);
    const d = parseDateKey(entry.dateKey);
    if (d) setCursor({ year: d.getFullYear(), month: d.getMonth() });
    setComposerDirty(false);
    setComposerKey((k) => k + 1);
    if (!railOpen) {
      try {
        localStorage.setItem("cadence_jn_rail", "1");
      } catch {
        /* ignore */
      }
      setRailOpen(true);
    }
  };

  const deleteEntry = async (id: string, dateKey: string) => {
    if (
      !(await askConfirm({
        title: `刪除 ${dateKey} 的日誌？`,
        message: "此操作無法復原。",
        danger: true,
        confirmLabel: "刪除",
      }))
    ) {
      return;
    }
    await deleteNote(id);
    toast("已刪除日誌");
    if (id === selectedId || (dateKey === selected && selectedId === id)) {
      const remaining = entries
        .filter((e) => e.dateKey === dateKey && e.id !== id)
        .sort((a, b) => b.updated_at.getTime() - a.updated_at.getTime());
      setSelected(dateKey);
      setSelectedId(remaining[0]?.id ?? null);
      setComposerDirty(false);
      setComposerKey((k) => k + 1);
    }
  };

  const exportMonth = () => {
    const md = exportMonthMarkdown(entries, cursor.year, cursor.month, tagDefs);
    downloadText(`cadence-journal-${cursor.year}-${cursor.month + 1}.md`, md);
    toast("已匯出本月 Markdown");
  };

  const askAi = async (prompt: string) => {
    const entry = selectedEntry;
    const res = await fetch("/api/ai/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "note",
        title: `日誌 ${selected}`,
        body: entry?.body_md || "",
        prompt,
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
    return data.text as string;
  };

  const monthlyReview = async () => {
    if (!user || busy) return;
    setBusy(true);
    try {
      const monthEntries = entries.filter((e) => {
        const d = parseDateKey(e.dateKey);
        return d && d.getFullYear() === cursor.year && d.getMonth() === cursor.month;
      });
      const pack = monthEntries
        .map(
          (e) =>
            `### ${e.dateKey}\n${(e.body_md || "").replace(/<!--\s*cadence-journal[^>]*-->/i, "").trim().slice(0, 1200)}`
        )
        .join("\n\n");
      if (!pack.trim()) {
        toast("本月尚無日誌可復盤");
        return;
      }
      const label = `${cursor.year}-${String(cursor.month + 1).padStart(2, "0")}`;
      const res = await fetch("/api/ai/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "journal_review",
          title: `日誌復盤 ${label}`,
          body: pack.slice(0, 14000),
          prompt: `請復盤 ${label} 的日誌，給出洞見與下月行動。`,
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
      const id = await createNote(
        user.uid,
        `日誌復盤 — ${label}`,
        `# 日誌復盤 ${label}\n\n${text}\n`,
        undefined,
        ["journal", "復盤"],
        { folder: "日誌復盤", status: "done" }
      );
      toast("已建立月復盤筆記");
      router.push(`/notes/${id}`);
    } catch (e) {
      toast(e instanceof Error ? e.message : "復盤失敗");
    } finally {
      setBusy(false);
    }
  };

  const startMeetingMode = useCallback(
    async (ev: ScheduleEvent) => {
      if (!user) return;
      try {
        const { noteId, created } = await ensureMeetingNote(user.uid, ev);
        setSelectedEventId(ev.id);
        try {
          if (ev.conferenceUrl) joinMeeting(ev);
        } catch {
          /* optional join */
        }
        const goLive = await askConfirm({
          title: "開始即時轉錄？",
          message:
            "會開啟會議筆記。錄音來源請誠實選擇：僅麥克風聽得到你自己（外放會議時可錄到對方）；分頁音訊需 Chrome 分享會議分頁並勾選「分享分頁音訊」。",
          confirmLabel: "選擇音訊並開始",
          cancelLabel: "只開筆記",
        });
        if (goLive) {
          const audioPick = await askChoice<LiveAudioSource>({
            title: "錄音來源",
            message: "可之後在錄音面板再改。",
            options: [
              {
                id: "mic",
                label: "麥克風",
                description: "錄此裝置麥克風（耳機通話通常錄不到對方）",
                primary: true,
              },
              {
                id: "system",
                label: "分頁音訊",
                description: "Chrome：分享會議分頁並勾選分享音訊",
              },
              {
                id: "both",
                label: "麥克風 + 分頁",
                description: "同時錄自己與分頁音訊",
              },
            ],
          });
          const audioSource = audioPick?.choice || "mic";
          setMeetingAiContext({
            sessionId: ev.id,
            eventId: ev.id,
            noteId,
            title: ev.title,
            transcript: "",
            dateKey: ev.dateKey,
            event: ev,
            uid: user.uid,
          });
          if (liveRec) {
            liveRec.startLive({
              uid: user.uid,
              noteId,
              mode: "transcribe",
              audioSource,
              autoStart: true,
            });
          }
          toast(created ? "已建立會議筆記並開始轉錄" : "已開始即時轉錄");
          router.push(
            `/notes/${noteId}?live=1&liveMode=transcribe&liveAudio=${audioSource}&liveStart=1`
          );
          return;
        }
        setMeetingAiContext({
          sessionId: ev.id,
          eventId: ev.id,
          noteId,
          title: ev.title,
          transcript: "",
          dateKey: ev.dateKey,
          event: ev,
          uid: user.uid,
        });
        toast(created ? "已建立會議筆記" : "已開啟會議筆記");
        router.push(`/notes/${noteId}`);
      } catch (e) {
        toast(e instanceof Error ? e.message : "無法進入會議模式");
      }
    },
    [user, liveRec, router]
  );

  const openEventNote = useCallback(
    async (ev: ScheduleEvent) => {
      if (!user) return;
      try {
        const { noteId } = await ensureMeetingNote(user.uid, ev);
        router.push(`/notes/${noteId}`);
      } catch (e) {
        toast(e instanceof Error ? e.message : "無法開啟筆記");
      }
    },
    [user, router]
  );

  const onJoinEvent = useCallback((ev: ScheduleEvent) => {
    try {
      joinMeeting(ev);
    } catch (e) {
      toast(e instanceof Error ? e.message : "無法加入");
    }
  }, []);

  if (loading) return <PageLoading />;
  if (!user) {
    return (
      <div className="jn-page jn-guest">
        <ScrambleText words="日誌" as="h1" className="page-title font-display" />
        <p className="page-sub">登入後寫日誌。</p>
        <ShinyPill onClick={() => loginWithGoogle()}>登入</ShinyPill>
      </div>
    );
  }

  const composerBody = selectedEntry
    ? selectedEntry.body_md.replace(/<!--\s*cadence-journal[^>]*-->/i, "").trim()
    : "";

  return (
    <div className="jn-page">
      <header className="jn-hero">
        <div className="jn-hero-brand">
          <ScrambleText words="日誌" as="h1" className="page-title font-display" speed={22} />
          <p className="page-sub">
            {today}
            {stats.streak > 0 ? ` · 連續 ${stats.streak} 天` : ""}
            {composerDirty ? " · 未儲存" : ""}
          </p>
        </div>
        <div className="jn-hero-toolbar">
          <QuickVoiceButton
            uid={user.uid}
            hero
            onAppendJournal={(md) => {
              void (async () => {
                try {
                  const existing = selectedEntry;
                  const base =
                    existing?.body_md.replace(/<!--\s*cadence-journal[^>]*-->/i, "").trim() ||
                    composerBody ||
                    "";
                  const next = `${base.trim()}${base.trim() ? "\n\n" : ""}${md.trim()}\n`;
                  const tags = existing?.meta.tags?.length
                    ? existing.meta.tags
                    : existing?.meta.mood
                      ? [existing.meta.mood]
                      : [];
                  const body = upsertJournalMeta(next, { tags });
                  const id = await ensureNote(selected, body, { tags }, {
                    noteId: existing?.id ?? selectedId,
                  });
                  setSelectedId(id);
                  setComposerDirty(false);
                  setComposerKey((k) => k + 1);
                  toast("快速錄音紀錄已寫入目前日誌");
                } catch (e) {
                  toast(e instanceof Error ? e.message : "寫入日誌失敗");
                }
              })();
            }}
            onCreatedNote={() => {
              /* note saved in background; toast already shown by queue */
            }}
          />
          <div className="jn-hero-actions">
            <button type="button" className="btn btn-ghost btn-sm" onClick={exportMonth}>
              匯出本月
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => {
                void toggleGoogleCal();
              }}
              title={
                googleCalendarConfigured()
                  ? "同步今日 Google 日曆行程（唯讀）"
                  : "需設定 NEXT_PUBLIC_GOOGLE_CALENDAR_CLIENT_ID"
              }
            >
              {gcalStatus === "loading"
                ? "Google 日曆 · 同步中…"
                : gcalStatus === "error"
                  ? "Google 日曆 · 重試"
                  : gcalOn
                    ? "Google 日曆 · 已連結"
                    : "連結 Google 日曆"}
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={busy}
              onClick={() => {
                void monthlyReview();
              }}
              title="AI 復盤本月日誌並建立筆記"
            >
              AI 月復盤
            </button>
            <ShinyPill
              className="btn jn-hero-open-today"
              style={{ padding: "0.45rem 0.95rem", fontSize: "0.82rem" }}
              disabled={busy}
              onClick={() => {
                void openOrCreate(today);
              }}
            >
              {byDate.has(today) ? "打開今日" : "建立今日"}
            </ShinyPill>
          </div>
        </div>
      </header>

      <div className={`jn-layout${railOpen ? " is-rail-open" : ""}`}>
        <div className="jn-left">
          <JournalCalendar
            year={cursor.year}
            month={cursor.month}
            cells={cells}
            selected={selected}
            tagDefs={tagDefs}
            onSelect={(dk) => {
              void onSelectDay(dk);
            }}
            onPrev={() => shiftMonth(-1)}
            onNext={() => shiftMonth(1)}
            onToday={() => {
              void goToday();
            }}
          />

          <button
            type="button"
            className="btn btn-soft jn-open-journal-rail"
            onClick={() => {
              if (!railOpen) toggleRail();
            }}
          >
            寫這天日誌
          </button>

          <JournalAside
            mode="agenda"
            stats={stats}
            dateKey={selected}
            noteId={selectedEntry?.id}
            noteTitle={selectedEntry?.title}
            tagDefs={tagDefs}
            agenda={agendaEvents}
            wordsByDate={wordsByDate}
            onAskAi={askAi}
            onSelectDay={(dk) => {
              void onSelectDay(dk);
            }}
            onMeetingMode={(ev) => {
              void startMeetingMode(ev);
            }}
            onOpenNote={(ev) => {
              void openEventNote(ev);
            }}
            onJoin={onJoinEvent}
          />
        </div>

        <div className="jn-center">
          <JournalSchedulePanel
            uid={user.uid}
            dateKey={selected}
            selectedEventId={selectedEventId}
            weekOverlays={weekGcal}
            monthOverlays={gcalEvents}
            onSelectDay={(dk) => {
              void onSelectDay(dk);
            }}
            onSelectEvent={(ev) => {
              setSelectedEventId(ev?.id ?? null);
            }}
            onMeetingMode={(ev) => {
              void startMeetingMode(ev);
            }}
            onOpenNote={(ev) => {
              void openEventNote(ev);
            }}
            onJoin={onJoinEvent}
          />
        </div>

        <button
          type="button"
          className={`jn-rail-toggle${railOpen ? " is-open" : ""}`}
          onClick={toggleRail}
          title={railOpen ? "收合側欄" : "展開側欄（日誌／過往／節奏）"}
          aria-expanded={railOpen}
        >
          {railOpen ? "›" : "‹"}
        </button>

        <aside className={`jn-rail${railOpen ? " is-open" : ""}`} aria-hidden={!railOpen}>
          {railOpen && (
            <>
              <div className="jn-center-stack">
                <JournalComposer
                  key={`${selectedId || "empty"}-${selected}-${composerKey}`}
                  ref={composerRef}
                  dateKey={selected}
                  initialText={composerBody}
                  tags={
                    selectedEntry?.meta.tags?.length
                      ? selectedEntry.meta.tags
                      : selectedEntry?.meta.mood
                        ? [selectedEntry.meta.mood]
                        : []
                  }
                  busy={busy}
                  onSave={(p) => {
                    void saveComposer(p);
                  }}
                  onOpenFull={() => {
                    void openOrCreate(selected);
                  }}
                  onDirtyChange={setComposerDirty}
                />
              </div>

              <section className="jn-list-section">
                <div className="jn-list-head">
                  <h3>過往日誌</h3>
                  <div className="jn-list-head-actions">
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm jn-add-entry"
                      disabled={busy}
                      title={`在 ${selected} 新增一則日誌`}
                      onClick={() => {
                        void createNewForDay(selected);
                      }}
                    >
                      新增
                    </button>
                    <input
                      className="input"
                      style={{ maxWidth: 120 }}
                      placeholder="搜尋…"
                      value={q}
                      onChange={(e) => setQ(e.target.value)}
                    />
                  </div>
                </div>
                {filtered.length === 0 ? (
                  <div className="jn-empty">
                    <p className="jn-muted">還沒有日誌</p>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => {
                        void createNewForDay(today);
                      }}
                    >
                      寫今天
                    </button>
                  </div>
                ) : (
                  <div className="jn-list">
                    {filtered.map((e, i) => (
                      <motion.div
                        key={e.id}
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: Math.min(i * 0.02, 0.2) }}
                        className={`jn-card${e.id === selectedEntry?.id ? " is-on" : ""}`}
                      >
                        <button
                          type="button"
                          className="jn-card-main"
                          onClick={() => {
                            void onSelectEntry(e);
                          }}
                        >
                          <div className="jn-card-top">
                            <strong>{e.dateKey}</strong>
                            {(e.meta.tags?.length
                              ? e.meta.tags
                              : e.meta.mood
                                ? [e.meta.mood]
                                : []
                            ).map((id) => {
                              const def = tagDefs.find((t) => t.id === id);
                              return (
                                <span
                                  key={id}
                                  className="jn-mood-dot"
                                  style={{ background: def?.color || "#94A3B8" }}
                                >
                                  {def?.label || id}
                                </span>
                              );
                            })}
                          </div>
                          <p>{e.snippet}</p>
                          <div className="jn-card-meta">
                            <span>{e.wordCount} 字</span>
                            <span>{e.updated_at.toLocaleString("zh-TW")}</span>
                          </div>
                        </button>
                        <div className="jn-card-actions">
                          <Link href={`/notes/${e.id}`} className="jn-card-open">
                            開啟
                          </Link>
                          <button
                            type="button"
                            className="jn-card-del"
                            title="刪除"
                            onClick={() => {
                              void deleteEntry(e.id, e.dateKey);
                            }}
                          >
                            刪除
                          </button>
                        </div>
                      </motion.div>
                    ))}
                  </div>
                )}
              </section>

              <JournalAside
                mode="secondary"
                stats={stats}
                dateKey={selected}
                noteId={selectedEntry?.id}
                noteTitle={selectedEntry?.title}
                tagDefs={tagDefs}
                agenda={agendaEvents}
                wordsByDate={wordsByDate}
                onAskAi={askAi}
                onSelectDay={(dk) => {
                  void onSelectDay(dk);
                }}
              />
            </>
          )}
        </aside>
      </div>
    </div>
  );
}
