"use client";

/** Reactions + "已閱" (read) strip shown at the top of a note page. */

import { useEffect, useMemo, useState } from "react";
import {
  collection,
  doc,
  setDoc,
  deleteDoc,
  onSnapshot,
  Timestamp,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/components/AuthProvider";
import { colorForUid } from "@/lib/presence";
import NoteCoverPickerDialog from "@/components/notes/NoteCoverPickerDialog";
import { isDefaultNoteCover } from "@/lib/noteCover";
import { pushRecentCover } from "@/lib/recentCovers";

type LogEntry = {
  id: string;
  uid: string;
  name: string;
  kind: "read" | "reaction";
  emoji?: string;
  created_at: Date;
};

const REACTIONS = ["👍", "❤️", "🎉", "💡", "👏"];

function pageLogCol(noteId: string) {
  return collection(db, "notes", noteId, "page_log");
}

type CoverProps = {
  cover: string;
  onCoverChange: (v: string) => void;
  userId?: string;
  readOnly?: boolean;
};

export default function NotePageLog({
  noteId,
  cover,
}: {
  noteId: string;
  /** When set, show「加封面」/「更換封面」to the right of 已閱. */
  cover?: CoverProps | null;
}) {
  const { user, displayName } = useAuth();
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);

  useEffect(() => {
    if (!noteId) return;
    return onSnapshot(
      pageLogCol(noteId),
      (snap) => {
        setEntries(
          snap.docs.map((d) => {
            const data = d.data();
            return {
              id: d.id,
              uid: String(data.uid || ""),
              name: String(data.name || "訪客"),
              kind: (data.kind as LogEntry["kind"]) || "read",
              emoji: data.emoji ? String(data.emoji) : undefined,
              created_at: data.created_at?.toDate?.() || new Date(),
            };
          })
        );
      },
      (err) => console.error("[NotePageLog]", err)
    );
  }, [noteId]);

  const readers = useMemo(() => entries.filter((e) => e.kind === "read"), [entries]);
  const reactions = useMemo(() => entries.filter((e) => e.kind === "reaction"), [entries]);
  const myRead = readers.some((e) => e.uid === user?.uid);
  const myReaction = reactions.find((e) => e.uid === user?.uid)?.emoji;

  const reactionCounts = useMemo(() => {
    const map = new Map<string, number>();
    reactions.forEach((r) => {
      if (!r.emoji) return;
      map.set(r.emoji, (map.get(r.emoji) || 0) + 1);
    });
    return map;
  }, [reactions]);

  useEffect(() => {
    if (!noteId || !user || myRead) return;
    void setDoc(doc(pageLogCol(noteId), `read_${user.uid}`), {
      uid: user.uid,
      name: displayName || "訪客",
      kind: "read",
      created_at: Timestamp.now(),
    }).catch(() => undefined);
  }, [noteId, user, myRead, displayName]);

  const toggleReaction = async (emoji: string) => {
    if (!user) return;
    const ref = doc(pageLogCol(noteId), `react_${user.uid}`);
    try {
      if (myReaction === emoji) {
        await deleteDoc(ref);
        return;
      }
      await setDoc(ref, {
        uid: user.uid,
        name: displayName || "訪客",
        kind: "reaction",
        emoji,
        created_at: Timestamp.now(),
      });
    } catch (err) {
      console.error("[NotePageLog] toggleReaction", err);
    }
  };

  if (!noteId) return null;

  const coverUrl = cover?.cover || "";
  const showCoverBtn = !!cover && !cover.readOnly;
  const applyCover = (next: string) => {
    if (!cover) return;
    const trimmed = (next || "").trim();
    if (trimmed && cover.userId && !isDefaultNoteCover(trimmed)) {
      pushRecentCover(cover.userId, trimmed);
    }
    cover.onCoverChange(trimmed);
  };

  return (
    <div className="note-page-log">
      <div className="note-page-log-reactions tm-noise">
        {REACTIONS.map((emoji) => {
          const count = reactionCounts.get(emoji) || 0;
          return (
            <button
              key={emoji}
              type="button"
              className={`note-page-log-react${myReaction === emoji ? " is-on" : ""}`}
              onClick={() => void toggleReaction(emoji)}
            >
              <span>{emoji}</span>
              {count > 0 && <span className="note-page-log-count">{count}</span>}
            </button>
          );
        })}
      </div>
      <div className="note-page-log-trailing">
        {readers.length > 0 ? (
          <div
            className="note-page-log-readers tm-noise"
            title={readers.map((r) => r.name).join("、")}
          >
            {readers.slice(0, 6).map((r) => (
              <span
                key={r.id}
                className="note-page-log-avatar"
                style={{ background: colorForUid(r.uid) }}
              >
                {(r.name || "?").slice(0, 1)}
              </span>
            ))}
            <span className="note-page-log-readers-label">{readers.length} 人已閱</span>
          </div>
        ) : null}
        {showCoverBtn ? (
          <div className="note-page-log-cover">
            <button
              type="button"
              className="note-page-log-cover-btn"
              onClick={() => setPickerOpen(true)}
            >
              {coverUrl ? "更換封面" : "加封面"}
            </button>
            {coverUrl ? (
              <button
                type="button"
                className="note-page-log-cover-btn note-page-log-cover-btn--quiet"
                onClick={() => applyCover("")}
              >
                移除
              </button>
            ) : null}
            <NoteCoverPickerDialog
              open={pickerOpen}
              title={coverUrl ? "更換封面" : "加封面"}
              currentCover={coverUrl}
              userId={cover?.userId}
              noteId={noteId}
              onClose={() => setPickerOpen(false)}
              onApply={applyCover}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}
