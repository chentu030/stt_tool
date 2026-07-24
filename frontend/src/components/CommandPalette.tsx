"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { createNote, deleteNote, updateNote, Note, Job } from "@/lib/firebase";
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
import { openGlobalAiRail } from "@/lib/aiRailBridge";
import { appendToTodayJournal, peekJournalCaptureUndo, undoLastJournalCapture } from "@/lib/journalCapture";
import { markDailyRhythmStep } from "@/lib/dailyRhythm";
import {
  searchNotes,
  searchJobs,
  searchCanvases,
  type LibraryNote,
  type LibraryJob,
  type LibraryCanvas,
} from "@/lib/libraryIndex";
import { listenCanvases, type CanvasMeta } from "@/lib/canvasCloud";
import {
  looksLikeSemanticQuery,
  searchNotesSemantic,
  type SemanticHit,
} from "@/lib/noteSemanticSearch";

type Props = {
  open: boolean;
  onClose: () => void;
  notes: Note[];
  jobs?: Job[];
  userId?: string;
};

type Row =
  | { kind: "nav"; href: string; label: string; hint: string }
  | { kind: "note"; id: string; label: string; hint: string; snippet?: string; surface?: string }
  | { kind: "job"; id: string; label: string; hint: string; snippet?: string; surface?: string }
  | { kind: "canvas"; id: string; label: string; hint: string; snippet?: string; surface?: string }
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
  const [canvases, setCanvases] = useState<CanvasMeta[]>([]);
  const [semanticHits, setSemanticHits] = useState<SemanticHit[]>([]);
  const [semanticPending, setSemanticPending] = useState(false);

  useEffect(() => {
    if (!open) return;
    setQ("");
    setIndex(0);
    setSemanticHits([]);
    setSemanticPending(false);
    setContextNoteId(readFocusNoteId(pathname));
  }, [open, pathname]);

  useEffect(() => {
    if (!open || !userId) {
      setCanvases([]);
      return;
    }
    return listenCanvases(userId, setCanvases);
  }, [open, userId]);

  useEffect(() => {
    if (!open || !userId) {
      setSemanticHits([]);
      setSemanticPending(false);
      return;
    }
    const query = q.trim();
    if (!looksLikeSemanticQuery(query)) {
      setSemanticHits([]);
      setSemanticPending(false);
      return;
    }
    let cancelled = false;
    setSemanticPending(true);
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const { hits } = await searchNotesSemantic(query, {
            limit: 10,
            threshold: 0.55,
          });
          if (!cancelled) setSemanticHits(hits);
        } catch {
          if (!cancelled) setSemanticHits([]);
        } finally {
          if (!cancelled) setSemanticPending(false);
        }
      })();
    }, 320);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [open, userId, q]);

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
                title: "移到垃圾桶？",
                message: "可之後在知識庫「垃圾桶」還原。",
                danger: true,
                confirmLabel: "移到垃圾桶",
              }))
            ) {
              return;
            }
            await deleteNote(n.id);
            toast("已移到垃圾桶");
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
            let contextLabel = "知識庫";
            if (pathname?.startsWith("/notes/")) contextLabel = "筆記";
            else if (pathname?.startsWith("/canvas/")) contextLabel = "白板";
            else if (pathname?.startsWith("/journal")) contextLabel = "日誌";
            else if (pathname?.startsWith("/library")) contextLabel = "知識庫";
            else if (pathname?.startsWith("/job/")) contextLabel = "會議";
            if (contextNote) contextLabel = `筆記 · ${contextNote.title || "未命名"}`;
            openGlobalAiRail({
              prompt: "請總結目前對焦內容的重點，並建議下一步",
              contextLabel,
              useCanvasSelection: true,
            });
          },
        });
        out.push({
          kind: "action",
          id: "ask-ai-page",
          label: "對此頁提問…",
          hint: "AI",
          run: () => {
            onClose();
            let contextLabel = "知識庫";
            if (pathname?.startsWith("/notes/")) contextLabel = "筆記";
            else if (pathname?.startsWith("/canvas/")) contextLabel = "白板";
            else if (pathname?.startsWith("/journal")) contextLabel = "日誌";
            else if (pathname?.startsWith("/library")) contextLabel = "知識庫";
            else if (pathname?.startsWith("/job/")) contextLabel = "會議";
            if (contextNote) contextLabel = `筆記 · ${contextNote.title || "未命名"}`;
            let selectionText = "";
            try {
              selectionText = window.getSelection()?.toString()?.trim() || "";
            } catch {
              selectionText = "";
            }
            openGlobalAiRail({
              prompt: "",
              contextLabel,
              useCanvasSelection: true,
              selectionText: selectionText || undefined,
              contextExtra: selectionText
                ? `—— 目前選取 ——\n${selectionText.slice(0, 12000)}\n—— 結束 ——`
                : undefined,
            });
          },
        });
        out.push({
          kind: "action",
          id: "ask-ai-selection",
          label: "用目前選取問 AI",
          hint: "AI",
          run: () => {
            onClose();
            let selectionText = "";
            try {
              selectionText = window.getSelection()?.toString()?.trim() || "";
            } catch {
              selectionText = "";
            }
            openGlobalAiRail({
              prompt: "請根據目前選取內容說明重點",
              contextLabel: selectionText
                ? `選取 · ${selectionText.slice(0, 20)}${selectionText.length > 20 ? "…" : ""}`
                : "⌘K · 目前選取",
              useCanvasSelection: true,
              selectionText: selectionText || undefined,
              contextExtra: selectionText
                ? `—— 目前選取 ——\n${selectionText.slice(0, 12000)}\n—— 結束 ——`
                : undefined,
            });
          },
        });
        out.push({
          kind: "action",
          id: "meeting-to-board-ai",
          label: "會議脈絡 → 白板／AI",
          hint: "交接",
          run: () => {
            onClose();
            openGlobalAiRail({
              prompt:
                "請把目前會議或筆記重點整理成可放到白板的便利貼大綱（條列 5–8 點），並標出可連線的關係。",
              contextLabel: "交接 · 會議→白板",
            });
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

    const libraryNotes: LibraryNote[] = notes.map((n) => ({
      id: n.id,
      title: n.title || "未命名",
      body_md: n.body_md || "",
      tags: n.tags,
      folder: n.folder,
      status: n.status,
      icon: n.icon,
      color: n.color,
      source_job_id: n.source_job_id,
      props: n.props,
      updated_at: n.updated_at instanceof Date ? n.updated_at : new Date(n.updated_at || Date.now()),
      created_at: n.created_at instanceof Date ? n.created_at : new Date(n.created_at || Date.now()),
    }));
    const hits = searchNotes(libraryNotes, q, { sort: "relevance" }).slice(0, 10);
    const matchedIds = new Set<string>();
    const matchedNotes: Note[] = [];
    for (const hit of hits) {
      const n = notes.find((x) => x.id === hit.id);
      if (!n) continue;
      matchedIds.add(n.id);
      matchedNotes.push(n);
      const fieldHint =
        hit.matchFields?.includes("body") && !hit.matchFields.includes("title")
          ? "內文"
          : hit.matchFields?.includes("tag")
            ? "標籤"
            : n.folder || "筆記";
      out.push({
        kind: "note",
        id: n.id,
        label: n.title || "未命名",
        hint: fieldHint,
        snippet: hit.snippet || undefined,
        surface: "筆記",
      });
    }
    // Semantic hits (natural-language): only add notes not already matched by keyword.
    for (const hit of semanticHits) {
      if (matchedIds.has(hit.id)) continue;
      const n = notes.find((x) => x.id === hit.id);
      if (!n) continue;
      matchedIds.add(n.id);
      matchedNotes.push(n);
      out.push({
        kind: "note",
        id: n.id,
        label: n.title || hit.title || "未命名",
        hint: "語意相關",
        snippet: n.folder ? `資料夾 · ${n.folder}` : undefined,
        surface: "筆記",
      });
    }
    if (matchedNotes[0]) pushNoteActions(matchedNotes[0], "hit-");

    const libraryJobs: LibraryJob[] = jobs.map((j) => ({
      id: j.id,
      status: j.status,
      title: j.title,
      filenames: j.filenames,
      youtube_url: j.youtube_url,
      created_at: j.created_at instanceof Date ? j.created_at : new Date(j.created_at || Date.now()),
      transcripts: j.transcripts,
    }));
    for (const hit of searchJobs(libraryJobs, q, 6)) {
      out.push({
        kind: "job",
        id: hit.id,
        label: hit.title,
        hint: hit.surfaceLabel,
        snippet: hit.snippet,
        surface: hit.surfaceLabel,
      });
    }

    const libraryCanvases: LibraryCanvas[] = canvases.map((c) => ({
      id: c.id,
      name: c.name,
      searchText: c.searchText,
      updated_at: c.updated_at,
    }));
    for (const hit of searchCanvases(libraryCanvases, q, 6)) {
      out.push({
        kind: "canvas",
        id: hit.id,
        label: hit.title,
        hint: hit.surfaceLabel,
        snippet: hit.snippet,
        surface: hit.surfaceLabel,
      });
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
          openGlobalAiRail({
            prompt: q.trim() || "請總結目前對焦內容的重點，並建議下一步",
            contextLabel: "⌘K · 整理本頁",
            useCanvasSelection: true,
          });
        },
      });
      out.push({
        kind: "action",
        id: "ask-ai-q",
        label: `問 AI「${q.trim().slice(0, 28)}${q.trim().length > 28 ? "…" : ""}」`,
        hint: "AI",
        run: () => {
          onClose();
          openGlobalAiRail({
            prompt: q.trim(),
            contextLabel: "⌘K · 提問",
            useCanvasSelection: true,
          });
        },
      });
    }

    if (!out.length && !userId) {
      return out;
    }

    return out.slice(0, 32);
  }, [
    q,
    notes,
    jobs,
    canvases,
    favIds,
    recentIds,
    userId,
    prefsCtx,
    router,
    onClose,
    contextNote,
    pathname,
    semanticHits,
  ]);

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
        } else if (row.kind === "canvas") {
          onClose();
          router.push(`/canvas/${row.id}`);
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
                  } else if (row.kind === "canvas") {
                    onClose();
                    router.push(`/canvas/${row.id}`);
                  } else {
                    row.run();
                  }
                }}
              >
                <strong>{row.label}</strong>
                {"surface" in row && row.surface ? (
                  <span className={`cmdk-surface cmdk-surface--${row.kind}`}>{row.surface}</span>
                ) : (
                  <span>{row.hint}</span>
                )}
                {(row.kind === "note" || row.kind === "job" || row.kind === "canvas") &&
                row.snippet ? (
                  <em className="cmdk-snippet">{row.snippet}</em>
                ) : null}
              </button>
            ))
          )}
        </div>
        <p className="cmdk-foot">
          ↑↓ 選擇 · Enter 執行 · Esc 關閉 · 關鍵字或語意搜尋筆記
          {semanticPending ? " · 語意比對中…" : ""}
          {" · 輸入後可寫入今日日誌"}
        </p>
      </div>
    </div>
  );
}
