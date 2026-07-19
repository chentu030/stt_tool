"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createNote, Note, Job } from "@/lib/firebase";
import { NOTE_TEMPLATES } from "@/lib/templates";
import { usePrefsOptional } from "@/components/PrefsProvider";
import { parseDefaultTags } from "@/lib/userPrefs";
import { CMD_NAV } from "@/lib/navApps";

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

export default function CommandPalette({ open, onClose, notes, jobs = [], userId }: Props) {
  const router = useRouter();
  const prefsCtx = usePrefsOptional();
  const [q, setQ] = useState("");
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (!open) return;
    setQ("");
    setIndex(0);
  }, [open]);

  const favIds = prefsCtx?.prefs.favoriteNoteIds || [];
  const recentIds = prefsCtx?.prefs.recentNoteIds || [];

  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    const out: Row[] = [];

    if (!s) {
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
      return out.slice(0, 18);
    }

    for (const n of CMD_NAV) {
      if (n.label.includes(s) || n.href.includes(s)) {
        out.push({ kind: "nav", href: n.href, label: n.label, hint: "前往" });
      }
    }
    for (const n of notes) {
      if (
        n.title.toLowerCase().includes(s) ||
        (n.folder || "").toLowerCase().includes(s) ||
        (n.tags || []).some((t) => t.toLowerCase().includes(s))
      ) {
        out.push({
          kind: "note",
          id: n.id,
          label: n.title,
          hint: n.folder || "筆記",
        });
      }
    }
    for (const j of jobs) {
      const title = j.filenames?.[0] || j.youtube_url || j.id;
      if (String(title).toLowerCase().includes(s) || j.id.toLowerCase().includes(s)) {
        out.push({ kind: "job", id: j.id, label: String(title), hint: "逐字稿" });
      }
    }
    return out.slice(0, 24);
  }, [q, notes, jobs, favIds, recentIds, userId, prefsCtx, router, onClose]);

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
          placeholder="搜尋筆記、逐字稿、頁面…"
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
        <p className="cmdk-foot">↑↓ 選擇 · Enter 開啟 · Esc 關閉</p>
      </div>
    </div>
  );
}
