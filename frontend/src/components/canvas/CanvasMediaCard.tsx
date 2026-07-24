"use client";

import { useMemo, useRef } from "react";
import type { CanvasMedia } from "@/lib/canvasStore";
import { parseTranscript } from "@/lib/transcript";

const LABELS: Record<CanvasMedia["media"], string> = {
  image: "圖片",
  audio: "語音",
  video: "影片",
  youtube: "YouTube",
  pdf: "PDF",
  ppt: "簡報",
  file: "檔案",
  link: "連結",
  web: "網頁",
};

function formatTs(sec: number) {
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}

function youtubeSeekUrl(embedUrl: string, seconds: number): string {
  try {
    const u = new URL(embedUrl);
    u.searchParams.set("start", String(Math.max(0, Math.floor(seconds))));
    u.searchParams.set("autoplay", "1");
    return u.toString();
  } catch {
    return embedUrl;
  }
}

type Props = {
  item: CanvasMedia;
  selected: boolean;
  readOnly?: boolean;
  onTranscribe?: (id: string) => void;
  onSummarize?: (id: string) => void;
  onMindMap?: (id: string) => void;
  onSplitCards?: (id: string) => void;
  onAskAi?: (id: string) => void;
  onPatchMedia?: (id: string, patch: Partial<CanvasMedia>) => void;
};

export default function CanvasMediaCard({
  item,
  selected,
  readOnly,
  onTranscribe,
  onSummarize,
  onMindMap,
  onSplitCards,
  onAskAi,
  onPatchMedia,
}: Props) {
  const label = LABELS[item.media] || "媒體";
  const href = item.originalUrl || item.url;
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const showFrame =
    item.frameable !== false &&
    (item.media === "youtube" || item.media === "web" || item.media === "pdf" || item.media === "ppt");
  const canTranscribe =
    !readOnly && (item.media === "youtube" || item.media === "video" || item.media === "audio");
  const status = item.transcriptStatus || (item.transcript ? "done" : "idle");
  const busy = status === "queued" || status === "running";

  const segments = useMemo(() => {
    const raw = (item.transcript || "").trim();
    if (!raw) return [] as { start: number; text: string }[];
    const parsed = parseTranscript(raw);
    if (parsed.length) {
      return parsed.map((s) => ({ start: s.startSec ?? 0, text: s.text }));
    }
    return raw.split(/\n+/).filter(Boolean).map((text) => ({ start: 0, text }));
  }, [item.transcript]);

  const seekTo = (sec: number) => {
    if (item.media === "video" && videoRef.current) {
      videoRef.current.currentTime = sec;
      void videoRef.current.play().catch(() => {});
      return;
    }
    if (item.media === "audio" && audioRef.current) {
      audioRef.current.currentTime = sec;
      void audioRef.current.play().catch(() => {});
      return;
    }
    if (item.media === "youtube" && onPatchMedia) {
      onPatchMedia(item.id, { url: youtubeSeekUrl(item.url, sec) });
    }
  };

  const statusLabel =
    status === "queued"
      ? item.transcriptProgress || "排隊中"
      : status === "running"
        ? item.transcriptProgress || "處理中…"
        : status === "done"
          ? item.transcriptSource && item.transcriptSource !== "whisper"
            ? "已有字幕"
            : item.transcriptSource === "whisper"
              ? "已語音轉錄"
              : "已轉錄"
          : status === "error"
            ? "失敗"
            : "";

  return (
    <div
      className={`cv-media cv-media--${item.media}${selected ? " is-on" : ""}`}
      style={{ left: item.x, top: item.y, width: item.w, height: item.h, zIndex: item.z }}
      draggable={false}
      onDragStart={(e) => e.preventDefault()}
    >
      <div className="cv-media-bar">
        <span className="cv-media-kind">{label}</span>
        <span className="cv-media-name" title={item.title}>
          {item.title || "未命名"}
        </span>
        {statusLabel ? (
          <span
            className={`cv-media-badge${
              status === "running" || status === "queued"
                ? " is-run"
                : status === "done"
                  ? " is-done"
                  : status === "error"
                    ? " is-err"
                    : ""
            }`}
          >
            {statusLabel}
          </span>
        ) : null}
        {!readOnly && canTranscribe && (
          <div className="cv-media-actions" onPointerDown={(e) => e.stopPropagation()}>
            {!item.transcript && (
              <button type="button" disabled={busy || !onTranscribe} onClick={() => onTranscribe?.(item.id)}>
                {busy ? "…" : "轉錄"}
              </button>
            )}
            {(item.media === "youtube" || item.transcript) && onAskAi ? (
              <button type="button" disabled={busy} onClick={() => onAskAi(item.id)}>
                AI
              </button>
            ) : null}
            {item.transcript && (
              <>
                <button type="button" disabled={!onSummarize} onClick={() => onSummarize?.(item.id)}>
                  摘要
                </button>
                <button type="button" disabled={!onMindMap} onClick={() => onMindMap?.(item.id)}>
                  心智圖
                </button>
                <button type="button" disabled={!onSplitCards} onClick={() => onSplitCards?.(item.id)}>
                  拆卡
                </button>
              </>
            )}
          </div>
        )}
        <a
          href={href}
          target="_blank"
          rel="noreferrer"
          className="cv-media-open"
          draggable={false}
          onDragStart={(e) => e.preventDefault()}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          開
        </a>
      </div>
      <div className="cv-media-body">
        {item.media === "image" && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={item.url} alt={item.title} draggable={false} />
        )}
        {item.media === "audio" && (
          <audio
            ref={audioRef}
            controls
            src={item.url}
            onPointerDown={(e) => e.stopPropagation()}
          />
        )}
        {item.media === "video" && (
          <video
            ref={videoRef}
            controls
            src={item.url}
            onPointerDown={(e) => e.stopPropagation()}
          />
        )}
        {showFrame && (
          <iframe
            key={item.url}
            src={item.url}
            title={item.title}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
            onPointerDown={(e) => e.stopPropagation()}
          />
        )}
        {!showFrame &&
          item.media !== "image" &&
          item.media !== "audio" &&
          item.media !== "video" && (
          <div
            className={`cv-media-file${item.previewImage ? " cv-media-file--rich" : ""}`}
            draggable={false}
            onDragStart={(e) => e.preventDefault()}
          >
            {item.previewImage ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img className="cv-media-og" src={item.previewImage} alt="" draggable={false} />
            ) : null}
            <div className="cv-media-file-meta">
              <strong>{item.title || "開啟連結"}</strong>
              {item.description ? <p className="cv-media-desc">{item.description}</p> : null}
              <span title={href}>{href.replace(/^https?:\/\//, "")}</span>
            </div>
          </div>
        )}
      </div>
      {segments.length > 0 && (
        <div
          className="cv-media-tx"
          onPointerDown={(e) => e.stopPropagation()}
          onWheel={(e) => e.stopPropagation()}
        >
          {segments.slice(0, 80).map((seg, i) => (
            <button
              key={`${seg.start}-${i}`}
              type="button"
              className="cv-media-tx-line"
              onClick={() => seekTo(seg.start)}
              title="跳到此時間"
            >
              {seg.start > 0 && <span className="cv-media-tx-t">{formatTs(seg.start)}</span>}
              {seg.text}
            </button>
          ))}
        </div>
      )}
      {status === "error" && item.transcriptError && (
        <div className="cv-media-tx" style={{ color: "var(--danger)" }}>
          {item.transcriptError}
        </div>
      )}
    </div>
  );
}
