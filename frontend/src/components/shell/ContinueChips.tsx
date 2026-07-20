"use client";

import Link from "next/link";
import { buildResearchUrl } from "@/lib/researchBridge";
import {
  boardNoteUrl,
  canvasNoteUrl,
  graphNoteUrl,
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

/** Removed site-wide — always no-op (keeps old imports from breaking). */
export default function ContinueChips(_props: Props) {
  return null;
}

export function noteContinueChips(_opts: {
  noteId: string;
  title?: string;
  sourceJobId?: string | null;
  folder?: string | null;
}): ContinueChip[] {
  return [];
}

export function researchContinueChips(_opts?: {
  savedNoteId?: string | null;
  sourceNoteId?: string | null;
}): ContinueChip[] {
  return [];
}

export function jobContinueChips(_opts: {
  jobId: string;
  noteId?: string | null;
  title?: string;
}): ContinueChip[] {
  return [];
}

export function libraryContinueChips(_opts?: {
  folder?: string | null;
  noteId?: string | null;
}): ContinueChip[] {
  return [];
}

export function spatialContinueChips(_opts: {
  kind: "board" | "canvas" | "graph";
  id?: string | null;
  noteId?: string | null;
  title?: string | null;
}): ContinueChip[] {
  return [];
}

export function journalContinueChips(_opts?: {
  noteId?: string | null;
}): ContinueChip[] {
  return [];
}

export function captureContinueChips(): ContinueChip[] {
  return [];
}

export function hubContinueChips(): ContinueChip[] {
  return [];
}

export function siloContinueChips(): ContinueChip[] {
  return [];
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
