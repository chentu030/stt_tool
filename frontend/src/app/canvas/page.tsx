"use client";

import PageLoading from "@/components/motion/PageLoading";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import { listenToUserNotes, loginWithGoogle, updateNote, type Note } from "@/lib/firebase";
import { listenCanvases, type CanvasMeta } from "@/lib/canvasCloud";
import { createWorkspacePage, noteOpenHref } from "@/lib/workspacePages";
import { CANVAS_TEMPLATES, formatHubRelTime } from "@/lib/workspaceHubTemplates";
import {
  HubMetricRow,
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

type SortKey = "updated" | "name" | "items";
type LayoutMode = "grid" | "list";

export default function CanvasIndexPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const prefsCtx = usePrefs();
  const [list, setList] = useState<CanvasMeta[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<SortKey>("updated");
  const [layout, setLayout] = useState<LayoutMode>("grid");

  useEffect(() => {
    if (!user) return;
    return listenCanvases(user.uid, setList);
  }, [user]);

  useEffect(() => {
    if (!user) return;
    return listenToUserNotes(user.uid, setNotes);
  }, [user]);

  const noteByCanvas = useMemo(() => {
    const m = new Map<string, Note>();
    for (const n of notes) {
      if (n.app_link?.type === "canvas" && n.app_link.id) m.set(n.app_link.id, n);
    }
    return m;
  }, [notes]);

  const rows = useMemo(() => {
    return list.map((c) => {
      const note = noteByCanvas.get(c.id);
      const title = (note?.title || c.name || "未命名白板").trim();
      const updated = Math.max(
        c.updated_at?.getTime?.() || 0,
        note?.updated_at?.getTime?.() || 0
      );
      const items = c.stickies + c.shapes + c.pins + c.media;
      return { c, note, title, updated, items };
    });
  }, [list, noteByCanvas]);

  const totals = useMemo(() => {
    let stickies = 0;
    let edges = 0;
    let items = 0;
    for (const r of rows) {
      stickies += r.c.stickies;
      edges += r.c.edges;
      items += r.items;
    }
    return { stickies, edges, items };
  }, [rows]);

  const filtered = useMemo(() => {
    const qq = q.trim().toLowerCase();
    let out = rows;
    if (qq) out = out.filter((r) => r.title.toLowerCase().includes(qq));
    out = [...out].sort((a, b) => {
      if (sort === "name") return a.title.localeCompare(b.title, "zh-Hant");
      if (sort === "items") return b.items - a.items;
      return b.updated - a.updated;
    });
    return out;
  }, [rows, q, sort]);

  const featured = filtered[0];

  const createFromTemplate = async (templateId: string) => {
    if (!user) return;
    setBusy(true);
    try {
      const def = CANVAS_TEMPLATES.find((t) => t.id === templateId) || CANVAS_TEMPLATES[2];
      const { noteId, href } = await createWorkspacePage(user.uid, "canvas", {
        name: def.defaultName,
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

  const rename = async (c: CanvasMeta, note?: Note) => {
    if (!user) return;
    const current = note?.title || c.name;
    const next = await askPrompt({
      title: "重新命名白板",
      message: "輸入新名稱",
      defaultValue: current,
      confirmLabel: "儲存",
    });
    if (next == null) return;
    const name = next.trim() || "未命名白板";
    try {
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
        <h1 className="page-title font-display">白板</h1>
        <p className="page-sub">登入後建立無限畫布。</p>
        <button type="button" className="btn" onClick={() => void loginWithGoogle()}>
          登入
        </button>
      </div>
    );
  }

  return (
    <HubShell
      title="白板"
      subtitle="無限畫布思考 — 卡片預覽會反映便利貼數量與連線，像 Miro 縮圖一樣可掃讀。"
      stats={[
        { value: list.length, label: "個白板" },
        { value: totals.stickies, label: "便利貼" },
        { value: totals.edges, label: "連線" },
        { value: totals.items, label: "物件" },
      ]}
      primaryLabel="新建白板"
      primaryBusy={busy}
      onPrimary={() => void createFromTemplate("brainstorm")}
      secondaryHref="/community"
      secondaryLabel="社群商店"
      featured={
        featured ? (
          <Link
            href={featured.note ? noteOpenHref(featured.note) : `/canvas/${featured.c.id}`}
            className="ws-hub-featured-card"
          >
            <HubPreview
              kind="canvas"
              large
              canvas={{
                stickies: featured.c.stickies,
                shapes: featured.c.shapes,
                edges: featured.c.edges,
                pins: featured.c.pins,
                media: featured.c.media,
                colors: featured.c.stickyColors,
              }}
            />
            <div className="ws-hub-featured-meta">
              <span className="ws-hub-featured-kicker">最近使用</span>
              <strong>{featured.title}</strong>
              <HubMetricRow
                items={[
                  { label: "便利貼", value: featured.c.stickies },
                  { label: "圖形", value: featured.c.shapes },
                  { label: "連線", value: featured.c.edges },
                  { label: "釘選", value: featured.c.pins },
                ]}
              />
            </div>
          </Link>
        ) : (
          <div className="ws-hub-featured-card is-empty">
            <HubPreview kind="canvas" large canvas={{ stickies: 5, shapes: 2, edges: 3, pins: 1, media: 0 }} />
            <div className="ws-hub-featured-meta">
              <span className="ws-hub-featured-kicker">預覽</span>
              <strong>空白畫布，立刻可擺便利貼</strong>
              <p>建立後可拖曳、連線、嵌入筆記。</p>
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
              { value: "items", label: "物件數" },
            ]}
            layout={layout}
            onLayout={setLayout}
            searchPlaceholder="搜尋白板名稱…"
          />
        ) : null
      }
    >
      {list.length === 0 ? (
        <HubTemplateWall
          title="從模板開始"
          hint="也可在側欄按 + 選「新白板」，或在筆記輸入 /canvas。"
          templates={CANVAS_TEMPLATES}
          busy={busy}
          onPick={(id) => void createFromTemplate(id)}
        />
      ) : (
        <section className="db-hub-section">
          <div className="db-hub-section-head">
            <h2>全部白板（{filtered.length}）</h2>
            <button
              type="button"
              className="btn btn-ghost"
              disabled={busy}
              onClick={() => void createFromTemplate("blank")}
            >
              + 空白白板
            </button>
          </div>
          {filtered.length === 0 ? (
            <p className="cdb-empty">沒有符合「{q}」的白板。</p>
          ) : (
            <div className={layout === "grid" ? "db-hub-grid ws-hub-grid" : "db-hub-list"}>
              {filtered.map(({ c, note, title, updated, items }) => {
                const href = note ? noteOpenHref(note) : `/canvas/${c.id}`;
                return (
                  <article key={c.id} className="db-hub-card ws-hub-card">
                    <Link href={href} className="db-hub-card-main">
                      <HubPreview
                        kind="canvas"
                        canvas={{
                          stickies: c.stickies,
                          shapes: c.shapes,
                          edges: c.edges,
                          pins: c.pins,
                          media: c.media,
                          colors: c.stickyColors,
                        }}
                      />
                      <div className="db-hub-card-top">
                        <PageChromeIcon icon={note?.icon || "palette"} fallback="palette" />
                        <div>
                          <strong>{title}</strong>
                          <span>
                            {items} 物件 · {formatHubRelTime(new Date(updated))}
                          </span>
                        </div>
                      </div>
                      <HubMetricRow
                        items={[
                          { label: "便利貼", value: c.stickies },
                          { label: "圖形", value: c.shapes },
                          { label: "連線", value: c.edges },
                          { label: "媒體", value: c.media },
                        ]}
                      />
                    </Link>
                    <div className="db-hub-card-actions">
                      <Link className="btn btn-ghost" href={href}>
                        開啟
                      </Link>
                      <button
                        type="button"
                        className="btn btn-ghost"
                        onClick={() => void rename(c, note)}
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
