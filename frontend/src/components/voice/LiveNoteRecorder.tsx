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

/** audio = 純錄製；transcribe = 錄+轉字；organize = 轉字+AI 整理 */
export type LiveRecordMode = "audio" | "transcribe" | "organize";

export function liveModeLabel(mode: LiveRecordMode): string {
  if (mode === "audio") return "純錄製";
  if (mode === "transcribe") return "錄製 + 轉錄";
  return "轉錄 + 整理";
}

type Props = {
  uid: string;
  noteId: string;
  open: boolean;
  onClose: () => void;
  insertMd: (md: string) => void;
  autoStart?: boolean;
  mode?: LiveRecordMode;
};

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

type CutMode = "auto" | "manual";

/** Safety ceiling so a never-ending talk still cuts for Google batch limits. */
const MAX_CHUNK_MULT = 6;

export default function LiveNoteRecorder({
  uid,
  noteId,
  open,
  onClose,
  insertMd,
  autoStart,
  mode = "organize",
}: Props) {
  const prefsCtx = usePrefsOptional();
  const prefs = prefsCtx?.prefs;
  const language = prefs?.captureLanguage || "zh-TW";
  const minSecs = Math.max(15, prefs?.liveChunkMinSecs ?? 30);
  const organizeEvery = Math.max(1, prefs?.liveOrganizeEveryChunks ?? 10);
  const silenceMs = Math.max(600, prefs?.liveSilenceMs ?? 1200);
  const maxSecs = minSecs * MAX_CHUNK_MULT;
  const doStt = mode !== "audio";
  const doOrganize = mode === "organize";

  const [live, setLive] = useState(false);
  const [starting, setStarting] = useState(Boolean(autoStart));
  const [secs, setSecs] = useState(0);
  const [segSecs, setSegSecs] = useState(0);
  const [pending, setPending] = useState(0);
  const [status, setStatus] = useState(
    autoStart ? "正在啟動麥克風…" : "準備麥克風…"
  );
  const [lines, setLines] = useState<PreviewLine[]>([]);
  const [stopping, setStopping] = useState(false);
  const [cutMode, setCutMode] = useState<CutMode>("auto");
  const [pendingOrg, setPendingOrg] = useState(0);
  const [orgBusy, setOrgBusy] = useState(false);

  const recRef = useRef<ContinuousDualRecorder | null>(null);
  const tickRef = useRef<number | null>(null);
  const silencePollRef = useRef<number | null>(null);
  const startedRef = useRef(false);
  const labelSeqRef = useRef(0);
  const liveRef = useRef(false);
  const rotatingRef = useRef(false);
  const cutModeRef = useRef<CutMode>("auto");
  const segSecsRef = useRef(0);
  const previewScrollRef = useRef<HTMLDivElement | null>(null);
  const extRef = useRef("webm");
  const jobsRef = useRef<SegJob[]>([]);
  const drainRef = useRef<Promise<void>>(Promise.resolve());
  const drainingRef = useRef(false);
  const pendingOrgTextsRef = useRef<string[]>([]);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const silenceSinceRef = useRef<number | null>(null);
  const modeRef = useRef(mode);

  cutModeRef.current = cutMode;
  modeRef.current = mode;

  const clearTimers = () => {
    if (tickRef.current) window.clearInterval(tickRef.current);
    if (silencePollRef.current) window.clearInterval(silencePollRef.current);
    tickRef.current = null;
    silencePollRef.current = null;
  };

  const stopSilenceMonitor = () => {
    if (silencePollRef.current) window.clearInterval(silencePollRef.current);
    silencePollRef.current = null;
    try {
      void audioCtxRef.current?.close();
    } catch {
      /* ignore */
    }
    audioCtxRef.current = null;
    analyserRef.current = null;
    silenceSinceRef.current = null;
  };

  const startSilenceMonitor = (stream: MediaStream) => {
    stopSilenceMonitor();
    const Ctx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    audioCtxRef.current = ctx;
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.5;
    source.connect(analyser);
    analyserRef.current = analyser;
    const data = new Uint8Array(analyser.fftSize);

    silencePollRef.current = window.setInterval(() => {
      if (!liveRef.current || cutModeRef.current !== "auto" || rotatingRef.current) return;
      const a = analyserRef.current;
      if (!a) return;
      a.getByteTimeDomainData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i++) {
        const v = (data[i] - 128) / 128;
        sum += v * v;
      }
      const rms = Math.sqrt(sum / data.length);
      const quiet = rms < 0.02;
      const now = Date.now();
      if (quiet) {
        if (silenceSinceRef.current == null) silenceSinceRef.current = now;
      } else {
        silenceSinceRef.current = null;
      }
      const silentFor =
        silenceSinceRef.current != null ? now - silenceSinceRef.current : 0;
      const dur = segSecsRef.current;
      if (dur >= maxSecs) {
        void cutParagraph(false, "max");
        return;
      }
      if (dur >= minSecs && silentFor >= silenceMs) {
        void cutParagraph(false, "silence");
      }
    }, 200);
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

  const flushOrganize = async (manual: boolean) => {
    if (modeRef.current !== "organize") return;
    const texts = pendingOrgTextsRef.current.slice();
    if (!texts.length) {
      if (manual) toast("目前沒有待整理的段落");
      return;
    }
    pendingOrgTextsRef.current = [];
    setPendingOrg(0);
    setOrgBusy(true);
    setStatus(manual ? "手動 AI 整理中…" : `每 ${organizeEvery} 段自動整理中…`);
    try {
      const packed = texts.map((t, i) => `【段 ${i + 1}】\n${t}`).join("\n\n");
      const organized = await organizeLiveSegment(packed);
      if (organized.trim()) {
        insertMd(`\n**整理（${texts.length} 段）**\n\n${organized}\n`);
        toast(`已整理 ${texts.length} 段`);
      }
      setStatus("整理完成 · 繼續錄製");
    } catch (e) {
      pendingOrgTextsRef.current = [...texts, ...pendingOrgTextsRef.current];
      setPendingOrg(pendingOrgTextsRef.current.length);
      toast(e instanceof Error ? e.message : "整理失敗");
      setStatus("整理失敗，可再按「AI 整理」");
    } finally {
      setOrgBusy(false);
    }
  };

  const maybeAutoOrganize = () => {
    if (modeRef.current !== "organize") return;
    if (cutModeRef.current === "manual") return;
    if (pendingOrgTextsRef.current.length < organizeEvery) return;
    void flushOrganize(false);
  };

  const queueTranscriptForOrganize = (transcript: string) => {
    if (modeRef.current !== "organize") return;
    const t = transcript.trim();
    if (!t) return;
    pendingOrgTextsRef.current.push(t);
    setPendingOrg(pendingOrgTextsRef.current.length);
    maybeAutoOrganize();
  };

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
        if (modeRef.current === "audio") {
          insertMd(`\n### ${job.label} · ${time}\n\n${audioBlock}`);
          setStatus(`「${job.label}」音檔已寫入`);
        } else {
          insertMd(`\n### ${job.label} · ${time}\n\n${audioBlock}${got.transcript}\n`);
          queueTranscriptForOrganize(got.transcript);
          setStatus(
            modeRef.current === "organize"
              ? `「${job.label}」已寫入 · 待整理 ${pendingOrgTextsRef.current.length} 段`
              : `「${job.label}」已寫入`
          );
        }
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
    const m = modeRef.current;
    setStatus(m === "audio" ? `儲存「${label}」音檔…` : `批次辨識「${label}」中…`);

    const result = (async (): Promise<{ transcript: string; url: string } | null> => {
      try {
        const ext = extRef.current || "webm";
        const file = new File([blob], `live-${noteId}-${Date.now()}.${ext}`, {
          type: blob.type || "audio/webm",
        });
        const upPromise = uploadNoteMedia(uid, noteId, file).catch(() => null);

        if (m === "audio") {
          const up = await upPromise;
          upsertLine(lineId, { text: "音檔已儲存", state: "ready" });
          return { transcript: "", url: up?.url || "" };
        }

        const sttPromise = transcribeWithGoogle(blob, {
          language,
          filename: file.name,
        });
        const transcript = await sttPromise;
        upsertLine(lineId, { text: transcript, state: "ready" });
        setStatus(`「${label}」已出字`);
        const up = await upPromise;
        return { transcript, url: up?.url || "" };
      } catch (e) {
        const msg = e instanceof Error ? e.message : m === "audio" ? "上傳失敗" : "轉錄失敗";
        upsertLine(lineId, { text: msg, state: "error" });
        setStatus(`「${label}」失敗：${msg}`);
        toast(`${label}：${msg}`);
        return null;
      }
    })();

    jobsRef.current.push({ id: lineId, label, result });
    void drainJobs();
  };

  const cutParagraph = async (
    manual = true,
    reason: "manual" | "silence" | "max" = "manual"
  ) => {
    const rec = recRef.current;
    if (!rec || !liveRef.current || rotatingRef.current || stopping) return;
    if (!manual && cutModeRef.current === "manual") return;
    rotatingRef.current = true;
    silenceSinceRef.current = null;
    try {
      setStatus(
        reason === "silence"
          ? "偵測到停頓，切段中…"
          : reason === "max"
            ? "本段過長，強制切段…"
            : "切段中…"
      );
      const blob = await rec.rotateSegment();
      segSecsRef.current = 0;
      setSegSecs(0);
      if (!blob) {
        setStatus("這段太短，已略過 · 繼續錄製");
        return;
      }
      labelSeqRef.current += 1;
      const label = `段落 ${labelSeqRef.current}`;
      const lineId = `seg-${Date.now()}-${labelSeqRef.current}`;
      setLines((prev) => [
        ...prev,
        {
          id: lineId,
          label,
          text: modeRef.current === "audio" ? "儲存音檔中…" : "批次辨識中…",
          state: "pending",
        },
      ]);
      startSegJob(blob, label, lineId);
      setStatus("本段已送出 · 可繼續講");
    } finally {
      rotatingRef.current = false;
    }
  };

  const start = async () => {
    setStarting(true);
    setStatus("請求麥克風權限…");
    setLines([]);
    setPending(0);
    setPendingOrg(0);
    pendingOrgTextsRef.current = [];
    setStopping(false);
    jobsRef.current = [];
    try {
      const rec = new ContinuousDualRecorder();
      await rec.start();
      recRef.current = rec;
      extRef.current = rec.extension || "webm";
      if (rec.mediaStream) startSilenceMonitor(rec.mediaStream);
      liveRef.current = true;
      setLive(true);
      setSecs(0);
      setSegSecs(0);
      segSecsRef.current = 0;
      labelSeqRef.current = 0;
      if (modeRef.current === "audio") {
        setStatus(
          cutModeRef.current === "auto"
            ? `純錄製：講超過 ${minSecs}s 且停頓後切段存檔`
            : "純錄製：按「段落結束」存音檔"
        );
      } else if (modeRef.current === "transcribe") {
        setStatus(
          cutModeRef.current === "auto"
            ? `轉錄：講超過 ${minSecs}s 且停頓後切段轉字`
            : "轉錄：按「段落結束」轉字"
        );
      } else {
        setStatus(
          cutModeRef.current === "auto"
            ? `自動切段：講超過 ${minSecs}s 且停頓後切段；每 ${organizeEvery} 段整理`
            : "手動切段：按「段落結束」；需要時按「AI 整理」"
        );
      }
      tickRef.current = window.setInterval(() => {
        setSecs((s) => s + 1);
        setSegSecs((s) => {
          const n = s + 1;
          segSecsRef.current = n;
          return n;
        });
      }, 1000);
    } finally {
      setStarting(false);
    }
  };

  const stop = async () => {
    if (stopping) return;
    setStopping(true);
    setStarting(false);
    clearTimers();
    stopSilenceMonitor();
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
          {
            id: lineId,
            label,
            text: modeRef.current === "audio" ? "儲存音檔中…" : "批次辨識中…",
            state: "pending",
          },
        ]);
        startSegJob(lastSegment, label, lineId);
      }
      await drainJobs();
      while (jobsRef.current.length) {
        await drainJobs();
      }
      if (modeRef.current === "organize" && pendingOrgTextsRef.current.length) {
        await flushOrganize(true);
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

  const cancelBoot = () => {
    clearTimers();
    stopSilenceMonitor();
    void recRef.current?.stopAll();
    recRef.current = null;
    liveRef.current = false;
    setLive(false);
    setStarting(false);
    onClose();
  };

  useEffect(() => {
    if (!open) return;
    if (autoStart && !startedRef.current) {
      startedRef.current = true;
      void start().catch((e) => {
        toast(e instanceof Error ? e.message : "無法開始錄音");
        setStarting(false);
        onClose();
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, autoStart]);

  useEffect(() => {
    return () => {
      clearTimers();
      stopSilenceMonitor();
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
  const orgHint = doOrganize && pendingOrg > 0 ? ` · 待整理 ${pendingOrg}` : "";
  const title =
    mode === "audio"
      ? "即時錄音"
      : mode === "transcribe"
        ? "即時錄音 · 轉錄"
        : "即時錄音 · 轉錄整理";
  const booting = starting || (autoStart && !live && !stopping);
  const emptyHint =
    mode === "audio"
      ? `純錄製：講超過 ${minSecs} 秒且停頓後切段存音檔。結束時會附上整場錄音。`
      : mode === "transcribe"
        ? `轉錄：講超過 ${minSecs} 秒且停頓後切段轉字並寫入筆記。結束時保留整場音檔。`
        : `轉錄 + 整理：講超過 ${minSecs} 秒且停頓後切段；每 ${organizeEvery} 段 AI 整理。也可改手動切段。設定可在「設定 → 捕捉」調整。`;

  return (
    <div className="voice-live-dock" role="dialog" aria-label={title}>
      <div className="voice-live-dock-top">
        <div className="voice-live-dock-main">
          <div className={`voice-live-dock-pulse${live ? "" : " is-off"}`} aria-hidden />
          <div className="voice-live-dock-meta">
            <strong>{title}</strong>
            <span>
              {live || stopping ? formatRecClock(secs) : "—"} · 本段{" "}
              {formatRecClock(segSecs)}
              {cutMode === "auto" ? `（≥${minSecs}s 停頓切段）` : "（手動）"}
              {pendingHint}
              {orgHint}
            </span>
            <em>{status}</em>
          </div>
        </div>
        <div className="voice-live-dock-actions">
          {booting ? (
            <>
              <button type="button" className="btn btn-sm" disabled>
                啟動中…
              </button>
              <button type="button" className="btn btn-sm btn-ghost" onClick={cancelBoot}>
                取消
              </button>
            </>
          ) : !live && !stopping ? (
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
                className={`btn btn-sm btn-ghost${cutMode === "manual" ? " is-on" : ""}`}
                disabled={stopping}
                title="切換自動／手動切段"
                onClick={() => {
                  setCutMode((m) => {
                    const next = m === "auto" ? "manual" : "auto";
                    setStatus(
                      next === "auto"
                        ? `已改自動：超過 ${minSecs}s 且停頓後切段`
                        : "已改手動：按「段落結束」切段"
                    );
                    return next;
                  });
                }}
              >
                {cutMode === "auto" ? "自動切段" : "手動切段"}
              </button>
              <button
                type="button"
                className="btn btn-sm btn-soft"
                disabled={!live || stopping}
                onClick={() => void cutParagraph(true, "manual")}
              >
                段落結束
              </button>
              {doOrganize ? (
                <button
                  type="button"
                  className="btn btn-sm btn-soft"
                  disabled={stopping || orgBusy || pendingOrg === 0}
                  title="立即整理目前待整理段落（不受每 N 段限制）"
                  onClick={() => void flushOrganize(true)}
                >
                  {orgBusy ? "整理中…" : `AI 整理${pendingOrg ? ` (${pendingOrg})` : ""}`}
                </button>
              ) : null}
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

      <div className="voice-live-preview" ref={previewScrollRef} aria-label="預覽">
        {lines.length === 0 ? (
          <p className="voice-live-preview-empty">{emptyHint}</p>
        ) : (
          lines.map((line) => (
            <div key={line.id} className={`voice-live-line is-${line.state}`}>
              <header>
                <strong>{line.label}</strong>
                <span>
                  {line.state === "pending"
                    ? doStt
                      ? "辨識中"
                      : "儲存中"
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
