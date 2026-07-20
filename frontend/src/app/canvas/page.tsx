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

type SortKey = "updated" | "name";
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

  const filtered = useMemo(() => {
    const qq = q.trim().toLowerCase();
    let rows = list.map((c) => {
      const note = noteByCanvas.get(c.id);
      const title = (note?.title || c.name || "未命名白板").trim();
      const updated = Math.max(
        c.updated_at?.getTime?.() || 0,
        note?.updated_at?.getTime?.() || 0
      );
      return { c, note, title, updated };
    });
    if (qq) rows = rows.filter((r) => r.title.toLowerCase().includes(qq));
    rows.sort((a, b) =>
      sort === "name" ? a.title.localeCompare(b.title, "zh-Hant") : b.updated - a.updated
    );
    return rows;
  }, [list, noteByCanvas, q, sort]);

  const recent = useMemo(() => filtered.slice(0, 3), [filtered]);

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
      subtitle="無限畫布思考 — 擺筆記、連線、分區，也可嵌進筆記頁。"
      stats={[
        { value: list.length, label: "個白板" },
        {
          value: list.filter((c) => Date.now() - c.updated_at.getTime() < 7 * 86400000).length,
          label: "本週更新",
        },
        { value: noteByCanvas.size, label: "已連結筆記" },
      ]}
      primaryLabel="新建白板"
      primaryBusy={busy}
      onPrimary={() => void createFromTemplate("brainstorm")}
      secondaryHref="/community"
      secondaryLabel="社群商店"
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
        <>
          {!q && recent.length > 0 && sort === "updated" && (
            <section className="db-hub-section">
              <h2>最近使用</h2>
              <div className="db-hub-recent">
                {recent.map(({ c, note, title, updated }) => {
                  const href = note ? noteOpenHref(note) : `/canvas/${c.id}`;
                  return (
                    <Link key={`r-${c.id}`} href={href} className="db-hub-recent-card">
                      <PageChromeIcon icon={note?.icon || "palette"} fallback="palette" />
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
                + 空白白板
              </button>
            </div>
            {filtered.length === 0 ? (
              <p className="cdb-empty">沒有符合「{q}」的白板。</p>
            ) : (
              <div className={layout === "grid" ? "db-hub-grid" : "db-hub-list"}>
                {filtered.map(({ c, note, title, updated }) => {
                  const href = note ? noteOpenHref(note) : `/canvas/${c.id}`;
                  return (
                    <article key={c.id} className="db-hub-card">
                      <Link href={href} className="db-hub-card-main">
                        <HubPreview kind="canvas" />
                        <div className="db-hub-card-top">
                          <PageChromeIcon icon={note?.icon || "palette"} fallback="palette" />
                          <div>
                            <strong>{title}</strong>
                            <span>{formatHubRelTime(new Date(updated))}</span>
                          </div>
                        </div>
                        <div className="db-hub-chips">
                          <em>無限畫布</em>
                          <em>可嵌入筆記</em>
                        </div>
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
        </>
      )}
    </HubShell>
  );
}
