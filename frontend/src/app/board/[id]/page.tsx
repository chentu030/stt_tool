"use client";

import PageLoading from "@/components/motion/PageLoading";

import { askPrompt, askConfirm } from "@/lib/dialogs";
import { toast } from "@/lib/toast";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import {
  listenToUserNotes,
  updateNote,
  createNote,
  deleteNote,
  loginWithGoogle,
  Note,
} from "@/lib/firebase";
import {
  listenBoards,
  createBoard,
  updateBoard,
  deleteBoard,
  lastBoardKey,
  type BoardConfig,
} from "@/lib/boardStore";
import { saveBoardWithSync } from "@/lib/offlineSync";
import WorkspaceSwitcher from "@/components/shell/WorkspaceSwitcher";
import ScrambleText from "@/components/motion/ScrambleText";
import ShinyPill from "@/components/motion/ShinyPill";
import MenuSelect from "@/components/MenuSelect";
import BoardColumn from "@/components/board/BoardColumn";
import BoardAside from "@/components/board/BoardAside";
import {
  BOARD_COLUMNS,
  BOARD_QUICK_TEMPLATES,
  BoardFilters,
  BoardSort,
  BoardStatus,
  Priority,
  PRIORITIES,
  computeBoardStats,
  exportBoardMarkdown,
  filterBoardCards,
  groupByFolder,
  noteMatchesBoard,
  sortBoardCards,
  toBoardCards,
  upsertBoardMeta,
  parseBoardMeta,
  statusOf,
} from "@/lib/boardMeta";
import { downloadText } from "@/lib/libraryIndex";
import { usePrefs } from "@/components/PrefsProvider";
import { useRedirectSpecialtyToNote } from "@/components/workspace/useRedirectSpecialtyToNote";

const SORT_OPTIONS = [
  { value: "updated" as const, label: "最近更新" },
  { value: "priority" as const, label: "優先級" },
  { value: "due" as const, label: "截止日期" },
  { value: "age" as const, label: "閒置最久" },
  { value: "title" as const, label: "標題" },
];

export default function BoardByIdPage() {
  const { id: boardId } = useParams<{ id: string }>();
  const { user, loading } = useAuth();
  const { prefs } = usePrefs();
  useRedirectSpecialtyToNote("board", boardId);
  const router = useRouter();
  const searchParams = useSearchParams();
  const [notes, setNotes] = useState<Note[]>([]);
  const [boards, setBoards] = useState<BoardConfig[]>([]);
  const [boardsReady, setBoardsReady] = useState(false);
  const [boardError, setBoardError] = useState("");
  const [boardRetry, setBoardRetry] = useState(0);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropCol, setDropCol] = useState<BoardStatus | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const focusApplied = useRef(false);
  const [sort, setSort] = useState<BoardSort>(prefs.boardSort);
  const [swimlanes, setSwimlanes] = useState(prefs.boardSwimlanes);
  const [busy, setBusy] = useState(false);
  const [filters, setFilters] = useState<BoardFilters>({
    q: "",
    folder: "",
    tag: "",
    priority: "",
    hideDone: prefs.boardHideDone,
    onlyOverdue: false,
    onlyStale: false,
  });
  const [aiBusy, setAiBusy] = useState(false);
  const [aiText, setAiText] = useState("");
  const [aiError, setAiError] = useState("");
  const [quickOpen, setQuickOpen] = useState<BoardStatus | null>(null);
  const [quickTitle, setQuickTitle] = useState("");
  const [quickTpl, setQuickTpl] = useState(BOARD_QUICK_TEMPLATES[0].id);
  const [prefsSeeded, setPrefsSeeded] = useState(false);

  useEffect(() => {
    if (prefsSeeded) return;
    setSort(prefs.boardSort);
    setSwimlanes(prefs.boardSwimlanes);
    setFilters((f) => ({ ...f, hideDone: prefs.boardHideDone }));
    setPrefsSeeded(true);
  }, [prefs.boardSort, prefs.boardSwimlanes, prefs.boardHideDone, prefsSeeded]);

  useEffect(() => {
    if (!user) return;
    return listenToUserNotes(user.uid, setNotes);
  }, [user]);

  useEffect(() => {
    if (!user) return;
    setBoardsReady(false);
    setBoardError("");
    const timer = window.setTimeout(() => {
      setBoardError((e) => e || "載入逾時，請重試");
    }, 20000);
    const unsub = listenBoards(
      user.uid,
      (list) => {
        window.clearTimeout(timer);
        setBoards(list);
        setBoardsReady(true);
      },
      (err) => {
        window.clearTimeout(timer);
        const msg = err.message || "無法載入看板";
        setBoardError(
          /permission|insufficient|Missing/i.test(msg)
            ? "沒有權限讀寫看板（請確認已部署含 boards 的 Firestore rules）"
            : msg
        );
        setBoardsReady(true);
      }
    );
    return () => {
      window.clearTimeout(timer);
      unsub();
    };
  }, [user, boardRetry]);

  const board = useMemo(
    () => boards.find((b) => b.id === boardId) || null,
    [boards, boardId]
  );

  useEffect(() => {
    const noteId = searchParams.get("note");
    if (!noteId || focusApplied.current || notes.length === 0 || !board) return;
    const note = notes.find((n) => n.id === noteId);
    if (!note) return;
    focusApplied.current = true;
    setSelected([noteId]);
    if (!noteMatchesBoard(note, board)) {
      toast("此筆記不在目前看板範圍，已選取但可能未顯示在欄位中");
    }
    requestAnimationFrame(() => {
      document
        .querySelector(`[data-note-id="${CSS.escape(noteId)}"]`)
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  }, [searchParams, notes, board]);

  useEffect(() => {
    if (!user || !boardsReady || boardError) return;
    if (!boardId) {
      router.replace("/board");
      return;
    }
    if (!board) {
      router.replace("/board");
      return;
    }
    try {
      localStorage.setItem(lastBoardKey(user.uid), board.id);
    } catch {
      /* ignore */
    }
  }, [user, boardsReady, boardError, board, boardId, router]);

  const scopedNotes = useMemo(() => {
    if (!board) return [];
    return notes.filter((n) => noteMatchesBoard(n, board));
  }, [notes, board]);

  const cards = useMemo(() => toBoardCards(scopedNotes), [scopedNotes]);
  const filtered = useMemo(
    () => sortBoardCards(filterBoardCards(cards, filters), sort),
    [cards, filters, sort]
  );
  const stats = useMemo(() => computeBoardStats(cards), [cards]);

  const allFolders = useMemo(() => {
    const s = new Set<string>();
    for (const n of notes) if (n.folder?.trim()) s.add(n.folder.trim());
    return Array.from(s).sort((a, b) => a.localeCompare(b, "zh-Hant"));
  }, [notes]);

  const allTags = useMemo(() => {
    const s = new Set<string>();
    for (const n of notes) (n.tags || []).forEach((t) => s.add(t));
    return Array.from(s).sort((a, b) => a.localeCompare(b, "zh-Hant"));
  }, [notes]);

  const folders = useMemo(() => {
    const s = new Set<string>();
    for (const n of scopedNotes) if (n.folder?.trim()) s.add(n.folder.trim());
    return Array.from(s).sort((a, b) => a.localeCompare(b, "zh-Hant"));
  }, [scopedNotes]);

  const tags = useMemo(() => {
    const s = new Set<string>();
    for (const n of scopedNotes) (n.tags || []).forEach((t) => s.add(t));
    return Array.from(s).sort((a, b) => a.localeCompare(b, "zh-Hant"));
  }, [scopedNotes]);

  const visibleColumns = useMemo(() => {
    if (!board || board.statuses.length === 0) return BOARD_COLUMNS;
    return BOARD_COLUMNS.filter((c) => board.statuses.includes(c.id));
  }, [board]);

  const byCol = useMemo(() => {
    const map: Record<BoardStatus, typeof filtered> = {
      backlog: [],
      doing: [],
      done: [],
    };
    for (const c of filtered) map[c.statusKey].push(c);
    return map;
  }, [filtered]);

  const lanes = useMemo(() => (swimlanes ? groupByFolder(filtered) : null), [swimlanes, filtered]);

  const persistLast = (id: string) => {
    if (!user) return;
    try {
      localStorage.setItem(lastBoardKey(user.uid), id);
    } catch {
      /* ignore */
    }
  };

  const moveCard = async (id: string, status: BoardStatus) => {
    await updateNote(id, { status });
    toast(`已移到「${BOARD_COLUMNS.find((c) => c.id === status)?.label}」`);
  };

  const moveSelected = async (status: BoardStatus) => {
    if (!selected.length) return;
    setBusy(true);
    try {
      await Promise.all(selected.map((id) => updateNote(id, { status })));
      const n = selected.length;
      setSelected([]);
      toast(`已移動 ${n} 張`);
    } finally {
      setBusy(false);
    }
  };

  const deleteSelected = async () => {
    if (!selected.length) return;
    if (
      !(await askConfirm({
        title: `刪除選取的 ${selected.length} 張卡片？`,
        message: "此操作無法復原。",
        danger: true,
        confirmLabel: "刪除",
      }))
    ) {
      return;
    }
    setBusy(true);
    try {
      const n = selected.length;
      await Promise.all(selected.map((id) => deleteNote(id)));
      setSelected([]);
      toast(`已刪除 ${n} 張`);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Delete" && e.key !== "Backspace") return;
      const tag = (document.activeElement as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (!selected.length) return;
      e.preventDefault();
      void deleteSelected();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);

  const cyclePriority = async (id: string) => {
    const note = notes.find((n) => n.id === id);
    if (!note) return;
    const cur = parseBoardMeta(note.body_md, note.tags).priority;
    const idx = PRIORITIES.findIndex((p) => p.id === cur);
    const next = PRIORITIES[(idx + 1) % PRIORITIES.length].id;
    const body = upsertBoardMeta(note.body_md, { priority: next });
    await updateNote(id, { body_md: body });
  };

  const setDueOnSelected = async () => {
    if (!selected.length) return;
    const due = await askPrompt({
      title: "截止日期",
      message: "格式 YYYY-MM-DD，留空則清除",
      defaultValue: "",
    });
    if (due === null) return;
    const val = due.trim();
    if (val && !/^\d{4}-\d{2}-\d{2}$/.test(val)) {
      toast("日期格式不正確");
      return;
    }
    setBusy(true);
    try {
      await Promise.all(
        selected.map(async (id) => {
          const note = notes.find((n) => n.id === id);
          if (!note) return;
          await updateNote(id, {
            body_md: upsertBoardMeta(note.body_md, { due: val }),
          });
        })
      );
      toast("已更新截止日期");
    } finally {
      setBusy(false);
    }
  };

  const onSelect = (id: string, multi: boolean) => {
    setSelected((prev) => {
      if (!multi) return prev.includes(id) && prev.length === 1 ? [] : [id];
      return prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
    });
  };

  const addTagToNote = async (noteId: string) => {
    const note = notes.find((n) => n.id === noteId);
    if (!note) return;
    const raw = await askPrompt({
      title: "新增標籤",
      message: "輸入標籤名稱（不含 #）",
      defaultValue: "",
    });
    if (raw === null) return;
    const tag = raw.trim().replace(/^#/, "");
    if (!tag) return;
    const next = Array.from(new Set([...(note.tags || []), tag]));
    await updateNote(noteId, { tags: next });
    toast(`已加上 #${tag}`);
  };

  const removeTagFromNote = async (noteId: string, tag: string) => {
    const note = notes.find((n) => n.id === noteId);
    if (!note) return;
    const next = (note.tags || []).filter((t) => t !== tag);
    await updateNote(noteId, { tags: next });
    toast(`已移除 #${tag}`);
  };

  const renameTagOnBoard = async (from: string) => {
    if (!user || !board) return;
    const raw = await askPrompt({
      title: "重新命名標籤",
      message: `將本看板卡片上的「#${from}」改名`,
      defaultValue: from,
    });
    if (raw === null) return;
    const to = raw.trim().replace(/^#/, "");
    if (!to || to === from) return;
    setBusy(true);
    try {
      const targets = scopedNotes.filter((n) => (n.tags || []).includes(from));
      await Promise.all(
        targets.map((n) => {
          const next = Array.from(
            new Set((n.tags || []).map((t) => (t === from ? to : t)))
          );
          return updateNote(n.id, { tags: next });
        })
      );
      if (board.tags.includes(from)) {
        await updateBoard(user.uid, board.id, {
          tags: board.tags.map((t) => (t === from ? to : t)),
        });
      }
      toast(`已將 #${from} 改為 #${to}（${targets.length} 張）`);
    } finally {
      setBusy(false);
    }
  };

  const deleteTagOnBoard = async (tag: string) => {
    if (!user || !board) return;
    const ok = await askConfirm({
      title: `刪除標籤「#${tag}」？`,
      message: "會從本看板目前顯示的卡片上移除，不會刪除筆記本身。",
      danger: true,
      confirmLabel: "刪除",
    });
    if (!ok) return;
    setBusy(true);
    try {
      const targets = scopedNotes.filter((n) => (n.tags || []).includes(tag));
      await Promise.all(
        targets.map((n) =>
          updateNote(n.id, { tags: (n.tags || []).filter((t) => t !== tag) })
        )
      );
      if (board.tags.includes(tag)) {
        await updateBoard(user.uid, board.id, {
          tags: board.tags.filter((t) => t !== tag),
        });
      }
      toast(`已移除 #${tag}（${targets.length} 張）`);
    } finally {
      setBusy(false);
    }
  };

  const toggleScopeFolder = async (folder: string) => {
    if (!user || !board) return;
    const next = board.folders.includes(folder)
      ? board.folders.filter((f) => f !== folder)
      : [...board.folders, folder];
    await saveBoardWithSync(user.uid, board.id, { folders: next }, {
      baseUpdatedAt: board.updated_at.getTime(),
      label: board.name,
    });
  };

  const toggleScopeTag = async (tag: string) => {
    if (!user || !board) return;
    const next = board.tags.includes(tag)
      ? board.tags.filter((t) => t !== tag)
      : [...board.tags, tag];
    await saveBoardWithSync(user.uid, board.id, { tags: next }, {
      baseUpdatedAt: board.updated_at.getTime(),
      label: board.name,
    });
  };

  const toggleScopeStatus = async (status: BoardStatus) => {
    if (!user || !board) return;
    const next = board.statuses.includes(status)
      ? board.statuses.filter((s) => s !== status)
      : [...board.statuses, status];
    await saveBoardWithSync(user.uid, board.id, { statuses: next }, {
      baseUpdatedAt: board.updated_at.getTime(),
      label: board.name,
    });
  };

  const clearScope = async (kind: "folders" | "tags" | "statuses") => {
    if (!user || !board) return;
    await saveBoardWithSync(user.uid, board.id, { [kind]: [] }, {
      baseUpdatedAt: board.updated_at.getTime(),
      label: board.name,
    });
  };

  const addScopeFolder = async () => {
    if (!user || !board) return;
    const raw = await askPrompt({
      title: "加入資料夾篩選",
      message: "輸入資料夾名稱（空白 = 未分類）",
      defaultValue: "",
    });
    if (raw === null) return;
    const folder = raw.trim();
    if (board.folders.includes(folder)) return;
    await saveBoardWithSync(user.uid, board.id, {
      folders: [...board.folders, folder],
    }, { baseUpdatedAt: board.updated_at.getTime(), label: board.name });
  };

  const addScopeTag = async () => {
    if (!user || !board) return;
    const raw = await askPrompt({
      title: "加入標籤篩選",
      message: "輸入標籤名稱（不含 #）",
      defaultValue: "",
    });
    if (raw === null) return;
    const tag = raw.trim().replace(/^#/, "");
    if (!tag || board.tags.includes(tag)) return;
    await saveBoardWithSync(user.uid, board.id, { tags: [...board.tags, tag] }, {
      baseUpdatedAt: board.updated_at.getTime(),
      label: board.name,
    });
  };

  const onCreateBoard = async () => {
    if (!user) return;
    const name = await askPrompt({
      title: "新建看板",
      message: "看板名稱",
      defaultValue: "新看板",
    });
    if (!name?.trim()) return;
    const id = await createBoard(user.uid, name.trim());
    persistLast(id);
    router.push(`/board/${id}`);
  };

  const onRenameBoard = async (id: string, name: string) => {
    if (!user) return;
    const target = boards.find((b) => b.id === id);
    await saveBoardWithSync(user.uid, id, { name }, {
      baseUpdatedAt: target?.updated_at.getTime() || Date.now(),
      label: name,
    });
    toast("已重新命名");
  };

  const onDeleteBoard = async (id: string) => {
    if (!user) return;
    const rest = boards.filter((b) => b.id !== id);
    await deleteBoard(user.uid, id);
    if (rest.length === 0) {
      const nid = await createBoard(user.uid, "主看板");
      persistLast(nid);
      router.replace(`/board/${nid}`);
      return;
    }
    const next = rest[0].id;
    persistLast(next);
    router.replace(`/board/${next}`);
  };

  const createQuick = async () => {
    if (!user || !quickOpen || !quickTitle.trim() || !board) return;
    setBusy(true);
    try {
      const tpl = BOARD_QUICK_TEMPLATES.find((t) => t.id === quickTpl) || BOARD_QUICK_TEMPLATES[0];
      const body = upsertBoardMeta(tpl.body, { priority: "normal" });
      const folder =
        filters.folder && filters.folder !== "__none__"
          ? filters.folder
          : board.folders[0] || "看板";
      const seedTags =
        board.tags.length > 0
          ? board.tags.slice(0, 1)
          : filters.tag
            ? [filters.tag]
            : [];
      const id = await createNote(user.uid, quickTitle.trim(), body, undefined, seedTags, {
        status: quickOpen,
        folder,
      });
      setQuickOpen(null);
      setQuickTitle("");
      toast("已新增卡片");
      router.push(`/notes/${id}`);
    } catch (e) {
      toast(e instanceof Error ? e.message : "新增失敗");
    } finally {
      setBusy(false);
    }
  };

  const exportMd = () => {
    downloadText(`cadence-board-${Date.now()}.md`, exportBoardMarkdown(filtered));
    toast("已匯出目前篩選結果");
  };

  const runAiTriage = async () => {
    setAiBusy(true);
    setAiError("");
    try {
      const backlog = byCol.backlog.slice(0, 12);
      const summary = backlog
        .map((c) => `- ${c.title}（優先 ${c.meta.priority}${c.meta.due ? `，截止 ${c.meta.due}` : ""}）`)
        .join("\n");
      const res = await fetch("/api/ai/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "note",
          title: board?.name || "看板待辦",
          body: summary || "（目前沒有待辦）",
          prompt:
            "用繁體中文，幫我把這些待辦排出今天／本週／可延後三組，並各給一句理由。若清單為空，給我建立看板的建議。",
          assistant: {
            name: prefs.aiAssistantName,
            style: prefs.aiStyle,
            model: prefs.aiModel,
            grounding: prefs.aiGrounding,
          },
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "AI 失敗");
      setAiText(data.text);
    } catch (e) {
      setAiError(e instanceof Error ? e.message : String(e));
    } finally {
      setAiBusy(false);
    }
  };

  const runAiScaffold = async (description: string) => {
    if (!user || aiBusy || !board) return;
    setAiBusy(true);
    setAiError("");
    setAiText("");
    try {
      const res = await fetch("/api/ai/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "board_scaffold",
          title: "看板規劃",
          body: description,
          prompt: description,
          assistant: {
            name: prefs.aiAssistantName,
            style: prefs.aiStyle,
            model: prefs.aiModel,
            grounding: prefs.aiGrounding,
          },
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "AI 失敗");
      const raw = String(data.text || "").trim();
      const jsonMatch = raw.match(/\[[\s\S]*\]/);
      if (!jsonMatch) throw new Error("無法解析卡片清單");
      const items = JSON.parse(jsonMatch[0]) as {
        title?: string;
        status?: BoardStatus;
        priority?: Priority;
        due?: string;
        body?: string;
      }[];
      if (!Array.isArray(items) || !items.length) throw new Error("沒有可建立的卡片");
      const seedTags = board.tags.length > 0 ? board.tags.slice(0, 1) : ["看板"];
      const folder = board.folders[0] || undefined;
      let created = 0;
      for (const item of items.slice(0, 12)) {
        const title = (item.title || "").trim();
        if (!title) continue;
        let status: BoardStatus =
          item.status === "doing" || item.status === "done" ? item.status : "backlog";
        if (board.statuses.length > 0 && !board.statuses.includes(status)) {
          status = board.statuses[0];
        }
        const priority: Priority = PRIORITIES.some((p) => p.id === item.priority)
          ? (item.priority as Priority)
          : "normal";
        const body = upsertBoardMeta(item.body || "", {
          priority,
          due: item.due || undefined,
        });
        await createNote(user.uid, title, body, undefined, seedTags, {
          status,
          folder,
        });
        created += 1;
      }
      setAiText(`已建立 ${created} 張卡片。\n\n${raw.slice(0, 800)}`);
      toast(`AI 已建立 ${created} 張看板卡片`);
    } catch (e) {
      setAiError(e instanceof Error ? e.message : String(e));
    } finally {
      setAiBusy(false);
    }
  };

  if (loading) return <PageLoading />;
  if (!user) {
    return (
      <div className="bd-page bd-guest">
        <ScrambleText words="看板" as="h1" className="page-title font-display" />
        <p className="page-sub">登入後使用看板。</p>
        <ShinyPill onClick={() => loginWithGoogle()}>登入</ShinyPill>
      </div>
    );
  }

  if (boardError) {
    return (
      <div className="bd-page bd-guest" style={{ padding: "1.5rem" }}>
        <p style={{ color: "var(--text-muted)", marginBottom: "1rem" }}>{boardError}</p>
        <ShinyPill onClick={() => setBoardRetry((n) => n + 1)}>重試</ShinyPill>
      </div>
    );
  }

  if (!boardsReady || !board) {
    return (
      <div className="bd-page bd-guest">
        <PageLoading label="載入看板中…" />
      </div>
    );
  }

  return (
    <div className="bd-page">
      <header className="bd-hero">
        <div>
          <div className="bd-hero-switch">
            <WorkspaceSwitcher
              label="看板"
              items={boards.map((b) => ({ id: b.id, name: b.name }))}
              currentId={board.id}
              onSelect={(id) => {
                persistLast(id);
                const note = searchParams.get("note");
                const qs = note ? `?note=${encodeURIComponent(note)}` : "";
                router.push(`/board/${id}${qs}`);
              }}
              onCreate={() => {
                void onCreateBoard();
              }}
              onRename={(id, name) => {
                void onRenameBoard(id, name);
              }}
              onDelete={(id) => {
                void onDeleteBoard(id);
              }}
            />
          </div>
          <p className="page-sub">
            {stats.total} 張
            {!stats.wipOk ? " · WIP 超限" : ""}
          </p>
        </div>
        <div className="bd-hero-actions">
          <button type="button" className="btn btn-ghost btn-sm" onClick={exportMd}>
            匯出
          </button>
          <button
            type="button"
            className={`btn btn-sm ${swimlanes ? "" : "btn-ghost"}`}
            onClick={() => setSwimlanes((v) => !v)}
          >
            {swimlanes ? "泳道中" : "資料夾泳道"}
          </button>
          <ShinyPill
            style={{ padding: "0.4rem 0.85rem", fontSize: "0.8rem" }}
            onClick={() => setQuickOpen("backlog")}
          >
            + 新卡片
          </ShinyPill>
        </div>
      </header>

      <div className="bd-scope-bar">
        <span className="bd-scope-label">範圍</span>
        <div className="bd-scope-group">
          <em>資料夾</em>
          {board.folders.length === 0 ? (
            <button type="button" className="bd-chip is-on" onClick={() => { void addScopeFolder(); }}>
              全部
            </button>
          ) : (
            board.folders.map((f) => (
              <button
                key={f || "__empty__"}
                type="button"
                className="bd-chip is-on"
                onClick={() => { void toggleScopeFolder(f); }}
                title="點擊移除"
              >
                {f || "未分類"} ×
              </button>
            ))
          )}
          <button type="button" className="bd-chip" onClick={() => { void addScopeFolder(); }}>
            +
          </button>
          {allFolders.filter((f) => !board.folders.includes(f)).slice(0, 6).map((f) => (
            <button
              key={f}
              type="button"
              className="bd-chip"
              onClick={() => { void toggleScopeFolder(f); }}
            >
              {f}
            </button>
          ))}
          {board.folders.length > 0 && (
            <button type="button" className="bd-chip" onClick={() => { void clearScope("folders"); }}>
              清除
            </button>
          )}
        </div>
        <div className="bd-scope-group">
          <em>標籤</em>
          {board.tags.length === 0 ? (
            <button type="button" className="bd-chip is-on" onClick={() => { void addScopeTag(); }}>
              全部
            </button>
          ) : (
            board.tags.map((t) => (
              <button
                key={t}
                type="button"
                className="bd-chip is-on"
                onClick={() => { void toggleScopeTag(t); }}
                title="點擊移除"
              >
                #{t} ×
              </button>
            ))
          )}
          <button type="button" className="bd-chip" onClick={() => { void addScopeTag(); }}>
            +
          </button>
          {allTags.filter((t) => !board.tags.includes(t)).slice(0, 6).map((t) => (
            <button
              key={t}
              type="button"
              className="bd-chip"
              onClick={() => { void toggleScopeTag(t); }}
            >
              #{t}
            </button>
          ))}
          {board.tags.length > 0 && (
            <button type="button" className="bd-chip" onClick={() => { void clearScope("tags"); }}>
              清除
            </button>
          )}
        </div>
        <div className="bd-scope-group">
          <em>狀態</em>
          {BOARD_COLUMNS.map((c) => {
            const on = board.statuses.length === 0 || board.statuses.includes(c.id);
            return (
              <button
                key={c.id}
                type="button"
                className={`bd-chip${on && board.statuses.length > 0 ? " is-on" : ""}${board.statuses.length === 0 ? " is-on" : ""}`}
                onClick={() => { void toggleScopeStatus(c.id); }}
              >
                {c.label}
              </button>
            );
          })}
          {board.statuses.length > 0 && (
            <button type="button" className="bd-chip" onClick={() => { void clearScope("statuses"); }}>
              全部
            </button>
          )}
        </div>
      </div>

      <div className="bd-toolbar">
        <input
          className="input bd-search"
          placeholder="搜尋標題、內容、標籤…"
          value={filters.q}
          onChange={(e) => setFilters((f) => ({ ...f, q: e.target.value }))}
        />
        <MenuSelect
          variant="soft"
          size="sm"
          ariaLabel="資料夾"
          value={filters.folder || ""}
          options={[
            { value: "", label: "全部資料夾" },
            { value: "__none__", label: "未分類" },
            ...folders.map((f) => ({ value: f, label: f })),
          ]}
          onChange={(folder) => setFilters((f) => ({ ...f, folder }))}
        />
        <MenuSelect
          variant="soft"
          size="sm"
          ariaLabel="標籤"
          value={filters.tag || ""}
          options={[
            { value: "", label: "全部標籤" },
            ...tags.map((t) => ({ value: t, label: `#${t}` })),
          ]}
          onChange={(tag) => setFilters((f) => ({ ...f, tag }))}
        />
        <MenuSelect
          variant="soft"
          size="sm"
          ariaLabel="優先級"
          value={filters.priority || ""}
          options={[
            { value: "", label: "全部優先" },
            ...PRIORITIES.map((p) => ({ value: p.id, label: p.label })),
          ]}
          onChange={(priority) =>
            setFilters((f) => ({ ...f, priority: priority as "" | Priority }))
          }
        />
        <MenuSelect variant="soft" size="sm" ariaLabel="排序" value={sort} options={SORT_OPTIONS} onChange={setSort} />
        <label className="bd-check">
          <input
            type="checkbox"
            checked={filters.hideDone}
            onChange={(e) => setFilters((f) => ({ ...f, hideDone: e.target.checked }))}
          />
          隱藏完成
        </label>
        <label className="bd-check">
          <input
            type="checkbox"
            checked={filters.onlyOverdue}
            onChange={(e) => setFilters((f) => ({ ...f, onlyOverdue: e.target.checked }))}
          />
          僅逾期
        </label>
        <label className="bd-check">
          <input
            type="checkbox"
            checked={filters.onlyStale}
            onChange={(e) => setFilters((f) => ({ ...f, onlyStale: e.target.checked }))}
          />
          僅閒置
        </label>
      </div>

      {selected.length > 0 && (
        <div className="bd-bulk">
          <span>已選 {selected.length}</span>
          {BOARD_COLUMNS.map((c) => (
            <button
              key={c.id}
              type="button"
              className="btn btn-soft btn-sm"
              disabled={busy}
              onClick={() => { void moveSelected(c.id); }}
            >
              移到{c.label}
            </button>
          ))}
          <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => { void setDueOnSelected(); }}>
            設截止日
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={busy}
            style={{ color: "var(--danger)" }}
            onClick={() => {
              void deleteSelected();
            }}
          >
            刪除
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setSelected([])}>
            取消選取
          </button>
        </div>
      )}

      {quickOpen && (
        <div className="bd-quick">
          <strong>新增到「{BOARD_COLUMNS.find((c) => c.id === quickOpen)?.label}」</strong>
          <input
            className="input"
            placeholder="卡片標題"
            value={quickTitle}
            autoFocus
            onChange={(e) => setQuickTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void createQuick();
            }}
          />
          <div className="bd-quick-tpls">
            {BOARD_QUICK_TEMPLATES.map((t) => (
              <button
                key={t.id}
                type="button"
                className={`bd-chip${quickTpl === t.id ? " is-on" : ""}`}
                onClick={() => setQuickTpl(t.id)}
              >
                {t.title}
              </button>
            ))}
          </div>
          <div className="bd-quick-actions">
            <button type="button" className="btn btn-sm" disabled={busy || !quickTitle.trim()} onClick={() => { void createQuick(); }}>
              建立
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setQuickOpen(null)}>
              取消
            </button>
          </div>
        </div>
      )}

      <div className="bd-layout">
        <div className="bd-main">
          {swimlanes && lanes ? (
            lanes.map((lane) => (
              <div key={lane.lane} className="bd-lane">
                <h3 className="bd-lane-title">{lane.lane} <em>{lane.cards.length}</em></h3>
                <div className="bd-grid" style={visibleColumns.length < 3 ? { gridTemplateColumns: `repeat(${visibleColumns.length}, 1fr)` } : undefined}>
                  {visibleColumns.map((col) => (
                    <BoardColumn
                      key={`${lane.lane}-${col.id}`}
                      status={col.id}
                      cards={lane.cards.filter((c) => c.statusKey === col.id)}
                      selectedIds={selected}
                      dragOver={dropCol === col.id}
                      onDragOver={() => setDropCol(col.id)}
                      onDragLeave={() => setDropCol(null)}
                      onDrop={() => {
                        if (dragId) void moveCard(dragId, col.id);
                        setDragId(null);
                        setDropCol(null);
                      }}
                      onDragStart={setDragId}
                      onSelect={onSelect}
                      onMove={(id, s) => { void moveCard(id, s); }}
                      onPriorityCycle={(id) => { void cyclePriority(id); }}
                      onAddTag={(id) => { void addTagToNote(id); }}
                      onRemoveTag={(id, tag) => { void removeTagFromNote(id, tag); }}
                      onQuickAdd={setQuickOpen}
                    />
                  ))}
                </div>
              </div>
            ))
          ) : (
            <div className="bd-grid" style={visibleColumns.length < 3 ? { gridTemplateColumns: `repeat(${visibleColumns.length}, 1fr)` } : undefined}>
              {visibleColumns.map((col) => (
                <BoardColumn
                  key={col.id}
                  status={col.id}
                  cards={byCol[col.id]}
                  selectedIds={selected}
                  dragOver={dropCol === col.id}
                  onDragOver={() => setDropCol(col.id)}
                  onDragLeave={() => setDropCol(null)}
                  onDrop={() => {
                    if (dragId) void moveCard(dragId, col.id);
                    setDragId(null);
                    setDropCol(null);
                  }}
                  onDragStart={setDragId}
                  onSelect={onSelect}
                  onMove={(id, s) => { void moveCard(id, s); }}
                  onPriorityCycle={(id) => { void cyclePriority(id); }}
                  onAddTag={(id) => { void addTagToNote(id); }}
                  onRemoveTag={(id, tag) => { void removeTagFromNote(id, tag); }}
                  onQuickAdd={setQuickOpen}
                />
              ))}
            </div>
          )}
        </div>

        <BoardAside
          stats={stats}
          boardTags={tags}
          selectedNoteId={selected[0] || null}
          selectedTitle={notes.find((n) => n.id === selected[0])?.title}
          onRenameTag={(tag) => { void renameTagOnBoard(tag); }}
          onDeleteTag={(tag) => { void deleteTagOnBoard(tag); }}
          onAiTriage={() => { void runAiTriage(); }}
          onAiScaffold={(d) => { void runAiScaffold(d); }}
          aiBusy={aiBusy}
          aiText={aiText}
          aiError={aiError}
        />
      </div>
    </div>
  );
}
