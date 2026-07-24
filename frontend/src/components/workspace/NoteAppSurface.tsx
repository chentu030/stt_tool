"use client";

import { useEffect, useMemo, useRef } from "react";
import DatabaseView from "@/components/database/DatabaseView";
import WebPageView from "@/components/workspace/WebPageView";
import {
  extensionEntryFromNote,
  noteAppEmbedHref,
  webUrlFromNote,
  type NoteAppLink,
} from "@/lib/workspacePages";
import type { Note } from "@/lib/firebase";
import { useCommunityOptional } from "@/components/community/CommunityProvider";
import {
  buildExtensionFrameUrl,
  mergeExtensionSettings,
} from "@/lib/community/extensionSettings";
import { effectivePermissions } from "@/lib/community/permissions";
import {
  handleNotesRpcRequest,
  isNotesRpcRequest,
  originFromFrameUrl,
} from "@/lib/community/notesRpc";
import { useAuth } from "@/components/AuthProvider";

type Props = {
  note: Note;
  userId: string;
  compact?: boolean;
  onTitleHint?: (title: string) => void;
};

function vocabListenBackend(): string {
  const raw =
    (process.env.NEXT_PUBLIC_VOCAB_LISTEN_BACKEND || "").trim() ||
    (process.env.NEXT_PUBLIC_API_BASE || "").trim();
  return raw.replace(/^http:\/\//i, "https://").replace(/\/$/, "");
}

/** Renders specialty workspace surfaces inside a note page / embed. */
export default function NoteAppSurface({ note, userId, compact, onTitleHint }: Props) {
  const community = useCommunityOptional();
  const { user } = useAuth();
  const frameRef = useRef<HTMLIFrameElement>(null);
  const link = note.app_link as NoteAppLink | undefined;

  const installed = useMemo(() => {
    if (!link || link.type !== "extension") return null;
    return community?.enabledExtensions.find((e) => e.id === link.id) || null;
  }, [community?.enabledExtensions, link]);

  const settings = useMemo(() => {
    if (!installed) return {};
    return mergeExtensionSettings(installed.manifest, installed.settings);
  }, [installed]);

  const frameSrc = useMemo(() => {
    if (!link || link.type !== "extension") return "";
    const fromProps = extensionEntryFromNote(note);
    const entry = fromProps || installed?.manifest.pageType.entry || "";
    if (!entry) return "";
    return buildExtensionFrameUrl(entry, note.id, settings);
  }, [link, note, installed, settings]);

  useEffect(() => {
    if (!frameSrc || !installed) return;
    const entryOrigin = originFromFrameUrl(frameSrc);
    const payload = {
      type: "albireus:settings",
      noteId: note.id,
      extensionId: installed.id,
      settings,
    };
    const post = () => {
      try {
        frameRef.current?.contentWindow?.postMessage(payload, entryOrigin || "*");
      } catch {
        /* ignore */
      }
    };
    const t = window.setTimeout(post, 400);
    return () => window.clearTimeout(t);
  }, [frameSrc, installed, note.id, settings]);

  useEffect(() => {
    if (!frameSrc || !installed) return;
    let cancelled = false;
    const entryOrigin = originFromFrameUrl(frameSrc);
    const postAuth = async () => {
      try {
        const token = user ? await user.getIdToken() : "";
        if (cancelled) return;
        frameRef.current?.contentWindow?.postMessage(
          {
            type: "albireus:auth",
            token,
            email: user?.email || "",
            uid: user?.uid || "",
            apiBase: (process.env.NEXT_PUBLIC_API_BASE || "").replace(/\/$/, ""),
            listenBackend: vocabListenBackend(),
          },
          entryOrigin || "*"
        );
      } catch {
        /* ignore */
      }
    };
    const t = window.setTimeout(() => void postAuth(), 500);
    const onMsg = (e: MessageEvent) => {
      if (e.data?.type === "albireus:auth-request") void postAuth();
    };
    window.addEventListener("message", onMsg);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
      window.removeEventListener("message", onMsg);
    };
  }, [frameSrc, installed, user]);

  useEffect(() => {
    if (!frameSrc || !installed) return;
    const entryOrigin = originFromFrameUrl(frameSrc);
    if (!entryOrigin) return;
    const permissions = effectivePermissions(installed.manifest);
    const onMsg = (e: MessageEvent) => {
      if (!isNotesRpcRequest(e.data)) return;
      if (e.source !== frameRef.current?.contentWindow) return;
      if (e.origin !== entryOrigin) return;
      void handleNotesRpcRequest(e.data, {
        uid: user?.uid || "",
        permissions,
      }).then((reply) => {
        if (!reply) return;
        try {
          frameRef.current?.contentWindow?.postMessage(reply, entryOrigin);
        } catch {
          /* ignore */
        }
      });
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, [frameSrc, installed, user?.uid]);

  if (!link?.type || !link.id) return null;

  if (link.type === "web") {
    return <WebPageView note={note} compact={compact} onTitleHint={onTitleHint} />;
  }

  if (link.type === "extension") {
    // web-browser-pack: always navigable (even if installed manifest predates the flag)
    const navigable =
      Boolean(installed?.manifest.pageType.navigable) || link.id === "web-browser-pack";
    if (navigable) {
      const url =
        webUrlFromNote(note) ||
        extensionEntryFromNote(note) ||
        installed?.manifest.pageType.entry ||
        "";
      const browserNote: Note = {
        ...note,
        app_link: { type: "web", id: note.id },
        props: {
          ...(note.props || {}),
          web_url: url,
        },
      };
      return (
        <WebPageView
          note={browserNote}
          compact={compact || Boolean(settings.compact)}
          onTitleHint={onTitleHint}
        />
      );
    }
    if (!frameSrc) {
      return (
        <div className="web-page-blocked">
          <p>找不到此擴充頁面的入口（可能已解除安裝）。</p>
          <a className="btn" href="/community">
            前往社群商店
          </a>
        </div>
      );
    }
    return (
      <div className={`note-app-surface note-app-surface--frame${compact ? " is-compact" : ""}`}>
        <iframe
          ref={frameRef}
          className="note-app-frame"
          src={frameSrc}
          title={note.title || "擴充頁面"}
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
          referrerPolicy="no-referrer-when-downgrade"
          allow="clipboard-read; clipboard-write"
          onLoad={() => {
            const entryOrigin = originFromFrameUrl(frameSrc);
            try {
              frameRef.current?.contentWindow?.postMessage(
                {
                  type: "albireus:settings",
                  noteId: note.id,
                  extensionId: installed?.id,
                  settings,
                },
                entryOrigin || "*"
              );
              frameRef.current?.contentWindow?.postMessage(
                { type: "albireus:auth-request" },
                entryOrigin || "*"
              );
            } catch {
              /* ignore */
            }
          }}
        />
      </div>
    );
  }

  if (link.type === "database") {
    return (
      <div className={`note-app-surface${compact ? " is-compact" : ""}`}>
        <DatabaseView databaseId={link.id} userId={userId} compact={compact} />
      </div>
    );
  }

  const href = noteAppEmbedHref(link, note.id);
  if (!href) return null;

  return (
    <div className={`note-app-surface note-app-surface--frame${compact ? " is-compact" : ""}`}>
      <iframe
        className="note-app-frame"
        src={href}
        title={note.title || link.type}
        allow="clipboard-read; clipboard-write"
      />
    </div>
  );
}
