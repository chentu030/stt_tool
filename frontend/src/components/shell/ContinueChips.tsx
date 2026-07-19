"use client";

import Link from "next/link";
import { buildResearchUrl } from "@/lib/researchBridge";
import {
  boardNoteUrl,
  canvasNoteUrl,
  graphNoteUrl,
  libraryFolderUrl,
  libraryJobsUrl,
  RESEARCH_FOLDER,
} from "@/lib/navApps";

export type ContinueChip = {
  href: string;
  label: string;
  primary?: boolean;
  external?: boolean;
};

type Props = {
  chips: ContinueChip[];
  className?: string;
  label?: string;
};

/** Compact cross-app handoff row — matches doc-cmd / kb-shortcuts language. */
export default function ContinueChips({
  chips,
  className = "",
  label = "繼續",
}: Props) {
  if (!chips.length) return null;
  return (
    <nav className={`continue-chips ${className}`.trim()} aria-label={label}>
      <span className="continue-chips-label">{label}</span>
      <div className="continue-chips-row">
        {chips.map((c) => (
          <Link
            key={`${c.href}-${c.label}`}
            href={c.href}
            className={`continue-chip${c.primary ? " is-primary" : ""}`}
            {...(c.external ? { target: "_blank", rel: "noreferrer" } : {})}
          >
            {c.label}
          </Link>
        ))}
      </div>
    </nav>
  );
}

export function noteContinueChips(opts: {
  noteId: string;
  title?: string;
  sourceJobId?: string | null;
  folder?: string | null;
}): ContinueChip[] {
  const chips: ContinueChip[] = [
    {
      href: buildResearchUrl({
        from: opts.noteId,
        topic: opts.title || undefined,
        returnTo: true,
      }),
      label: "深度研究",
      primary: true,
    },
    { href: graphNoteUrl(opts.noteId), label: "圖譜" },
    { href: boardNoteUrl(opts.noteId), label: "看板" },
    { href: canvasNoteUrl(opts.noteId), label: "白板" },
    { href: "/library", label: "知識庫" },
    { href: "/journal", label: "日誌" },
  ];
  if (opts.sourceJobId) {
    chips.splice(1, 0, { href: `/job/${opts.sourceJobId}`, label: "來源逐字稿" });
  }
  if (opts.folder) {
    chips.push({ href: libraryFolderUrl(opts.folder), label: `資料夾 · ${opts.folder}` });
  }
  return chips;
}

export function researchContinueChips(opts?: {
  savedNoteId?: string | null;
  sourceNoteId?: string | null;
}): ContinueChip[] {
  const chips: ContinueChip[] = [
    {
      href: libraryFolderUrl(RESEARCH_FOLDER),
      label: "知識庫 · 深度研究",
      primary: true,
    },
    { href: "/library", label: "知識庫" },
    { href: "/graph", label: "圖譜" },
    { href: "/board", label: "看板" },
    { href: "/canvas", label: "白板" },
  ];
  if (opts?.savedNoteId) {
    chips.unshift({ href: `/notes/${opts.savedNoteId}`, label: "開啟報告筆記", primary: true });
  }
  if (opts?.sourceNoteId) {
    chips.push({ href: `/notes/${opts.sourceNoteId}`, label: "回來源筆記" });
  }
  return chips;
}

export function jobContinueChips(opts: {
  jobId: string;
  noteId?: string | null;
  title?: string;
}): ContinueChip[] {
  const chips: ContinueChip[] = [
    { href: libraryJobsUrl(), label: "全部轉錄" },
    { href: "/library", label: "知識庫" },
    { href: "/capture", label: "再捕捉" },
  ];
  if (opts.noteId) {
    chips.unshift(
      { href: `/notes/${opts.noteId}`, label: "開啟筆記", primary: true },
      {
        href: buildResearchUrl({
          from: opts.noteId,
          topic: opts.title || undefined,
          returnTo: true,
        }),
        label: "深度研究",
      }
    );
  } else {
    chips.unshift({
      href: buildResearchUrl({
        topic: opts.title || undefined,
      }),
      label: "深度研究此主題",
      primary: true,
    });
  }
  return chips;
}

export function libraryContinueChips(opts?: {
  selectedIds?: string[];
  folder?: string;
}): ContinueChip[] {
  const chips: ContinueChip[] = [
    {
      href: libraryFolderUrl(RESEARCH_FOLDER),
      label: "深度研究資料夾",
      primary: true,
    },
    { href: "/research", label: "啟動研究" },
    { href: libraryJobsUrl(), label: "轉錄" },
    { href: "/capture", label: "捕捉" },
    { href: "/graph", label: "圖譜" },
    { href: "/board", label: "看板" },
    { href: "/canvas", label: "白板" },
    { href: "/journal", label: "日誌" },
  ];
  if (opts?.selectedIds?.length) {
    chips.unshift({
      href: buildResearchUrl({ notes: opts.selectedIds }),
      label: `研究已選 ${opts.selectedIds.length} 則`,
      primary: true,
    });
  }
  return chips;
}

export function spatialContinueChips(opts: {
  kind: "board" | "canvas" | "graph";
  noteId?: string | null;
  title?: string;
}): ContinueChip[] {
  const chips: ContinueChip[] = [
    { href: "/library", label: "知識庫" },
    { href: "/journal", label: "日誌" },
    { href: "/research", label: "深度研究" },
  ];
  if (opts.kind !== "graph") {
    chips.unshift({
      href: opts.noteId ? graphNoteUrl(opts.noteId) : "/graph",
      label: "圖譜",
    });
  }
  if (opts.kind !== "board") {
    chips.unshift({
      href: opts.noteId ? boardNoteUrl(opts.noteId) : "/board",
      label: "看板",
    });
  }
  if (opts.kind !== "canvas") {
    chips.unshift({
      href: opts.noteId ? canvasNoteUrl(opts.noteId) : "/canvas",
      label: "白板",
    });
  }
  if (opts.noteId) {
    chips.unshift(
      { href: `/notes/${opts.noteId}`, label: "開啟筆記", primary: true },
      {
        href: buildResearchUrl({
          from: opts.noteId,
          topic: opts.title || undefined,
          returnTo: true,
        }),
        label: "深度研究",
        primary: true,
      }
    );
  }
  return chips;
}

export function journalContinueChips(opts?: {
  noteId?: string | null;
}): ContinueChip[] {
  const chips: ContinueChip[] = [
    { href: "/library", label: "知識庫", primary: !opts?.noteId },
    { href: "/research", label: "深度研究" },
    { href: "/graph", label: "圖譜" },
    { href: "/board", label: "看板" },
    { href: "/capture", label: "捕捉" },
  ];
  if (opts?.noteId) {
    chips.unshift(
      { href: `/notes/${opts.noteId}`, label: "開啟今日筆記", primary: true },
      {
        href: buildResearchUrl({ from: opts.noteId, returnTo: true }),
        label: "深度研究此篇",
      }
    );
  }
  return chips;
}

export function captureContinueChips(): ContinueChip[] {
  return [
    { href: libraryJobsUrl(), label: "轉錄紀錄", primary: true },
    { href: "/library", label: "知識庫" },
    { href: "/research", label: "深度研究" },
    { href: "/journal", label: "日誌" },
  ];
}

export function hubContinueChips(): ContinueChip[] {
  return [
    { href: "/capture", label: "捕捉", primary: true },
    { href: "/library", label: "知識庫" },
    { href: libraryJobsUrl(), label: "轉錄" },
    { href: "/research", label: "深度研究" },
    { href: "/journal", label: "日誌" },
    { href: "/graph", label: "圖譜" },
    { href: "/board", label: "看板" },
  ];
}

export function siloContinueChips(): ContinueChip[] {
  return [
    { href: "/library", label: "知識庫", primary: true },
    { href: "/research", label: "深度研究" },
    { href: "/graph", label: "圖譜" },
    { href: "/board", label: "看板" },
    { href: "/journal", label: "日誌" },
    { href: "/capture", label: "捕捉" },
  ];
}

/** Compact handoff links for asides when a note is in focus. */
export function NoteHandoffLinks({
  noteId,
  title,
  className = "",
}: {
  noteId: string;
  title?: string;
  className?: string;
}) {
  return (
    <div className={`note-handoff ${className}`.trim()}>
      <Link href={`/notes/${noteId}`}>開啟筆記</Link>
      <Link
        href={buildResearchUrl({
          from: noteId,
          topic: title || undefined,
          returnTo: true,
        })}
      >
        深度研究
      </Link>
      <Link href={graphNoteUrl(noteId)}>圖譜</Link>
      <Link href={boardNoteUrl(noteId)}>看板</Link>
      <Link href={canvasNoteUrl(noteId)}>白板</Link>
    </div>
  );
}
