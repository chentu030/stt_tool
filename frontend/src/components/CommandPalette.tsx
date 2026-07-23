"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { createNote, deleteNote, updateNote, Note, Job, jobDisplayTitle } from "@/lib/firebase";
import { NOTE_TEMPLATES } from "@/lib/templates";
import { usePrefsOptional } from "@/components/PrefsProvider";
import { parseDefaultTags, toggleFavoriteId } from "@/lib/userPrefs";
import {
  boardNoteUrl,
  canvasNoteUrl,
  CMD_NAV,
  graphNoteUrl,
} from "@/lib/navApps";
import { buildResearchUrl } from "@/lib/researchBridge";
import { askConfirm, askPrompt } from "@/lib/dialogs";
import { toast } from "@/lib/toast";
import { normalizeFolderPath } from "@/lib/noteTree";
import { openGlobalAiRail } from "@/components/shell/GlobalAiDock";
import { appendToTodayJournal, peekJournalCaptureUndo, undoLastJournalCapture } from "@/lib/journalCapture";
import { markDailyRhythmStep } from "@/lib/dailyRhythm";

type Props = {
  open: boolean;
  onClose: () => void;
  notes: Note[];
  jobs?: Job[];
  userId?: string;
};

type Row =
  | { kind: "nav"; href: string; label: string; hint: string }
  | { kind: "note"; id: string; label: string; hint: string }
  | { kind: "job"; id: string; label: string; hint: string }
  | { kind: "action"; id: string; label: string; hint: string; run: () => void };

function readFocusNoteId(pathname: string | null): string | null {
  const m = pathname?.match(/^\/notes\/([^/?#]+)/);
  if (m?.[1]) return m[1];
  if (typeof window === "undefined") return null;
  try {
    return new URLSearchParams(window.location.search).get("note");
  } catch {
    return null;
  }
}

export default function CommandPalette({ open, onClose, notes, jobs = [], userId }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const prefsCtx = usePrefsOptional();
  const [q, setQ] = useState("");
  const [index, setIndex] = useState(0);
  const [contextNoteId, setContextNoteId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setQ("");
    setIndex(0);
    setContextNoteId(readFocusNoteId(pathname));
  }, [open, pathname]);

  const favIds = prefsCtx?.prefs.favoriteNoteIds || [];
  const recentIds = prefsCtx?.prefs.recentNoteIds || [];

  const contextNote = useMemo(
    () => (contextNoteId ? notes.find((n) => n.id === contextNoteId) : null),
    [contextNoteId, notes]
  );

  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    const out: Row[] = [];

    const pushManageActions = (n: Note, prefix = "") => {
      const label = n.title || "未命名";
      const isFav = favIds.includes(n.id);
      out.push({
        kind: "action",
        id: `${prefix}rename-${n.id}`,
        label: `重新命名「${label}」`,
        hint: "管理",
        run: () => {
          void (async () => {
            const next = await askPrompt({
              title: "重新命名筆記",
              defaultValue: n.title || "未命名",
              confirmLabel: "重新命名",
            });
            if (next == null) return;
            await updateNote(n.id, { title: next || "未命名" });
            toast("已重新命名");
            onClose();
          })();
        },
      });
      out.push({
        kind: "action",
        id: `${prefix}move-${n.id}`,
        label: `移動「${label}」…`,
        hint: "管理",
        run: () => {
          void (async () => {
            const next = await askPrompt({
              title: "移動筆記",
              message: "輸入資料夾路徑（空白＝未分類）",
              defaultValue: normalizeFolderPath(n.folder) || "",
              confirmLabel: "移動",
            });
            if (next == null) return;
            await updateNote(n.id, { folder: normalizeFolderPath(next), parent_id: "" });
            toast("已移動");
            onClose();
          })();
        },
      });
      out.push({
        kind: "action",
        id: `${prefix}fav-${n.id}`,
        label: isFav ? `取消收藏「${label}」` : `收藏「${label}」`,
        hint: "管理",
        run: () => {
          prefsCtx?.setPrefs((p) => toggleFavoriteId(p, n.id));
          toast(isFav ? "已取消收藏" : "已加入收藏");
          onClose();
        },
      });
      out.push({
        kind: "action",
        id: `${prefix}copy-${n.id}`,
        label: `複製「${label}」連結`,
        hint: "管理",
        run: () => {
          void (async () => {
            await navigator.clipboard.writeText(`${window.location.origin}/notes/${n.id}`);
            toast("已複製連結");
            onClose();
          })();
        },
      });
      out.push({
        kind: "action",
        id: `${prefix}del-${n.id}`,
        label: `刪除「${label}」`,
        hint: "危險",
        run: () => {
          void (async () => {
            if (
              !(await askConfirm({
                title: "刪除此筆記？",
                message: "此操作無法復原。",
                danger: true,
                confirmLabel: "刪除",
              }))
            ) {
              return;
            }
            await deleteNote(n.id);
            toast("已刪除");
            onClose();
            if (pathname?.startsWith(`/notes/${n.id}`)) router.push("/library");
          })();
        },
      });
    };

    const pushNoteActions = (n: Note, prefix = "") => {
      const label = n.title || "未命名";
      pushManageActions(n, prefix);
      out.push({
        kind: "action",
        id: `${prefix}research-${n.id}`,
        label: `深度研究「${label}」`,
        hint: "研究",
        run: () => {
          onClose();
          router.push(
            buildResearchUrl({ from: n.id, topic: n.title || undefined, returnTo: true })
          );
        },
      });
      out.push({
        kind: "action",
        id: `${prefix}graph-${n.id}`,
        label: `在圖譜開啟「${label}」`,
        hint: "圖譜",
        run: () => {
          onClose();
          router.push(graphNoteUrl(n.id));
        },
      });
      out.push({
        kind: "action",
        id: `${prefix}board-${n.id}`,
        label: `在看板開啟「${label}」`,
        hint: "看板",
        run: () => {
          onClose();
          router.push(boardNoteUrl(n.id));
        },
      });
      out.push({
        kind: "action",
        id: `${prefix}canvas-${n.id}`,
        label: `在白板開啟「${label}」`,
        hint: "白板",
        run: () => {
          onClose();
          router.push(canvasNoteUrl(n.id));
        },
      });
    };

    if (!s) {
      if (userId) {
        if (peekJournalCaptureUndo()) {
          out.push({
            kind: "action",
            id: "undo-capture",
            label: "復原剛才的日誌捕捉",
            hint: "復原",
            run: () => {
              void (async () => {
                try {
                  const ok = await undoLastJournalCapture();
                  toast(ok ? "已復原日誌捕捉" : "沒有可復原的捕捉");
                  onClose();
                } catch (e) {
                  toast(e instanceof Error ? e.message : "復原失敗");
                }
              })();
            },
          });
        }
        out.push({
          kind: "action",
          id: "organize-page",
          label: "整理本頁（開啟 AI）",
          hint: "AI",
          run: () => {
            onClose();
            openGlobalAiRail();
          },
        });
      }
      if (contextNote) {
        out.push({
          kind: "note",
          id: contextNote.id,
          label: contextNote.title || "目前筆記",
          hint: "目前",
        });
        pushNoteActions(contextNote, "ctx-");
      }
      for (const id of recentIds.slice(0, 5)) {
        const n = notes.find((x) => x.id === id);
        if (n) out.push({ kind: "note", id: n.id, label: n.title, hint: "最近" });
      }
      for (const id of favIds.slice(0, 5)) {
        const n = notes.find((x) => x.id === id);
        if (n && !out.some((r) => r.kind === "note" && r.id === n.id)) {
          out.push({ kind: "note", id: n.id, label: n.title, hint: "收藏" });
        }
      }
      for (const n of CMD_NAV) out.push({ kind: "nav", href: n.href, label: n.label, hint: "前往" });
      if (userId) {
        out.push({
          kind: "action",
          id: "new",
          label: "新筆記",
          hint: "建立",
          run: () => {
            void (async () => {
              const id = await createNote(
                userId,
                "未命名筆記",
                "",
                undefined,
                parseDefaultTags(prefsCtx?.prefs.defaultTags || ""),
                {
                  folder: prefsCtx?.prefs.defaultFolder || "",
                  status: prefsCtx?.prefs.defaultStatus || "backlog",
                }
              );
              onClose();
              router.push(`/notes/${id}`);
            })();
          },
        });
        for (const t of NOTE_TEMPLATES.filter((x) => x.id !== "blank").slice(0, 4)) {
          out.push({
            kind: "action",
            id: `tpl-${t.id}`,
            label: t.label,
            hint: "範本",
            run: () => {
              void (async () => {
                const id = await createNote(userId, t.title, t.body, undefined, t.tags, {
                  folder: prefsCtx?.prefs.defaultFolder || "",
                  status: prefsCtx?.prefs.defaultStatus || "backlog",
                });
                onClose();
                router.push(`/notes/${id}`);
              })();
            },
          });
        }
      }
      return out.slice(0, 28);
    }

    for (const n of CMD_NAV) {
      if (n.label.includes(s) || n.href.includes(s)) {
        out.push({ kind: "nav", href: n.href, label: n.label, hint: "前往" });
      }
    }

    const matchedNotes: Note[] = [];
    for (const n of notes) {
      if (
        n.title.toLowerCase().includes(s) ||
        (n.folder || "").toLowerCase().includes(s) ||
        (n.tags || []).some((t) => t.toLowerCase().includes(s))
      ) {
        matchedNotes.push(n);
        out.push({
          kind: "note",
          id: n.id,
          label: n.title,
          hint: n.folder || "筆記",
        });
      }
    }
    if (matchedNotes[0]) pushNoteActions(matchedNotes[0], "hit-");

    for (const j of jobs) {
      const title = jobDisplayTitle(j);
      if (String(title).toLowerCase().includes(s) || j.id.toLowerCase().includes(s)) {
        out.push({ kind: "job", id: j.id, label: String(title), hint: "逐字稿" });
      }
    }

    if (userId && q.trim()) {
      const title = q.trim();
      out.unshift({
        kind: "action",
        id: "capture-today",
        label: `寫入今日日誌「${title.slice(0, 40)}${title.length > 40 ? "…" : ""}」`,
        hint: "捕捉",
        run: () => {
          void (async () => {
            try {
              await appendToTodayJournal(userId, notes, title, { stamp: true });
              markDailyRhythmStep("capture");
              toast("已寫入今日日誌 · ⌘K 可「復原剛才的日誌捕捉」");
              onClose();
            } catch (e) {
              toast(e instanceof Error ? e.message : "寫入失敗");
            }
          })();
        },
      });
      out.push({
        kind: "action",
        id: "create-from-q",
        label: `建立筆記「${title}」`,
        hint: "建立",
        run: () => {
          void (async () => {
            const id = await createNote(
              userId,
              title,
              "",
              undefined,
              parseDefaultTags(prefsCtx?.prefs.defaultTags || ""),
              {
                folder: prefsCtx?.prefs.defaultFolder || "",
                status: prefsCtx?.prefs.defaultStatus || "backlog",
              }
            );
            toast("已建立筆記");
            onClose();
            router.push(`/notes/${id}`);
          })();
        },
      });
      out.push({
        kind: "action",
        id: "organize-page-q",
        label: "整理本頁（開啟 AI）",
        hint: "AI",
        run: () => {
          onClose();
          openGlobalAiRail();
        },
      });
    }

    if (!out.length && !userId) {
      return out;
    }

    return out.slice(0, 32);
  }, [q, notes, jobs, favIds, recentIds, userId, prefsCtx, router, onClose, contextNote, pathname]);

  useEffect(() => {
    setIndex(0);
  }, [q]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setIndex((i) => (i + 1) % Math.max(rows.length, 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setIndex((i) => (i - 1 + Math.max(rows.length, 1)) % Math.max(rows.length, 1));
      } else if (e.key === "Enter") {
        e.preventDefault();
        const row = rows[index];
        if (!row) return;
        if (row.kind === "nav") {
          onClose();
          router.push(row.href);
        } else if (row.kind === "note") {
          onClose();
          router.push(`/notes/${row.id}`);
        } else if (row.kind === "job") {
          onClose();
          router.push(`/job/${row.id}`);
        } else if (row.kind === "action") {
          row.run();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, rows, index, onClose, router]);

  if (!open) return null;

  return (
    <div className="cmdk-backdrop" onMouseDown={onClose}>
      <div
        className="cmdk-panel"
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="快速搜尋"
      >
        <input
          className="cmdk-input"
          autoFocus
          placeholder="輸入一句話可寫入今日日誌，或搜尋筆記…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <div className="cmdk-list">
          {rows.length === 0 ? (
            <p className="cmdk-empty">沒有符合項目</p>
          ) : (
            rows.map((row, i) => (
              <button
                key={`${row.kind}-${"id" in row ? row.id : row.href}-${i}`}
                type="button"
                className={`cmdk-item${i === index ? " is-on" : ""}`}
                onMouseEnter={() => setIndex(i)}
                onClick={() => {
                  if (row.kind === "nav") {
                    onClose();
                    router.push(row.href);
                  } else if (row.kind === "note") {
                    onClose();
                    router.push(`/notes/${row.id}`);
                  } else if (row.kind === "job") {
                    onClose();
                    router.push(`/job/${row.id}`);
                  } else {
                    row.run();
                  }
                }}
              >
                <strong>{row.label}</strong>
                <span>{row.hint}</span>
              </button>
            ))
          )}
        </div>
        <p className="cmdk-foot">↑↓ 選擇 · Enter 執行 · Esc 關閉 · ⌘K 隨時開啟 · 輸入後優先寫入日誌</p>
      </div>
    </div>
  );
}
