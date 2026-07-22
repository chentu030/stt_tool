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
  insertMd: (md: string) => void;
  autoStart?: boolean;
};

/** Shorter clips → faster STT feedback while recording continues. */
const AUTO_SECS = 20;

type PreviewLine = {
  id: string;
  label: string;
  text: string;
  state: "pending" | "ready" | "error";
};

type SegJob = {
  id: string;
  label: string;
  result: Promise<{ transcript: string; url: string } | null>;
};

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
  const [pending, setPending] = useState(0);
  const [status, setStatus] = useState("準備麥克風…");
  const [lines, setLines] = useState<PreviewLine[]>([]);
  const [stopping, setStopping] = useState(false);

  const recRef = useRef<ContinuousDualRecorder | null>(null);
  const tickRef = useRef<number | null>(null);
  const autoRef = useRef<number | null>(null);
  const startedRef = useRef(false);
  const labelSeqRef = useRef(0);
  const liveRef = useRef(false);
  const rotatingRef = useRef(false);
  const previewScrollRef = useRef<HTMLDivElement | null>(null);
  const extRef = useRef("webm");
  const jobsRef = useRef<SegJob[]>([]);
  const drainRef = useRef<Promise<void>>(Promise.resolve());
  const drainingRef = useRef(false);

  const clearTimers = () => {
    if (tickRef.current) window.clearInterval(tickRef.current);
    if (autoRef.current) window.clearInterval(autoRef.current);
    tickRef.current = null;
    autoRef.current = null;
  };

  const armAutoCut = () => {
    if (autoRef.current) window.clearInterval(autoRef.current);
    autoRef.current = window.setInterval(() => {
      void cutParagraph(false);
    }, AUTO_SECS * 1000);
  };

  const upsertLine = (id: string, patch: Partial<PreviewLine>) => {
    setLines((prev) => {
      const i = prev.findIndex((x) => x.id === id);
      if (i < 0) return prev;
      const next = prev.slice();
      next[i] = { ...next[i], ...patch };
      return next;
    });
  };

  /** Ordered note inserts; STT itself runs in parallel per job. */
  const drainJobs = () => {
    if (drainingRef.current) return drainRef.current;
    drainingRef.current = true;
    drainRef.current = (async () => {
      while (jobsRef.current.length) {
        const job = jobsRef.current[0];
        const got = await job.result;
        jobsRef.current.shift();
        setPending(jobsRef.current.length);
        if (!got) continue;
        const time = new Date().toLocaleTimeString("zh-TW", {
          hour: "2-digit",
          minute: "2-digit",
        });
        const audioBlock = got.url
          ? `<audio class="rich-audio" data-note-audio="1" controls preload="metadata" src="${got.url}" title="${job.label}"></audio>\n\n`
          : "";
        insertMd(`\n### ${job.label} · ${time}\n\n${audioBlock}${got.transcript}\n`);
        setStatus(`「${job.label}」已寫入 · 繼續錄製`);
        void organizeLiveSegment(got.transcript)
          .then((organized) => {
            if (!organized.trim()) return;
            insertMd(`\n**整理 · ${job.label}**\n\n${organized}\n`);
            upsertLine(job.id, {
              text: `${got.transcript}\n\n〔整理〕${organized}`,
            });
          })
          .catch(() => {
            /* optional */
          });
      }
    })()
      .catch((e) => {
        toast(e instanceof Error ? e.message : "寫入筆記失敗");
      })
      .finally(() => {
        drainingRef.current = false;
      });
    return drainRef.current;
  };

  const startSegJob = (blob: Blob, label: string, lineId: string) => {
    setPending((n) => n + 1);
    setStatus(`辨識「${label}」中…`);

    const result = (async (): Promise<{ transcript: string; url: string } | null> => {
      try {
        const ext = extRef.current || "webm";
        const file = new File([blob], `live-${noteId}-${Date.now()}.${ext}`, {
          type: blob.type || "audio/webm",
        });
        const sttPromise = transcribeWithGoogle(blob, {
          language,
          filename: file.name,
        });
        const upPromise = uploadNoteMedia(uid, noteId, file).catch(() => null);

        const transcript = await sttPromise;
        upsertLine(lineId, { text: transcript, state: "ready" });
        setStatus(`「${label}」已出字`);

        const up = await upPromise;
        return { transcript, url: up?.url || "" };
      } catch (e) {
        const msg = e instanceof Error ? e.message : "轉錄失敗";
        upsertLine(lineId, { text: msg, state: "error" });
        setStatus(`「${label}」失敗：${msg}`);
        toast(`${label}：${msg}`);
        return null;
      }
    })();

    jobsRef.current.push({ id: lineId, label, result });
    void drainJobs();
  };

  const cutParagraph = async (manual = true) => {
    const rec = recRef.current;
    if (!rec || !liveRef.current || rotatingRef.current || stopping) return;
    rotatingRef.current = true;
    try {
      setStatus(manual ? "切段中…" : "自動切段…");
      const blob = await rec.rotateSegment();
      setSegSecs(0);
      armAutoCut();
      if (!blob) {
        setStatus("這段太短，已略過 · 繼續錄製");
        return;
      }
      labelSeqRef.current += 1;
      const label = `段落 ${labelSeqRef.current}`;
      const lineId = `seg-${Date.now()}-${labelSeqRef.current}`;
      setLines((prev) => [
        ...prev,
        { id: lineId, label, text: "辨識中…", state: "pending" },
      ]);
      startSegJob(blob, label, lineId);
      setStatus("本段已送出辨識 · 可繼續講／再按段落結束");
    } finally {
      rotatingRef.current = false;
    }
  };

  const start = async () => {
    setStatus("請求麥克風權限…");
    setLines([]);
    setPending(0);
    setStopping(false);
    jobsRef.current = [];
    const rec = new ContinuousDualRecorder();
    await rec.start();
    recRef.current = rec;
    extRef.current = rec.extension || "webm";
    liveRef.current = true;
    setLive(true);
    setSecs(0);
    setSegSecs(0);
    labelSeqRef.current = 0;
    setStatus("錄製中 · 講完一段按「段落結束」，文字會出現在下方");
    tickRef.current = window.setInterval(() => {
      setSecs((s) => s + 1);
      setSegSecs((s) => s + 1);
    }, 1000);
    armAutoCut();
  };

  const stop = async () => {
    if (stopping) return;
    setStopping(true);
    clearTimers();
    const rec = recRef.current;
    liveRef.current = false;
    setLive(false);
    setStatus("結束錄音，處理剩餘段落…");
    if (!rec) {
      onClose();
      return;
    }
    try {
      const { full, lastSegment } = await rec.stopAll();
      recRef.current = null;
      if (lastSegment) {
        labelSeqRef.current += 1;
        const lineId = `seg-final-${Date.now()}`;
        const label = `段落 ${labelSeqRef.current}`;
        setLines((prev) => [
          ...prev,
          { id: lineId, label, text: "辨識中…", state: "pending" },
        ]);
        startSegJob(lastSegment, label, lineId);
      }
      await drainJobs();
      // Ensure any job started during drain finishes
      while (jobsRef.current.length) {
        await drainJobs();
      }
      if (full && full.size > 1000) {
        setStatus("儲存完整音檔…");
        try {
          const ext = extRef.current || "webm";
          const file = new File([full], `live-full-${noteId}-${Date.now()}.${ext}`, {
            type: full.type || "audio/webm",
          });
          const up = await uploadNoteMedia(uid, noteId, file);
          insertMd(
            `\n\n---\n\n**整場錄音**\n\n<audio class="rich-audio" data-note-audio="1" controls preload="metadata" src="${up.url}" title="${file.name}"></audio>\n`
          );
          toast("完整音檔已附在筆記");
        } catch {
          toast("完整音檔上傳失敗，段落音檔仍保留");
        }
      }
      setStatus("已結束");
      onClose();
    } catch (e) {
      toast(e instanceof Error ? e.message : "結束失敗");
      setStopping(false);
      setStatus("結束失敗，可再試一次");
    }
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, autoStart]);

  useEffect(() => {
    return () => {
      clearTimers();
      void recRef.current?.stopAll();
    };
  }, []);

  useEffect(() => {
    const el = previewScrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [lines]);

  if (!open) return null;

  const pendingHint = pending > 0 ? ` · ${pending} 段處理中` : "";

  return (
    <div className="voice-live-dock" role="dialog" aria-label="即時錄音轉錄">
      <div className="voice-live-dock-top">
        <div className="voice-live-dock-main">
          <div className={`voice-live-dock-pulse${live ? "" : " is-off"}`} aria-hidden />
          <div className="voice-live-dock-meta">
            <strong>即時轉錄</strong>
            <span>
              {live || stopping ? formatRecClock(secs) : "—"} · 本段{" "}
              {formatRecClock(segSecs)} / {AUTO_SECS}s
              {pendingHint}
            </span>
            <em>{status}</em>
          </div>
        </div>
        <div className="voice-live-dock-actions">
          {!live && !stopping ? (
            <>
              <button type="button" className="btn btn-sm" onClick={() => void start()}>
                開始
              </button>
              <button type="button" className="btn btn-sm btn-ghost" onClick={onClose}>
                關閉
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                className="btn btn-sm btn-soft"
                disabled={!live || stopping}
                onClick={() => void cutParagraph(true)}
              >
                段落結束
              </button>
              <button
                type="button"
                className="btn btn-sm"
                disabled={stopping}
                onClick={() => void stop()}
              >
                {stopping ? "收尾中…" : "結束並存檔"}
              </button>
            </>
          )}
        </div>
      </div>

      <div
        className="voice-live-preview"
        ref={previewScrollRef}
        aria-label="即時逐字稿預覽"
      >
        {lines.length === 0 ? (
          <p className="voice-live-preview-empty">
            逐字稿會出現在這裡，可往上捲動回顧。按「段落結束」或約 {AUTO_SECS}{" "}
            秒自動送出辨識（錄音不中斷）。
          </p>
        ) : (
          lines.map((line) => (
            <div key={line.id} className={`voice-live-line is-${line.state}`}>
              <header>
                <strong>{line.label}</strong>
                <span>
                  {line.state === "pending"
                    ? "辨識中"
                    : line.state === "error"
                      ? "失敗"
                      : "完成"}
                </span>
              </header>
              <p>{line.text}</p>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
