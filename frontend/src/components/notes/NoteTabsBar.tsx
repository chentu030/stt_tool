"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
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
  noteOpenHref,
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

type MenuPos = { top: number; left: number; minWidth: number };

function clampMenuPos(anchor: DOMRect, minWidth: number, preferRight = false): MenuPos {
  const gap = 4;
  const top = Math.min(anchor.bottom + gap, window.innerHeight - 12);
  const width = Math.max(minWidth, preferRight ? 200 : 176);
  let left = preferRight ? anchor.right - width : anchor.left;
  left = Math.max(8, Math.min(left, window.innerWidth - width - 8));
  return { top, left, minWidth: width };
}

export default function NoteTabsBar() {
  const router = useRouter();
  const { user } = useAuth();
  const prefsCtx = usePrefs();
  const prefs = prefsCtx?.prefs;
  const { openIds, activeId, splitId, open, activate, close, setSplit, toggleSplitWith, reorder } =
    useNoteTabs();
  const community = useCommunityOptional();
  const [notes, setNotes] = useState<Note[]>([]);
  const [menuOpen, setMenuOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createPos, setCreatePos] = useState<MenuPos | null>(null);
  const [splitPos, setSplitPos] = useState<MenuPos | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const dragIdRef = useRef<string | null>(null);

  const createBtnRef = useRef<HTMLButtonElement>(null);
  const splitBtnRef = useRef<HTMLButtonElement>(null);
  const createMenuRef = useRef<HTMLDivElement>(null);
  const splitMenuRef = useRef<HTMLDivElement>(null);

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

  useLayoutEffect(() => {
    if (!createOpen) {
      setCreatePos(null);
      return;
    }
    const place = () => {
      const el = createBtnRef.current;
      if (!el) return;
      setCreatePos(clampMenuPos(el.getBoundingClientRect(), 176, false));
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [createOpen, pageOptions.length]);

  useLayoutEffect(() => {
    if (!menuOpen) {
      setSplitPos(null);
      return;
    }
    const place = () => {
      const el = splitBtnRef.current;
      if (!el) return;
      setSplitPos(clampMenuPos(el.getBoundingClientRect(), 200, true));
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [menuOpen, openIds.length, splitId]);

  useEffect(() => {
    if (!createOpen && !menuOpen) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (createBtnRef.current?.contains(t) || createMenuRef.current?.contains(t)) return;
      if (splitBtnRef.current?.contains(t) || splitMenuRef.current?.contains(t)) return;
      setCreateOpen(false);
      setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setCreateOpen(false);
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [createOpen, menuOpen]);

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
          message: "貼上或輸入網址（Ctrl+V）",
          placeholder: "https://example.com",
          defaultValue: "",
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
      open(noteId);
      router.push(href);
    } catch (err) {
      toast(err instanceof Error ? err.message : "建立失敗");
    } finally {
      setCreating(false);
    }
  };

  if (!openIds.length) return null;

  const createMenu =
    createOpen && createPos && typeof document !== "undefined"
      ? createPortal(
          <div
            ref={createMenuRef}
            className="note-tabs-menu note-tabs-create-menu note-tabs-menu--portal"
            role="menu"
            style={{
              position: "fixed",
              top: createPos.top,
              left: createPos.left,
              minWidth: createPos.minWidth,
              zIndex: 6000,
            }}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
          >
            {pageOptions.map((opt) => (
              <button
                key={opt.kind}
                type="button"
                role="menuitem"
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
              role="menuitem"
              onClick={() => {
                setCreateOpen(false);
                router.push("/library");
              }}
            >
              前往知識庫…
            </button>
          </div>,
          document.body
        )
      : null;

  const splitMenu =
    menuOpen && splitPos && typeof document !== "undefined"
      ? createPortal(
          <div
            ref={splitMenuRef}
            className="note-tabs-menu note-tabs-menu--portal"
            role="menu"
            style={{
              position: "fixed",
              top: splitPos.top,
              left: splitPos.left,
              minWidth: splitPos.minWidth,
              zIndex: 6000,
            }}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
          >
            {splitId && (
              <button
                type="button"
                role="menuitem"
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
                    role="menuitem"
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
              role="menuitem"
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
          </div>,
          document.body
        )
      : null;

  return (
    <div className="note-tabs" role="tablist" aria-label="開啟的筆記">
      <div className="note-tabs-scroll">
        {openIds.map((id, index) => {
          const n = byId.get(id);
          const title = n ? n.title || "未命名" : "載入中…";
          const isActive = id === activeId;
          const splitLive = Boolean(splitId && activeId && splitId !== activeId);
          const isSplit = splitLive && id === splitId;
          const prevId = index > 0 ? openIds[index - 1] : null;
          const nextId = index < openIds.length - 1 ? openIds[index + 1] : null;
          const inSplitPair =
            splitLive &&
            ((isActive && (prevId === splitId || nextId === splitId)) ||
              (isSplit && (prevId === activeId || nextId === activeId)));
          const pairRole =
            inSplitPair && isActive ? "primary" : inSplitPair && isSplit ? "secondary" : "";
          return (
            <div
              key={id}
              className={`note-tab${isActive ? " is-active" : ""}${isSplit ? " is-split" : ""}${
                inSplitPair ? " is-pair" : ""
              }${pairRole ? ` is-pair-${pairRole}` : ""}${dragOverId === id ? " is-drag-over" : ""}`}
              role="tab"
              aria-selected={isActive}
              draggable
              title={`${title}（可拖曳排序）`}
              onDragStart={(e) => {
                if ((e.target as HTMLElement).closest(".note-tab-close")) {
                  e.preventDefault();
                  return;
                }
                dragIdRef.current = id;
                e.dataTransfer.effectAllowed = "move";
                e.dataTransfer.setData("text/plain", id);
                e.currentTarget.classList.add("is-dragging");
              }}
              onDragEnd={(e) => {
                dragIdRef.current = null;
                setDragOverId(null);
                e.currentTarget.classList.remove("is-dragging");
              }}
              onDragOver={(e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                if (dragOverId !== id) setDragOverId(id);
              }}
              onDragLeave={() => {
                setDragOverId((cur) => (cur === id ? null : cur));
              }}
              onDrop={(e) => {
                e.preventDefault();
                const from = e.dataTransfer.getData("text/plain") || dragIdRef.current;
                setDragOverId(null);
                if (from && from !== id) reorder(from, id);
              }}
              onClick={(e) => {
                if ((e.target as HTMLElement).closest(".note-tab-close")) return;
                activate(id, n ? noteOpenHref(n) : undefined);
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
                  activate(id, n ? noteOpenHref(n) : undefined);
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
                {isActive && splitLive ? (
                  <span className="note-tab-badge">主頁</span>
                ) : null}
                {isSplit ? <span className="note-tab-badge">並排</span> : null}
              </button>
              <button
                type="button"
                className="note-tab-close"
                title="關閉"
                aria-label={`關閉 ${title}`}
                draggable={false}
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
      </div>

      <div className="note-tab-new-wrap">
        <button
          ref={createBtnRef}
          type="button"
          className="note-tab-new"
          title="新增頁面"
          aria-label="新增頁面"
          aria-expanded={createOpen}
          disabled={creating || !user}
          onClick={(e) => {
            e.stopPropagation();
            setMenuOpen(false);
            setCreateOpen((v) => !v);
          }}
        >
          +
        </button>
      </div>

      <div className="note-tabs-actions">
        <div className="note-tabs-split-wrap">
          {splitId ? (
            <>
              <button
                type="button"
                className="note-tabs-action is-on"
                title="取消並排"
                onClick={() => {
                  setCreateOpen(false);
                  setMenuOpen(false);
                  setSplit(null);
                }}
              >
                取消並排
              </button>
              <button
                ref={splitBtnRef}
                type="button"
                className="note-tabs-action note-tabs-action--menu"
                title="選擇右側頁面"
                aria-expanded={menuOpen}
                aria-label="選擇並排頁面"
                onClick={() => {
                  setCreateOpen(false);
                  setMenuOpen((v) => !v);
                }}
              >
                ▾
              </button>
            </>
          ) : (
            <button
              ref={splitBtnRef}
              type="button"
              className="note-tabs-action"
              title="雙頁並排（或雙擊另一個分頁）"
              aria-expanded={menuOpen}
              onClick={() => {
                setCreateOpen(false);
                setMenuOpen((v) => !v);
              }}
            >
              並排
            </button>
          )}
        </div>
      </div>

      {createMenu}
      {splitMenu}
    </div>
  );
}
