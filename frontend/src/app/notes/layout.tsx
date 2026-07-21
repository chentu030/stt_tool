"use client";

import type { ReactNode } from "react";

/** Tabs shell lives in AppShell so /web|/board|… keep the same bar as /notes. */
export default function NotesLayout({ children }: { children: ReactNode }) {
  return children;
}
