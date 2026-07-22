"use client";

import { useEffect, useRef, useState } from "react";
import { uploadNoteMedia } from "@/lib/firebase";
import { organizeLiveSegment } from "@/lib/googleStt";
import { GoogleLiveSttSession } from "@/lib/googleSttStream";
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

/** Audio paragraph cut for note attachment (text comes from streaming). */
const AUTO_SECS = 45;

type PreviewLine = {
  id: string;
  label: string;
  text: string;
  state: "pending" | "ready" | "live" | "error";
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
  const [status, setStatus] = useState("準備麥克風…");
  const [lines, setLines] = useState<PreviewLine[]>([]);
  const [interim, setInterim] = useState("");
  const [engineLabel, setEngineLabel] = useState("");
  const [stopping, setStopping] = useState(false);

  const recRef = useRef<ContinuousDualRecorder | null>(null);
  const sttRef = useRef<GoogleLiveSttSession | null>(null);
  const micRef = useRef<MediaStream | null>(null);
  const tickRef = useRef<number | null>(null);
  const autoRef = useRef<number | null>(null);
  const startedRef = useRef(false);
  const labelSeqRef = useRef(0);
  const liveRef = useRef(false);
  const rotatingRef = useRef(false);
  const previewScrollRef = useRef<HTMLDivElement | null>(null);
  const extRef = useRef("webm");
  /** Finals since last paragraph cut — for organize + audio attach. */
  const sinceCutRef = useRef<string[]>([]);
  const interimRef = useRef("");
  const insertQueueRef = useRef<Promise<void>>(Promise.resolve());

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

  const enqueueInsert = (fn: () => Promise<void> | void) => {
    insertQueueRef.current = insertQueueRef.current.then(fn).catch(() => {});
    return insertQueueRef.current;
  };

  const onFinalText = (text: string) => {
    const t = text.trim();
    if (!t) return;
    interimRef.current = "";
    setInterim("");
    labelSeqRef.current += 1;
    const label = `句 ${labelSeqRef.current}`;
    const id = `f-${Date.now()}-${labelSeqRef.current}`;
    setLines((prev) => [...prev, { id, label, text: t, state: "ready" }]);
    sinceCutRef.current.push(t);
    void enqueueInsert(() => {
      insertMd(`${t} `);
    });
    setStatus("即時出字中…");
  };

  const cutParagraph = async (manual = true) => {
    const rec = recRef.current;
    if (!rec || !liveRef.current || rotatingRef.current || stopping) return;
    rotatingRef.current = true;
    try {
      setStatus(manual ? "切段存音…" : "自動存音…");
      const blob = await rec.rotateSegment();
      setSegSecs(0);
      armAutoCut();
      const chunkText = sinceCutRef.current.join("").trim();
      sinceCutRef.current = [];
      if (interim.trim()) {
        // don't steal live interim into cut — leave for next final
      }
      if (!blob) {
        setStatus("音檔太短，略過存檔 · 文字仍持續");
        return;
      }
      const label = `音檔 ${new Date().toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit" })}`;
      const lineId = `a-${Date.now()}`;
      setLines((prev) => [
        ...prev,
        { id: lineId, label, text: chunkText || "（本段音檔）", state: "pending" },
      ]);

      void (async () => {
        try {
          const ext = extRef.current || "webm";
          const file = new File([blob], `live-${noteId}-${Date.now()}.${ext}`, {
            type: blob.type || "audio/webm",
          });
          const up = await uploadNoteMedia(uid, noteId, file);
          await enqueueInsert(() => {
            insertMd(
              `\n\n<audio class="rich-audio" data-note-audio="1" controls preload="metadata" src="${up.url}" title="${file.name}"></audio>\n\n`
            );
          });
          setLines((prev) =>
            prev.map((x) =>
              x.id === lineId ? { ...x, state: "ready", text: chunkText || "音檔已附上" } : x
            )
          );
          if (chunkText) {
            void organizeLiveSegment(chunkText)
              .then((organized) => {
                if (!organized.trim()) return;
                insertMd(`\n**整理**\n\n${organized}\n`);
              })
              .catch(() => {});
          }
          setStatus("音檔已附上 · 繼續即時辨識");
        } catch (e) {
          setLines((prev) =>
            prev.map((x) =>
              x.id === lineId
                ? { ...x, state: "error", text: e instanceof Error ? e.message : "上傳失敗" }
                : x
            )
          );
        }
      })();
    } finally {
      rotatingRef.current = false;
    }
  };

  const start = async () => {
    setStatus("請求麥克風與串流連線…");
    setLines([]);
    setInterim("");
    setStopping(false);
    sinceCutRef.current = [];
    labelSeqRef.current = 0;

    const mic = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    micRef.current = mic;

    const stt = new GoogleLiveSttSession({
      language,
      onEvent: (ev) => {
        if (ev.type === "ready") {
          const eng = [ev.engine, ev.model, ev.language].filter(Boolean).join(" · ");
          setEngineLabel(eng);
          setStatus("串流已連線 · 開始說話即會出字");
        } else if (ev.type === "interim") {
          interimRef.current = ev.text;
          setInterim(ev.text);
          setStatus("辨識中…");
        } else if (ev.type === "final") {
          onFinalText(ev.text);
        } else if (ev.type === "info") {
          setStatus(ev.message);
        } else if (ev.type === "error") {
          setStatus(ev.message);
          toast(ev.message);
        }
      },
    });
    sttRef.current = stt;
    await stt.start({ language, stream: mic, ownStream: false });

    const rec = new ContinuousDualRecorder();
    await rec.start(mic);
    recRef.current = rec;
    extRef.current = rec.extension || "webm";

    liveRef.current = true;
    setLive(true);
    setSecs(0);
    setSegSecs(0);
    setStatus("即時串流中 · 可按段落結束附上音檔");
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
    liveRef.current = false;
    setLive(false);
    setStatus("結束中…");

    try {
      await sttRef.current?.stop();
    } catch {
      /* ignore */
    }
    sttRef.current = null;

    const rec = recRef.current;
    recRef.current = null;
    let full: Blob | null = null;
    let lastSegment: Blob | null = null;
    if (rec) {
      ({ full, lastSegment } = await rec.stopAll());
    }
    micRef.current?.getTracks().forEach((t) => t.stop());
    micRef.current = null;

    const leftover = sinceCutRef.current.join("").trim();
    sinceCutRef.current = [];
    const pendingInterim = interimRef.current.trim();
    if (pendingInterim) {
      onFinalText(pendingInterim);
      interimRef.current = "";
      setInterim("");
    }

    const audioBlob = lastSegment && lastSegment.size > 800 ? lastSegment : null;
    if (audioBlob) {
      try {
        const ext = extRef.current || "webm";
        const file = new File([audioBlob], `live-last-${noteId}-${Date.now()}.${ext}`, {
          type: audioBlob.type || "audio/webm",
        });
        const up = await uploadNoteMedia(uid, noteId, file);
        insertMd(
          `\n\n<audio class="rich-audio" data-note-audio="1" controls preload="metadata" src="${up.url}"></audio>\n`
        );
        if (leftover) {
          void organizeLiveSegment(leftover)
            .then((o) => {
              if (o.trim()) insertMd(`\n**整理**\n\n${o}\n`);
            })
            .catch(() => {});
        }
      } catch {
        /* ignore */
      }
    }

    await insertQueueRef.current;

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
        toast("完整音檔上傳失敗");
      }
    }
    setStatus("已結束");
    onClose();
  };

  useEffect(() => {
    if (!open) return;
    if (autoStart && !startedRef.current) {
      startedRef.current = true;
      void start().catch((e) => {
        toast(e instanceof Error ? e.message : "無法開始即時轉錄");
        onClose();
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, autoStart]);

  useEffect(() => {
    return () => {
      clearTimers();
      void sttRef.current?.stop();
      void recRef.current?.stopAll();
      micRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  useEffect(() => {
    const el = previewScrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [lines, interim]);

  if (!open) return null;

  return (
    <div className="voice-live-dock" role="dialog" aria-label="即時錄音轉錄">
      <div className="voice-live-dock-top">
        <div className="voice-live-dock-main">
          <div className={`voice-live-dock-pulse${live ? "" : " is-off"}`} aria-hidden />
          <div className="voice-live-dock-meta">
            <strong>即時轉錄</strong>
            <span>
              {live || stopping ? formatRecClock(secs) : "—"} · 本段音檔{" "}
              {formatRecClock(segSecs)} / {AUTO_SECS}s
              {engineLabel ? ` · ${engineLabel}` : ""}
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
                title="立刻把目前音檔附到筆記（文字已即時寫入）"
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

      <div className="voice-live-preview" ref={previewScrollRef} aria-label="即時逐字稿預覽">
        {lines.length === 0 && !interim ? (
          <p className="voice-live-preview-empty">
            說話後會出現暫定文字（會跳動修正），停頓後鎖定為最終結果並寫入筆記。可往上捲動回顧。
          </p>
        ) : (
          <>
            {lines.map((line) => (
              <div key={line.id} className={`voice-live-line is-${line.state}`}>
                <header>
                  <strong>{line.label}</strong>
                  <span>
                    {line.state === "pending"
                      ? "處理中"
                      : line.state === "error"
                        ? "失敗"
                        : "完成"}
                  </span>
                </header>
                <p>{line.text}</p>
              </div>
            ))}
            {interim ? (
              <div className="voice-live-line is-live">
                <header>
                  <strong>暫定</strong>
                  <span>修正中</span>
                </header>
                <p>{interim}</p>
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
