"use client";

import { useEffect, useRef, useState } from "react";
import { uploadNoteMedia } from "@/lib/firebase";
import {
  organizeLiveSegment,
  transcribeWithGoogle,
} from "@/lib/googleStt";
import {
  ContinuousDualRecorder,
  formatRecClock,
} from "@/lib/voiceSession";
import { toast } from "@/lib/toast";
import { usePrefsOptional } from "@/components/PrefsProvider";

type Props = {
  uid: string;
  noteId: string;
  open: boolean;
  onClose: () => void;
  /** Insert markdown into the open note editor */
  insertMd: (md: string) => void;
  autoStart?: boolean;
};

const AUTO_SECS = 45;

export default function LiveNoteRecorder({
  uid,
  noteId,
  open,
  onClose,
  insertMd,
  autoStart,
}: Props) {
  const prefs = usePrefsOptional()?.prefs;
  const language = prefs?.captureLanguage || "zh-TW";
  const [live, setLive] = useState(false);
  const [secs, setSecs] = useState(0);
  const [segSecs, setSegSecs] = useState(0);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("準備麥克風…");
  const [segCount, setSegCount] = useState(0);
  const recRef = useRef<ContinuousDualRecorder | null>(null);
  const tickRef = useRef<number | null>(null);
  const autoRef = useRef<number | null>(null);
  const queueRef = useRef<Promise<void>>(Promise.resolve());
  const startedRef = useRef(false);
  const segCountRef = useRef(0);
  const busyRef = useRef(false);
  const liveRef = useRef(false);

  const clearTimers = () => {
    if (tickRef.current) window.clearInterval(tickRef.current);
    if (autoRef.current) window.clearInterval(autoRef.current);
    tickRef.current = null;
    autoRef.current = null;
  };

  const enqueue = (fn: () => Promise<void>) => {
    queueRef.current = queueRef.current.then(fn).catch((e) => {
      toast(e instanceof Error ? e.message : "段落處理失敗");
    });
    return queueRef.current;
  };

  const processBlob = async (blob: Blob, label: string) => {
    busyRef.current = true;
    setBusy(true);
    setStatus(`上傳並轉錄「${label}」…`);
    try {
      const ext = recRef.current?.extension || "webm";
      const file = new File([blob], `live-${noteId}-${Date.now()}.${ext}`, {
        type: blob.type || "audio/webm",
      });
      const up = await uploadNoteMedia(uid, noteId, file);
      setStatus("Google 語音辨識中…");
      const transcript = await transcribeWithGoogle(blob, {
        language,
        filename: file.name,
      });
      let organized = "";
      try {
        setStatus("AI 整理中…");
        organized = await organizeLiveSegment(transcript);
      } catch {
        organized = "";
      }
      const time = new Date().toLocaleTimeString("zh-TW", {
        hour: "2-digit",
        minute: "2-digit",
      });
      const md = [
        ``,
        `### ${label} · ${time}`,
        ``,
        `<audio class="rich-audio" data-note-audio="1" controls preload="metadata" src="${up.url}" title="${file.name}"></audio>`,
        ``,
        transcript,
        organized ? `\n\n**整理**\n\n${organized}` : "",
        ``,
      ].join("\n");
      insertMd(md);
      segCountRef.current += 1;
      setSegCount(segCountRef.current);
      setStatus("段落已寫入筆記 · 繼續錄製中");
      toast(`${label} 已整理進筆記`);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const cutParagraph = (manual = true) => {
    const rec = recRef.current;
    if (!rec || !liveRef.current) return;
    if (!manual && busyRef.current) return;
    void enqueue(async () => {
      setStatus("切段中…");
      const blob = await rec.rotateSegment();
      setSegSecs(0);
      if (!blob) {
        setStatus("這段太短，已略過 · 繼續錄製");
        return;
      }
      const n = segCountRef.current + 1;
      await processBlob(blob, `段落 ${n}`);
    });
  };

  const start = async () => {
    setStatus("請求麥克風權限…");
    const rec = new ContinuousDualRecorder();
    await rec.start();
    recRef.current = rec;
    liveRef.current = true;
    setLive(true);
    setSecs(0);
    setSegSecs(0);
    segCountRef.current = 0;
    setSegCount(0);
    setStatus("錄製中 · 講完一段可按「段落結束」");
    tickRef.current = window.setInterval(() => {
      setSecs((s) => s + 1);
      setSegSecs((s) => s + 1);
    }, 1000);
    autoRef.current = window.setInterval(() => {
      cutParagraph(false);
    }, AUTO_SECS * 1000);
  };

  const stop = async () => {
    clearTimers();
    const rec = recRef.current;
    liveRef.current = false;
    setLive(false);
    setStatus("結束中…");
    if (!rec) {
      onClose();
      return;
    }
    await enqueue(async () => {
      const { full, lastSegment } = await rec.stopAll();
      recRef.current = null;
      if (lastSegment) {
        await processBlob(lastSegment, `段落 ${segCountRef.current + 1}`);
      }
      if (full && full.size > 1000) {
        setBusy(true);
        setStatus("儲存完整音檔…");
        try {
          const ext = rec.extension || "webm";
          const file = new File([full], `live-full-${noteId}-${Date.now()}.${ext}`, {
            type: full.type || "audio/webm",
          });
          const up = await uploadNoteMedia(uid, noteId, file);
          insertMd(
            `\n\n---\n\n**整場錄音**\n\n<audio class="rich-audio" data-note-audio="1" controls preload="metadata" src="${up.url}" title="${file.name}"></audio>\n`
          );
          toast("完整音檔已附在筆記");
        } finally {
          setBusy(false);
        }
      }
      setStatus("已結束");
      onClose();
    });
  };

  useEffect(() => {
    if (!open) return;
    if (autoStart && !startedRef.current) {
      startedRef.current = true;
      void start().catch((e) => {
        toast(e instanceof Error ? e.message : "無法開始錄音");
        onClose();
      });
    }
    return () => {
      /* keep running until stop */
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, autoStart]);

  useEffect(() => {
    return () => {
      clearTimers();
      void recRef.current?.stopAll();
    };
  }, []);

  if (!open) return null;

  return (
    <div className="voice-live-dock" role="dialog" aria-label="即時錄音轉錄">
      <div className="voice-live-dock-main">
        <div className="voice-live-dock-pulse" aria-hidden />
        <div className="voice-live-dock-meta">
          <strong>即時轉錄</strong>
          <span>
            {live ? formatRecClock(secs) : "—"} · 本段 {formatRecClock(segSecs)} / {AUTO_SECS}s
          </span>
          <em>{status}</em>
        </div>
      </div>
      <div className="voice-live-dock-actions">
        {!live ? (
          <button type="button" className="btn btn-sm" disabled={busy} onClick={() => void start()}>
            開始
          </button>
        ) : (
          <>
            <button
              type="button"
              className="btn btn-sm btn-soft"
              disabled={busy}
              onClick={() => cutParagraph(true)}
            >
              段落結束
            </button>
            <button type="button" className="btn btn-sm" disabled={busy} onClick={() => void stop()}>
              結束並存檔
            </button>
          </>
        )}
        {!live ? (
          <button type="button" className="btn btn-sm btn-ghost" onClick={onClose}>
            關閉
          </button>
        ) : null}
      </div>
    </div>
  );
}
