"use client";

import {
  NodeViewWrapper,
  ReactNodeViewRenderer,
  type ReactNodeViewProps,
} from "@tiptap/react";
import React, { useEffect, useRef } from "react";

function NoteVideoView({ node, updateAttributes, selected, editor }: ReactNodeViewProps) {
  const src = String(node.attrs.src || "");
  const title = (node.attrs.title as string | null) || null;
  const loop = node.attrs.loop !== false && node.attrs.loop !== "false" && node.attrs.loop !== 0;
  const readOnly = !editor?.isEditable;
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    el.loop = !!loop;
  }, [loop]);

  return (
    <NodeViewWrapper
      className={`rich-video-wrap${selected ? " is-selected" : ""}`}
      data-note-video-wrap="1"
      data-loop={loop ? "1" : "0"}
    >
      <video
        ref={videoRef}
        className="rich-video"
        data-note-video="1"
        data-loop={loop ? "1" : "0"}
        controls
        playsInline
        preload="metadata"
        loop={loop || undefined}
        src={src || undefined}
        title={title || undefined}
        draggable={false}
      />
      {!readOnly && src ? (
        <div className="rich-video-actions" contentEditable={false}>
          <button
            type="button"
            className={`btn btn-soft btn-sm rich-video-loop-btn${loop ? " is-on" : ""}`}
            title={loop ? "循環播放中 · 再按可改為播完即停" : "已關閉循環 · 再按可開啟"}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              updateAttributes({ loop: !loop });
            }}
          >
            {loop ? "循環：開" : "循環：關"}
          </button>
        </div>
      ) : null}
    </NodeViewWrapper>
  );
}

export function noteVideoNodeView() {
  return ReactNodeViewRenderer(NoteVideoView);
}
