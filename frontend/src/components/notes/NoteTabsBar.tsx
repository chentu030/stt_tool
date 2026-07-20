"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import { listenToUserNotes, type Note } from "@/lib/firebase";
import { useNoteTabs } from "@/components/notes/NoteTabsProvider";
import { askPrompt } from "@/lib/dialogs";
import PageChromeIcon from "@/components/PageChromeIcon";
import { normalizePageIcon } from "@/lib/pageChrome";
import {
  WORKSPACE_PAGE_OPTIONS,
  createWorkspacePage,
  type WorkspacePageKind,
} from "@/lib/workspacePages";
import { usePrefs } from "@/components/PrefsProvider";
import { touchRecentId } from "@/lib/userPrefs";
import { toast } from "@/lib/toast";
import { useCommunityOptional } from "@/components/community/CommunityProvider";
import type { ExtensionManifest } from "@/lib/community/types";

function parseDefaultTags(raw: string): string[] {
  return raw
    .split(/[,，\s]+/)
    .map((t) => t.replace(/^#/, "").trim())
    .filter(Boolean);
}

export default function NoteTabsBar() {
  const router = useRouter();
  const { user } = useAuth();
  const prefsCtx = usePrefs();
  const prefs = prefsCtx?.prefs;
  const { openIds, activeId, splitId, activate, close, setSplit, toggleSplitWith } = useNoteTabs();
  const community = useCommunityOptional();
  const [notes, setNotes] = useState<Note[]>([]);
  const [menuOpen, setMenuOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);

  const pageOptions = useMemo(() => {
    const extras = (community?.enabledExtensions || []).map((ext) => ({
      kind: `ext:${ext.id}` as WorkspacePageKind,
      label: ext.manifest.pageType.createLabel || ext.manifest.name,
      icon: ext.manifest.icon || "extension",
      extension: ext.manifest,
    }));
    return [
      ...WORKSPACE_PAGE_OPTIONS.map((o) => ({ ...o, extension: undefined as undefined })),
      ...extras,
    ];
  }, [community?.enabledExtensions]);

  useEffect(() => {
    if (!user) return;
    return listenToUserNotes(user.uid, setNotes);
  }, [user]);

  const byId = useMemo(() => {
    const m = new Map<string, Note>();
    notes.forEach((n) => m.set(n.id, n));
    return m;
  }, [notes]);

  const createPage = async (
    kind: WorkspacePageKind,
    extension?: ExtensionManifest
  ) => {
    if (!user || creating) return;
    setCreating(true);
    setCreateOpen(false);
    try {
      let webUrl: string | undefined;
      if (kind === "web") {
        const raw = await askPrompt({
          title: "開啟網頁",
          message: "輸入網址，將以瀏覽器分頁開啟",
          placeholder: "https://",
          defaultValue: "https://",
        });
        if (raw === null) return;
        webUrl = raw.trim() || "https://www.google.com";
      }
      const { noteId, href } = await createWorkspacePage(user.uid, kind, {
        folder: prefs?.defaultFolder || "",
        tags: parseDefaultTags(prefs?.defaultTags || ""),
        status: prefs?.defaultStatus || "backlog",
        webUrl,
        extension,
      });
      prefsCtx?.setPrefs((p) => touchRecentId(p, noteId));
      router.push(href);
    } catch (err) {
      toast(err instanceof Error ? err.message : "建立失敗");
    } finally {
      setCreating(false);
    }
  };

  if (!openIds.length) return null;

  return (
    <div className="note-tabs" role="tablist" aria-label="開啟的筆記">
      <div className="note-tabs-scroll">
        {openIds.map((id) => {
          const n = byId.get(id);
          const title = n ? n.title || "未命名" : "載入中…";
          const isActive = id === activeId;
          const isSplit = id === splitId;
          return (
            <div
              key={id}
              className={`note-tab${isActive ? " is-active" : ""}${isSplit ? " is-split" : ""}`}
              role="tab"
              aria-selected={isActive}
              onClick={(e) => {
                if ((e.target as HTMLElement).closest(".note-tab-close")) return;
                activate(id);
              }}
              onDoubleClick={(e) => {
                if ((e.target as HTMLElement).closest(".note-tab-close")) return;
                if (activeId && id !== activeId) toggleSplitWith(id);
              }}
            >
              <button
                type="button"
                className="note-tab-main"
                title={title}
                onClick={(e) => {
                  e.stopPropagation();
                  activate(id);
                }}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  if (activeId && id !== activeId) toggleSplitWith(id);
                }}
              >
                {n && normalizePageIcon(n.icon) ? (
                  <PageChromeIcon
                    icon={n.icon}
                    color={n.color}
                    className="note-tab-icon"
                  />
                ) : null}
                <span className="note-tab-title">{title}</span>
                {isSplit && <span className="note-tab-badge">並排</span>}
              </button>
              <button
                type="button"
                className="note-tab-close"
                title="關閉"
                aria-label={`關閉 ${title}`}
                onClick={(e) => {
                  e.stopPropagation();
                  close(id);
                }}
              >
                ×
              </button>
            </div>
          );
        })}
        <div className="note-tab-new-wrap">
          <button
            type="button"
            className="note-tab-new"
            title="新增頁面"
            aria-label="新增頁面"
            aria-expanded={createOpen}
            disabled={creating}
            onClick={() => {
              setMenuOpen(false);
              setCreateOpen((v) => !v);
            }}
          >
            +
          </button>
          {createOpen && (
            <div className="note-tabs-menu note-tabs-create-menu">
              {pageOptions.map((opt) => (
                <button
                  key={opt.kind}
                  type="button"
                  disabled={creating}
                  onClick={() => void createPage(opt.kind, opt.extension)}
                >
                  <span className="note-tabs-menu-row">
                    <PageChromeIcon icon={opt.icon} fallback={opt.icon} className="note-tab-icon" />
                    {opt.label}
                  </span>
                </button>
              ))}
              <button
                type="button"
                onClick={() => {
                  setCreateOpen(false);
                  router.push("/library");
                }}
              >
                前往知識庫…
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="note-tabs-actions">
        <div className="note-tabs-split-wrap">
          <button
            type="button"
            className={`note-tabs-action${splitId ? " is-on" : ""}`}
            title="雙頁並排（或雙擊另一個分頁）"
            onClick={() => {
              setCreateOpen(false);
              setMenuOpen((v) => !v);
            }}
          >
            {splitId ? "並排中" : "並排"}
          </button>
          {menuOpen && (
            <div className="note-tabs-menu">
              {splitId && (
                <button
                  type="button"
                  onClick={() => {
                    setSplit(null);
                    setMenuOpen(false);
                  }}
                >
                  關閉並排
                </button>
              )}
              <p className="note-tabs-menu-label">右側開啟</p>
              {openIds
                .filter((id) => id !== activeId)
                .map((id) => {
                  const n = byId.get(id);
                  return (
                    <button
                      key={id}
                      type="button"
                      className={id === splitId ? "is-on" : ""}
                      onClick={() => {
                        setSplit(id);
                        setMenuOpen(false);
                      }}
                    >
                      {n ? (
                        <span className="note-tabs-menu-row">
                          <PageChromeIcon
                            icon={n.icon}
                            color={n.color}
                            hideWhenEmpty
                            className="note-tab-icon"
                          />
                          {n.title || "未命名"}
                        </span>
                      ) : (
                        id.slice(0, 8)
                      )}
                    </button>
                  );
                })}
              {openIds.filter((id) => id !== activeId).length === 0 && (
                <p className="note-tabs-menu-empty">先再開一個筆記分頁</p>
              )}
              <button
                type="button"
                onClick={() => {
                  void (async () => {
                    const raw = await askPrompt({
                      title: "並排筆記",
                      message: "貼上筆記 ID，或從已開啟分頁選擇",
                      placeholder: "note id",
                    });
                    const id = raw?.trim();
                    if (id) {
                      setSplit(id);
                      setMenuOpen(false);
                    }
                  })();
                }}
              >
                用 ID 開啟…
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
