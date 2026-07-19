"use client";

/** Discussion panel for a single text selection ("block") within a note. */

import { useEffect, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import {
  ensureThread,
  listenThreadMessages,
  sendThreadMessage,
  resolveThread,
  listenThread,
  type Thread,
  type ThreadMessage,
} from "@/lib/noteThreads";

type Props = {
  noteId: string;
  selectionText: string;
  onClose: () => void;
};

export default function BlockThreadPanel({ noteId, selectionText, onClose }: Props) {
  const { user } = useAuth();
  const [threadId, setThreadId] = useState<string | null>(null);
  const [thread, setThread] = useState<Thread | null>(null);
  const [messages, setMessages] = useState<ThreadMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!noteId || !user) return;
    let cancelled = false;
    void ensureThread(noteId, selectionText, user.uid).then((id) => {
      if (!cancelled) setThreadId(id);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noteId, selectionText, user?.uid]);

  useEffect(() => {
    if (!noteId || !threadId) return;
    const u1 = listenThread(noteId, threadId, setThread);
    const u2 = listenThreadMessages(noteId, threadId, setMessages);
    return () => {
      u1();
      u2();
    };
  }, [noteId, threadId]);

  const send = async () => {
    if (!user || !threadId || !draft.trim() || busy) return;
    setBusy(true);
    try {
      await sendThreadMessage(noteId, threadId, {
        author_id: user.uid,
        author_name: user.displayName || "",
        text: draft.trim(),
      });
      setDraft("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="block-thread tm-noise" role="dialog" aria-label="討論串">
      <div className="block-thread-head">
        <strong>討論</strong>
        <div className="block-thread-head-actions">
          {threadId && (
            <button
              type="button"
              className="doc-cmd"
              onClick={() => void resolveThread(noteId, threadId, !thread?.resolved)}
            >
              {thread?.resolved ? "重新開啟" : "標記已解決"}
            </button>
          )}
          <button type="button" className="doc-cmd" onClick={onClose}>關閉</button>
        </div>
      </div>

      {selectionText && (
        <blockquote className="block-thread-selection">「{selectionText.slice(0, 200)}」</blockquote>
      )}

      <div className="block-thread-messages">
        {messages.length === 0 ? (
          <p className="note-aside-empty">尚無討論，留下第一則留言吧。</p>
        ) : (
          messages.map((m) => (
            <div key={m.id} className="block-thread-msg">
              <span className="block-thread-msg-author">{m.author_name || "匿名"}</span>
              <span className="block-thread-msg-text">{m.text}</span>
              <span className="block-thread-msg-time">
                {m.created_at.toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit" })}
              </span>
            </div>
          ))
        )}
      </div>

      <div className="block-thread-composer">
        <input
          className="input"
          placeholder="留言…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void send();
            }
          }}
        />
        <button type="button" className="btn btn-sm" disabled={busy || !draft.trim()} onClick={() => void send()}>
          送出
        </button>
      </div>
    </div>
  );
}
