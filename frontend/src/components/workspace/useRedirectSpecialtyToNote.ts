"use client";

import { useEffect } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import {
  ensureNoteForAppLink,
  type NoteAppLinkType,
} from "@/lib/workspacePages";

/**
 * Specialty routes (/canvas, /graph, /board, /db) are full-screen pages.
 * - ?embed=1 → compact iframe chrome for slash embeds inside notes
 * - otherwise stay on the native route; ensure a paired note exists for the tree
 */
export function useRedirectSpecialtyToNote(
  type: Exclude<NoteAppLinkType, "web" | "extension">,
  appId: string | undefined,
  title?: string
) {
  const { user } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const embed = searchParams.get("embed") === "1";
  const noteQ = searchParams.get("note");

  useEffect(() => {
    if (embed) {
      document.documentElement.classList.add("is-note-app-embed");
      return () => document.documentElement.classList.remove("is-note-app-embed");
    }
    return;
  }, [embed]);

  useEffect(() => {
    if (embed || !user || !appId) return;
    let cancelled = false;
    void (async () => {
      try {
        const noteId =
          (noteQ && noteQ.trim()) ||
          (await ensureNoteForAppLink(user.uid, type, appId, title));
        if (cancelled || !noteId) return;
        if (noteQ && noteQ.trim() === noteId) return;
        const params = new URLSearchParams(
          typeof window !== "undefined" ? window.location.search : ""
        );
        params.set("note", noteId);
        params.delete("embed");
        const qs = params.toString();
        router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
      } catch {
        /* stay on specialty route if ensure fails */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [embed, user, appId, type, title, noteQ, router, pathname]);

  return { embed };
}
