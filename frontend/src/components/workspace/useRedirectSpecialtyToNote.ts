"use client";

import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import {
  ensureNoteForAppLink,
  type NoteAppLinkType,
} from "@/lib/workspacePages";

/** When not iframe-embedded, send specialty routes to their note shell. */
export function useRedirectSpecialtyToNote(
  type: Exclude<NoteAppLinkType, "web">,
  appId: string | undefined,
  title?: string
) {
  const { user } = useAuth();
  const router = useRouter();
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
        router.replace(`/notes/${noteId}`);
      } catch {
        /* stay on specialty route if ensure fails */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [embed, user, appId, type, title, noteQ, router]);

  return { embed };
}
