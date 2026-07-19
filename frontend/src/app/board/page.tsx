"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import {
  listenToUserNotes,
  updateNote,
  createNote,
  loginWithGoogle,
  Note,
} from "@/lib/firebase";
import ScrambleText from "@/components/motion/ScrambleText";
import ShinyPill from "@/components/motion/ShinyPill";
import MenuSelect from "@/components/MenuSelect";
import BoardColumn from "@/components/board/BoardColumn";
import BoardAside from "@/components/board/BoardAside";
import {
  BOARD_COLUMNS,
  BOARD_QUICK_TEMPLATES,
  BoardFilters,
  BoardSort,
  BoardStatus,
  Priority,
  PRIORITIES,
  computeBoardStats,
  exportBoardMarkdown,
  filterBoardCards,
  groupByFolder,
  sortBoardCards,
  toBoardCards,
  upsertBoardMeta,
  parseBoardMeta,
} from "@/lib/boardMeta";
import { downloadText } from "@/lib/libraryIndex";
import { usePrefs } from "@/components/PrefsProvider";

const SORT_OPTIONS = [
  { value: "updated" as const, label: "最近更新" },
  { value: "priority" as const, label: "優先級" },
  { value: "due" as const, label: "截止日期" },
  { value: "age" as const, label: "閒置最久" },
  { value: "title" as const, label: "標題" },
];

export default function BoardPage() {
  const { user, loading } = useAuth();
  const { prefs } = usePrefs();
  const router = useRouter();
  const [notes, setNotes] = useState<Note[]>([]);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropCol, setDropCol] = useState<BoardStatus | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [sort, setSort] = useState<BoardSort>(prefs.boardSort);
  const [swimlanes, setSwimlanes] = useState(prefs.boardSwimlanes);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState("");
  const [filters, setFilters] = useState<BoardFilters>({
    q: "",
    folder: "",
    tag: "",
    priority: "",
    hideDone: prefs.boardHideDone,
    onlyOverdue: false,
    onlyStale: false,
  });
  const [aiBusy, setAiBusy] = useState(false);
  const [aiText, setAiText] = useState("");
  const [aiError, setAiError] = useState("");
  const [quickOpen, setQuickOpen] = useState<BoardStatus | null>(null);
  const [quickTitle, setQuickTitle] = useState("");
  const [quickTpl, setQuickTpl] = useState(BOARD_QUICK_TEMPLATES[0].id);
  const [prefsSeeded, setPrefsSeeded] = useState(false);

  useEffect(() => {
    if (prefsSeeded) return;
    setSort(prefs.boardSort);
    setSwimlanes(prefs.boardSwimlanes);
    setFilters((f) => ({ ...f, hideDone: prefs.boardHideDone }));
    setPrefsSeeded(true);
  }, [prefs.boardSort, prefs.boardSwimlanes, prefs.boardHideDone, prefsSeeded]);

  useEffect(() => {
    if (!user) return;
    return listenToUserNotes(user.uid, setNotes);
  }, [user]);

  const cards = useMemo(() => toBoardCards(notes), [notes]);
  const filtered = useMemo(
    () => sortBoardCards(filterBoardCards(cards, filters), sort),
    [cards, filters, sort]
  );
  const stats = useMemo(() => computeBoardStats(cards), [cards]);

  const folders = useMemo(() => {
    const s = new Set<string>();
    for (const n of notes) if (n.folder?.trim()) s.add(n.folder.trim());
    return Array.from(s).sort((a, b) => a.localeCompare(b, "zh-Hant"));
  }, [notes]);

  const tags = useMemo(() => {
    const s = new Set<string>();
    for (const n of notes) (n.tags || []).forEach((t) => s.add(t));
    return Array.from(s).sort((a, b) => a.localeCompare(b, "zh-Hant"));
  }, [notes]);

  const byCol = useMemo(() => {
    const map: Record<BoardStatus, typeof filtered> = {
      backlog: [],
      doing: [],
      done: [],
    };
    for (const c of filtered) map[c.statusKey].push(c);
    return map;
  }, [filtered]);

  const lanes = useMemo(() => (swimlanes ? groupByFolder(filtered) : null), [swimlanes, filtered]);

  const flash = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(""), 2200);
  };

  const moveCard = async (id: string, status: BoardStatus) => {
    await updateNote(id, { status });
    flash(`已移到「${BOARD_COLUMNS.find((c) => c.id === status)?.label}」`);
  };

  const moveSelected = async (status: BoardStatus) => {
    if (!selected.length) return;
    setBusy(true);
    try {
      await Promise.all(selected.map((id) => updateNote(id, { status })));
      setSelected([]);
      flash(`已移動 ${selected.length} 張`);
    } finally {
      setBusy(false);
    }
  };

  const cyclePriority = async (id: string) => {
    const note = notes.find((n) => n.id === id);
    if (!note) return;
    const cur = parseBoardMeta(note.body_md, note.tags).priority;
    const idx = PRIORITIES.findIndex((p) => p.id === cur);
    const next = PRIORITIES[(idx + 1) % PRIORITIES.length].id;
    const body = upsertBoardMeta(note.body_md, { priority: next });
    await updateNote(id, { body_md: body });
  };

  const setDueOnSelected = async () => {
    if (!selected.length) return;
    const due = window.prompt("截止日期 YYYY-MM-DD（空白清除）", "");
    if (due === null) return;
    const val = due.trim();
    if (val && !/^\d{4}-\d{2}-\d{2}$/.test(val)) {
      flash("日期格式不正確");
      return;
    }
    setBusy(true);
    try {
      await Promise.all(
        selected.map(async (id) => {
          const note = notes.find((n) => n.id === id);
          if (!note) return;
          await updateNote(id, {
            body_md: upsertBoardMeta(note.body_md, { due: val }),
          });
        })
      );
      flash("已更新截止日期");
    } finally {
      setBusy(false);
    }
  };

  const onSelect = (id: string, multi: boolean) => {
    setSelected((prev) => {
      if (!multi) return prev.includes(id) && prev.length === 1 ? [] : [id];
      return prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
    });
  };

  const createQuick = async () => {
    if (!user || !quickOpen || !quickTitle.trim()) return;
    setBusy(true);
    try {
      const tpl = BOARD_QUICK_TEMPLATES.find((t) => t.id === quickTpl) || BOARD_QUICK_TEMPLATES[0];
      const body = upsertBoardMeta(tpl.body, { priority: "normal" });
      const id = await createNote(user.uid, quickTitle.trim(), body, undefined, [], {
        status: quickOpen,
        folder: filters.folder && filters.folder !== "__none__" ? filters.folder : "看板",
      });
      setQuickOpen(null);
      setQuickTitle("");
      flash("已新增卡片");
      router.push(`/notes/${id}`);
    } catch (e) {
      flash(e instanceof Error ? e.message : "新增失敗");
    } finally {
      setBusy(false);
    }
  };

  const exportMd = () => {
    downloadText(`cadence-board-${Date.now()}.md`, exportBoardMarkdown(filtered));
    flash("已匯出目前篩選結果");
  };

  const runAiTriage = async () => {
    setAiBusy(true);
    setAiError("");
    try {
      const backlog = byCol.backlog.slice(0, 12);
      const summary = backlog
        .map((c) => `- ${c.title}（優先 ${c.meta.priority}${c.meta.due ? `，截止 ${c.meta.due}` : ""}）`)
        .join("\n");
      const res = await fetch("/api/ai/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "note",
          title: "看板待辦",
          body: summary || "（目前沒有待辦）",
          prompt:
            "用繁體中文，幫我把這些待辦排出今天／本週／可延後三組，並各給一句理由。若清單為空，給我建立看板的建議。",
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "AI 失敗");
      setAiText(data.text);
    } catch (e) {
      setAiError(e instanceof Error ? e.message : String(e));
    } finally {
      setAiBusy(false);
    }
  };

  if (loading) return <p style={{ color: "var(--text-muted)" }}>載入中…</p>;
  if (!user) {
    return (
      <div className="bd-page bd-guest">
        <ScrambleText words="看板" as="h1" className="page-title font-display" />
          <p className="page-sub">登入後使用看板。</p>
        <ShinyPill onClick={() => loginWithGoogle()}>登入</ShinyPill>
      </div>
    );
  }

  return (
    <div className="bd-page">
      <header className="bd-hero">
        <div>
          <ScrambleText words="看板" as="h1" className="page-title font-display" speed={22} />
          <p className="page-sub">
            {stats.total} 張
            {!stats.wipOk ? " · WIP 超限" : ""}
          </p>
        </div>
        <div className="bd-hero-actions">
          <button type="button" className="btn btn-ghost btn-sm" onClick={exportMd}>
            匯出
          </button>
          <button
            type="button"
            className={`btn btn-sm ${swimlanes ? "" : "btn-ghost"}`}
            onClick={() => setSwimlanes((v) => !v)}
          >
            {swimlanes ? "泳道中" : "資料夾泳道"}
          </button>
          <ShinyPill
            style={{ padding: "0.4rem 0.85rem", fontSize: "0.8rem" }}
            onClick={() => setQuickOpen("backlog")}
          >
            + 新卡片
          </ShinyPill>
        </div>
      </header>

      <div className="bd-toolbar">
        <input
          className="input"
          style={{ flex: 1, minWidth: 140 }}
          placeholder="搜尋標題、內容、標籤…"
          value={filters.q}
          onChange={(e) => setFilters((f) => ({ ...f, q: e.target.value }))}
        />
        <select
          className="input"
          style={{ width: "auto" }}
          value={filters.folder}
          onChange={(e) => setFilters((f) => ({ ...f, folder: e.target.value }))}
        >
          <option value="">全部資料夾</option>
          <option value="__none__">未分類</option>
          {folders.map((f) => (
            <option key={f} value={f}>{f}</option>
          ))}
        </select>
        <select
          className="input"
          style={{ width: "auto" }}
          value={filters.tag}
          onChange={(e) => setFilters((f) => ({ ...f, tag: e.target.value }))}
        >
          <option value="">全部標籤</option>
          {tags.map((t) => (
            <option key={t} value={t}>#{t}</option>
          ))}
        </select>
        <select
          className="input"
          style={{ width: "auto" }}
          value={filters.priority}
          onChange={(e) => setFilters((f) => ({ ...f, priority: e.target.value as "" | Priority }))}
        >
          <option value="">全部優先</option>
          {PRIORITIES.map((p) => (
            <option key={p.id} value={p.id}>{p.label}</option>
          ))}
        </select>
        <MenuSelect variant="soft" ariaLabel="排序" value={sort} options={SORT_OPTIONS} onChange={setSort} />
        <label className="bd-check">
          <input
            type="checkbox"
            checked={filters.hideDone}
            onChange={(e) => setFilters((f) => ({ ...f, hideDone: e.target.checked }))}
          />
          隱藏完成
        </label>
        <label className="bd-check">
          <input
            type="checkbox"
            checked={filters.onlyOverdue}
            onChange={(e) => setFilters((f) => ({ ...f, onlyOverdue: e.target.checked }))}
          />
          僅逾期
        </label>
        <label className="bd-check">
          <input
            type="checkbox"
            checked={filters.onlyStale}
            onChange={(e) => setFilters((f) => ({ ...f, onlyStale: e.target.checked }))}
          />
          僅閒置
        </label>
      </div>

      {selected.length > 0 && (
        <div className="bd-bulk">
          <span>已選 {selected.length}</span>
          {BOARD_COLUMNS.map((c) => (
            <button
              key={c.id}
              type="button"
              className="btn btn-soft btn-sm"
              disabled={busy}
              onClick={() => { void moveSelected(c.id); }}
            >
              移到{c.label}
            </button>
          ))}
          <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => { void setDueOnSelected(); }}>
            設截止日
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setSelected([])}>
            取消選取
          </button>
        </div>
      )}

      {quickOpen && (
        <div className="bd-quick">
          <strong>新增到「{BOARD_COLUMNS.find((c) => c.id === quickOpen)?.label}」</strong>
          <input
            className="input"
            placeholder="卡片標題"
            value={quickTitle}
            autoFocus
            onChange={(e) => setQuickTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void createQuick();
            }}
          />
          <div className="bd-quick-tpls">
            {BOARD_QUICK_TEMPLATES.map((t) => (
              <button
                key={t.id}
                type="button"
                className={`bd-chip${quickTpl === t.id ? " is-on" : ""}`}
                onClick={() => setQuickTpl(t.id)}
              >
                {t.title}
              </button>
            ))}
          </div>
          <div className="bd-quick-actions">
            <button type="button" className="btn btn-sm" disabled={busy || !quickTitle.trim()} onClick={() => { void createQuick(); }}>
              建立
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setQuickOpen(null)}>
              取消
            </button>
          </div>
        </div>
      )}

      <div className="bd-layout">
        <div className="bd-main">
          {swimlanes && lanes ? (
            lanes.map((lane) => (
              <div key={lane.lane} className="bd-lane">
                <h3 className="bd-lane-title">{lane.lane} <em>{lane.cards.length}</em></h3>
                <div className="bd-grid">
                  {BOARD_COLUMNS.map((col) => (
                    <BoardColumn
                      key={`${lane.lane}-${col.id}`}
                      status={col.id}
                      cards={lane.cards.filter((c) => c.statusKey === col.id)}
                      selectedIds={selected}
                      dragOver={dropCol === col.id}
                      onDragOver={() => setDropCol(col.id)}
                      onDragLeave={() => setDropCol(null)}
                      onDrop={() => {
                        if (dragId) void moveCard(dragId, col.id);
                        setDragId(null);
                        setDropCol(null);
                      }}
                      onDragStart={setDragId}
                      onSelect={onSelect}
                      onMove={(id, s) => { void moveCard(id, s); }}
                      onPriorityCycle={(id) => { void cyclePriority(id); }}
                      onQuickAdd={setQuickOpen}
                    />
                  ))}
                </div>
              </div>
            ))
          ) : (
            <div className="bd-grid">
              {BOARD_COLUMNS.map((col) => (
                <BoardColumn
                  key={col.id}
                  status={col.id}
                  cards={byCol[col.id]}
                  selectedIds={selected}
                  dragOver={dropCol === col.id}
                  onDragOver={() => setDropCol(col.id)}
                  onDragLeave={() => setDropCol(null)}
                  onDrop={() => {
                    if (dragId) void moveCard(dragId, col.id);
                    setDragId(null);
                    setDropCol(null);
                  }}
                  onDragStart={setDragId}
                  onSelect={onSelect}
                  onMove={(id, s) => { void moveCard(id, s); }}
                  onPriorityCycle={(id) => { void cyclePriority(id); }}
                  onQuickAdd={setQuickOpen}
                />
              ))}
            </div>
          )}
        </div>

        <BoardAside
          stats={stats}
          onAiTriage={() => { void runAiTriage(); }}
          aiBusy={aiBusy}
          aiText={aiText}
          aiError={aiError}
        />
      </div>

      {toast && <p className="bd-toast">{toast}</p>}
    </div>
  );
}
