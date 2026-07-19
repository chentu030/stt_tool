"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import { createNote, listenToUserNotes, Note } from "@/lib/firebase";
import { usePrefsOptional } from "@/components/PrefsProvider";
import { parseDefaultTags } from "@/lib/userPrefs";
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
  const prefs = usePrefsOptional()?.prefs;
  const pathname = usePathname();
  const router = useRouter();
  const [notes, setNotes] = useState<Note[]>([]);
  const [q, setQ] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set([UNCATEGORIZED]));
  const [creating, setCreating] = useState(false);

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

  const tree = useMemo(() => buildNoteTree(notes), [notes]);
  const rows = useMemo(
    () => flattenVisibleNotes(tree.roots, tree.uncategorized, expanded, q),
    [tree, expanded, q]
  );

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
      if (!folder) {
        next.add(UNCATEGORIZED);
      } else {
        const parts = folder.replace(/\\/g, "/").split("/").filter(Boolean);
        let path = "";
        for (const p of parts) {
          path = path ? `${path}/${p}` : p;
          next.add(path);
        }
      }
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

  const newNote = async (folderPath?: string) => {
    if (!user || creating) return;
    setCreating(true);
    try {
      const folder =
        !folderPath || folderPath === UNCATEGORIZED
          ? prefs?.defaultFolder || ""
          : folderPath;
      const tags = parseDefaultTags(prefs?.defaultTags || "");
      const id = await createNote(user.uid, "未命名筆記", "", undefined, tags, {
        folder,
        status: prefs?.defaultStatus || "backlog",
      });
      router.push(`/notes/${id}`);
    } finally {
      setCreating(false);
    }
  };

  if (!user) {
    return (
      <div className="sb-tree sb-tree--guest">
        <p>登入後顯示筆記與資料夾。</p>
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
        placeholder="篩選筆記…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />

      <div className="sb-tree-list">
        {rows.length === 0 ? (
          <p className="sb-tree-empty">
            {notes.length === 0 ? "尚無筆記" : "沒有符合的項目"}
          </p>
        ) : (
          rows.map((row) => {
            if (row.kind === "folder" && row.folder) {
              const open = q ? true : expanded.has(row.path);
              const folderParam =
                row.folder.id === "__none__" ? "__none__" : row.folder.path;
              return (
                <div
                  key={`f:${row.path}`}
                  className="sb-row sb-row--folder"
                  style={{ paddingLeft: 8 + row.depth * 12 }}
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
                      void newNote(row.folder!.path === UNCATEGORIZED ? "" : row.folder!.path);
                    }}
                  >
                    +
                  </button>
                </div>
              );
            }
            if (row.kind === "note" && row.note) {
              const active = row.note.id === activeNoteId;
              return (
                <Link
                  key={`n:${row.note.id}`}
                  href={`/notes/${row.note.id}`}
                  className={`sb-row sb-row--note${active ? " is-active" : ""}`}
                  style={{ paddingLeft: 20 + row.depth * 12 }}
                  title={row.note.title || "未命名"}
                >
                  <span className="sb-note-icon" aria-hidden>
                    ▢
                  </span>
                  <span className="sb-name">{row.note.title || "未命名"}</span>
                </Link>
              );
            }
            return null;
          })
        )}
      </div>

      <div className="sb-tree-foot">
        <Link href="/library" className="sb-tree-all">
          開啟知識庫 · {tree.total}
        </Link>
      </div>
    </div>
  );
}
