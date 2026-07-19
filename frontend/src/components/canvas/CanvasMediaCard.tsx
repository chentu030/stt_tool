"use client";

import type { CanvasMedia } from "@/lib/canvasStore";

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

type Props = {
  item: CanvasMedia;
  selected: boolean;
};

export default function CanvasMediaCard({ item, selected }: Props) {
  const label = LABELS[item.media] || "媒體";
  const href = item.originalUrl || item.url;
  const showFrame =
    item.frameable !== false &&
    (item.media === "youtube" || item.media === "web" || item.media === "pdf" || item.media === "ppt");

  return (
    <div
      className={`cv-media cv-media--${item.media}${selected ? " is-on" : ""}`}
      style={{ left: item.x, top: item.y, width: item.w, height: item.h, zIndex: item.z }}
    >
      <div className="cv-media-bar">
        <span className="cv-media-kind">{label}</span>
        <span className="cv-media-name" title={item.title}>
          {item.title || "未命名"}
        </span>
        <a
          href={href}
          target="_blank"
          rel="noreferrer"
          className="cv-media-open"
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
          <audio controls src={item.url} onPointerDown={(e) => e.stopPropagation()} />
        )}
        {item.media === "video" && (
          <video controls src={item.url} onPointerDown={(e) => e.stopPropagation()} />
        )}
        {showFrame && (
          <iframe
            src={item.url}
            title={item.title}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
            onPointerDown={(e) => e.stopPropagation()}
          />
        )}
        {(item.media === "file" ||
          item.media === "link" ||
          (item.media !== "image" && item.media !== "audio" && item.media !== "video" && !showFrame)) && (
          <a
            className="cv-media-file"
            href={href}
            target="_blank"
            rel="noreferrer"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
          >
            <strong>{item.title || "開啟檔案"}</strong>
            <span>{href.replace(/^https?:\/\//, "").slice(0, 72)}</span>
          </a>
        )}
      </div>
    </div>
  );
}
