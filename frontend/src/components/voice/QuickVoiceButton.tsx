"use client";

import { useEffect, useRef, useState } from "react";
import { createNote, uploadNoteMedia } from "@/lib/firebase";
import { organizeQuickVoice, transcribeWithGoogle } from "@/lib/googleStt";
import { formatRecClock, SimpleVoiceRecorder } from "@/lib/voiceSession";
import { toast } from "@/lib/toast";
import { usePrefsOptional } from "@/components/PrefsProvider";
import { journalTitle } from "@/lib/templates";

type Props = {
  uid: string;
  /** Append markdown into today's journal composer / note body */
  onAppendJournal?: (md: string) => void;
  /** Called with created quick-idea note id */
  onCreatedNote?: (noteId: string) => void;
  compact?: boolean;
};

export default function QuickVoiceButton({
  uid,
  onAppendJournal,
  onCreatedNote,
  compact,
}: Props) {
  const prefs = usePrefsOptional()?.prefs;
  const language = prefs?.captureLanguage || "zh-TW";
  const [recording, setRecording] = useState(false);
  const [secs, setSecs] = useState(0);
  const [pending, setPending] = useState(0);
  const recRef = useRef<SimpleVoiceRecorder | null>(null);
  const tickRef = useRef<number | null>(null);
  const queueRef = useRef<Promise<void>>(Promise.resolve());
  const languageRef = useRef(language);
  const cbRef = useRef({ uid, onAppendJournal, onCreatedNote });

  languageRef.current = language;
  cbRef.current = { uid, onAppendJournal, onCreatedNote };

  useEffect(() => {
    return () => {
      if (tickRef.current) window.clearInterval(tickRef.current);
      void recRef.current?.stop();
    };
  }, []);

  const processClip = async (blob: Blob, ext: string) => {
    setPending((n) => n + 1);
    try {
      const { uid: id, onAppendJournal: append, onCreatedNote: created } = cbRef.current;
      const transcript = await transcribeWithGoogle(blob, {
        language: languageRef.current,
        filename: `quick-${Date.now()}.${ext}`,
      });
      let title = "快速想法";
      let body = transcript;
      try {
        const org = await organizeQuickVoice(transcript);
        title = org.title;
        body = org.body;
      } catch {
        /* keep raw */
      }
      const dateKey = journalTitle();
      const noteId = await createNote(id, title, "", undefined, ["quick-voice", "journal"], {
        folder: "日誌/快速錄音",
        journal_date: dateKey,
        icon: "mic",
      });
      const file = new File([blob], `quick-${Date.now()}.${ext}`, {
        type: blob.type || "audio/webm",
      });
      const up = await uploadNoteMedia(id, noteId, file);
      const md = [
        body,
        ``,
        `<audio class="rich-audio" data-note-audio="1" controls preload="metadata" src="${up.url}" title="${file.name}"></audio>`,
        ``,
        `> 原始口述：${transcript}`,
      ].join("\n");
      const { updateNote } = await import("@/lib/firebase");
      await updateNote(noteId, { body_md: md });

      const journalBlock = [
        ``,
        `### ${title} · 快速錄音`,
        ``,
        body,
        ``,
        `<audio class="rich-audio" data-note-audio="1" controls preload="metadata" src="${up.url}"></audio>`,
        ``,
      ].join("\n");
      append?.(journalBlock);
      created?.(noteId);
      toast(`已整理「${title}」`);
    } catch (e) {
      toast(e instanceof Error ? e.message : "快速錄音失敗");
    } finally {
      setPending((n) => Math.max(0, n - 1));
    }
  };

  const enqueueClip = (blob: Blob, ext: string) => {
    queueRef.current = queueRef.current
      .then(() => processClip(blob, ext))
      .catch(() => {
        /* errors toasted inside processClip */
      });
  };

  const start = async () => {
    if (recording) return;
    try {
      const rec = new SimpleVoiceRecorder();
      await rec.start();
      recRef.current = rec;
      setRecording(true);
      setSecs(0);
      tickRef.current = window.setInterval(() => setSecs((s) => s + 1), 1000);
    } catch {
      toast("無法使用麥克風，請檢查權限");
    }
  };

  const stop = async () => {
    if (tickRef.current) {
      window.clearInterval(tickRef.current);
      tickRef.current = null;
    }
    setRecording(false);
    setSecs(0);
    const rec = recRef.current;
    recRef.current = null;
    if (!rec) return;
    try {
      const blob = await rec.stop();
      if (!blob) {
        toast("錄音太短，請再試一次");
        return;
      }
      toast("已收下 · 可立刻接下一段");
      enqueueClip(blob, rec.extension || "webm");
    } catch (e) {
      toast(e instanceof Error ? e.message : "錄音失敗");
    }
  };

  const pendingHint = pending > 0 ? ` · 整理中 ${pending}` : "";

  if (compact) {
    return (
      <button
        type="button"
        className={`voice-quick-btn${recording ? " is-live" : ""}${pending ? " is-pending" : ""}`}
        title={
          recording
            ? "停止並送出這段"
            : pending
              ? `背景整理 ${pending} 段 · 可繼續錄`
              : "快速錄音想法（停下後可立刻再錄）"
        }
        onClick={() => void (recording ? stop() : start())}
      >
        {recording ? `停止 ${formatRecClock(secs)}` : `快速錄音${pending ? ` · ${pending}` : ""}`}
      </button>
    );
  }

  return (
    <div className="voice-quick-card">
      <div>
        <strong>快速錄音想法</strong>
        <p>
          想到什麼就說；停下後可立刻接下一段，背景會自動整理進日誌並保留音檔
          {pendingHint}。
        </p>
      </div>
      <button
        type="button"
        className={`btn${recording ? " voice-quick-stop" : ""}`}
        onClick={() => void (recording ? stop() : start())}
      >
        {recording
          ? `停止 ${formatRecClock(secs)}`
          : pending
            ? `再錄一段（整理中 ${pending}）`
            : "按住想法 · 開始錄"}
      </button>
    </div>
  );
}
