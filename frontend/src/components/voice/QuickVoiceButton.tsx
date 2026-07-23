"use client";

import { useEffect, useRef, useState } from "react";
import { formatRecClock, SimpleVoiceRecorder } from "@/lib/voiceSession";
import { toast } from "@/lib/toast";
import { usePrefsOptional } from "@/components/PrefsProvider";
import {
  enqueueQuickVoiceJob,
  subscribeQuickVoicePending,
  type QuickVoiceCallbacks,
} from "@/lib/quickVoiceBackground";

type Props = {
  uid: string;
  /** Append markdown into today's journal composer / note body */
  onAppendJournal?: (md: string) => void;
  /** Called with created quick-idea note id */
  onCreatedNote?: (noteId: string) => void;
  compact?: boolean;
  /** Larger hero CTA on journal header */
  hero?: boolean;
};

export default function QuickVoiceButton({
  uid,
  onAppendJournal,
  onCreatedNote,
  compact,
  hero,
}: Props) {
  const prefs = usePrefsOptional()?.prefs;
  const language = prefs?.captureLanguage || "zh-TW";
  const [recording, setRecording] = useState(false);
  const [secs, setSecs] = useState(0);
  const [pending, setPending] = useState(0);
  const recRef = useRef<SimpleVoiceRecorder | null>(null);
  const tickRef = useRef<number | null>(null);
  const languageRef = useRef(language);
  const cbRef = useRef<QuickVoiceCallbacks>({ onAppendJournal, onCreatedNote });
  const uidRef = useRef(uid);

  languageRef.current = language;
  uidRef.current = uid;
  cbRef.current = { onAppendJournal, onCreatedNote };

  useEffect(() => subscribeQuickVoicePending(setPending), []);

  useEffect(() => {
    return () => {
      if (tickRef.current) window.clearInterval(tickRef.current);
      const rec = recRef.current;
      recRef.current = null;
      if (!rec) return;
      // Leaving mid-record: stop mic and still enqueue background job.
      void rec.stop().then((blob) => {
        if (!blob || blob.size < 800) return;
        enqueueQuickVoiceJob({
          uid: uidRef.current,
          blob,
          ext: rec.extension || "webm",
          language: languageRef.current,
          callbacks: { ...cbRef.current },
        });
        toast("錄音已送出背景整理，可安心離開");
      });
    };
  }, []);

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
      if (!blob || blob.size < 800) {
        toast("錄音太短，請再試一次");
        return;
      }
      enqueueQuickVoiceJob({
        uid: uidRef.current,
        blob,
        ext: rec.extension || "webm",
        language: languageRef.current,
        callbacks: { ...cbRef.current },
      });
      toast("已送出背景整理 · 可立刻離開或再錄一段");
    } catch (e) {
      toast(e instanceof Error ? e.message : "錄音失敗");
    }
  };

  const label = recording
    ? `停止 ${formatRecClock(secs)}`
    : pending > 0
      ? `快速錄音紀錄 · 背景 ${pending}`
      : "快速錄音紀錄";

  const title = recording
    ? "停止並送出這段（背景整理，不用等）"
    : pending
      ? `背景整理 ${pending} 段中 · 可離開頁面`
      : "說完就停 · 背景自動整理成紀錄";

  const className = [
    hero || compact ? "voice-quick-btn" : "btn",
    hero ? "voice-quick-btn--hero" : "",
    compact && !hero ? "is-compact" : "",
    recording ? "is-live" : "",
    pending ? "is-pending" : "",
    !hero && !compact && recording ? "voice-quick-stop" : "",
  ]
    .filter(Boolean)
    .join(" ");

  if (compact || hero) {
    return (
      <button
        type="button"
        className={className}
        title={title}
        onClick={() => void (recording ? stop() : start())}
      >
        <span className="voice-quick-btn-dot" aria-hidden />
        {label}
      </button>
    );
  }

  return (
    <div className="voice-quick-card">
      <div>
        <strong>快速錄音紀錄</strong>
        <p>
          想到什麼就說；停下後立刻可離開，背景會自動整理並儲存
          {pending > 0 ? ` · 整理中 ${pending}` : ""}。
        </p>
      </div>
      <button type="button" className={className} onClick={() => void (recording ? stop() : start())}>
        {recording
          ? `停止 ${formatRecClock(secs)}`
          : pending
            ? `再錄一段（整理中 ${pending}）`
            : "開始快速錄音紀錄"}
      </button>
    </div>
  );
}
