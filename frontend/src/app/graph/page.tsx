"use client";

import PageLoading from "@/components/motion/PageLoading";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import { listenToUserNotes, loginWithGoogle, updateNote, type Note } from "@/lib/firebase";
import { listenGraphs, updateGraph, type GraphConfig } from "@/lib/graphStore";
import { createWorkspacePage, noteOpenHref } from "@/lib/workspacePages";
import {
  GRAPH_TEMPLATES,
  formatHubRelTime,
  graphPresetForTemplate,
} from "@/lib/workspaceHubTemplates";
import {
  HubPreview,
  HubShell,
  HubTemplateWall,
  HubToolbar,
} from "@/components/workspace/WorkspaceHub";
import PageChromeIcon from "@/components/PageChromeIcon";
import { LAYOUT_OPTIONS } from "@/lib/graphModel";
import { askPrompt } from "@/lib/dialogs";
import { toast } from "@/lib/toast";
import { touchRecentId } from "@/lib/userPrefs";
import { usePrefs } from "@/components/PrefsProvider";

type SortKey = "updated" | "name";
type LayoutMode = "grid" | "list";

export default function GraphIndexPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const prefsCtx = usePrefs();
  const [list, setList] = useState<GraphConfig[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<SortKey>("updated");
  const [layout, setLayout] = useState<LayoutMode>("grid");

  useEffect(() => {
    if (!user) return;
    return listenGraphs(user.uid, setList);
  }, [user]);

  useEffect(() => {
    if (!user) return;
    return listenToUserNotes(user.uid, setNotes);
  }, [user]);

  const noteByGraph = useMemo(() => {
    const m = new Map<string, Note>();
    for (const n of notes) {
      if (n.app_link?.type === "graph" && n.app_link.id) m.set(n.app_link.id, n);
    }
    return m;
  }, [notes]);

  const wikiLinked = useMemo(
    () => notes.filter((n) => /\[\[[^\]]+\]\]/.test(n.body_md || "")).length,
    [notes]
  );

  const filtered = useMemo(() => {
    const qq = q.trim().toLowerCase();
    let rows = list.map((g) => {
      const note = noteByGraph.get(g.id);
      const title = (note?.title || g.name || "未命名圖譜").trim();
      const updated = Math.max(
        g.updated_at?.getTime?.() || 0,
        note?.updated_at?.getTime?.() || 0
      );
      return { g, note, title, updated };
    });
    if (qq) {
      rows = rows.filter(
        (r) =>
          r.title.toLowerCase().includes(qq) ||
          r.g.layout.toLowerCase().includes(qq) ||
          (r.g.filters.folder || "").toLowerCase().includes(qq) ||
          (r.g.filters.tag || "").toLowerCase().includes(qq)
      );
    }
    rows.sort((a, b) =>
      sort === "name" ? a.title.localeCompare(b.title, "zh-Hant") : b.updated - a.updated
    );
    return rows;
  }, [list, noteByGraph, q, sort]);

  const recent = useMemo(() => filtered.slice(0, 3), [filtered]);

  const createFromTemplate = async (templateId: string) => {
    if (!user) return;
    setBusy(true);
    try {
      const def = GRAPH_TEMPLATES.find((t) => t.id === templateId) || GRAPH_TEMPLATES[2];
      const preset = graphPresetForTemplate(templateId);
      const { noteId, href } = await createWorkspacePage(user.uid, "graph", {
        name: def.defaultName,
        graphFilters: preset.filters,
        graphLayout: preset.layout,
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

  const rename = async (g: GraphConfig, note?: Note) => {
    if (!user) return;
    const current = note?.title || g.name;
    const next = await askPrompt({
      title: "重新命名圖譜",
      message: "輸入新名稱",
      defaultValue: current,
      confirmLabel: "儲存",
    });
    if (next == null) return;
    const name = next.trim() || "未命名圖譜";
    try {
      await updateGraph(user.uid, g.id, { name });
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
        <h1 className="page-title font-display">圖譜</h1>
        <p className="page-sub">登入後建立知識圖譜。</p>
        <button type="button" className="btn" onClick={() => void loginWithGoogle()}>
          登入
        </button>
      </div>
    );
  }

  return (
    <HubShell
      title="圖譜"
      subtitle="把筆記連成知識網路 — 力導向佈局、篩選與路徑，也可插入筆記。"
      stats={[
        { value: list.length, label: "個圖譜" },
        { value: notes.length, label: "筆記節點" },
        { value: wikiLinked, label: "含 Wiki 連結" },
      ]}
      primaryLabel="新建圖譜"
      primaryBusy={busy}
      onPrimary={() => void createFromTemplate("overview")}
      secondaryHref="/notes"
      secondaryLabel="全部筆記"
      toolbar={
        list.length > 0 ? (
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
            searchPlaceholder="搜尋圖譜、佈局、篩選…"
          />
        ) : null
      }
    >
      {list.length === 0 ? (
        <HubTemplateWall
          title="從模板開始"
          hint="也可在側欄按 + 選「新圖譜」。在筆記用 [[標題]] 建立連線後，圖譜會自動長出邊。"
          templates={GRAPH_TEMPLATES}
          busy={busy}
          onPick={(id) => void createFromTemplate(id)}
        />
      ) : (
        <>
          {!q && recent.length > 0 && sort === "updated" && (
            <section className="db-hub-section">
              <h2>最近使用</h2>
              <div className="db-hub-recent">
                {recent.map(({ g, note, title, updated }) => {
                  const href = note ? noteOpenHref(note) : `/graph/${g.id}`;
                  return (
                    <Link key={`r-${g.id}`} href={href} className="db-hub-recent-card">
                      <PageChromeIcon icon={note?.icon || "hub"} fallback="hub" />
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
                + 空白圖譜
              </button>
            </div>
            {filtered.length === 0 ? (
              <p className="cdb-empty">沒有符合「{q}」的圖譜。</p>
            ) : (
              <div className={layout === "grid" ? "db-hub-grid" : "db-hub-list"}>
                {filtered.map(({ g, note, title, updated }) => {
                  const href = note ? noteOpenHref(note) : `/graph/${g.id}`;
                  const layoutLabel =
                    LAYOUT_OPTIONS.find((o) => o.id === g.layout)?.label || g.layout;
                  const pinned = Object.keys(g.positions || {}).length;
                  return (
                    <article key={g.id} className="db-hub-card">
                      <Link href={href} className="db-hub-card-main">
                        <HubPreview kind="graph" />
                        <div className="db-hub-card-top">
                          <PageChromeIcon icon={note?.icon || "hub"} fallback="hub" />
                          <div>
                            <strong>{title}</strong>
                            <span>
                              {layoutLabel}
                              {pinned ? ` · ${pinned} 固定節點` : ""} ·{" "}
                              {formatHubRelTime(new Date(updated))}
                            </span>
                          </div>
                        </div>
                        <div className="db-hub-chips">
                          <em>Wiki</em>
                          {g.filters.showTagEdges ? <em>標籤邊</em> : null}
                          {g.filters.showFolderEdges ? <em>資料夾邊</em> : null}
                          {g.filters.showGhosts ? <em>幽靈</em> : null}
                        </div>
                        <div className="db-hub-props">
                          {g.filters.folder ? <span>{g.filters.folder}</span> : null}
                          {g.filters.tag ? <span>#{g.filters.tag}</span> : null}
                          {!g.filters.folder && !g.filters.tag ? <span>全部筆記</span> : null}
                        </div>
                      </Link>
                      <div className="db-hub-card-actions">
                        <Link className="btn btn-ghost" href={href}>
                          開啟
                        </Link>
                        <button
                          type="button"
                          className="btn btn-ghost"
                          onClick={() => void rename(g, note)}
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
