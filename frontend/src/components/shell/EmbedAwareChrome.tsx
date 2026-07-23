"use client";

import { Suspense, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import AppShell from "@/components/shell/AppShell";
import { NotesListProvider } from "@/components/notes/NotesListProvider";

/**
 * Specialty apps opened as ?embed=1 (split pane / note iframe) must not remount
 * the full shell: a second NotesListProvider + AppShell listeners next to the
 * parent tab routinely OOMs Chrome ("This page couldn't load").
 */
function EmbedAwareChromeInner({ children }: { children: ReactNode }) {
  const searchParams = useSearchParams();
  const embed = searchParams.get("embed") === "1";

  if (embed) {
    return <div className="shell-embed-root">{children}</div>;
  }

  return (
    <NotesListProvider>
      <AppShell>{children}</AppShell>
    </NotesListProvider>
  );
}

export default function EmbedAwareChrome({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={<div className="shell-embed-root">{children}</div>}>
      <EmbedAwareChromeInner>{children}</EmbedAwareChromeInner>
    </Suspense>
  );
}
