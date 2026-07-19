"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as REMouseEvent,
  type PointerEvent as RPointerEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import {
  createNote,
  deleteNote,
  listenToUserNotes,
  updateNote,
  Note,
} from "@/lib/firebase";
import { usePrefsOptional } from "@/components/PrefsProvider";
import IconColorPicker from "@/components/IconColorPicker";
import PageChromeIcon from "@/components/PageChromeIcon";
import { parseDefaultTags, toggleFavoriteId } from "@/lib/userPrefs";
import { askConfirm, askPrompt } from "@/lib/dialogs";
import {
  UNCATEGORIZED,
  buildNoteTree,
  compareSidebarNotes,
  flattenVisibleNotes,
  noteInFolderPath,
  normalizeFolderPath,
  remapFolderPath,
  renameFolderLeaf,
} from "@/lib/noteTree";
import {
  isPageColorId,
  normalizePageIcon,
  pageColorMeta,
  remapFolderStyles,
  setFolderStyle,
  type PageColorId,
} from "@/lib/pageChrome";
import { toast } from "@/lib/toast";

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

type CtxTarget =
  | { kind: "note"; noteId: string }
  | { kind: "folder"; path: string }
  | { kind: "blank" };

type CtxMenu = {
  x: number;
  y: number;
  target: CtxTarget;
};

type StylePicker = {
  x: number;
  y: number;
  target: { kind: "note"; noteId: string } | { kind: "folder"; path: string };
};

type MenuItem =
  | {
      type: "item";
      label: string;
      danger?: boolean;
      disabled?: boolean;
      action: () => void | Promise<void>;
    }
  | { type: "sep" };

function clampMenuPos(x: number, y: number, w = 200, h = 280) {
  const pad = 8;
  const maxX = Math.max(pad, window.innerWidth - w - pad);
  const maxY = Math.max(pad, window.innerHeight - h - pad);
  return { x: Math.min(Math.max(pad, x), maxX), y: Math.min(Math.max(pad, y), maxY) };
}

export default function SidebarNotesTree() {
  const { user } = useAuth();
  const prefsCtx = usePrefsOptional();
  const prefs = prefsCtx?.prefs;
  const pathname = usePathname();
  const router = useRouter();
  const rootRef = useRef<HTMLDivElement>(null);
  const [notes, setNotes] = useState<Note[]>([]);
  const [q, setQ] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set([UNCATEGORIZED]));
  const [creating, setCreating] = useState(false);
  const [dragOverFolder, setDragOverFolder] = useState<string | null>(null);
  const [dropHint, setDropHint] = useState<{ noteId: string; place: "before" | "after" } | null>(
    null
  );
  const draggingId = useRef<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [ctx, setCtx] = useState<CtxMenu | null>(null);
  const [stylePicker, setStylePicker] = useState<StylePicker | null>(null);
  const [hintDismissed, setHintDismissed] = useState(true);

  const folderStyles = prefs?.folderStyles || {};

  const remapStyles = (oldPath: string, newPath: string) => {
    if (!prefsCtx) return;
    prefsCtx.setPrefs((prev) => ({
      ...prev,
      folderStyles: remapFolderStyles(prev.folderStyles || {}, oldPath, newPath),
    }));
  };

  useEffect(() => {
    try {
      setHintDismissed(localStorage.getItem("cadence_hint_sidebar_v1") === "1");
    } catch {
      setHintDismissed(true);
    }
  }, []);

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
      arr.sort(compareSidebarNotes);
    }
    return m;
  }, [notes]);

  const tree = useMemo(() => buildNoteTree(topNotes), [topNotes]);
  const rows = useMemo(
    () => flattenVisibleNotes(tree.roots, tree.uncategorized, expanded, q),
    [tree, expanded, q]
  );

  const visibleNoteIds = useMemo(() => {
    const ids: string[] = [];
    const seen = new Set<string>();
    const pushKids = (id: string) => {
      const kids = childrenByParent.get(id) || [];
      for (const c of kids) {
        if (seen.has(c.id)) continue;
        seen.add(c.id);
        ids.push(c.id);
        if (expanded.has(`note:${c.id}`)) pushKids(c.id);
      }
    };
    for (const row of rows) {
      if (row.kind !== "note" || !row.note) continue;
      if (seen.has(row.note.id)) continue;
      seen.add(row.note.id);
      ids.push(row.note.id);
      if (expanded.has(`note:${row.note.id}`)) pushKids(row.note.id);
    }
    return ids;
  }, [rows, childrenByParent, expanded]);

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

  useEffect(() => {
    setSelected((prev) => {
      if (!prev.size) return prev;
      const alive = new Set(notes.map((n) => n.id));
      const next = new Set([...prev].filter((id) => alive.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [notes]);

  useEffect(() => {
    if (!ctx) return;
    const close = () => setCtx(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [ctx]);

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
    const siblings = notes.filter(
      (n) =>
        !(n.parent_id || "").trim() &&
        normalizeFolderPath(n.folder) === normalizeFolderPath(folder) &&
        n.id !== noteId
    );
    const maxOrder = siblings.reduce((m, n) => {
      const o = n.sort_order;
      return typeof o === "number" && Number.isFinite(o) ? Math.max(m, o) : m;
    }, 0);
    await updateNote(
      noteId,
      { folder, parent_id: "", sort_order: maxOrder + 1000 },
      { silent: true }
    );
    setDragOverFolder(null);
    setDropHint(null);
    toast("已移到資料夾");
  };

  const onDropReorder = async (
    dragId: string,
    targetId: string,
    place: "before" | "after"
  ) => {
    if (!dragId || dragId === targetId) return;
    const drag = notes.find((n) => n.id === dragId);
    const target = notes.find((n) => n.id === targetId);
    if (!drag || !target) return;

    const parentId = (target.parent_id || "").trim();
    const folder = normalizeFolderPath(target.folder);

    const siblings = notes
      .filter((n) => {
        const p = (n.parent_id || "").trim();
        if (parentId) return p === parentId;
        return !p && normalizeFolderPath(n.folder) === folder;
      })
      .sort(compareSidebarNotes);

    const ordered = siblings.filter((n) => n.id !== dragId);
    let idx = ordered.findIndex((n) => n.id === targetId);
    if (idx < 0) return;
    if (place === "after") idx += 1;
    ordered.splice(idx, 0, drag);

    await Promise.all(
      ordered.map((n, i) => {
        const sort_order = (i + 1) * 1000;
        if (n.id === dragId) {
          return updateNote(
            n.id,
            {
              sort_order,
              parent_id: parentId,
              folder: target.folder || "",
            },
            { silent: true }
          );
        }
        if (n.sort_order === sort_order) return Promise.resolve();
        return updateNote(n.id, { sort_order }, { silent: true });
      })
    );
    setDropHint(null);
    setDragOverFolder(null);
    toast("已調整順序");
  };

  const clearDragState = () => {
    draggingId.current = null;
    setDragOverFolder(null);
    setDropHint(null);
  };

  const toggleFav = (noteId: string) => {
    if (!prefsCtx) return;
    prefsCtx.setPrefs((prev) => toggleFavoriteId(prev, noteId));
  };

  const toggleSelect = useCallback((noteId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(noteId)) next.delete(noteId);
      else next.add(noteId);
      return next;
    });
  }, []);

  const selectAllVisible = useCallback(() => {
    setSelected(new Set(visibleNoteIds));
  }, [visibleNoteIds]);

  const clearSelection = useCallback(() => setSelected(new Set()), []);

  const openCtx = (e: REMouseEvent, target: CtxTarget) => {
    e.preventDefault();
    e.stopPropagation();
    if (target.kind === "note") {
      setSelected((prev) => {
        if (prev.has(target.noteId)) return prev;
        return new Set([target.noteId]);
      });
    }
    const pos = clampMenuPos(e.clientX, e.clientY);
    setCtx({ ...pos, target });
  };

  const closeCtx = () => setCtx(null);

  const openStylePicker = (
    target: StylePicker["target"],
    x: number,
    y: number
  ) => {
    closeCtx();
    const pos = clampMenuPos(x, y, 280, 320);
    setStylePicker({ ...pos, target });
  };

  const applyStyle = async (next: { icon: string; color: PageColorId | "" }) => {
    if (!stylePicker) return;
    const icon = normalizePageIcon(next.icon);
    if (stylePicker.target.kind === "note") {
      await updateNote(stylePicker.target.noteId, {
        icon,
        color: next.color || "",
      });
      toast("已更新圖示");
      return;
    }
    if (!prefsCtx) return;
    const path = stylePicker.target.path;
    prefsCtx.setPrefs((prev) => ({
      ...prev,
      folderStyles: setFolderStyle(prev.folderStyles || {}, path, {
        icon,
        color: next.color || undefined,
      }),
    }));
    toast("已更新資料夾樣式");
  };

  const renameNote = async (note: Note) => {
    const next = await askPrompt({
      title: "重新命名筆記",
      defaultValue: note.title || "未命名",
      placeholder: "筆記標題",
      confirmLabel: "重新命名",
    });
    if (next == null) return;
    await updateNote(note.id, { title: next || "未命名" });
    toast("已重新命名");
  };

  const moveNotes = async (ids: string[]) => {
    if (!ids.length) return;
    const first = notes.find((n) => n.id === ids[0]);
    const next = await askPrompt({
      title: ids.length > 1 ? `移動 ${ids.length} 篇筆記` : "移動筆記",
      message: "輸入資料夾路徑（空白＝未分類；可用 / 建立子資料夾）",
      defaultValue: normalizeFolderPath(first?.folder) || "",
      placeholder: "例如：專案/客戶A",
      confirmLabel: "移動",
    });
    if (next == null) return;
    const folder = normalizeFolderPath(next);
    await Promise.all(ids.map((id) => updateNote(id, { folder, parent_id: "" })));
    toast(ids.length > 1 ? `已移動 ${ids.length} 篇` : "已移動");
  };

  const duplicateNote = async (note: Note) => {
    if (!user) return;
    const newId = await createNote(
      user.uid,
      `${note.title || "未命名"}（副本）`,
      note.body_md || "",
      note.source_job_id,
      note.tags || [],
      {
        folder: note.folder || "",
        status: note.status || "backlog",
        icon: note.icon || "",
        parent_id: note.parent_id || "",
      }
    );
    toast("已建立副本");
    router.push(`/notes/${newId}`);
  };

  const copyNoteLink = async (noteId: string) => {
    const url = `${window.location.origin}/notes/${noteId}`;
    await navigator.clipboard.writeText(url);
    toast("已複製連結");
  };

  const deleteNotes = async (ids: string[]) => {
    if (!ids.length) return;
    const ask = prefs?.askBeforeDelete !== false;
    if (
      ask &&
      !(await askConfirm({
        title: ids.length > 1 ? `刪除選取的 ${ids.length} 篇筆記？` : "刪除此筆記？",
        message: "此操作無法復原。",
        danger: true,
        confirmLabel: "刪除",
      }))
    ) {
      return;
    }
    const wasActive = ids.includes(activeNoteId);
    await Promise.all(ids.map((id) => deleteNote(id)));
    setSelected((prev) => {
      const next = new Set(prev);
      for (const id of ids) next.delete(id);
      return next;
    });
    toast(ids.length > 1 ? `已刪除 ${ids.length} 篇` : "已刪除");
    if (wasActive) router.push("/library");
  };

  const renameFolder = async (path: string) => {
    if (!path || path === UNCATEGORIZED) return;
    const leaf = path.split("/").pop() || path;
    const nextLeaf = await askPrompt({
      title: "重新命名資料夾",
      message: `目前路徑：${path}`,
      defaultValue: leaf,
      placeholder: "資料夾名稱",
      confirmLabel: "重新命名",
    });
    if (nextLeaf == null) return;
    const newPath = renameFolderLeaf(path, nextLeaf);
    if (newPath === path) return;
    const updates = notes
      .map((n) => {
        const remapped = remapFolderPath(n.folder, path, newPath);
        return remapped == null ? null : { id: n.id, folder: remapped };
      })
      .filter(Boolean) as { id: string; folder: string }[];
    await Promise.all(updates.map((u) => updateNote(u.id, { folder: u.folder })));
    remapStyles(path, newPath);
    toast("已重新命名資料夾");
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
        next.add(newPath);
      }
      for (const p of [...next]) {
        if (p.startsWith(`${path}/`)) {
          next.delete(p);
          next.add(`${newPath}${p.slice(path.length)}`);
        }
      }
      saveExpanded(next);
      return next;
    });
  };

  const moveFolder = async (path: string) => {
    if (!path || path === UNCATEGORIZED) return;
    const next = await askPrompt({
      title: "移動資料夾",
      message: `將「${path}」及其子資料夾移到新路徑`,
      defaultValue: path,
      placeholder: "例如：歸檔/專案",
      confirmLabel: "移動",
    });
    if (next == null) return;
    const newPath = normalizeFolderPath(next);
    if (!newPath || newPath === path) return;
    if (newPath.startsWith(`${path}/`)) {
      await askConfirm({
        title: "無法移動",
        message: "不能把資料夾移到自己的子路徑下。",
        confirmLabel: "知道了",
        cancelLabel: "關閉",
      });
      return;
    }
    const updates = notes
      .map((n) => {
        const remapped = remapFolderPath(n.folder, path, newPath);
        return remapped == null ? null : { id: n.id, folder: remapped };
      })
      .filter(Boolean) as { id: string; folder: string }[];
    await Promise.all(updates.map((u) => updateNote(u.id, { folder: u.folder })));
    remapStyles(path, newPath);
    toast("已移動資料夾");
    setExpanded((prev) => {
      const nextSet = new Set(prev);
      if (nextSet.has(path)) {
        nextSet.delete(path);
        nextSet.add(newPath);
      }
      for (const p of [...nextSet]) {
        if (p.startsWith(`${path}/`)) {
          nextSet.delete(p);
          nextSet.add(`${newPath}${p.slice(path.length)}`);
        }
      }
      saveExpanded(nextSet);
      return nextSet;
    });
  };

  const selectFolderNotes = (path: string) => {
    const ids = notes
      .filter((n) => !(n.parent_id || "").trim() && noteInFolderPath(n.folder, path))
      .map((n) => n.id);
    setSelected(new Set(ids));
  };

  const deleteFolderNotes = async (path: string) => {
    if (!path || path === UNCATEGORIZED) return;
    const ids = notes.filter((n) => noteInFolderPath(n.folder, path)).map((n) => n.id);
    if (!ids.length) return;
    if (
      !(await askConfirm({
        title: `刪除「${path}」內的 ${ids.length} 篇筆記？`,
        message: "含子資料夾中的筆記。此操作無法復原。",
        danger: true,
        confirmLabel: "全部刪除",
      }))
    ) {
      return;
    }
    await Promise.all(ids.map((id) => deleteNote(id)));
    clearSelection();
    toast(`已刪除 ${ids.length} 篇`);
  };

  useEffect(() => {
    const treeFocused = () => {
      const root = rootRef.current;
      if (!root) return false;
      const el = document.activeElement;
      if (!el) return false;
      if (root === el || root.contains(el)) {
        const tag = (el as HTMLElement).tagName;
        if (tag === "INPUT" || tag === "TEXTAREA") return false;
        return true;
      }
      return false;
    };

    const onKey = (e: KeyboardEvent) => {
      if (!treeFocused()) return;
      const mod = e.ctrlKey || e.metaKey;

      if (mod && e.key.toLowerCase() === "a") {
        e.preventDefault();
        setSelected(new Set(visibleNoteIds));
        return;
      }

      if (e.key === "Escape") {
        if (selected.size) {
          e.preventDefault();
          clearSelection();
        }
        return;
      }

      if (e.key === "F2") {
        e.preventDefault();
        const id =
          selected.size === 1 ? [...selected][0] : activeNoteId || "";
        const note = notes.find((n) => n.id === id);
        if (note) void renameNote(note);
        return;
      }

      if (e.key === "Delete" || e.key === "Backspace") {
        const tag = (document.activeElement as HTMLElement | null)?.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA") return;
        const ids =
          selected.size > 0
            ? [...selected]
            : activeNoteId
              ? [activeNoteId]
              : [];
        if (!ids.length) return;
        e.preventDefault();
        void deleteNotes(ids);
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    visibleNoteIds,
    selected,
    activeNoteId,
    notes,
    clearSelection,
  ]);

  const buildMenuItems = (): MenuItem[] => {
    if (!ctx) return [];
    const { target } = ctx;
    const menuX = ctx.x;
    const menuY = ctx.y;
    const items: MenuItem[] = [];

    if (selected.size > 1 && (target.kind === "note" || target.kind === "blank")) {
      items.push(
        {
          type: "item",
          label: `移動選取（${selected.size}）…`,
          action: () => moveNotes([...selected]),
        },
        {
          type: "item",
          label: `刪除選取（${selected.size}）`,
          danger: true,
          action: () => deleteNotes([...selected]),
        },
        { type: "item", label: "取消選取", action: clearSelection },
        { type: "sep" }
      );
    }

    if (target.kind === "note") {
      const note = notes.find((n) => n.id === target.noteId);
      if (!note) return items;
      const isSel = selected.has(note.id);
      items.push(
        { type: "item", label: "開啟", action: () => router.push(`/notes/${note.id}`) },
        { type: "item", label: "重新命名", action: () => renameNote(note) },
        {
          type: "item",
          label: "圖示與顏色…",
          action: () => openStylePicker({ kind: "note", noteId: note.id }, menuX, menuY),
        },
        { type: "item", label: "移動至…", action: () => moveNotes([note.id]) },
        {
          type: "item",
          label: isSel ? "取消選取" : "選取",
          action: () => toggleSelect(note.id),
        },
        { type: "sep" },
        { type: "item", label: "複製筆記", action: () => duplicateNote(note) },
        { type: "item", label: "複製連結", action: () => copyNoteLink(note.id) },
        {
          type: "item",
          label: (prefs?.favoriteNoteIds || []).includes(note.id) ? "取消收藏" : "收藏",
          action: () => {
            const wasFav = (prefs?.favoriteNoteIds || []).includes(note.id);
            toggleFav(note.id);
            toast(wasFav ? "已取消收藏" : "已加入收藏");
          },
        },
        { type: "item", label: "新增子頁面", action: () => newNote("", note.id) },
        { type: "sep" },
        {
          type: "item",
          label: "刪除",
          danger: true,
          action: () => deleteNotes([note.id]),
        },
        { type: "sep" },
        { type: "item", label: "全選可見", action: selectAllVisible }
      );
      return items;
    }

    if (target.kind === "folder") {
      const isVirtual = target.path === UNCATEGORIZED;
      items.push({
        type: "item",
        label: "圖示與顏色…",
        action: () => openStylePicker({ kind: "folder", path: target.path }, menuX, menuY),
      });
      if (!isVirtual) {
        items.push(
          { type: "item", label: "重新命名", action: () => renameFolder(target.path) },
          { type: "item", label: "移動至…", action: () => moveFolder(target.path) }
        );
      }
      items.push(
        {
          type: "item",
          label: "選取此夾全部",
          action: () => selectFolderNotes(target.path),
        },
        {
          type: "item",
          label: "新增筆記",
          action: () => newNote(target.path === UNCATEGORIZED ? "" : target.path),
        },
        { type: "sep" },
        { type: "item", label: "全選可見", action: selectAllVisible }
      );
      if (!isVirtual) {
        items.push(
          { type: "sep" },
          {
            type: "item",
            label: "刪除此夾筆記…",
            danger: true,
            action: () => deleteFolderNotes(target.path),
          }
        );
      }
      return items;
    }

    items.push(
      { type: "item", label: "全選可見", action: selectAllVisible },
      {
        type: "item",
        label: "取消選取",
        disabled: !selected.size,
        action: clearSelection,
      },
      { type: "sep" },
      { type: "item", label: "新增筆記", action: () => newNote() }
    );
    return items;
  };

  const onNoteClick = (e: REMouseEvent, noteId: string) => {
    if (e.metaKey || e.ctrlKey) {
      e.preventDefault();
      toggleSelect(noteId);
      return;
    }
    if (e.shiftKey && selected.size) {
      e.preventDefault();
      const ids = visibleNoteIds;
      const anchor = [...selected].pop() || ids[0];
      const a = ids.indexOf(anchor);
      const b = ids.indexOf(noteId);
      if (a >= 0 && b >= 0) {
        const [lo, hi] = a < b ? [a, b] : [b, a];
        setSelected(new Set(ids.slice(lo, hi + 1)));
      } else {
        toggleSelect(noteId);
      }
    }
  };

  const runMenuAction = async (fn: () => void | Promise<void>) => {
    closeCtx();
    try {
      await fn();
    } catch {
      /* ignore */
    }
  };

  const openCtxAt = (x: number, y: number, target: CtxTarget) => {
    if (target.kind === "note") {
      setSelected((prev) => {
        if (prev.has(target.noteId)) return prev;
        return new Set([target.noteId]);
      });
    }
    const pos = clampMenuPos(x, y);
    setCtx({ ...pos, target });
  };

  const bindLongPress = (target: CtxTarget) => ({
    onPointerDown: (e: RPointerEvent) => {
      if (e.button !== 0) return;
      const startX = e.clientX;
      const startY = e.clientY;
      const timer = window.setTimeout(() => {
        openCtxAt(startX, startY, target);
      }, 520);
      const clear = () => {
        window.clearTimeout(timer);
        window.removeEventListener("pointerup", clear);
        window.removeEventListener("pointercancel", clear);
        window.removeEventListener("pointermove", onMove);
      };
      const onMove = (ev: PointerEvent) => {
        if (Math.hypot(ev.clientX - startX, ev.clientY - startY) > 10) clear();
      };
      window.addEventListener("pointerup", clear);
      window.addEventListener("pointercancel", clear);
      window.addEventListener("pointermove", onMove);
    },
  });

  const renderNoteLink = (note: Note, depth: number) => {
    const active = note.id === activeNoteId;
    const isSelected = selected.has(note.id);
    const kids = childrenByParent.get(note.id) || [];
    const open = expanded.has(`note:${note.id}`);
    const isFav = (prefs?.favoriteNoteIds || []).includes(note.id);
    const colorId = isPageColorId(note.color) ? note.color : "";
    const color = pageColorMeta(colorId);
    const dropPlace =
      dropHint?.noteId === note.id ? dropHint.place : null;
    return (
      <div key={`n:${note.id}`}>
        <div
          className={`sb-row sb-row--note${active ? " is-active" : ""}${isSelected ? " is-selected" : ""}${colorId ? " has-color" : ""}${dropPlace === "before" ? " is-drop-before" : ""}${dropPlace === "after" ? " is-drop-after" : ""}`}
          style={{
            paddingLeft: 12 + depth * 12,
            ...(colorId
              ? {
                  ["--sb-tint" as string]: color.fg,
                  ["--sb-tint-bg" as string]: color.bg,
                }
              : {}),
          }}
          draggable
          onDragStart={(e) => {
            draggingId.current = note.id;
            e.dataTransfer.setData("text/note-id", note.id);
            e.dataTransfer.effectAllowed = "move";
          }}
          onDragEnd={clearDragState}
          onDragOver={(e) => {
            e.preventDefault();
            e.stopPropagation();
            if (draggingId.current === note.id) return;
            const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
            const place = e.clientY < rect.top + rect.height / 2 ? "before" : "after";
            setDragOverFolder(null);
            setDropHint((prev) =>
              prev?.noteId === note.id && prev.place === place
                ? prev
                : { noteId: note.id, place }
            );
          }}
          onDragLeave={(e) => {
            const related = e.relatedTarget as Node | null;
            if (related && (e.currentTarget as HTMLElement).contains(related)) return;
            setDropHint((prev) => (prev?.noteId === note.id ? null : prev));
          }}
          onDrop={(e) => {
            e.preventDefault();
            e.stopPropagation();
            const id = e.dataTransfer.getData("text/note-id");
            const place = dropHint?.noteId === note.id ? dropHint.place : "before";
            clearDragState();
            if (id) void onDropReorder(id, note.id, place);
          }}
          onContextMenu={(e) => openCtx(e, { kind: "note", noteId: note.id })}
          onClick={(e) => onNoteClick(e, note.id)}
          {...bindLongPress({ kind: "note", noteId: note.id })}
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
          <button
            type="button"
            className={`sb-note-icon${note.icon ? " has-icon" : ""}`}
            title="圖示與顏色"
            aria-label="圖示與顏色"
            style={colorId ? { background: color.bg, color: color.fg } : undefined}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
              openStylePicker({ kind: "note", noteId: note.id }, r.left, r.bottom + 4);
            }}
          >
            <PageChromeIcon
              icon={note.icon}
              color={colorId || undefined}
              hideWhenEmpty
              fallback="description"
            />
          </button>
          <Link
            href={`/notes/${note.id}`}
            className="sb-note-main"
            title={note.title || "未命名"}
            onClick={(e) => {
              if (e.metaKey || e.ctrlKey || e.shiftKey) e.preventDefault();
            }}
            onDoubleClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              void renameNote(note);
            }}
          >
            <span className="sb-name" style={colorId ? { color: color.fg } : undefined}>
              {note.title || "未命名"}
            </span>
          </Link>
          <button
            type="button"
            className="sb-row-more"
            title="更多"
            aria-label="更多"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
              openCtxAt(r.left, r.bottom + 4, { kind: "note", noteId: note.id });
            }}
          >
            ···
          </button>
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
        {open && kids.map((c) => renderNoteLink(c, depth + 1))}
      </div>
    );
  };

  const menuPortal: ReactNode =
    ctx && typeof document !== "undefined"
      ? createPortal(
          <div
            className="sb-ctx"
            role="menu"
            style={{ left: ctx.x, top: ctx.y }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            {buildMenuItems().map((item, i) =>
              item.type === "sep" ? (
                <hr key={`sep-${i}`} className="sb-ctx-sep" />
              ) : (
                <button
                  key={`${item.label}-${i}`}
                  type="button"
                  role="menuitem"
                  className={item.danger ? "is-danger" : undefined}
                  disabled={item.disabled}
                  onClick={() => void runMenuAction(item.action)}
                >
                  {item.label}
                </button>
              )
            )}
          </div>,
          document.body
        )
      : null;

  const stylePickerPortal: ReactNode = (() => {
    if (!stylePicker || typeof document === "undefined") return null;
    let icon = "";
    let color: PageColorId | "" = "";
    let mode: "note" | "folder" = "note";
    const target = stylePicker.target;
    if (target.kind === "note") {
      const note = notes.find((n) => n.id === target.noteId);
      icon = note?.icon || "";
      color = isPageColorId(note?.color) ? note!.color! : "";
      mode = "note";
    } else {
      const st = folderStyles[target.path] || {};
      icon = st.icon || "";
      color = st.color || "";
      mode = "folder";
    }
    return createPortal(
      <IconColorPicker
        mode={mode}
        icon={icon}
        color={color}
        x={stylePicker.x}
        y={stylePicker.y}
        onChange={(next) => {
          void applyStyle(next);
        }}
        onClose={() => setStylePicker(null)}
      />,
      document.body
    );
  })();

  if (!user) {
    return (
      <div className="sb-tree sb-tree--guest">
        <p>登入後顯示筆記。</p>
      </div>
    );
  }

  return (
    <div
      ref={rootRef}
      className="sb-tree"
      tabIndex={0}
      onContextMenu={(e) => {
        if ((e.target as HTMLElement).closest(".sb-row")) return;
        openCtx(e, { kind: "blank" });
      }}
    >
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

      {!hintDismissed && (
        <div className="sb-hint">
          <span>⌘K 搜尋 · 拖曳排序／移資料夾 · 右鍵管理 · F2 改名</span>
          <button
            type="button"
            aria-label="關閉提示"
            onClick={() => {
              setHintDismissed(true);
              try {
                localStorage.setItem("cadence_hint_sidebar_v1", "1");
              } catch {
                /* ignore */
              }
            }}
          >
            ✕
          </button>
        </div>
      )}

      {selected.size > 0 && (
        <div className="sb-sel-bar">
          <span>已選 {selected.size}</span>
          <button type="button" onClick={() => void moveNotes([...selected])}>
            移動
          </button>
          <button type="button" className="is-danger" onClick={() => void deleteNotes([...selected])}>
            刪除
          </button>
          <button type="button" onClick={clearSelection}>
            取消
          </button>
        </div>
      )}

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
          <div className="sb-tree-empty">
            {notes.length === 0 ? (
              <>
                <p>還沒有筆記</p>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  disabled={creating}
                  onClick={() => void newNote()}
                >
                  建立第一篇
                </button>
              </>
            ) : (
              <>
                <p>沒有符合「{q}」的結果</p>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setQ("")}>
                  清除篩選
                </button>
              </>
            )}
          </div>
        ) : (
          rows.map((row) => {
            if (row.kind === "folder" && row.folder) {
              const open = q ? true : expanded.has(row.path);
              const folderParam =
                row.folder.id === "__none__" ? "__none__" : row.folder.path;
              const dropKey = row.folder.path;
              const fStyle = folderStyles[dropKey] || {};
              const colorId = fStyle.color || "";
              const color = pageColorMeta(colorId);
              return (
                <div key={`f:${row.path}`}>
                  <div
                    className={`sb-row sb-row--folder${dragOverFolder === dropKey ? " is-drop" : ""}${colorId ? " has-color" : ""}`}
                    style={{
                      paddingLeft: 8 + row.depth * 12,
                      ...(colorId
                        ? {
                            ["--sb-tint" as string]: color.fg,
                            ["--sb-tint-bg" as string]: color.bg,
                          }
                        : {}),
                    }}
                    onDragOver={(e) => {
                      e.preventDefault();
                      setDropHint(null);
                      setDragOverFolder(dropKey);
                    }}
                    onDragLeave={() => setDragOverFolder(null)}
                    onDrop={(e) => {
                      e.preventDefault();
                      const id = e.dataTransfer.getData("text/note-id");
                      clearDragState();
                      if (id) void onDropToFolder(dropKey, id);
                    }}
                    onContextMenu={(e) => openCtx(e, { kind: "folder", path: dropKey })}
                    {...bindLongPress({ kind: "folder", path: dropKey })}
                  >
                    <button
                      type="button"
                      className="sb-twist"
                      aria-label={open ? "收合" : "展開"}
                      onClick={() => toggle(row.path)}
                    >
                      {open ? "▾" : "▸"}
                    </button>
                    <button
                      type="button"
                      className={fStyle.icon ? "sb-folder-ms" : `sb-folder-icon${open ? " is-open" : ""}`}
                      title="圖示與顏色"
                      aria-label="圖示與顏色"
                      style={
                        fStyle.icon
                          ? colorId
                            ? { background: color.bg, color: color.fg }
                            : undefined
                          : colorId
                            ? { background: color.fg, opacity: 0.9 }
                            : undefined
                      }
                      onClick={(e) => {
                        e.preventDefault();
                        const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                        openStylePicker({ kind: "folder", path: dropKey }, r.left, r.bottom + 4);
                      }}
                    >
                      {fStyle.icon ? (
                        <PageChromeIcon
                          icon={fStyle.icon}
                          color={colorId || undefined}
                          fallback="folder"
                        />
                      ) : null}
                    </button>
                    <Link
                      href={`/library?folder=${encodeURIComponent(folderParam)}`}
                      className="sb-folder-link"
                      title={row.folder.path}
                      onDoubleClick={(e) => {
                        if (dropKey === UNCATEGORIZED) return;
                        e.preventDefault();
                        e.stopPropagation();
                        void renameFolder(dropKey);
                      }}
                    >
                      <span
                        className="sb-name"
                        style={colorId ? { color: color.fg } : undefined}
                      >
                        {row.folder.name}
                      </span>
                      <em>{row.folder.noteCount}</em>
                    </Link>
                    <button
                      type="button"
                      className="sb-row-more"
                      title="更多"
                      aria-label="更多"
                      onClick={(e) => {
                        e.preventDefault();
                        const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                        openCtxAt(r.left, r.bottom + 4, { kind: "folder", path: dropKey });
                      }}
                    >
                      ···
                    </button>
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

      {menuPortal}
      {stylePickerPortal}
    </div>
  );
}
