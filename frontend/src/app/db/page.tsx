"use client";

import PageLoading from "@/components/motion/PageLoading";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import { listenToUserNotes, loginWithGoogle, updateNote, type Note } from "@/lib/firebase";
import {
  DB_TEMPLATES,
  listenUserDatabases,
  updateDatabase,
  type CadenceDatabase,
  type DbTemplateId,
  type DbViewType,
} from "@/lib/database";
import { createWorkspacePage, noteOpenHref } from "@/lib/workspacePages";
import PageChromeIcon from "@/components/PageChromeIcon";
import ScrambleText from "@/components/motion/ScrambleText";
import { HubPreview } from "@/components/workspace/WorkspaceHub";
import { askPrompt } from "@/lib/dialogs";
import { toast } from "@/lib/toast";
import { touchRecentId } from "@/lib/userPrefs";
import { usePrefs } from "@/components/PrefsProvider";

type SortKey = "updated" | "name" | "rows";
type LayoutMode = "grid" | "list";

const VIEW_LABEL: Record<DbViewType, string> = {
  table: "表格",
  list: "列表",
  board: "看板",
  calendar: "日曆",
  gallery: "畫廊",
  form: "表單",
};

function formatRelTime(d: Date): string {
  const diff = Date.now() - d.getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "剛剛";
  if (m < 60) return `${m} 分鐘前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} 小時前`;
  const day = Math.floor(h / 24);
  if (day < 14) return `${day} 天前`;
  return d.toLocaleDateString("zh-TW", { month: "short", day: "numeric" });
}

export default function DatabasesIndexPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const prefsCtx = usePrefs();
  const [list, setList] = useState<CadenceDatabase[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<SortKey>("updated");
  const [layout, setLayout] = useState<LayoutMode>("grid");
  const [pickerOpen, setPickerOpen] = useState(false);

  useEffect(() => {
    if (!user) return;
    return listenUserDatabases(user.uid, setList);
  }, [user]);

  useEffect(() => {
    if (!user) return;
    return listenToUserNotes(user.uid, setNotes);
  }, [user]);

  const noteByDb = useMemo(() => {
    const m = new Map<string, Note>();
    for (const n of notes) {
      if (n.app_link?.type === "database" && n.app_link.id) m.set(n.app_link.id, n);
    }
    return m;
  }, [notes]);

  const rowCountByDb = useMemo(() => {
    const m = new Map<string, number>();
    for (const n of notes) {
      const id = (n.database_id || "").trim();
      if (!id) continue;
      m.set(id, (m.get(id) || 0) + 1);
    }
    return m;
  }, [notes]);

  const totalRows = useMemo(
    () => [...rowCountByDb.values()].reduce((a, b) => a + b, 0),
    [rowCountByDb]
  );

  const filtered = useMemo(() => {
    const qq = q.trim().toLowerCase();
    let rows = list.map((d) => {
      const note = noteByDb.get(d.id);
      const title = (note?.title || d.name || "未命名資料庫").trim();
      const rowsN = rowCountByDb.get(d.id) || 0;
      const updated = Math.max(
        d.updated_at?.getTime?.() || 0,
        note?.updated_at?.getTime?.() || 0
      );
      return { d, note, title, rowsN, updated };
    });
    if (qq) {
      rows = rows.filter(
        (r) =>
          r.title.toLowerCase().includes(qq) ||
          r.d.properties.some((p) => p.name.toLowerCase().includes(qq)) ||
          r.d.views.some((v) => v.name.toLowerCase().includes(qq) || v.type.includes(qq))
      );
    }
    rows.sort((a, b) => {
      if (sort === "name") return a.title.localeCompare(b.title, "zh-Hant");
      if (sort === "rows") return b.rowsN - a.rowsN;
      return b.updated - a.updated;
    });
    return rows;
  }, [list, noteByDb, rowCountByDb, q, sort]);

  const recent = useMemo(() => filtered.slice(0, 3), [filtered]);

  const createFromTemplate = async (template: DbTemplateId) => {
    if (!user) return;
    setBusy(true);
    setPickerOpen(false);
    try {
      const def = DB_TEMPLATES.find((t) => t.id === template);
      const { noteId, href } = await createWorkspacePage(user.uid, "database", {
        databaseTemplate: template,
        databaseName: def?.defaultName,
      });
      prefsCtx.setPrefs((p) => touchRecentId(p, noteId));
      toast(`已建立「${def?.defaultName || "資料庫"}」`);
      router.push(href);
    } catch (e) {
      toast(e instanceof Error ? e.message : "建立失敗");
    } finally {
      setBusy(false);
    }
  };

  const renameDb = async (d: CadenceDatabase, note?: Note) => {
    if (!user) return;
    const current = note?.title || d.name;
    const next = await askPrompt({
      title: "重新命名資料庫",
      message: "輸入新名稱",
      placeholder: current,
      defaultValue: current,
      confirmLabel: "儲存",
    });
    if (next == null) return;
    const name = next.trim() || "未命名資料庫";
    try {
      await updateDatabase(d.id, { name });
      if (note) await updateNote(note.id, { title: name });
      toast("已重新命名");
    } catch (e) {
      toast(e instanceof Error ? e.message : "重新命名失敗");
    }
  };

  const copyLink = async (href: string) => {
    const url =
      typeof window !== "undefined" ? `${window.location.origin}${href}` : href;
    try {
      await navigator.clipboard.writeText(url);
      toast("已複製連結");
    } catch {
      toast(url);
    }
  };

  if (loading) return <PageLoading />;
  if (!user) {
    return (
      <div className="db-hub">
        <ScrambleText words="資料庫" as="h1" className="page-title font-display" />
        <p className="page-sub">登入後建立屬性表格與多視圖資料庫。</p>
        <button type="button" className="btn" onClick={() => void loginWithGoogle()}>
          登入
        </button>
      </div>
    );
  }

  return (
    <div className="db-hub ws-hub">
      <header className="db-hub-hero page-chrome">
        <div>
          <ScrambleText words="資料庫" as="h1" className="page-title font-display" />
          <p className="page-sub">
            表格、看板、畫廊等多視圖 — 每列也是筆記，可插入知識庫頁面。
          </p>
          <div className="db-hub-stats" aria-label="統計">
            <span>
              <strong>{list.length}</strong> 個資料庫
            </span>
            <span>
              <strong>{totalRows}</strong> 列
            </span>
            <span>
              <strong>{list.reduce((n, d) => n + d.views.length, 0)}</strong> 個視圖
            </span>
          </div>
        </div>
        <div className="db-hub-hero-actions">
          <button
            type="button"
            className="btn"
            disabled={busy}
            onClick={() => setPickerOpen(true)}
          >
            {busy ? "…" : "新建資料庫"}
          </button>
          <Link className="btn btn-ghost" href="/community">
            社群商店
          </Link>
        </div>
      </header>

      {list.length > 0 && (
        <div className="db-hub-toolbar">
          <input
            className="db-hub-search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="搜尋名稱、屬性、視圖…"
            aria-label="搜尋資料庫"
          />
          <select
            className="db-hub-select"
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
            aria-label="排序"
          >
            <option value="updated">最近更新</option>
            <option value="name">名稱</option>
            <option value="rows">列數</option>
          </select>
          <div className="db-hub-layout" role="group" aria-label="版面">
            <button
              type="button"
              className={layout === "grid" ? "is-on" : ""}
              onClick={() => setLayout("grid")}
            >
              網格
            </button>
            <button
              type="button"
              className={layout === "list" ? "is-on" : ""}
              onClick={() => setLayout("list")}
            >
              列表
            </button>
          </div>
        </div>
      )}

      {list.length === 0 ? (
        <section className="db-hub-empty">
          <h2>從模板開始</h2>
          <p>選一個結構，之後仍可自由加屬性與視圖。</p>
          <div className="db-hub-templates">
            {DB_TEMPLATES.map((t) => (
              <button
                key={t.id}
                type="button"
                className="db-hub-template-card"
                disabled={busy}
                onClick={() => void createFromTemplate(t.id)}
              >
                <PageChromeIcon icon={t.icon} fallback="table_chart" />
                <strong>{t.name}</strong>
                <span>{t.description}</span>
                <div className="db-hub-chips">
                  {t.viewLabels.map((v) => (
                    <em key={v}>{v}</em>
                  ))}
                </div>
              </button>
            ))}
          </div>
          <p className="db-hub-hint">也可在筆記輸入 <code>/database</code> 插入。</p>
        </section>
      ) : (
        <>
          {!q && recent.length > 0 && sort === "updated" && (
            <section className="db-hub-section">
              <h2>最近使用</h2>
              <div className="db-hub-recent">
                {recent.map(({ d, note, title, rowsN, updated }) => {
                  const href = note ? noteOpenHref(note) : `/db/${d.id}`;
                  return (
                    <Link key={`r-${d.id}`} href={href} className="db-hub-recent-card">
                      <PageChromeIcon
                        icon={note?.icon || d.icon || "table_chart"}
                        fallback="table_chart"
                      />
                      <div>
                        <strong>{title}</strong>
                        <span>
                          {rowsN} 列 · {formatRelTime(new Date(updated))}
                        </span>
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
                onClick={() => setPickerOpen(true)}
              >
                + 從模板新建
              </button>
            </div>
            {filtered.length === 0 ? (
              <p className="cdb-empty">沒有符合「{q}」的資料庫。</p>
            ) : (
              <div className={layout === "grid" ? "db-hub-grid" : "db-hub-list"}>
                {filtered.map(({ d, note, title, rowsN, updated }) => {
                  const href = note ? noteOpenHref(note) : `/db/${d.id}`;
                  const views = [...new Set(d.views.map((v) => v.type))];
                  return (
                    <article key={d.id} className="db-hub-card">
                      <Link href={href} className="db-hub-card-main">
                        <HubPreview kind="database" />
                        <div className="db-hub-card-top">
                          <PageChromeIcon
                            icon={note?.icon || d.icon || "table_chart"}
                            fallback="table_chart"
                          />
                          <div>
                            <strong>{title}</strong>
                            <span>
                              {rowsN} 列 · {d.properties.length} 屬性 ·{" "}
                              {formatRelTime(new Date(updated))}
                            </span>
                          </div>
                        </div>
                        <div className="db-hub-chips">
                          {views.map((v) => (
                            <em key={v}>{VIEW_LABEL[v] || v}</em>
                          ))}
                        </div>
                        <div className="db-hub-props">
                          {d.properties
                            .filter((p) => p.type !== "title")
                            .slice(0, 5)
                            .map((p) => (
                              <span key={p.id}>{p.name}</span>
                            ))}
                          {d.properties.length > 6 ? (
                            <span>+{d.properties.length - 6}</span>
                          ) : null}
                        </div>
                      </Link>
                      <div className="db-hub-card-actions">
                        <Link className="btn btn-ghost" href={href}>
                          開啟
                        </Link>
                        <button
                          type="button"
                          className="btn btn-ghost"
                          onClick={() => void renameDb(d, note)}
                        >
                          重新命名
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost"
                          onClick={() => void copyLink(href)}
                        >
                          複製連結
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </section>

          <section className="db-hub-section db-hub-templates-section">
            <h2>快速新建</h2>
            <div className="db-hub-templates is-compact">
              {DB_TEMPLATES.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  className="db-hub-template-card"
                  disabled={busy}
                  onClick={() => void createFromTemplate(t.id)}
                >
                  <PageChromeIcon icon={t.icon} fallback="table_chart" />
                  <strong>{t.name}</strong>
                  <span>{t.description}</span>
                </button>
              ))}
            </div>
          </section>
        </>
      )}

      {pickerOpen && (
        <div className="db-hub-backdrop" onClick={() => setPickerOpen(false)}>
          <div className="db-hub-picker" onClick={(e) => e.stopPropagation()} role="dialog">
            <header>
              <h2>選擇模板</h2>
              <button type="button" className="db-hub-picker-close" onClick={() => setPickerOpen(false)}>
                ×
              </button>
            </header>
            <div className="db-hub-templates">
              {DB_TEMPLATES.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  className="db-hub-template-card"
                  disabled={busy}
                  onClick={() => void createFromTemplate(t.id)}
                >
                  <PageChromeIcon icon={t.icon} fallback="table_chart" />
                  <strong>{t.name}</strong>
                  <span>{t.description}</span>
                  <div className="db-hub-chips">
                    {t.previewProps.slice(0, 4).map((p) => (
                      <em key={p}>{p}</em>
                    ))}
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
