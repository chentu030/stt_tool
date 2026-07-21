"use client";

import { Suspense, type ReactNode } from "react";
import NoteTabsProvider from "@/components/notes/NoteTabsProvider";
import NoteTabsBar from "@/components/notes/NoteTabsBar";

function NoteTabsShellInner({ children }: { children: ReactNode }) {
  return (
    <NoteTabsProvider>
      <div className="note-tabs-shell">
        <NoteTabsBar />
        <div className="note-tabs-main">{children}</div>
      </div>
    </NoteTabsProvider>
  );
}

/** Browser-like note tabs for notes + specialty full-screen routes (/web, /board, …). */
export default function NoteTabsShell({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={<div className="note-tabs-main">{children}</div>}>
      <NoteTabsShellInner>{children}</NoteTabsShellInner>
    </Suspense>
  );
}

export function isNoteTabsPath(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  return (
    pathname.startsWith("/notes/") ||
    pathname.startsWith("/web/") ||
    pathname.startsWith("/board/") ||
    pathname.startsWith("/canvas/") ||
    pathname.startsWith("/graph/") ||
    pathname.startsWith("/db/")
  );
}
