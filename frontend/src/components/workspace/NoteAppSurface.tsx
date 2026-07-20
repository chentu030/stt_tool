"use client";

import DatabaseView from "@/components/database/DatabaseView";
import WebPageView from "@/components/workspace/WebPageView";
import { noteAppEmbedHref, type NoteAppLink } from "@/lib/workspacePages";
import type { Note } from "@/lib/firebase";

type Props = {
  note: Note;
  userId: string;
  compact?: boolean;
  onTitleHint?: (title: string) => void;
};

/** Renders specialty workspace surfaces inside a note page / embed. */
export default function NoteAppSurface({ note, userId, compact, onTitleHint }: Props) {
  const link = note.app_link as NoteAppLink | undefined;
  if (!link?.type || !link.id) return null;

  if (link.type === "web") {
    return <WebPageView note={note} compact={compact} onTitleHint={onTitleHint} />;
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
