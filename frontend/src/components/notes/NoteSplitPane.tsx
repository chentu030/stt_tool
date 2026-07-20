"use client";

import PageLoading from "@/components/motion/PageLoading";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { getNote, updateNote } from "@/lib/firebase";
import RichNoteEditor from "@/components/RichNoteEditor";
import { useNoteTabsOptional } from "@/components/notes/NoteTabsProvider";

type Props = {
  noteId: string;
  onClose: () => void;
};

/** Compact secondary editor for side-by-side note view */
export default function NoteSplitPane({ noteId, onClose }: Props) {
  const tabs = useNoteTabsOptional();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [icon, setIcon] = useState("");
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState<"idle" | "dirty" | "saving" | "saved">("idle");
  const dirty = useRef(false);
  const titleRef = useRef(title);
  const bodyRef = useRef(body);
  titleRef.current = title;
  bodyRef.current = body;

  useEffect(() => {
    let cancelled = false;
    setReady(false);
    setError("");
    dirty.current = false;
    void (async () => {
      try {
        const n = await getNote(noteId);
        if (cancelled) return;
        if (!n) {
          setError("找不到筆記");
          return;
        }
        setTitle(n.title || "");
        setBody(n.body_md || "");
        setIcon(n.icon || "");
        setReady(true);
        setStatus("idle");
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "載入失敗");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [noteId]);

  useEffect(() => {
    if (!ready || !dirty.current) return;
    setStatus("dirty");
    const t = window.setTimeout(() => {
      setStatus("saving");
      void updateNote(noteId, {
        title: titleRef.current,
        body_md: bodyRef.current,
      })
        .then(() => {
          dirty.current = false;
          setStatus("saved");
        })
        .catch(() => setStatus("idle"));
    }, 700);
    return () => window.clearTimeout(t);
  }, [title, body, ready, noteId]);

  const markDirty = () => {
    dirty.current = true;
    setStatus("dirty");
  };

  return (
    <div className="note-split-pane">
      <div className="note-split-head">
        <Link href={`/notes/${noteId}`} className="note-split-title" title="設為主要分頁">
          {icon ? `${icon} ` : ""}
          {title || "未命名"}
        </Link>
        <span className="note-split-status">
          {status === "saving" ? "儲存中" : status === "saved" ? "已存" : status === "dirty" ? "未存" : ""}
        </span>
        <button
          type="button"
          className="note-split-swap"
          title="與左側對調"
          onClick={() => tabs?.activate(noteId)}
        >
          ⇄
        </button>
        <button type="button" className="note-split-close" onClick={onClose} title="關閉並排">
          ×
        </button>
      </div>
      {error ? (
        <p className="note-split-error">{error}</p>
      ) : !ready ? (
        <PageLoading fill={false} />
      ) : (
        <>
          <input
            className="note-split-title-input"
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
              markDirty();
            }}
            placeholder="標題"
          />
          <div className="note-split-editor">
            <RichNoteEditor
              key={noteId}
              valueMd={body}
              onChangeMd={(md) => {
                setBody(md);
                markDirty();
              }}
              noteId={noteId}
              placeholder="並排編輯…"
            />
          </div>
        </>
      )}
    </div>
  );
}
