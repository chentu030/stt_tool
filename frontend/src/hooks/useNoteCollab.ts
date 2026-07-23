"use client";

import { useCallback, useEffect, useEffectEvent, useState } from "react";
import {
  BODY_SNAPSHOT_MS,
  FirestoreYjsProvider,
  collabUserFromAuth,
  snapshotCollabBody,
  type CollabSyncStatus,
} from "@/lib/noteCollab";

type Opts = {
  noteId: string | undefined;
  uid: string | undefined;
  displayName?: string | null;
  enabled: boolean;
  canWrite: boolean;
  seedMarkdown: string;
  seedTitle: string;
  /** Export current editor markdown (from RichNoteEditor callback / ref). */
  getBodyMd: () => string;
  onTitleRemote?: (title: string) => void;
};

export function useNoteCollab(opts: Opts) {
  const {
    noteId,
    uid,
    displayName,
    enabled,
    canWrite,
    seedMarkdown,
    seedTitle,
    getBodyMd,
    onTitleRemote,
  } = opts;

  const [provider, setProvider] = useState<FirestoreYjsProvider | null>(null);
  const [status, setStatus] = useState<CollabSyncStatus>("connecting");
  const [ready, setReady] = useState(false);

  const onTitleRemoteEvent = useEffectEvent((t: string) => {
    onTitleRemote?.(t);
  });
  const getBodyEvent = useEffectEvent(() => getBodyMd());
  const getTitleEvent = useEffectEvent(() => seedTitle);

  useEffect(() => {
    if (!enabled || !noteId || !uid) {
      // Reset when leaving collab mode (note change / logout).
      // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional provider teardown
      setProvider(null);
      setReady(false);
      setStatus("connecting");
      return;
    }

    let cancelled = false;
    let versionAt = 0;
    let lastSnapBody = seedMarkdown;
    const p = new FirestoreYjsProvider({
      noteId,
      user: collabUserFromAuth(uid, displayName),
      seedMarkdown,
      canWrite,
      onStatus: (s) => {
        if (!cancelled) setStatus(s);
      },
      onTitleRemote: (t) => onTitleRemoteEvent(t),
    });

    void (async () => {
      try {
        await p.connect();
        if (cancelled) {
          await p.destroy();
          return;
        }
        if (seedTitle) p.setTitleLocal(seedTitle);
        setProvider(p);
        setReady(true);
      } catch {
        if (!cancelled) {
          setStatus("error");
          setReady(false);
          setProvider(null);
        }
      }
    })();

    const snapTimer = window.setInterval(() => {
      if (!canWrite || cancelled) return;
      const body = getBodyEvent();
      const title = getTitleEvent();
      const prevBody = lastSnapBody;
      if (body === prevBody) return;
      lastSnapBody = body;
      void snapshotCollabBody({
        noteId,
        title,
        bodyMd: body,
        previousBody: prevBody,
        previousTitle: title,
        lastVersionAt: versionAt,
      }).then((r) => {
        if (r.writtenVersion && r.at) versionAt = r.at;
      });
    }, BODY_SNAPSHOT_MS);

    return () => {
      cancelled = true;
      window.clearInterval(snapTimer);
      setReady(false);
      setProvider(null);
      void p.destroy();
    };
    // Reconnect only when note / auth / write mode changes — not on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, noteId, uid, canWrite, displayName]);

  const setTitle = useCallback(
    (title: string) => {
      provider?.setTitleLocal(title);
    },
    [provider]
  );

  return { provider, status, ready, setTitle };
}
