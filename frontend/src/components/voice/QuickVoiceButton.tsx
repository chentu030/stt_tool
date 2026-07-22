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
  const [busy, setBusy] = useState(false);
  const recRef = useRef<SimpleVoiceRecorder | null>(null);
  const tickRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (tickRef.current) window.clearInterval(tickRef.current);
      void recRef.current?.stop();
    };
  }, []);

  const start = async () => {
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
    const rec = recRef.current;
    recRef.current = null;
    if (!rec) return;
    setBusy(true);
    try {
      const blob = await rec.stop();
      if (!blob) {
        toast("錄音太短，請再試一次");
        return;
      }
      toast("辨識中…");
      const transcript = await transcribeWithGoogle(blob, {
        language,
        filename: `quick-${Date.now()}.${rec.extension}`,
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
      const noteId = await createNote(uid, title, "", undefined, ["quick-voice", "journal"], {
        folder: "日誌/快速錄音",
        journal_date: dateKey,
        icon: "mic",
      });
      const file = new File([blob], `quick-${Date.now()}.${rec.extension}`, {
        type: blob.type || "audio/webm",
      });
      const up = await uploadNoteMedia(uid, noteId, file);
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
      onAppendJournal?.(journalBlock);
      onCreatedNote?.(noteId);
      toast("已整理成快速筆記");
    } catch (e) {
      toast(e instanceof Error ? e.message : "快速錄音失敗");
    } finally {
      setBusy(false);
      setSecs(0);
    }
  };

  if (compact) {
    return (
      <button
        type="button"
        className={`voice-quick-btn${recording ? " is-live" : ""}`}
        disabled={busy}
        title="快速錄音想法"
        onClick={() => void (recording ? stop() : start())}
      >
        {busy ? "整理中…" : recording ? `停止 ${formatRecClock(secs)}` : "快速錄音"}
      </button>
    );
  }

  return (
    <div className="voice-quick-card">
      <div>
        <strong>快速錄音想法</strong>
        <p>想到什麼就說；停下來後會自動整理進日誌，並保留音檔。</p>
      </div>
      <button
        type="button"
        className={`btn${recording ? " voice-quick-stop" : ""}`}
        disabled={busy}
        onClick={() => void (recording ? stop() : start())}
      >
        {busy ? "整理中…" : recording ? `停止 ${formatRecClock(secs)}` : "按住想法 · 開始錄"}
      </button>
    </div>
  );
}
