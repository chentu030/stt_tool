"use client";

import Image from "@tiptap/extension-image";
import {
  NodeViewWrapper,
  ReactNodeViewRenderer,
  type ReactNodeViewProps,
} from "@tiptap/react";
import React, { useEffect, useState } from "react";

function ImageUrlView({ node, updateAttributes }: ReactNodeViewProps) {
  const src = String(node.attrs.src || "");
  const alt = String(node.attrs.alt || "");
  const [draft, setDraft] = useState(src);
  const empty = !src.trim();

  useEffect(() => {
    setDraft(src);
  }, [src]);

  const commit = (raw: string) => {
    const url = raw.trim();
    updateAttributes({ src: url || null, alt: alt || undefined });
  };

  if (empty) {
    return (
      <NodeViewWrapper className="rich-image-shell is-empty" data-drag-handle>
        <div className="rich-bookmark-bar">
          <span className="rich-bookmark-label">圖片網址</span>
          <input
            className="rich-embed-url-input"
            type="url"
            inputMode="url"
            spellCheck={false}
            placeholder="貼上圖片網址…"
            value={draft}
            onMouseDown={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter") {
                e.preventDefault();
                commit(draft);
              }
            }}
            aria-label="圖片網址"
          />
        </div>
        <p className="rich-embed-empty-hint">可貼上網址後按 Enter；也可先留空。</p>
      </NodeViewWrapper>
    );
  }

  return (
    <NodeViewWrapper className="rich-image-shell" data-drag-handle>
      <div className="rich-bookmark-bar">
        <span className="rich-bookmark-label">圖片</span>
        <input
          className="rich-embed-url-input"
          type="url"
          inputMode="url"
          spellCheck={false}
          placeholder="圖片網址…"
          value={draft}
          onMouseDown={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter") {
              e.preventDefault();
              commit(draft);
            }
          }}
          aria-label="圖片網址"
        />
        <button
          type="button"
          className="rich-embed-clear"
          title="清除網址"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.preventDefault();
            setDraft("");
            updateAttributes({ src: null });
          }}
        >
          清除
        </button>
      </div>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className="rich-image" src={src} alt={alt} />
    </NodeViewWrapper>
  );
}

/** Image with in-note URL field (empty OK until URL entered). */
export const NoteImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      src: {
        default: null,
      },
    };
  },
  addNodeView() {
    return ReactNodeViewRenderer(ImageUrlView as never);
  },
});
