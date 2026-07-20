"use client";

import DatabaseView from "@/components/database/DatabaseView";
import WebPageView from "@/components/workspace/WebPageView";
import {
  extensionEntryFromNote,
  noteAppEmbedHref,
  type NoteAppLink,
} from "@/lib/workspacePages";
import type { Note } from "@/lib/firebase";
import { useCommunityOptional } from "@/components/community/CommunityProvider";

type Props = {
  note: Note;
  userId: string;
  compact?: boolean;
  onTitleHint?: (title: string) => void;
};

function withNoteQuery(entry: string, noteId: string): string {
  try {
    const u = new URL(entry);
    u.searchParams.set("note", noteId);
    u.searchParams.set("albireus", "1");
    return u.toString();
  } catch {
    const sep = entry.includes("?") ? "&" : "?";
    return `${entry}${sep}note=${encodeURIComponent(noteId)}&albireus=1`;
  }
}

/** Renders specialty workspace surfaces inside a note page / embed. */
export default function NoteAppSurface({ note, userId, compact, onTitleHint }: Props) {
  const community = useCommunityOptional();
  const link = note.app_link as NoteAppLink | undefined;
  if (!link?.type || !link.id) return null;

  if (link.type === "web") {
    return <WebPageView note={note} compact={compact} onTitleHint={onTitleHint} />;
  }

  if (link.type === "extension") {
    const fromProps = extensionEntryFromNote(note);
    const fromInstall = community?.enabledExtensions.find((e) => e.id === link.id)?.manifest
      .pageType.entry;
    const entry = fromProps || fromInstall || "";
    if (!entry) {
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
          className="note-app-frame"
          src={withNoteQuery(entry, note.id)}
          title={note.title || "擴充頁面"}
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
          referrerPolicy="no-referrer-when-downgrade"
          allow="clipboard-read; clipboard-write"
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
