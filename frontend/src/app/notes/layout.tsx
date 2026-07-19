"use client";

import { Suspense, type ReactNode } from "react";
import NoteTabsProvider from "@/components/notes/NoteTabsProvider";
import NoteTabsBar from "@/components/notes/NoteTabsBar";

function NoteTabsShell({ children }: { children: ReactNode }) {
  return (
    <NoteTabsProvider>
      <div className="note-tabs-shell">
        <NoteTabsBar />
        <div className="note-tabs-main">{children}</div>
      </div>
    </NoteTabsProvider>
  );
}

export default function NotesLayout({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={<div className="note-tabs-main">{children}</div>}>
      <NoteTabsShell>{children}</NoteTabsShell>
    </Suspense>
  );
}
