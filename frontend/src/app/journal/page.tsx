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
  listenToUserNotes,
  loginWithGoogle,
  updateNote,
  Note,
} from "@/lib/firebase";
import { NOTE_TEMPLATES, journalTitle } from "@/lib/templates";
import ScrambleText from "@/components/motion/ScrambleText";
import ShinyPill from "@/components/motion/ShinyPill";
import JournalCalendar from "@/components/journal/JournalCalendar";
import JournalComposer, { type JournalComposerHandle } from "@/components/journal/JournalComposer";
import JournalAside from "@/components/journal/JournalAside";
import QuickVoiceButton from "@/components/voice/QuickVoiceButton";
import {
  buildMonthGrid,
  computeJournalStats,
  dateKeyFromDate,
  exportMonthMarkdown,
  parseDateKey,
  promptForDate,
  toJournalEntries,
  upsertJournalMeta,
} from "@/lib/journalMeta";
import { downloadText } from "@/lib/libraryIndex";
import { usePrefsOptional } from "@/components/PrefsProvider";
import { askConfirm } from "@/lib/dialogs";
import { toast } from "@/lib/toast";

export default function JournalPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const prefsCtx = usePrefsOptional();
  const [notes, setNotes] = useState<Note[]>([]);
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

  useEffect(() => {
    if (!user) return;
    return listenToUserNotes(user.uid, setNotes);
  }, [user]);

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
    const d = parseDateKey(dateKey);
    if (d) setCursor({ year: d.getFullYear(), month: d.getMonth() });
    setComposerDirty(false);
    setComposerKey((k) => k + 1);
  };

  const onSelectEntry = async (entry: (typeof entries)[0]) => {
    if (entry.id === selectedId) return;
    if (!(await confirmLeaveComposer())) return;
    setSelected(entry.dateKey);
    setSelectedId(entry.id);
    const d = parseDateKey(entry.dateKey);
    if (d) setCursor({ year: d.getFullYear(), month: d.getMonth() });
    setComposerDirty(false);
    setComposerKey((k) => k + 1);
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

  const weekNeighbors = useMemo(() => {
    const d = parseDateKey(selected);
    if (!d) return [];
    const keys: string[] = [];
    for (let i = -3; i <= 3; i++) {
      const x = new Date(d);
      x.setDate(d.getDate() + i);
      keys.push(dateKeyFromDate(x));
    }
    return keys.map((k) => ({ dateKey: k, entry: byDate.get(k) }));
  }, [selected, byDate]);

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
        <div>
          <ScrambleText words="日誌" as="h1" className="page-title font-display" speed={22} />
          <p className="page-sub">
            {today}
            {stats.streak > 0 ? ` · 連續 ${stats.streak} 天` : ""}
            {composerDirty ? " · 未儲存" : ""}
          </p>
        </div>
        <div className="jn-hero-actions">
          <QuickVoiceButton
            uid={user.uid}
            compact
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
                  toast("快速錄音已寫入目前日誌");
                } catch (e) {
                  toast(e instanceof Error ? e.message : "寫入日誌失敗");
                }
              })();
            }}
            onCreatedNote={(noteId) => {
              toast("已另存快速筆記");
              // keep user on journal; they can open from toast flow later
              void noteId;
            }}
          />
          <button type="button" className="btn btn-ghost btn-sm" onClick={exportMonth}>
            匯出本月
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
            style={{ padding: "0.45rem 0.95rem", fontSize: "0.82rem" }}
            disabled={busy}
            onClick={() => {
              void openOrCreate(today);
            }}
          >
            {byDate.has(today) ? "打開今日" : "建立今日"}
          </ShinyPill>
        </div>
      </header>

      <div className="jn-layout">
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

          <div className="jn-week-strip">
            <h3>鄰近日子</h3>
            <div className="jn-week-row">
              {weekNeighbors.map(({ dateKey }) => {
                const words = wordsByDate.get(dateKey) || 0;
                return (
                <button
                  key={dateKey}
                  type="button"
                  className={`jn-week-pill${dateKey === selected ? " is-on" : ""}${words > 0 ? " has" : ""}`}
                  onClick={() => {
                    void onSelectDay(dateKey);
                  }}
                >
                  <strong>{dateKey.slice(5)}</strong>
                  <span>{words > 0 ? `${words} 字` : "空"}</span>
                </button>
                );
              })}
            </div>
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
                  style={{ maxWidth: 160 }}
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
        </div>

        <div className="jn-center">
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

        <JournalAside
          stats={stats}
          dateKey={selected}
          noteId={selectedEntry?.id}
          noteTitle={selectedEntry?.title}
          tagDefs={tagDefs}
          onAskAi={askAi}
        />
      </div>
    </div>
  );
}
