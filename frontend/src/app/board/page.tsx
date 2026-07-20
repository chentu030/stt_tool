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
  HubPreview,
  HubShell,
  HubTemplateWall,
  HubToolbar,
} from "@/components/workspace/WorkspaceHub";
import PageChromeIcon from "@/components/PageChromeIcon";
import { askPrompt } from "@/lib/dialogs";
import { toast } from "@/lib/toast";
import { touchRecentId } from "@/lib/userPrefs";
import { usePrefs } from "@/components/PrefsProvider";
import { BOARD_COLUMNS } from "@/lib/boardMeta";

type SortKey = "updated" | "name";
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

  const noteStats = useMemo(() => {
    let backlog = 0;
    let doing = 0;
    let done = 0;
    for (const n of notes) {
      if (n.app_link) continue;
      if (n.database_id) continue;
      const s = n.status || "backlog";
      if (s === "doing") doing += 1;
      else if (s === "done") done += 1;
      else backlog += 1;
    }
    return { backlog, doing, done, total: backlog + doing + done };
  }, [notes]);

  const filtered = useMemo(() => {
    const qq = q.trim().toLowerCase();
    let rows = boards.map((b) => {
      const note = noteByBoard.get(b.id);
      const title = (note?.title || b.name || "未命名看板").trim();
      const updated = Math.max(
        b.updated_at?.getTime?.() || 0,
        note?.updated_at?.getTime?.() || 0
      );
      return { b, note, title, updated };
    });
    if (qq) {
      rows = rows.filter(
        (r) =>
          r.title.toLowerCase().includes(qq) ||
          r.b.folders.some((f) => f.toLowerCase().includes(qq)) ||
          r.b.tags.some((t) => t.toLowerCase().includes(qq))
      );
    }
    rows.sort((a, b) =>
      sort === "name" ? a.title.localeCompare(b.title, "zh-Hant") : b.updated - a.updated
    );
    return rows;
  }, [boards, noteByBoard, q, sort]);

  const recent = useMemo(() => filtered.slice(0, 3), [filtered]);

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
      subtitle="把筆記排成泳道 — 也可插入筆記頁，與知識庫並排使用。"
      stats={[
        { value: boards.length, label: "個看板" },
        { value: noteStats.doing, label: "進行中" },
        { value: noteStats.total, label: "可排程筆記" },
      ]}
      primaryLabel="新建看板"
      primaryBusy={busy}
      onPrimary={() => void createFromTemplate("tasks")}
      secondaryHref="/notes"
      secondaryLabel="全部筆記"
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
        <>
          {!q && recent.length > 0 && sort === "updated" && (
            <section className="db-hub-section">
              <h2>最近使用</h2>
              <div className="db-hub-recent">
                {recent.map(({ b, note, title, updated }) => {
                  const href = note ? noteOpenHref(note) : `/board/${b.id}`;
                  return (
                    <Link key={`r-${b.id}`} href={href} className="db-hub-recent-card">
                      <PageChromeIcon icon={note?.icon || "view_kanban"} fallback="view_kanban" />
                      <div>
                        <strong>{title}</strong>
                        <span>{formatHubRelTime(new Date(updated))}</span>
                      </div>
                    </Link>
                  );
                })}
              </div>
            </section>
          )}

          <section className="db-hub-section">
            <div className="db-hub-section-head">
              <h2>全部（{filtered.length}）</h2>
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
              <div className={layout === "grid" ? "db-hub-grid" : "db-hub-list"}>
                {filtered.map(({ b, note, title, updated }) => {
                  const href = note ? noteOpenHref(note) : `/board/${b.id}`;
                  const statuses =
                    b.statuses.length > 0
                      ? b.statuses
                      : (["backlog", "doing", "done"] as const);
                  return (
                    <article key={b.id} className="db-hub-card">
                      <Link href={href} className="db-hub-card-main">
                        <HubPreview kind="board" />
                        <div className="db-hub-card-top">
                          <PageChromeIcon
                            icon={note?.icon || "view_kanban"}
                            fallback="view_kanban"
                          />
                          <div>
                            <strong>{title}</strong>
                            <span>{formatHubRelTime(new Date(updated))}</span>
                          </div>
                        </div>
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
        </>
      )}
    </HubShell>
  );
}
