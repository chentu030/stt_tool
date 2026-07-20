"use client";

/** Avatar stack + colored dots showing who else is viewing a note right now. */

import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { listenPresence, startPresenceHeartbeat, type PresenceUser } from "@/lib/presence";

type Props = {
  noteId: string;
};

export default function NotePresence({ noteId }: Props) {
  const { user, displayName } = useAuth();
  const [users, setUsers] = useState<PresenceUser[]>([]);
  const mouseRef = useRef({ x: 0, y: 0 });

  useEffect(() => {
    if (!noteId) return;
    return listenPresence(noteId, setUsers);
  }, [noteId]);

  useEffect(() => {
    if (!noteId || !user) return;
    const onMove = (e: MouseEvent) => {
      mouseRef.current = { x: e.clientX, y: e.clientY };
    };
    window.addEventListener("mousemove", onMove);
    const stop = startPresenceHeartbeat(noteId, user.uid, () => ({
      x: mouseRef.current.x,
      y: mouseRef.current.y,
      name: displayName || "訪客",
    }));
    return () => {
      window.removeEventListener("mousemove", onMove);
      stop();
    };
  }, [noteId, user, displayName]);

  const others = users.filter((u) => u.uid !== user?.uid);
  if (others.length === 0) return null;

  return (
    <div className="note-presence tm-noise" title={others.map((u) => u.name).join("、")}>
      {others.slice(0, 5).map((u) => (
        <span
          key={u.uid}
          className="note-presence-avatar"
          style={{ background: u.color }}
        >
          {(u.name || "?").slice(0, 1)}
        </span>
      ))}
      {others.length > 5 && (
        <span className="note-presence-avatar note-presence-more">+{others.length - 5}</span>
      )}
      {others.map((u) => (
        <span
          key={`dot_${u.uid}`}
          className="note-presence-cursor"
          style={{ left: u.x, top: u.y, borderColor: u.color }}
        >
          <span className="note-presence-cursor-label" style={{ background: u.color }}>
            {u.name}
          </span>
        </span>
      ))}
    </div>
  );
}
