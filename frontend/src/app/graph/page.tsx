"use client";

import PageLoading from "@/components/motion/PageLoading";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import { loginWithGoogle, updateNote, type Note } from "@/lib/firebase";
import { useNotesList } from "@/components/notes/NotesListProvider";
import { listenGraphs, updateGraph, type GraphConfig } from "@/lib/graphStore";
import { createWorkspacePage, noteOpenHref } from "@/lib/workspacePages";
import {
  GRAPH_TEMPLATES,
  formatHubRelTime,
  graphPresetForTemplate,
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
  LAYOUT_OPTIONS,
  buildGraph,
  computeStats,
  filterGraph,
  type GraphStats,
} from "@/lib/graphModel";
import { askPrompt } from "@/lib/dialogs";
import { toast } from "@/lib/toast";
import { touchRecentId } from "@/lib/userPrefs";
import { usePrefs } from "@/components/PrefsProvider";

type SortKey = "updated" | "name" | "edges";
type LayoutMode = "grid" | "list";

export default function GraphIndexPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const prefsCtx = usePrefs();
  const [list, setList] = useState<GraphConfig[]>([]);
  const { notes } = useNotesList();
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<SortKey>("updated");
  const [layout, setLayout] = useState<LayoutMode>("grid");

  useEffect(() => {
    if (!user) return;
    return listenGraphs(user.uid, setList);
  }, [user]);

  const noteByGraph = useMemo(() => {
    const m = new Map<string, Note>();
    for (const n of notes) {
      if (n.app_link?.type === "graph" && n.app_link.id) m.set(n.app_link.id, n);
    }
    return m;
  }, [notes]);

  const baseBundle = useMemo(
    () =>
      buildGraph(notes, {
        includeTagNodes: true,
        includeFolderNodes: true,
      }),
    [notes]
  );

  const statsById = useMemo(() => {
    const m = new Map<string, GraphStats>();
    for (const g of list) {
      const filtered = filterGraph(baseBundle, g.filters);
      m.set(g.id, computeStats(filtered, notes.length));
    }
    return m;
  }, [list, baseBundle, notes.length]);

  const rows = useMemo(() => {
    return list.map((g) => {
      const note = noteByGraph.get(g.id);
      const title = (note?.title || g.name || "未命名圖譜").trim();
      const updated = Math.max(
        g.updated_at?.getTime?.() || 0,
        note?.updated_at?.getTime?.() || 0
      );
      const stats = statsById.get(g.id) || computeStats(baseBundle, notes.length);
      return { g, note, title, updated, stats };
    });
  }, [list, noteByGraph, statsById, baseBundle, notes.length]);

  const totals = useMemo(() => {
    const first = rows[0]?.stats;
    return {
      notes: notes.length,
      wiki: first?.wikiEdges ?? 0,
      hubs: first?.hubs ?? 0,
    };
  }, [rows, notes.length]);

  const filtered = useMemo(() => {
    const qq = q.trim().toLowerCase();
    let out = rows;
    if (qq) {
      out = out.filter(
        (r) =>
          r.title.toLowerCase().includes(qq) ||
          r.g.layout.toLowerCase().includes(qq) ||
          (r.g.filters.folder || "").toLowerCase().includes(qq) ||
          (r.g.filters.tag || "").toLowerCase().includes(qq)
      );
    }
    out = [...out].sort((a, b) => {
      if (sort === "name") return a.title.localeCompare(b.title, "zh-Hant");
      if (sort === "edges") return b.stats.edges - a.stats.edges;
      return b.updated - a.updated;
    });
    return out;
  }, [rows, q, sort]);

  const featured = filtered[0];

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
      subtitle="知識網路總覽 — 每張卡片顯示該圖譜篩選後的節點、Wiki 邊與樞紐，不再是空殼標題。"
      stats={[
        { value: list.length, label: "個圖譜" },
        { value: totals.notes, label: "筆記" },
        { value: totals.wiki, label: "Wiki 邊" },
        { value: totals.hubs, label: "樞紐" },
      ]}
      primaryLabel="新建圖譜"
      primaryBusy={busy}
      onPrimary={() => void createFromTemplate("overview")}
      secondaryHref="/notes"
      secondaryLabel="全部筆記"
      featured={
        featured ? (
          <Link
            href={featured.note ? noteOpenHref(featured.note) : `/graph/${featured.g.id}`}
            className="ws-hub-featured-card"
          >
            <HubPreview
              kind="graph"
              large
              graph={{
                nodes: featured.stats.nodes,
                edges: featured.stats.edges,
                hubs: featured.stats.hubs,
                orphans: featured.stats.orphans,
              }}
            />
            <div className="ws-hub-featured-meta">
              <span className="ws-hub-featured-kicker">最近使用</span>
              <strong>{featured.title}</strong>
              <HubMetricRow
                items={[
                  { label: "節點", value: featured.stats.nodes },
                  { label: "Wiki", value: featured.stats.wikiEdges },
                  { label: "樞紐", value: featured.stats.hubs },
                  { label: "孤兒", value: featured.stats.orphans },
                ]}
              />
            </div>
          </Link>
        ) : (
          <div className="ws-hub-featured-card is-empty">
            <HubPreview kind="graph" large graph={{ nodes: 8, edges: 10, hubs: 2 }} />
            <div className="ws-hub-featured-meta">
              <span className="ws-hub-featured-kicker">預覽</span>
              <strong>筆記用 [[標題]] 連起來後會出現在這裡</strong>
              <p>力導向佈局會把相關主題聚成叢集。</p>
            </div>
          </div>
        )
      }
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
              { value: "edges", label: "連線數" },
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
        <section className="db-hub-section">
          <div className="db-hub-section-head">
            <h2>全部圖譜（{filtered.length}）</h2>
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
            <div className={layout === "grid" ? "db-hub-grid ws-hub-grid" : "db-hub-list"}>
              {filtered.map(({ g, note, title, updated, stats }) => {
                const href = note ? noteOpenHref(note) : `/graph/${g.id}`;
                const layoutLabel =
                  LAYOUT_OPTIONS.find((o) => o.id === g.layout)?.label || g.layout;
                return (
                  <article key={g.id} className="db-hub-card ws-hub-card">
                    <Link href={href} className="db-hub-card-main">
                      <HubPreview
                        kind="graph"
                        graph={{
                          nodes: stats.nodes,
                          edges: stats.edges,
                          hubs: stats.hubs,
                          orphans: stats.orphans,
                        }}
                      />
                      <div className="db-hub-card-top">
                        <PageChromeIcon icon={note?.icon || "hub"} fallback="hub" />
                        <div>
                          <strong>{title}</strong>
                          <span>
                            {layoutLabel} · {formatHubRelTime(new Date(updated))}
                          </span>
                        </div>
                      </div>
                      <HubMetricRow
                        items={[
                          { label: "節點", value: stats.nodes },
                          { label: "Wiki", value: stats.wikiEdges },
                          { label: "樞紐", value: stats.hubs },
                          { label: "孤兒", value: stats.orphans },
                        ]}
                      />
                      <div className="db-hub-chips">
                        <em>Wiki</em>
                        {g.filters.showTagEdges ? <em>標籤邊</em> : null}
                        {g.filters.showFolderEdges ? <em>資料夾邊</em> : null}
                        {g.filters.showGhosts ? <em>幽靈</em> : null}
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
      )}
    </HubShell>
  );
}
