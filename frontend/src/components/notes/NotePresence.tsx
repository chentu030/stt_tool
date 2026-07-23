"use client";

/** Avatar stack + remote mouse cursors scoped to the note page surface (not app chrome). */

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useAuth } from "@/components/AuthProvider";
import { listenPresence, startPresenceHeartbeat, type PresenceUser } from "@/lib/presence";

type Props = {
  noteId: string;
  /**
   * CSS selector for the note content surface (excludes top ribbon / command chrome).
   * Defaults to `.doc-page` (owner note) or `.share-doc` (share link).
   */
  surfaceSelector?: string;
};

const DEFAULT_SURFACE = ".doc-page, .share-doc";

function resolveSurface(selector: string): HTMLElement | null {
  if (typeof document === "undefined") return null;
  return document.querySelector(selector) as HTMLElement | null;
}

/** Mouse position relative to the note page box (not the viewport chrome). */
function toSurfacePoint(clientX: number, clientY: number, surface: HTMLElement) {
  const rect = surface.getBoundingClientRect();
  return {
    x: clientX - rect.left,
    y: clientY - rect.top,
  };
}

export default function NotePresence({ noteId, surfaceSelector = DEFAULT_SURFACE }: Props) {
  const { user, displayName } = useAuth();
  const [users, setUsers] = useState<PresenceUser[]>([]);
  const [surfaceEl, setSurfaceEl] = useState<HTMLElement | null>(null);
  const mouseRef = useRef({ x: 0, y: 0, onSurface: false });

  useLayoutEffect(() => {
    const sync = () => setSurfaceEl(resolveSurface(surfaceSelector));
    sync();
    const t = window.setInterval(sync, 800);
    return () => window.clearInterval(t);
  }, [surfaceSelector, noteId]);

  useEffect(() => {
    if (!noteId) return;
    return listenPresence(noteId, setUsers);
  }, [noteId]);

  useEffect(() => {
    if (!noteId || !user) return;

    const onMove = (e: MouseEvent) => {
      const surface = resolveSurface(surfaceSelector);
      if (!surface) {
        mouseRef.current = { x: e.clientX, y: e.clientY, onSurface: false };
        return;
      }
      const rect = surface.getBoundingClientRect();
      const onSurface =
        e.clientX >= rect.left &&
        e.clientX <= rect.right &&
        e.clientY >= rect.top &&
        e.clientY <= rect.bottom;
      if (!onSurface) {
        mouseRef.current = { ...mouseRef.current, onSurface: false };
        return;
      }
      const pt = toSurfacePoint(e.clientX, e.clientY, surface);
      mouseRef.current = { x: pt.x, y: pt.y, onSurface: true };
    };

    window.addEventListener("mousemove", onMove, { passive: true });
    const stop = startPresenceHeartbeat(noteId, user.uid, () => {
      const m = mouseRef.current;
      // Keep last on-surface point so remote still sees where we were in the note.
      return {
        x: m.x,
        y: m.y,
        name: displayName || "訪客",
      };
    });
    return () => {
      window.removeEventListener("mousemove", onMove);
      stop();
    };
  }, [noteId, user, displayName, surfaceSelector]);

  const others = users.filter((u) => u.uid !== user?.uid);

  const cursors =
    surfaceEl &&
    others.length > 0 &&
    createPortal(
      <div className="note-presence-layer" aria-hidden>
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
      </div>,
      surfaceEl
    );

  if (others.length === 0) return null;

  return (
    <>
      <div className="note-presence tm-noise" title={others.map((u) => u.name).join("、")}>
        {others.slice(0, 5).map((u) => (
          <span key={u.uid} className="note-presence-avatar" style={{ background: u.color }}>
            {(u.name || "?").slice(0, 1)}
          </span>
        ))}
        {others.length > 5 && (
          <span className="note-presence-avatar note-presence-more">+{others.length - 5}</span>
        )}
      </div>
      {cursors}
    </>
  );
}
