"use client";

import { useEffect, useRef, useState } from "react";
import { uploadNoteMedia } from "@/lib/firebase";
import {
  fetchGoogleSttHealth,
  organizeLiveSegment,
  mapCaptureLangToGoogle,
  transcribeWithGoogle,
} from "@/lib/googleStt";
import { GoogleLiveSttSession } from "@/lib/googleSttStream";
import {
  STREAM_QUOTA_MAX_MINS,
  STREAM_QUOTA_MAX_SECS,
  addStreamUsedSecs,
  formatStreamQuota,
  getStreamUsedSecs,
  streamRemainingSecs,
} from "@/lib/sttStreamQuota";
import {
  ContinuousDualRecorder,
  acquireLiveAudioStream,
  formatRecClock,
  liveAudioSourceHint,
  liveAudioSourceLabel,
  type LiveAudioSource,
} from "@/lib/voiceSession";
import { toast } from "@/lib/toast";
import { usePrefsOptional } from "@/components/PrefsProvider";
import {
  DEFAULT_LIVE_HIDE_DOCK_SHORTCUT,
  eventMatchesShortcut,
  formatShortcutLabel,
} from "@/lib/shortcutSpec";

/** audio = 純錄製；transcribe = 錄+轉字；organize = 轉字+AI 整理 */
export type LiveRecordMode = "audio" | "transcribe" | "organize";

export type { LiveAudioSource };

export function liveModeLabel(mode: LiveRecordMode): string {
  if (mode === "audio") return "純錄製";
  if (mode === "transcribe") return "錄製 + 轉錄";
  return "轉錄 + 整理";
}

const AUDIO_SOURCES: LiveAudioSource[] = ["mic", "system", "both"];

type Props = {
  uid: string;
  noteId: string;
  open: boolean;
  onClose: () => void;
  insertMd: (md: string) => void;
  autoStart?: boolean;
  mode?: LiveRecordMode;
  /** Initial source; user can still change before pressing 開始 */
  audioSource?: LiveAudioSource;
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
  result: Promise<{ transcript: string; url: string; audioOnly?: boolean } | null>;
};

type CutMode = "auto" | "manual";

/** Safety ceiling so a never-ending talk still cuts for Google batch limits. */
const MAX_CHUNK_MULT = 6;
/** Realtime mode: AI organize interval (not silence cuts). */
const STREAM_ORGANIZE_EVERY_SECS = 5 * 60;

function clockNow(): string {
  return new Date().toLocaleTimeString("zh-TW", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

/** Collapsed toggle titled 逐字稿, with timestamped body. */
function transcriptToggleMd(body: string): string {
  const inner = body.trim();
  if (!inner) return "";
  return `\n\n:::toggle 逐字稿\n${inner}\n:::\n\n`;
}

export default function LiveNoteRecorder({
  uid,
  noteId,
  open,
  onClose,
  insertMd,
  autoStart,
  mode = "organize",
  audioSource: audioSourceProp = "mic",
}: Props) {
  const prefsCtx = usePrefsOptional();
  const prefs = prefsCtx?.prefs;
  const language = mapCaptureLangToGoogle(prefs?.captureLanguage || "zh-TW");
  const minSecs = Math.max(15, prefs?.liveChunkMinSecs ?? 30);
  const organizeEvery = Math.max(1, prefs?.liveOrganizeEveryChunks ?? 10);
  const silenceMs = Math.max(600, prefs?.liveSilenceMs ?? 1200);
  const maxSecs = minSecs * MAX_CHUNK_MULT;
  const streamMaxSecs = Math.min(
    STREAM_QUOTA_MAX_SECS,
    Math.max(15 * 60, (prefs?.liveStreamMaxMins ?? STREAM_QUOTA_MAX_MINS) * 60)
  );
  const doStt = mode !== "audio";
  const doOrganize = mode === "organize";

  const [audioSource, setAudioSource] = useState<LiveAudioSource>(audioSourceProp);
  /** Session opt-in; seeded from prefs (default off = batch). */
  const [streamOn, setStreamOn] = useState(() => Boolean(prefs?.liveStreamStt));
  /** null = probing; false = Cloud Run has streaming off. */
  const [streamServerOk, setStreamServerOk] = useState<boolean | null>(null);
  const [streamUsedSecs, setStreamUsedSecs] = useState(() => getStreamUsedSecs());
  const [streamLive, setStreamLive] = useState(false);
  const [live, setLive] = useState(false);
  const [starting, setStarting] = useState(Boolean(autoStart));
  const [secs, setSecs] = useState(0);
  const [segSecs, setSegSecs] = useState(0);
  const [pending, setPending] = useState(0);
  const [status, setStatus] = useState(() =>
    autoStart
      ? `正在啟動${liveAudioSourceLabel(audioSourceProp)}…`
      : `選擇來源後開始（目前：${liveAudioSourceLabel(audioSourceProp)}）`
  );
  const [lines, setLines] = useState<PreviewLine[]>([]);
  const [stopping, setStopping] = useState(false);
  const [cutMode, setCutMode] = useState<CutMode>("auto");
  const [pendingOrg, setPendingOrg] = useState(0);
  const [orgBusy, setOrgBusy] = useState(false);
  const [dockHidden, setDockHidden] = useState(false);
  /** After stop finishes: keep panel open with a clear summary so it doesn't feel frozen/empty. */
  const [doneSummary, setDoneSummary] = useState<string | null>(null);
  const segOkRef = useRef(0);
  const segFailRef = useRef(0);

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
  const audioSourceRef = useRef(audioSource);
  const streamOnRef = useRef(streamOn);
  const streamLiveRef = useRef(false);
  const streamSessionRef = useRef<GoogleLiveSttSession | null>(null);
  const streamInterimIdRef = useRef<string | null>(null);
  const streamSessionStartedAtRef = useRef(0);
  const secsRef = useRef(0);
  /** After realtime fails, always use batch STT for cuts (even if UI lagged). */
  const forceBatchSttRef = useRef(false);
  /** Buffered realtime finals → flushed into a 逐字稿 toggle. */
  const streamTranscriptBufRef = useRef<Array<{ stamp: string; text: string }>>([]);
  const lastStreamOrgAtRef = useRef(0);
  /** True if this session used realtime (even briefly) — skip re-STT on stop. */
  const usedStreamThisSessionRef = useRef(false);
  const maybeStreamTimedOrganizeRef = useRef(() => {});
  const stopRef = useRef<() => Promise<void>>(async () => {});
  const fallbackToBatchRef = useRef<(reason: "quota" | "error", detail?: string) => Promise<void>>(
    async () => {}
  );

  cutModeRef.current = cutMode;
  modeRef.current = mode;
  audioSourceRef.current = audioSource;
  streamLiveRef.current = streamLive;

  // Sync stream opt-in via effect so mid-tick re-renders cannot undo fallbackToBatch().
  useEffect(() => {
    streamOnRef.current = streamOn;
  }, [streamOn]);

  useEffect(() => {
    if (!open || !doStt) return;
    let cancelled = false;
    void fetchGoogleSttHealth().then((h) => {
      if (cancelled) return;
      const ok = h?.stream_enabled !== false;
      setStreamServerOk(ok);
      if (!ok) {
        streamOnRef.current = false;
        setStreamOn(false);
        forceBatchSttRef.current = true;
        if (prefs?.liveStreamStt) prefsCtx?.setPrefs({ liveStreamStt: false });
      }
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, doStt]);

  useEffect(() => {
    if (!live && !stopping) {
      const want = Boolean(prefs?.liveStreamStt) && streamRemainingSecs() > 0;
      setStreamOn(want && streamServerOk !== false);
      setStreamUsedSecs(getStreamUsedSecs());
    }
  }, [prefs?.liveStreamStt, live, stopping, streamServerOk]);

  useEffect(() => {
    if (audioSourceProp && !live && !stopping) setAudioSource(audioSourceProp);
  }, [audioSourceProp, live, stopping]);

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
      // Realtime mode: no silence/30s auto-cuts (text streams continuously).
      if (
        !forceBatchSttRef.current &&
        streamOnRef.current &&
        streamLiveRef.current
      ) {
        return;
      }
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
    setStatus(manual ? "手動 AI 整理中…" : "AI 整理中…");
    try {
      const packed = texts.map((t, i) => `【段 ${i + 1}】\n${t}`).join("\n\n");
      const organized = await organizeLiveSegment(packed);
      if (organized.trim()) {
        const time = clockNow();
        insertMd(`\n### 整理 · ${time}\n\n${organized}\n`);
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

  /** Flush buffered realtime lines into a collapsed 逐字稿 toggle. */
  const flushStreamTranscriptToggle = () => {
    const buf = streamTranscriptBufRef.current;
    if (!buf.length) return;
    streamTranscriptBufRef.current = [];
    const body = buf.map((x) => `${x.stamp}\n${x.text}`).join("\n\n");
    insertMd(transcriptToggleMd(body));
  };

  const maybeAutoOrganize = () => {
    if (modeRef.current !== "organize") return;
    if (cutModeRef.current === "manual") return;
    // Realtime uses a 5-minute timer instead of chunk count.
    if (
      !forceBatchSttRef.current &&
      streamOnRef.current &&
      streamLiveRef.current
    ) {
      return;
    }
    if (pendingOrgTextsRef.current.length < organizeEvery) return;
    void flushOrganize(false);
  };

  const maybeStreamTimedOrganize = () => {
    if (modeRef.current !== "organize") return;
    if (forceBatchSttRef.current || !streamOnRef.current || !streamLiveRef.current) return;
    if (!lastStreamOrgAtRef.current) {
      lastStreamOrgAtRef.current = Date.now();
      return;
    }
    const elapsed = (Date.now() - lastStreamOrgAtRef.current) / 1000;
    if (elapsed < STREAM_ORGANIZE_EVERY_SECS) return;
    if (!pendingOrgTextsRef.current.length && !streamTranscriptBufRef.current.length) {
      lastStreamOrgAtRef.current = Date.now();
      return;
    }
    lastStreamOrgAtRef.current = Date.now();
    flushStreamTranscriptToggle();
    void flushOrganize(false);
  };
  maybeStreamTimedOrganizeRef.current = maybeStreamTimedOrganize;

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
        const time = clockNow();
        const audioBlock = got.url
          ? `<audio class="rich-audio" data-note-audio="1" controls preload="metadata" src="${got.url}" title="${job.label}"></audio>\n\n`
          : "";
        if (modeRef.current === "audio" || got.audioOnly) {
          if (modeRef.current === "audio") {
            insertMd(`\n### 音檔 · ${time}\n\n${audioBlock}`);
            setStatus(`「${job.label}」音檔已寫入`);
          } else {
            // Text already streamed in; keep a compact audio bookmark per cut.
            if (audioBlock) insertMd(`\n${audioBlock}`);
            setStatus(`「${job.label}」音檔已附上`);
          }
          segOkRef.current += 1;
        } else {
          const toggle = transcriptToggleMd(`${time}\n\n${got.transcript}`);
          insertMd(`${toggle}${audioBlock}`);
          queueTranscriptForOrganize(got.transcript);
          segOkRef.current += 1;
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
    // Only skip batch while realtime is actually live. After fallback (or if stream
    // never produced text), cuts must go through Google batch STT.
    const streaming =
      !forceBatchSttRef.current &&
      streamLiveRef.current &&
      streamOnRef.current &&
      m !== "audio";
    setStatus(
      m === "audio"
        ? `儲存「${label}」音檔…`
        : streaming
          ? `儲存「${label}」音檔（串流已出字）…`
          : `批次辨識「${label}」中…`
    );

    const result = (async (): Promise<{
      transcript: string;
      url: string;
      audioOnly?: boolean;
    } | null> => {
      try {
        const ext = extRef.current || "webm";
        const file = new File([blob], `live-${noteId}-${Date.now()}.${ext}`, {
          type: blob.type || "audio/webm",
        });
        const upPromise = uploadNoteMedia(uid, noteId, file).catch(() => null);

        if (m === "audio") {
          const up = await upPromise;
          upsertLine(lineId, { text: "音檔已儲存", state: "ready" });
          return { transcript: "", url: up?.url || "", audioOnly: true };
        }

        // Streaming already wrote finals into the note — only keep audio for this cut.
        if (streaming) {
          const up = await upPromise;
          upsertLine(lineId, { text: "音檔已附上（文字已由串流出）", state: "ready" });
          return { transcript: "", url: up?.url || "", audioOnly: true };
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
        segFailRef.current += 1;
        setStatus(`「${label}」失敗：${msg}`);
        toast(`${label}：${msg}`);
        return null;
      }
    })();

    jobsRef.current.push({ id: lineId, label, result });
    void drainJobs();
  };

  const stopStreamSession = async () => {
    const s = streamSessionRef.current;
    streamSessionRef.current = null;
    streamInterimIdRef.current = null;
    streamLiveRef.current = false;
    setStreamLive(false);
    if (streamSessionStartedAtRef.current) {
      const elapsed = Math.floor((Date.now() - streamSessionStartedAtRef.current) / 1000);
      streamSessionStartedAtRef.current = 0;
      if (elapsed > 0) setStreamUsedSecs(addStreamUsedSecs(elapsed));
    }
    if (!s) return;
    try {
      await s.stop();
    } catch {
      /* ignore */
    }
  };

  /** Drop realtime STT but keep mic/system recording + batch cuts running. */
  const fallbackToBatch = async (reason: "quota" | "error", detail?: string) => {
    if (!streamLiveRef.current && !streamSessionRef.current && !streamOnRef.current) return;
    forceBatchSttRef.current = true;
    streamOnRef.current = false;
    setStreamOn(false);
    flushStreamTranscriptToggle();
    await stopStreamSession();
    // Rebuild segment MediaRecorder — STT AudioContext on the same stream can poison it.
    try {
      await recRef.current?.rearmSegmentRecorder();
      segSecsRef.current = 0;
      setSegSecs(0);
    } catch {
      /* ignore */
    }
    const detailBit = detail?.trim() ? `（${detail.trim()}）` : "";
    const msg =
      reason === "quota"
        ? "即時額度已用完，已改切段批次（錄音未中斷）"
        : `即時串流中斷，已改切段批次（錄音未中斷）${detailBit}`;
    setStatus(msg);
    toast(msg);
  };
  fallbackToBatchRef.current = fallbackToBatch;

  const startStreamSession = async (media: MediaStream) => {
    await stopStreamSession();
    if (streamRemainingSecs() <= 0) {
      throw new Error("即時串流額度已用完");
    }
    // Clone tracks so ScriptProcessor/AudioContext never shares the MediaRecorder stream.
    const sttStream = new MediaStream(media.getAudioTracks().map((t) => t.clone()));
    if (!sttStream.getAudioTracks().length) {
      throw new Error("無法複製音訊軌道供即時辨識");
    }
    const session = new GoogleLiveSttSession({
      language,
      onEvent: (ev) => {
        if (ev.type === "interim") {
          const text = (ev.text || "").trim();
          if (!text) return;
          const existingId = streamInterimIdRef.current;
          if (!existingId) {
            const interimId = `stream-interim-${Date.now()}`;
            streamInterimIdRef.current = interimId;
            setLines((prev) => [
              ...prev.filter((l) => l.id !== interimId),
              { id: interimId, label: "即時", text, state: "pending" },
            ]);
          } else {
            upsertLine(existingId, { text, state: "pending" });
          }
          setStatus("即時辨識中…");
          return;
        }
        if (ev.type === "final") {
          const text = (ev.text || "").trim();
          const interimId = streamInterimIdRef.current;
          if (interimId) {
            setLines((prev) => prev.filter((l) => l.id !== interimId));
            streamInterimIdRef.current = null;
          }
          if (!text) return;
          const stamp = formatRecClock(secsRef.current);
          const lineId = `stream-final-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
          setLines((prev) => [...prev, { id: lineId, label: stamp, text, state: "ready" }]);
          streamTranscriptBufRef.current.push({ stamp, text });
          queueTranscriptForOrganize(text);
          setStatus("即時出字中…");
          return;
        }
        if (ev.type === "info" && ev.message) {
          setStatus(ev.message);
          return;
        }
        if (ev.type === "error") {
          void fallbackToBatchRef.current("error", ev.message);
        }
      },
    });
    streamSessionRef.current = session;
    try {
      await session.start({ language, stream: sttStream, ownStream: true });
    } catch (e) {
      sttStream.getTracks().forEach((t) => t.stop());
      streamSessionRef.current = null;
      throw e;
    }
    streamSessionStartedAtRef.current = Date.now();
    streamLiveRef.current = true;
    usedStreamThisSessionRef.current = true;
    lastStreamOrgAtRef.current = Date.now();
    setStreamLive(true);
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
          text:
            modeRef.current === "audio" ||
            (!forceBatchSttRef.current && streamLiveRef.current && streamOnRef.current)
              ? "儲存音檔中…"
              : "批次辨識中…",
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
    const src = audioSourceRef.current;
    const srcLabel = liveAudioSourceLabel(src);
    const useStream = streamOnRef.current && modeRef.current !== "audio";
    setStarting(true);
    setStatus(
      src === "system"
        ? "選擇要分享的分頁／視窗，並勾選分享音訊…"
        : src === "both"
          ? "請求麥克風，並選擇要分享音訊的分頁／視窗…"
          : "請求麥克風權限…"
    );
    setLines([]);
    setPending(0);
    setPendingOrg(0);
    pendingOrgTextsRef.current = [];
    setStopping(false);
    setDoneSummary(null);
    segOkRef.current = 0;
    segFailRef.current = 0;
    forceBatchSttRef.current = false;
    streamTranscriptBufRef.current = [];
    lastStreamOrgAtRef.current = 0;
    usedStreamThisSessionRef.current = false;
    jobsRef.current = [];
    secsRef.current = 0;
    try {
      const acquired = await acquireLiveAudioStream(src);
      const rec = new ContinuousDualRecorder();
      await rec.start(acquired.stream, acquired.release);
      recRef.current = rec;
      extRef.current = rec.extension || "webm";
      if (rec.mediaStream) startSilenceMonitor(rec.mediaStream);
      if (useStream && rec.mediaStream) {
        if (streamRemainingSecs() <= 0) {
          forceBatchSttRef.current = true;
          streamOnRef.current = false;
          setStreamOn(false);
          toast("即時額度已用完，改用切段批次");
        } else {
          setStatus("檢查即時串流是否可用…");
          const health = await fetchGoogleSttHealth();
          if (health && health.stream_enabled === false) {
            forceBatchSttRef.current = true;
            streamOnRef.current = false;
            setStreamOn(false);
            try {
              await rec.rearmSegmentRecorder();
            } catch {
              /* ignore */
            }
            toast("伺服器尚未開放即時串流，已改用切段批次");
          } else {
            setStatus("連接即時串流…");
            try {
              await startStreamSession(rec.mediaStream);
            } catch (e) {
              forceBatchSttRef.current = true;
              streamOnRef.current = false;
              setStreamOn(false);
              await stopStreamSession();
              try {
                await rec.rearmSegmentRecorder();
              } catch {
                /* ignore */
              }
              const msg = e instanceof Error ? e.message : "無法開啟即時串流";
              toast(`${msg} · 已改用切段批次`);
            }
          }
        }
      } else {
        forceBatchSttRef.current = true;
      }
      liveRef.current = true;
      setLive(true);
      setSecs(0);
      setSegSecs(0);
      segSecsRef.current = 0;
      labelSeqRef.current = 0;
      const srcBit = `來源：${srcLabel}`;
      const streamBit = streamOnRef.current && modeRef.current !== "audio" ? " · 即時串流" : "";
      if (modeRef.current === "audio") {
        setStatus(
          cutModeRef.current === "auto"
            ? `${srcBit} · 純錄製：講超過 ${minSecs}s 且停頓後切段存檔`
            : `${srcBit} · 純錄製：按「切段」存音檔`
        );
      } else if (streamOnRef.current && modeRef.current !== "audio") {
        setStatus(
          modeRef.current === "organize"
            ? `${srcBit}${streamBit} · 邊講邊出字；每 ${STREAM_ORGANIZE_EVERY_SECS / 60} 分鐘 AI 整理`
            : `${srcBit}${streamBit} · 邊講邊出字（不自動切段）`
        );
      } else if (modeRef.current === "transcribe") {
        setStatus(
          cutModeRef.current === "auto"
            ? `${srcBit} · 講超過 ${minSecs}s 且停頓後切段`
            : `${srcBit} · 按「切段」`
        );
      } else {
        setStatus(
          cutModeRef.current === "auto"
            ? `${srcBit} · ≥${minSecs}s 停頓切段；每 ${organizeEvery} 段整理`
            : `${srcBit} · 手動切段；需要時按「AI 整理」`
        );
      }
      tickRef.current = window.setInterval(() => {
        setSecs((s) => {
          const n = s + 1;
          secsRef.current = n;
          return n;
        });
        setSegSecs((s) => {
          const n = s + 1;
          segSecsRef.current = n;
          return n;
        });
        maybeStreamTimedOrganizeRef.current();
        if (streamLiveRef.current && streamSessionStartedAtRef.current) {
          const sessionElapsed = Math.floor(
            (Date.now() - streamSessionStartedAtRef.current) / 1000
          );
          const total = getStreamUsedSecs() + sessionElapsed;
          setStreamUsedSecs(total);
          if (total >= STREAM_QUOTA_MAX_SECS || sessionElapsed >= streamMaxSecs) {
            void fallbackToBatchRef.current("quota");
          }
        }
      }, 1000);
    } catch (e) {
      await stopStreamSession();
      setStatus(e instanceof Error ? e.message : "無法開始錄音");
      throw e;
    } finally {
      setStarting(false);
    }
  };

  const stop = async () => {
    if (stopping) return;
    setStopping(true);
    setDoneSummary(null);
    setDockHidden(false);
    setStarting(false);
    clearTimers();
    stopSilenceMonitor();
    await stopStreamSession();
    const rec = recRef.current;
    liveRef.current = false;
    setLive(false);
    setStatus("結束錄音，正在處理…請稍候，不要關閉頁面");
    toast("正在處理錄音…完成後會寫入筆記");
    if (!rec) {
      setStopping(false);
      setDoneSummary("沒有可處理的錄音");
      setStatus("沒有可處理的錄音");
      toast("沒有可處理的錄音");
      return;
    }
    try {
      const wasStreaming = usedStreamThisSessionRef.current;
      const { full, lastSegment } = await rec.stopAll();
      recRef.current = null;
      // Flush any buffered realtime lines before final organize / audio.
      flushStreamTranscriptToggle();
      if (lastSegment && !wasStreaming) {
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
        setStatus(
          modeRef.current === "audio"
            ? `處理「${label}」音檔中…`
            : `批次辨識「${label}」中…可能需要數十秒`
        );
        startSegJob(lastSegment, label, lineId);
      }
      await drainJobs();
      while (jobsRef.current.length) {
        setStatus(`還有 ${jobsRef.current.length} 段處理中…`);
        await drainJobs();
      }
      let organizedN = 0;
      if (modeRef.current === "organize" && pendingOrgTextsRef.current.length) {
        organizedN = pendingOrgTextsRef.current.length;
        setStatus(`AI 整理 ${organizedN} 段中…`);
        await flushOrganize(true);
      }
      let fullOk = false;
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
          fullOk = true;
        } catch {
          toast("完整音檔上傳失敗，段落音檔仍保留");
        }
      }
      const okN = segOkRef.current;
      const failN = segFailRef.current;
      const parts: string[] = [];
      if (okN > 0) {
        parts.push(
          modeRef.current === "audio" ? `已寫入 ${okN} 段音檔` : `已寫入 ${okN} 段文字`
        );
      }
      if (organizedN > 0) parts.push(`已整理 ${organizedN} 段`);
      if (fullOk) parts.push("完整音檔已附上");
      if (failN > 0) parts.push(`${failN} 段失敗`);
      const summary =
        parts.length > 0
          ? parts.join(" · ")
          : "這次沒有寫入內容（錄音可能太短，或尚未達到切段長度）";
      setStatus(summary);
      setDoneSummary(summary);
      toast(summary);
      setStopping(false);
    } catch (e) {
      toast(e instanceof Error ? e.message : "結束失敗");
      setStopping(false);
      setDoneSummary(null);
      setStatus("結束失敗，可再試一次");
    }
  };
  stopRef.current = stop;

  const cancelBoot = () => {
    clearTimers();
    stopSilenceMonitor();
    void stopStreamSession();
    void recRef.current?.stopAll();
    recRef.current = null;
    liveRef.current = false;
    setLive(false);
    setStarting(false);
    onClose();
  };

  useEffect(() => {
    if (!open) {
      startedRef.current = false;
      setDockHidden(false);
      setStopping(false);
      setDoneSummary(null);
      setStarting(false);
      setLive(false);
      liveRef.current = false;
      return;
    }
    if (autoStart && !startedRef.current && !liveRef.current) {
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
      void streamSessionRef.current?.stop();
      streamSessionRef.current = null;
      void recRef.current?.stopAll();
    };
  }, []);

  useEffect(() => {
    const el = previewScrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [lines]);

  useEffect(() => {
    if (!open) return;
    const spec = prefs?.liveHideDockShortcut || DEFAULT_LIVE_HIDE_DOCK_SHORTCUT;
    const onKey = (e: KeyboardEvent) => {
      if (!eventMatchesShortcut(e, spec)) return;
      e.preventDefault();
      e.stopPropagation();
      setDockHidden((h) => {
        const next = !h;
        if (next) toast(`錄製面板已隱藏 · ${formatShortcutLabel(spec)} 可再顯示`);
        return next;
      });
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, prefs?.liveHideDockShortcut]);

  if (!open) return null;

  const hideLabel = formatShortcutLabel(
    prefs?.liveHideDockShortcut || DEFAULT_LIVE_HIDE_DOCK_SHORTCUT
  );

  const pendingHint = pending > 0 ? ` · ${pending} 段處理中` : "";
  const orgHint = doOrganize && pendingOrg > 0 ? ` · 待整理 ${pendingOrg}` : "";
  const title =
    mode === "audio" ? "錄音" : mode === "transcribe" ? "錄音 · 轉錄" : "錄音 · 轉錄整理";
  const booting = starting || (autoStart && !live && !stopping && !doneSummary);
  const canPickSource = !live && !stopping && !booting && !doneSummary;
  const idle = !live && !stopping && !booting;
  const showPreview = lines.length > 0 || live || stopping || Boolean(doneSummary);
  const streamActive = doStt && streamOn && streamLive;
  const streamWanted = doStt && streamOn;
  const quotaLabel = formatStreamQuota(streamUsedSecs);
  const emptyHint = !doStt
    ? `≥${minSecs}s 停頓切段存檔`
    : streamWanted
      ? `即時串流 · ${quotaLabel} · 每 ${STREAM_ORGANIZE_EVERY_SECS / 60} 分鐘整理`
      : mode === "transcribe"
        ? `≥${minSecs}s 停頓切段轉字（批次）`
        : `≥${minSecs}s 切段批次 · 每 ${organizeEvery} 段整理`;

  return (
    <>
      {dockHidden ? (
        <button
          type="button"
          className={`voice-live-hidden-pill${stopping ? " is-busy" : ""}`}
          title={
            stopping
              ? "正在處理錄音…點此顯示進度"
              : `錄音進行中 · ${hideLabel} 或點此顯示面板`
          }
          aria-label={stopping ? "顯示處理進度" : "顯示錄製面板"}
          onClick={() => setDockHidden(false)}
        />
      ) : (
        <div
          className={`voice-live-dock${idle || booting ? " is-compact" : ""}${showPreview ? "" : " is-bare"}${stopping ? " is-processing" : ""}${doneSummary ? " is-done" : ""}`}
          role="dialog"
          aria-label={title}
          aria-busy={stopping || booting}
        >
          <div className="voice-live-dock-top">
            <div className="voice-live-dock-main">
              <div
                className={`voice-live-dock-pulse${live ? "" : " is-off"}${stopping ? " is-busy" : ""}`}
                aria-hidden
              />
              <div className="voice-live-dock-meta">
                <strong>
                  {stopping ? "處理中" : doneSummary ? "已完成" : title}
                  {live || stopping ? (
                    <span className="voice-live-source-badge">{liveAudioSourceLabel(audioSource)}</span>
                  ) : null}
                  {streamActive ? (
                    <span className="voice-live-source-badge is-stream">即時</span>
                  ) : live && doStt ? (
                    <span className="voice-live-source-badge">批次</span>
                  ) : null}
                </strong>
                {live || stopping || booting || doneSummary ? (
                  <span>
                    {live || stopping ? formatRecClock(secs) : doneSummary ? "—" : "—"} · 本段{" "}
                    {formatRecClock(segSecs)}
                    {cutMode === "auto" ? ` · ≥${minSecs}s` : " · 手動"}
                    {streamWanted || streamActive || streamUsedSecs > 0
                      ? ` · 即時 ${quotaLabel}`
                      : ""}
                    {pendingHint}
                    {orgHint}
                  </span>
                ) : doStt ? (
                  <span title="目前先提供 5 小時（300 分鐘）即時額度">
                    即時額度 {quotaLabel}
                  </span>
                ) : null}
                {(live || stopping || booting || doneSummary) && status ? (
                  <em title={status}>{status}</em>
                ) : null}
              </div>
            </div>

            {(canPickSource || booting) && (
              <div className="voice-live-source" role="group" aria-label="錄音來源">
                {AUDIO_SOURCES.map((src) => (
                  <button
                    key={src}
                    type="button"
                    className={`voice-live-source-chip${audioSource === src ? " is-on" : ""}`}
                    disabled={!canPickSource}
                    title={liveAudioSourceHint(src)}
                    onClick={() => {
                      setAudioSource(src);
                      setStatus(`目前：${liveAudioSourceLabel(src)}`);
                    }}
                  >
                    {src === "mic" ? "麥克風" : src === "system" ? "裝置" : "兩者"}
                  </button>
                ))}
                {doStt ? (
                  <button
                    type="button"
                    className={`voice-live-source-chip${streamOn ? " is-on" : ""}`}
                    disabled={
                      !canPickSource ||
                      streamRemainingSecs() <= 0 ||
                      streamServerOk === false
                    }
                    title={
                      streamServerOk === false
                        ? "伺服器尚未開放即時串流（Cloud Run stream_enabled=false），請用切段批次"
                        : streamRemainingSecs() <= 0
                          ? "即時額度已用完，目前僅切段批次"
                          : streamOn
                            ? `即時串流（${quotaLabel}，目前先提供 5 小時）。再按改回切段批次。`
                            : `開啟即時串流（${quotaLabel}，目前先提供 5 小時）`
                    }
                    onClick={() => {
                      if (streamServerOk === false) {
                        toast("伺服器尚未開放即時串流，請用切段批次");
                        return;
                      }
                      if (streamRemainingSecs() <= 0) {
                        toast("即時額度已用完");
                        return;
                      }
                      const next = !streamOn;
                      if (next) {
                        void fetchGoogleSttHealth().then((h) => {
                          if (h && h.stream_enabled === false) {
                            setStreamServerOk(false);
                            toast("伺服器尚未開放即時串流，請先用切段批次");
                            setStreamOn(false);
                            streamOnRef.current = false;
                            forceBatchSttRef.current = true;
                            prefsCtx?.setPrefs({ liveStreamStt: false });
                            return;
                          }
                          setStreamServerOk(true);
                          setStreamOn(true);
                          streamOnRef.current = true;
                          forceBatchSttRef.current = false;
                          prefsCtx?.setPrefs({ liveStreamStt: true });
                          setStatus(`已開即時串流（${quotaLabel}，目前先 5 小時）`);
                        });
                        return;
                      }
                      setStreamOn(false);
                      streamOnRef.current = false;
                      forceBatchSttRef.current = true;
                      prefsCtx?.setPrefs({ liveStreamStt: false });
                      setStatus("已改用切段批次（較省）");
                    }}
                  >
                    {streamServerOk === false
                      ? "切段（伺服器未開即時）"
                      : streamOn
                        ? `即時 ${quotaLabel}`
                        : "切段批次"}
                  </button>
                ) : null}
              </div>
            )}

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
              ) : doneSummary ? (
                <>
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => {
                      setDoneSummary(null);
                      setLines([]);
                      setStatus(
                        `選擇來源後開始（目前：${liveAudioSourceLabel(audioSource)}）`
                      );
                      void start().catch((e) => {
                        toast(e instanceof Error ? e.message : "無法開始錄音");
                      });
                    }}
                  >
                    再錄一段
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm btn-ghost"
                    onClick={() => {
                      setDoneSummary(null);
                      onClose();
                    }}
                  >
                    關閉
                  </button>
                </>
              ) : !live && !stopping ? (
                <>
                  <button
                    type="button"
                    className="btn btn-sm"
                    title={liveAudioSourceHint(audioSource)}
                    onClick={() =>
                      void start().catch((e) => {
                        toast(e instanceof Error ? e.message : "無法開始錄音");
                      })
                    }
                  >
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
                    className="btn btn-sm btn-ghost"
                    disabled={stopping}
                    title={`隱藏（${hideLabel}）`}
                    onClick={() => {
                      setDockHidden(true);
                      toast(
                        stopping
                          ? "面板已隱藏 · 仍在背景處理，點紅點可看進度"
                          : `錄製面板已隱藏 · ${hideLabel} 可再顯示`
                      );
                    }}
                  >
                    隱藏
                  </button>
                  <button
                    type="button"
                    className={`btn btn-sm btn-ghost${cutMode === "manual" ? " is-on" : ""}`}
                    disabled={stopping || streamActive}
                    title={
                      streamActive
                        ? "即時模式不自動切段"
                        : "切換自動／手動切段"
                    }
                    onClick={() => {
                      setCutMode((m) => {
                        const next = m === "auto" ? "manual" : "auto";
                        setStatus(
                          next === "auto"
                            ? `自動：≥${minSecs}s 停頓切段`
                            : "手動：按「切段」"
                        );
                        return next;
                      });
                    }}
                  >
                    {cutMode === "auto" ? "自動" : "手動"}
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm btn-soft"
                    disabled={!live || stopping || streamActive}
                    title={streamActive ? "即時模式不切段" : "手動切段"}
                    onClick={() => void cutParagraph(true, "manual")}
                  >
                    切段
                  </button>
                  {doOrganize ? (
                    <button
                      type="button"
                      className="btn btn-sm btn-soft"
                      disabled={stopping || orgBusy || pendingOrg === 0}
                      title="立即整理目前待整理段落"
                      onClick={() => void flushOrganize(true)}
                    >
                      {orgBusy ? "整理中…" : `整理${pendingOrg ? ` ${pendingOrg}` : ""}`}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="btn btn-sm"
                    disabled={stopping}
                    onClick={() => void stop()}
                  >
                    {stopping ? "處理中…" : "結束"}
                  </button>
                </>
              )}
            </div>
          </div>

          {stopping || doneSummary ? (
            <div
              className={`voice-live-progress${doneSummary ? " is-done" : " is-busy"}`}
              role="status"
              aria-live="polite"
            >
              <strong>{doneSummary ? "已寫入筆記" : "請稍候，正在處理"}</strong>
              <span>{doneSummary || status || "辨識／上傳中…"}</span>
              {stopping && pending > 0 ? <em>{pending} 段還在跑</em> : null}
            </div>
          ) : null}

          {showPreview ? (
            <div className="voice-live-preview" ref={previewScrollRef} aria-label="預覽">
              {lines.length === 0 ? (
                <p className="voice-live-preview-empty">
                  {stopping ? "正在整理最後一段…" : emptyHint}
                </p>
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
          ) : null}
        </div>
      )}
    </>
  );
}
