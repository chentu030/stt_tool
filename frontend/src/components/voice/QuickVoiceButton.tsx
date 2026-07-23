"use client";

import { useEffect, useRef, useState } from "react";
import { formatRecClock, SimpleVoiceRecorder } from "@/lib/voiceSession";
import { toast } from "@/lib/toast";
import { usePrefsOptional } from "@/components/PrefsProvider";
import {
  enqueueQuickVoiceJob,
  resumePersistedQuickVoiceJobs,
  subscribeQuickVoicePending,
  type QuickVoiceCallbacks,
} from "@/lib/quickVoiceBackground";
import {
  attachRecordingGuard,
  isLikelyMobileBrowser,
  type RecordingGuard,
} from "@/lib/voiceRecordingGuard";
import {
  clearQuickVoiceDraft,
  listQuickVoiceDrafts,
  newQuickVoiceId,
  saveQuickVoiceDraft,
} from "@/lib/quickVoicePersist";

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
  const [bgWarn, setBgWarn] = useState(false);
  const recRef = useRef<SimpleVoiceRecorder | null>(null);
  const guardRef = useRef<RecordingGuard | null>(null);
  const draftIdRef = useRef<string | null>(null);
  const tickRef = useRef<number | null>(null);
  const languageRef = useRef(language);
  const cbRef = useRef<QuickVoiceCallbacks>({ onAppendJournal, onCreatedNote });
  const uidRef = useRef(uid);

  languageRef.current = language;
  uidRef.current = uid;
  cbRef.current = { onAppendJournal, onCreatedNote };

  useEffect(() => subscribeQuickVoicePending(setPending), []);

  useEffect(() => {
    resumePersistedQuickVoiceJobs({ ...cbRef.current });
    // Recover orphan drafts from a hard kill mid-record (best-effort).
    void (async () => {
      const drafts = await listQuickVoiceDrafts();
      const stale = drafts.filter((d) => Date.now() - d.updatedAt > 30_000);
      for (const d of stale) {
        if (!d.chunks.length || d.uid !== uidRef.current) {
          await clearQuickVoiceDraft(d.id);
          continue;
        }
        const blob = new Blob(d.chunks, { type: d.mimeType || "audio/webm" });
        if (blob.size < 800) {
          await clearQuickVoiceDraft(d.id);
          continue;
        }
        enqueueQuickVoiceJob({
          uid: d.uid,
          blob,
          ext: d.ext || "webm",
          language: languageRef.current,
          callbacks: { ...cbRef.current },
        });
        await clearQuickVoiceDraft(d.id);
        toast("已救回一段未送出的錄音，背景整理中");
      }
    })();
  }, []);

  useEffect(() => {
    return () => {
      if (tickRef.current) window.clearInterval(tickRef.current);
      guardRef.current?.release();
      guardRef.current = null;
      const rec = recRef.current;
      recRef.current = null;
      if (!rec) return;
      // Leaving mid-record: stop mic and still enqueue background job.
      void rec.stop().then(async (blob) => {
        const draftId = draftIdRef.current;
        draftIdRef.current = null;
        if (draftId) await clearQuickVoiceDraft(draftId);
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
      const draftId = newQuickVoiceId("draft");
      draftIdRef.current = draftId;
      const rec = new SimpleVoiceRecorder();
      rec.setChunkListener((chunks, mime) => {
        void saveQuickVoiceDraft({
          id: draftId,
          uid: uidRef.current,
          ext: mime.ext,
          mimeType: mime.mimeType || "audio/webm",
          chunks,
          updatedAt: Date.now(),
        });
      });
      await rec.start();
      recRef.current = rec;
      guardRef.current?.release();
      guardRef.current = attachRecordingGuard(rec.mediaStream, {
        onHidden: () => {
          rec.flush();
          setBgWarn(true);
        },
        onVisible: () => setBgWarn(false),
        onTrackMuted: () => setBgWarn(true),
        onTrackUnmuted: () => setBgWarn(false),
      });
      setRecording(true);
      setBgWarn(false);
      setSecs(0);
      tickRef.current = window.setInterval(() => setSecs((s) => s + 1), 1000);
      if (isLikelyMobileBrowser()) {
        toast("錄音中請盡量保持畫面開啟（切換 App 可能被系統暫停）");
      }
    } catch {
      draftIdRef.current = null;
      toast("無法使用麥克風，請檢查權限");
    }
  };

  const stop = async () => {
    if (tickRef.current) {
      window.clearInterval(tickRef.current);
      tickRef.current = null;
    }
    guardRef.current?.release();
    guardRef.current = null;
    setRecording(false);
    setBgWarn(false);
    setSecs(0);
    const rec = recRef.current;
    recRef.current = null;
    const draftId = draftIdRef.current;
    draftIdRef.current = null;
    if (!rec) return;
    try {
      const blob = await rec.stop();
      if (draftId) await clearQuickVoiceDraft(draftId);
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
      if (draftId) await clearQuickVoiceDraft(draftId);
      toast(e instanceof Error ? e.message : "錄音失敗");
    }
  };

  const label = recording
    ? `停止 ${formatRecClock(secs)}`
    : pending > 0
      ? `快速錄音紀錄 · 背景 ${pending}`
      : "快速錄音紀錄";

  const title = recording
    ? bgWarn
      ? "背景可能已影響錄音 — 建議停止並重錄關鍵內容"
      : "停止並送出這段（背景整理，不用等）"
    : pending
      ? `背景整理 ${pending} 段中 · 可離開頁面`
      : "說完就停 · 背景自動整理成紀錄";

  const className = [
    hero || compact ? "voice-quick-btn" : "btn",
    hero ? "voice-quick-btn--hero" : "",
    compact && !hero ? "is-compact" : "",
    recording ? "is-live" : "",
    pending ? "is-pending" : "",
    bgWarn ? "is-bg-warn" : "",
    !hero && !compact && recording ? "voice-quick-stop" : "",
  ]
    .filter(Boolean)
    .join(" ");

  if (compact || hero) {
    return (
      <div className="voice-quick-wrap">
        <button
          type="button"
          className={className}
          title={title}
          onClick={() => void (recording ? stop() : start())}
        >
          <span className="voice-quick-btn-dot" aria-hidden />
          {label}
        </button>
        {recording && bgWarn && (
          <p className="voice-quick-bg-hint">畫面在背景時，系統可能暫停麥克風</p>
        )}
      </div>
    );
  }

  return (
    <div className="voice-quick-card">
      <div>
        <strong>快速錄音紀錄</strong>
        <p>
          想到什麼就說；停下後立刻可離開，背景會自動整理並儲存
          {pending > 0 ? ` · 整理中 ${pending}` : ""}。
          {isLikelyMobileBrowser()
            ? " 手機請盡量保持畫面開啟，切換 App 可能中斷錄音。"
            : ""}
        </p>
        {recording && bgWarn && (
          <p className="voice-quick-bg-hint">偵測到背景／麥克風中斷風險，建議回到前台後確認音質</p>
        )}
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
