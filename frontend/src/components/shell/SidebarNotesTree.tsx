"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import { createNote, listenToUserNotes, updateNote, Note } from "@/lib/firebase";
import { usePrefsOptional } from "@/components/PrefsProvider";
import { parseDefaultTags, toggleFavoriteId } from "@/lib/userPrefs";
import {
  UNCATEGORIZED,
  buildNoteTree,
  flattenVisibleNotes,
} from "@/lib/noteTree";

const EXPAND_KEY = "cadence_sidebar_expand_v1";

function loadExpanded(): Set<string> {
  try {
    const raw = localStorage.getItem(EXPAND_KEY);
    if (!raw) return new Set([UNCATEGORIZED]);
    return new Set(JSON.parse(raw) as string[]);
  } catch {
    return new Set([UNCATEGORIZED]);
  }
}

function saveExpanded(set: Set<string>) {
  try {
    localStorage.setItem(EXPAND_KEY, JSON.stringify([...set]));
  } catch {
    /* ignore */
  }
}

export default function SidebarNotesTree() {
  const { user } = useAuth();
  const prefsCtx = usePrefsOptional();
  const prefs = prefsCtx?.prefs;
  const pathname = usePathname();
  const router = useRouter();
  const [notes, setNotes] = useState<Note[]>([]);
  const [q, setQ] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set([UNCATEGORIZED]));
  const [creating, setCreating] = useState(false);
  const [dragOverFolder, setDragOverFolder] = useState<string | null>(null);

  useEffect(() => {
    setExpanded(loadExpanded());
  }, []);

  useEffect(() => {
    if (!user) {
      setNotes([]);
      return;
    }
    return listenToUserNotes(user.uid, setNotes);
  }, [user]);

  const topNotes = useMemo(
    () => notes.filter((n) => !(n.parent_id || "").trim()),
    [notes]
  );
  const childrenByParent = useMemo(() => {
    const m = new Map<string, Note[]>();
    for (const n of notes) {
      const p = (n.parent_id || "").trim();
      if (!p) continue;
      if (!m.has(p)) m.set(p, []);
      m.get(p)!.push(n);
    }
    for (const arr of m.values()) {
      arr.sort((a, b) => (a.title || "").localeCompare(b.title || "", "zh-Hant"));
    }
    return m;
  }, [notes]);

  const tree = useMemo(() => buildNoteTree(topNotes), [topNotes]);
  const rows = useMemo(
    () => flattenVisibleNotes(tree.roots, tree.uncategorized, expanded, q),
    [tree, expanded, q]
  );

  const favNotes = useMemo(() => {
    const ids = prefs?.favoriteNoteIds || [];
    return ids.map((id) => notes.find((n) => n.id === id)).filter(Boolean) as Note[];
  }, [notes, prefs?.favoriteNoteIds]);

  const recentNotes = useMemo(() => {
    const ids = prefs?.recentNoteIds || [];
    return ids
      .map((id) => notes.find((n) => n.id === id))
      .filter(Boolean)
      .slice(0, 8) as Note[];
  }, [notes, prefs?.recentNoteIds]);

  const activeNoteId = pathname.startsWith("/notes/")
    ? pathname.split("/")[2]
    : "";

  useEffect(() => {
    if (!activeNoteId) return;
    const note = notes.find((n) => n.id === activeNoteId);
    if (!note) return;
    const folder = (note.folder || "").trim();
    setExpanded((prev) => {
      const next = new Set(prev);
      if (!folder) next.add(UNCATEGORIZED);
      else {
        const parts = folder.replace(/\\/g, "/").split("/").filter(Boolean);
        let path = "";
        for (const p of parts) {
          path = path ? `${path}/${p}` : p;
          next.add(path);
        }
      }
      if (note.parent_id) next.add(`note:${note.parent_id}`);
      saveExpanded(next);
      return next;
    });
  }, [activeNoteId, notes]);

  const toggle = (path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      saveExpanded(next);
      return next;
    });
  };

  const expandAll = () => {
    const all = new Set<string>([UNCATEGORIZED]);
    const walk = (nodes: typeof tree.roots) => {
      for (const n of nodes) {
        all.add(n.path);
        walk(n.children);
      }
    };
    walk(tree.roots);
    setExpanded(all);
    saveExpanded(all);
  };

  const collapseAll = () => {
    const next = new Set<string>();
    setExpanded(next);
    saveExpanded(next);
  };

  const newNote = async (folderPath?: string, parentId?: string) => {
    if (!user || creating) return;
    setCreating(true);
    try {
      const folder =
        !folderPath || folderPath === UNCATEGORIZED
          ? prefs?.defaultFolder || ""
          : folderPath;
      const tags = parseDefaultTags(prefs?.defaultTags || "");
      const id = await createNote(user.uid, "未命名筆記", "", undefined, tags, {
        folder: parentId ? "" : folder,
        status: prefs?.defaultStatus || "backlog",
        parent_id: parentId || "",
      });
      router.push(`/notes/${id}`);
    } finally {
      setCreating(false);
    }
  };

  const onDropToFolder = async (folderPath: string, noteId: string) => {
    const folder = folderPath === UNCATEGORIZED ? "" : folderPath;
    await updateNote(noteId, { folder, parent_id: "" });
    setDragOverFolder(null);
  };

  const toggleFav = (noteId: string) => {
    if (!prefsCtx) return;
    prefsCtx.setPrefs((prev) => toggleFavoriteId(prev, noteId));
  };

  const renderNoteLink = (note: Note, depth: number) => {
    const active = note.id === activeNoteId;
    const kids = childrenByParent.get(note.id) || [];
    const open = expanded.has(`note:${note.id}`);
    const isFav = (prefs?.favoriteNoteIds || []).includes(note.id);
    return (
      <div key={`n:${note.id}`}>
        <div
          className={`sb-row sb-row--note${active ? " is-active" : ""}`}
          style={{ paddingLeft: 12 + depth * 12 }}
          draggable
          onDragStart={(e) => {
            e.dataTransfer.setData("text/note-id", note.id);
            e.dataTransfer.effectAllowed = "move";
          }}
        >
          {kids.length > 0 ? (
            <button
              type="button"
              className="sb-twist"
              onClick={() => toggle(`note:${note.id}`)}
            >
              {open ? "▾" : "▸"}
            </button>
          ) : (
            <span className="sb-twist-spacer" />
          )}
          <Link
            href={`/notes/${note.id}`}
            className="sb-note-main"
            title={note.title || "未命名"}
          >
            <span className="sb-note-icon" aria-hidden>
              {note.icon || "▢"}
            </span>
            <span className="sb-name">{note.title || "未命名"}</span>
          </Link>
          <button
            type="button"
            className={`sb-fav${isFav ? " is-on" : ""}`}
            title={isFav ? "取消收藏" : "收藏"}
            onClick={(e) => {
              e.preventDefault();
              toggleFav(note.id);
            }}
          >
            ★
          </button>
        </div>
        {open &&
          kids.map((c) => renderNoteLink(c, depth + 1))}
      </div>
    );
  };

  if (!user) {
    return (
      <div className="sb-tree sb-tree--guest">
        <p>登入後顯示筆記。</p>
      </div>
    );
  }

  return (
    <div className="sb-tree">
      <div className="sb-tree-head">
        <span className="sb-tree-label">筆記</span>
        <div className="sb-tree-actions">
          <button type="button" title="全部展開" onClick={expandAll}>
            ⊞
          </button>
          <button type="button" title="全部收合" onClick={collapseAll}>
            ⊟
          </button>
          <button
            type="button"
            className="sb-tree-new"
            disabled={creating}
            title="新筆記"
            onClick={() => {
              void newNote();
            }}
          >
            {creating ? "…" : "+"}
          </button>
        </div>
      </div>

      <input
        className="sb-tree-search"
        placeholder="篩選…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />

      {!q && favNotes.length > 0 && (
        <div className="sb-section">
          <p className="sb-section-label">收藏</p>
          {favNotes.map((n) => renderNoteLink(n, 0))}
        </div>
      )}

      {!q && recentNotes.length > 0 && (
        <div className="sb-section">
          <p className="sb-section-label">最近</p>
          {recentNotes.slice(0, 5).map((n) => renderNoteLink(n, 0))}
        </div>
      )}

      <div className="sb-tree-list">
        {rows.length === 0 ? (
          <p className="sb-tree-empty">
            {notes.length === 0 ? "無筆記" : "無結果"}
          </p>
        ) : (
          rows.map((row) => {
            if (row.kind === "folder" && row.folder) {
              const open = q ? true : expanded.has(row.path);
              const folderParam =
                row.folder.id === "__none__" ? "__none__" : row.folder.path;
              const dropKey = row.folder.path;
              return (
                <div key={`f:${row.path}`}>
                  <div
                    className={`sb-row sb-row--folder${dragOverFolder === dropKey ? " is-drop" : ""}`}
                    style={{ paddingLeft: 8 + row.depth * 12 }}
                    onDragOver={(e) => {
                      e.preventDefault();
                      setDragOverFolder(dropKey);
                    }}
                    onDragLeave={() => setDragOverFolder(null)}
                    onDrop={(e) => {
                      e.preventDefault();
                      const id = e.dataTransfer.getData("text/note-id");
                      if (id) void onDropToFolder(dropKey, id);
                    }}
                  >
                    <button
                      type="button"
                      className="sb-twist"
                      aria-label={open ? "收合" : "展開"}
                      onClick={() => toggle(row.path)}
                    >
                      {open ? "▾" : "▸"}
                    </button>
                    <Link
                      href={`/library?folder=${encodeURIComponent(folderParam)}`}
                      className="sb-folder-link"
                      title={row.folder.path}
                    >
                      <span className={`sb-folder-icon${open ? " is-open" : ""}`} aria-hidden />
                      <span className="sb-name">{row.folder.name}</span>
                      <em>{row.folder.noteCount}</em>
                    </Link>
                    <button
                      type="button"
                      className="sb-row-add"
                      title="在此資料夾新增"
                      onClick={() => {
                        void newNote(
                          row.folder!.path === UNCATEGORIZED ? "" : row.folder!.path
                        );
                      }}
                    >
                      +
                    </button>
                  </div>
                </div>
              );
            }
            if (row.kind === "note" && row.note) {
              const full = notes.find((n) => n.id === row.note!.id);
              if (!full) return null;
              return renderNoteLink(full, row.depth);
            }
            return null;
          })
        )}
      </div>

      <div className="sb-tree-foot">
        <Link href="/library" className="sb-tree-all">
          知識庫 · {tree.total}
        </Link>
      </div>
    </div>
  );
}
