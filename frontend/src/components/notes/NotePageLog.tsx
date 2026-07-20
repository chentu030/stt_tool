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

export default function NotePageLog({ noteId }: { noteId: string }) {
  const { user, displayName } = useAuth();
  const [entries, setEntries] = useState<LogEntry[]>([]);

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
    if (myReaction === emoji) {
      await deleteDoc(ref).catch(() => undefined);
      return;
    }
    await setDoc(ref, {
      uid: user.uid,
      name: displayName || "訪客",
      kind: "reaction",
      emoji,
      created_at: Timestamp.now(),
    });
  };

  if (!noteId) return null;

  return (
    <div className="note-page-log tm-noise">
      <div className="note-page-log-reactions">
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
      {readers.length > 0 && (
        <div className="note-page-log-readers" title={readers.map((r) => r.name).join("、")}>
          {readers.slice(0, 6).map((r) => (
            <span key={r.id} className="note-page-log-avatar" style={{ background: colorForUid(r.uid) }}>
              {(r.name || "?").slice(0, 1)}
            </span>
          ))}
          <span className="note-page-log-readers-label">{readers.length} 人已閱</span>
        </div>
      )}
    </div>
  );
}
