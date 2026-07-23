"use client";

import {
  NodeViewWrapper,
  ReactNodeViewRenderer,
  type ReactNodeViewProps,
} from "@tiptap/react";
import React, { useState } from "react";
import type { TranscribableMedia } from "@/lib/noteMediaIngest";
import { toast } from "@/lib/toast";

export type NoteAudioTranscribeOpts = {
  forceChoice?: "transcribe" | "transcribe_summarize";
};

function guessFilename(src: string, title: string | null): string {
  const fromTitle = (title || "").trim();
  if (fromTitle && /\.\w{2,5}$/i.test(fromTitle)) return fromTitle;
  try {
    const path = decodeURIComponent(new URL(src).pathname);
    const base = path.split("/").pop() || "";
    if (base && /\.\w{2,5}$/i.test(base)) return base.replace(/^\d+_/, "");
  } catch {
    /* ignore */
  }
  return fromTitle ? `${fromTitle}.webm` : `audio-${Date.now()}.webm`;
}

async function urlToFile(src: string, filename: string): Promise<File> {
  const res = await fetch(src);
  if (!res.ok) throw new Error("無法讀取音檔，請稍後再試");
  const blob = await res.blob();
  const type = blob.type || "audio/webm";
  return new File([blob], filename, { type });
}

function NoteAudioView({ node, editor, selected }: ReactNodeViewProps) {
  const src = String(node.attrs.src || "");
  const title = (node.attrs.title as string | null) || null;
  const [busy, setBusy] = useState(false);
  const readOnly = !editor?.isEditable;

  const onTranscribe = async () => {
    if (!src || busy || readOnly) return;
    const storage = editor?.storage as {
      noteAudio?: {
        requestTranscribe?: (
          media: TranscribableMedia,
          opts?: NoteAudioTranscribeOpts
        ) => void;
      };
    };
    const request = storage?.noteAudio?.requestTranscribe;
    if (!request) {
      toast("此處無法啟動轉錄");
      return;
    }
    setBusy(true);
    try {
      const filename = guessFilename(src, title);
      const file = await urlToFile(src, filename);
      request(
        { kind: "file", file, label: title || filename },
        { forceChoice: "transcribe" }
      );
      toast("已開始 Whisper 轉錄，完成後會寫入筆記與轉錄紀錄");
    } catch (e) {
      toast(e instanceof Error ? e.message : "無法啟動轉錄");
    } finally {
      setBusy(false);
    }
  };

  return (
    <NodeViewWrapper
      className={`rich-audio-wrap${selected ? " is-selected" : ""}`}
      data-note-audio-wrap="1"
    >
      <audio
        className="rich-audio"
        data-note-audio="1"
        controls
        preload="metadata"
        src={src || undefined}
        title={title || undefined}
        draggable={false}
      />
      {!readOnly && src ? (
        <div className="rich-audio-actions" contentEditable={false}>
          <button
            type="button"
            className="btn btn-soft btn-sm rich-audio-transcribe"
            disabled={busy}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              void onTranscribe();
            }}
          >
            {busy ? "準備中…" : "轉錄成逐字稿"}
          </button>
        </div>
      ) : null}
    </NodeViewWrapper>
  );
}

export function noteAudioNodeView() {
  return ReactNodeViewRenderer(NoteAudioView);
}
