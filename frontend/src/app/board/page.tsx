"use client";

import PageLoading from "@/components/motion/PageLoading";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import { listenToUserNotes, loginWithGoogle, updateNote, type Note } from "@/lib/firebase";
import { listenBoards, updateBoard, type BoardConfig } from "@/lib/boardStore";
import { createWorkspacePage, noteOpenHref } from "@/lib/workspacePages";
import {
  BOARD_TEMPLATES,
  boardStatusesForTemplate,
  formatHubRelTime,
} from "@/lib/workspaceHubTemplates";
import {
  HubMetricRow,
  HubPreview,
  HubShell,
  HubTemplateWall,
  HubToolbar,
} from "@/components/workspace/WorkspaceHub";
import PageChromeIcon from "@/components/PageChromeIcon";
import {
  BOARD_COLUMNS,
  computeBoardStats,
  noteMatchesBoard,
  toBoardCards,
} from "@/lib/boardMeta";
import { askPrompt } from "@/lib/dialogs";
import { toast } from "@/lib/toast";
import { touchRecentId } from "@/lib/userPrefs";
import { usePrefs } from "@/components/PrefsProvider";

type SortKey = "updated" | "name" | "cards";
type LayoutMode = "grid" | "list";

export default function BoardIndexPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const prefsCtx = usePrefs();
  const [boards, setBoards] = useState<BoardConfig[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<SortKey>("updated");
  const [layout, setLayout] = useState<LayoutMode>("grid");

  useEffect(() => {
    if (!user) return;
    return listenBoards(user.uid, setBoards);
  }, [user]);

  useEffect(() => {
    if (!user) return;
    return listenToUserNotes(user.uid, setNotes);
  }, [user]);

  const noteByBoard = useMemo(() => {
    const m = new Map<string, Note>();
    for (const n of notes) {
      if (n.app_link?.type === "board" && n.app_link.id) m.set(n.app_link.id, n);
    }
    return m;
  }, [notes]);

  const rows = useMemo(() => {
    return boards.map((b) => {
      const note = noteByBoard.get(b.id);
      const title = (note?.title || b.name || "未命名看板").trim();
      const updated = Math.max(
        b.updated_at?.getTime?.() || 0,
        note?.updated_at?.getTime?.() || 0
      );
      const scoped = notes.filter((n) => noteMatchesBoard(n, b));
      const stats = computeBoardStats(toBoardCards(scoped));
      return { b, note, title, updated, stats };
    });
  }, [boards, noteByBoard, notes]);

  const totals = useMemo(() => {
    let backlog = 0;
    let doing = 0;
    let done = 0;
    let overdue = 0;
    for (const r of rows) {
      backlog += r.stats.backlog;
      doing += r.stats.doing;
      done += r.stats.done;
      overdue += r.stats.overdue;
    }
    return { backlog, doing, done, overdue, cards: backlog + doing + done };
  }, [rows]);

  const filtered = useMemo(() => {
    const qq = q.trim().toLowerCase();
    let list = rows;
    if (qq) {
      list = list.filter(
        (r) =>
          r.title.toLowerCase().includes(qq) ||
          r.b.folders.some((f) => f.toLowerCase().includes(qq)) ||
          r.b.tags.some((t) => t.toLowerCase().includes(qq))
      );
    }
    list = [...list].sort((a, b) => {
      if (sort === "name") return a.title.localeCompare(b.title, "zh-Hant");
      if (sort === "cards") return b.stats.total - a.stats.total;
      return b.updated - a.updated;
    });
    return list;
  }, [rows, q, sort]);

  const recent = useMemo(() => filtered.slice(0, 3), [filtered]);
  const featured = recent[0];

  const createFromTemplate = async (templateId: string) => {
    if (!user) return;
    setBusy(true);
    try {
      const def = BOARD_TEMPLATES.find((t) => t.id === templateId) || BOARD_TEMPLATES[2];
      const { noteId, href } = await createWorkspacePage(user.uid, "board", {
        name: def.defaultName,
        boardStatuses: boardStatusesForTemplate(templateId),
      });
      prefsCtx.setPrefs((p) => touchRecentId(p, noteId));
      toast(`已建立「${def.defaultName}」`);
      router.push(href);
    } catch (e) {
      toast(e instanceof Error ? e.message : "建立失敗");
    } finally {
      setBusy(false);
    }
  };

  const rename = async (b: BoardConfig, note?: Note) => {
    if (!user) return;
    const current = note?.title || b.name;
    const next = await askPrompt({
      title: "重新命名看板",
      message: "輸入新名稱",
      defaultValue: current,
      confirmLabel: "儲存",
    });
    if (next == null) return;
    const name = next.trim() || "未命名看板";
    try {
      await updateBoard(user.uid, b.id, { name });
      if (note) await updateNote(note.id, { title: name });
      toast("已重新命名");
    } catch (e) {
      toast(e instanceof Error ? e.message : "重新命名失敗");
    }
  };

  if (loading) return <PageLoading />;
  if (!user) {
    return (
      <div className="db-hub">
        <h1 className="page-title font-display">看板</h1>
        <p className="page-sub">登入後建立 Kanban 看板。</p>
        <button type="button" className="btn" onClick={() => void loginWithGoogle()}>
          登入
        </button>
      </div>
    );
  }

  return (
    <HubShell
      title="看板"
      subtitle="把筆記排成泳道 — 卡片上直接看到各欄數量與逾期，不必點進去才知道進度。"
      stats={[
        { value: boards.length, label: "個看板" },
        { value: totals.doing, label: "進行中" },
        { value: totals.overdue, label: "逾期" },
        { value: totals.cards, label: "卡片" },
      ]}
      primaryLabel="新建看板"
      primaryBusy={busy}
      onPrimary={() => void createFromTemplate("tasks")}
      secondaryHref="/notes"
      secondaryLabel="全部筆記"
      featured={
        featured ? (
          <Link
            href={featured.note ? noteOpenHref(featured.note) : `/board/${featured.b.id}`}
            className="ws-hub-featured-card"
          >
            <HubPreview
              kind="board"
              large
              board={{
                backlog: featured.stats.backlog,
                doing: featured.stats.doing,
                done: featured.stats.done,
                overdue: featured.stats.overdue,
              }}
            />
            <div className="ws-hub-featured-meta">
              <span className="ws-hub-featured-kicker">最近使用</span>
              <strong>{featured.title}</strong>
              <HubMetricRow
                items={[
                  { label: "待辦", value: featured.stats.backlog },
                  { label: "進行", value: featured.stats.doing },
                  { label: "完成", value: featured.stats.done },
                  ...(featured.stats.overdue
                    ? [{ label: "逾期", value: featured.stats.overdue, warn: true }]
                    : []),
                ]}
              />
            </div>
          </Link>
        ) : (
          <div className="ws-hub-featured-card is-empty">
            <HubPreview kind="board" large board={{ backlog: 3, doing: 2, done: 1 }} />
            <div className="ws-hub-featured-meta">
              <span className="ws-hub-featured-kicker">預覽</span>
              <strong>你的第一個看板會長這樣</strong>
              <p>建立後，筆記會依狀態落入待辦／進行中／完成。</p>
            </div>
          </div>
        )
      }
      toolbar={
        boards.length > 0 ? (
          <HubToolbar
            q={q}
            onQ={setQ}
            sort={sort}
            onSort={(v) => setSort(v as SortKey)}
            sortOptions={[
              { value: "updated", label: "最近更新" },
              { value: "name", label: "名稱" },
              { value: "cards", label: "卡片數" },
            ]}
            layout={layout}
            onLayout={setLayout}
            searchPlaceholder="搜尋看板、資料夾、標籤…"
          />
        ) : null
      }
    >
      {boards.length === 0 ? (
        <HubTemplateWall
          title="從模板開始"
          hint="也可在側欄按 + 選「新看板」，或在筆記輸入 /board。"
          templates={BOARD_TEMPLATES}
          busy={busy}
          onPick={(id) => void createFromTemplate(id)}
        />
      ) : (
        <section className="db-hub-section">
          <div className="db-hub-section-head">
            <h2>全部看板（{filtered.length}）</h2>
            <button
              type="button"
              className="btn btn-ghost"
              disabled={busy}
              onClick={() => void createFromTemplate("blank")}
            >
              + 空白看板
            </button>
          </div>
          {filtered.length === 0 ? (
            <p className="cdb-empty">沒有符合「{q}」的看板。</p>
          ) : (
            <div className={layout === "grid" ? "db-hub-grid ws-hub-grid" : "db-hub-list"}>
              {filtered.map(({ b, note, title, updated, stats }) => {
                const href = note ? noteOpenHref(note) : `/board/${b.id}`;
                const statuses =
                  b.statuses.length > 0 ? b.statuses : (["backlog", "doing", "done"] as const);
                return (
                  <article key={b.id} className="db-hub-card ws-hub-card">
                    <Link href={href} className="db-hub-card-main">
                      <HubPreview
                        kind="board"
                        board={{
                          backlog: stats.backlog,
                          doing: stats.doing,
                          done: stats.done,
                          overdue: stats.overdue,
                        }}
                      />
                      <div className="db-hub-card-top">
                        <PageChromeIcon
                          icon={note?.icon || "view_kanban"}
                          fallback="view_kanban"
                        />
                        <div>
                          <strong>{title}</strong>
                          <span>
                            {stats.total} 張卡 · 完成率 {stats.doneRate}% ·{" "}
                            {formatHubRelTime(new Date(updated))}
                          </span>
                        </div>
                      </div>
                      <HubMetricRow
                        items={[
                          { label: "待辦", value: stats.backlog },
                          { label: "進行", value: stats.doing },
                          { label: "完成", value: stats.done },
                          ...(stats.overdue
                            ? [{ label: "逾期", value: stats.overdue, warn: true }]
                            : []),
                        ]}
                      />
                      <div className="db-hub-chips">
                        {statuses.map((s) => (
                          <em key={s}>
                            {BOARD_COLUMNS.find((c) => c.id === s)?.label || s}
                          </em>
                        ))}
                      </div>
                      <div className="db-hub-props">
                        {b.folders.length === 0 && b.tags.length === 0 ? (
                          <span>全部筆記</span>
                        ) : (
                          <>
                            {b.folders.slice(0, 3).map((f) => (
                              <span key={f}>{f}</span>
                            ))}
                            {b.tags.slice(0, 3).map((t) => (
                              <span key={t}>#{t}</span>
                            ))}
                          </>
                        )}
                      </div>
                    </Link>
                    <div className="db-hub-card-actions">
                      <Link className="btn btn-ghost" href={href}>
                        開啟
                      </Link>
                      <button
                        type="button"
                        className="btn btn-ghost"
                        onClick={() => void rename(b, note)}
                      >
                        重新命名
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      )}
    </HubShell>
  );
}
