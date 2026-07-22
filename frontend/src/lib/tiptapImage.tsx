"use client";

import Image from "@tiptap/extension-image";
import { mergeAttributes } from "@tiptap/core";
import {
  NodeViewWrapper,
  ReactNodeViewRenderer,
  type ReactNodeViewProps,
} from "@tiptap/react";
import React, { useEffect, useState } from "react";
import MediaLayoutChrome from "@/components/notes/MediaLayoutChrome";
import {
  layoutToDataAttrs,
  mediaLayoutTipTapAttributes,
  readLayoutFromAttrs,
  type MediaLayout,
} from "@/lib/mediaLayout";

function ImageUrlView({ node, updateAttributes, selected, editor }: ReactNodeViewProps) {
  const src = String(node.attrs.src || "");
  const alt = String(node.attrs.alt || "");
  const [draft, setDraft] = useState(src);
  const empty = !src.trim();
  const readOnly = !editor?.isEditable;

  useEffect(() => {
    setDraft(src);
  }, [src]);

  const commit = (raw: string) => {
    const url = raw.trim();
    updateAttributes({ src: url || null, alt: alt || undefined });
  };

  const patchLayout = (patch: Partial<MediaLayout>) => {
    updateAttributes(patch);
  };

  const inner = empty ? (
    <>
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
    </>
  ) : (
    <>
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
      <img className="rich-image" src={src} alt={alt} draggable={false} />
    </>
  );

  return (
    <NodeViewWrapper
      className={`rich-image-shell${empty ? " is-empty" : ""}`}
      data-drag-handle
    >
      <MediaLayoutChrome
        attrs={node.attrs as Record<string, unknown>}
        updateAttributes={patchLayout}
        selected={!!selected}
        readOnly={!!readOnly}
      >
        {inner}
      </MediaLayoutChrome>
    </NodeViewWrapper>
  );
}

/** Image with in-note URL field + layout (size / align / wrap). */
export const NoteImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      src: {
        default: null,
      },
      ...mediaLayoutTipTapAttributes(),
    };
  },
  parseHTML() {
    return [
      {
        tag: "div.rich-image-shell img.rich-image",
        getAttrs: (el) => {
          const img = el as HTMLImageElement;
          const shell = img.closest(".rich-image-shell, .rich-media-frame") as HTMLElement | null;
          const layout = readLayoutFromAttrs({
            widthPct: shell?.getAttribute("data-width-pct") ?? img.getAttribute("data-width-pct"),
            align: shell?.getAttribute("data-align") ?? img.getAttribute("data-align"),
            wrap: shell?.getAttribute("data-wrap") ?? img.getAttribute("data-wrap"),
            offsetX: shell?.getAttribute("data-ox") ?? img.getAttribute("data-ox"),
            offsetY: shell?.getAttribute("data-oy") ?? img.getAttribute("data-oy"),
          });
          return {
            src: img.getAttribute("src"),
            alt: img.getAttribute("alt"),
            ...layout,
          };
        },
      },
      {
        tag: "img.rich-image",
        getAttrs: (el) => {
          const img = el as HTMLImageElement;
          const layout = readLayoutFromElementSafe(img);
          return {
            src: img.getAttribute("src"),
            alt: img.getAttribute("alt"),
            ...layout,
          };
        },
      },
      {
        tag: "img[src]",
        getAttrs: (el) => {
          const img = el as HTMLImageElement;
          if (img.closest("[data-note-embed], .rich-embed-favicon")) return false;
          const layout = readLayoutFromElementSafe(img);
          return {
            src: img.getAttribute("src"),
            alt: img.getAttribute("alt"),
            ...layout,
          };
        },
      },
    ];
  },
  renderHTML({ HTMLAttributes }) {
    const layout = readLayoutFromAttrs(HTMLAttributes);
    const src = HTMLAttributes.src;
    const alt = HTMLAttributes.alt || "";
    return [
      "div",
      mergeAttributes({
        class: "rich-image-shell rich-media-frame",
        ...layoutToDataAttrs(layout),
      }),
      [
        "img",
        mergeAttributes({
          class: "rich-image",
          src,
          alt,
          ...layoutToDataAttrs(layout),
        }),
      ],
    ];
  },
  addNodeView() {
    return ReactNodeViewRenderer(ImageUrlView as never);
  },
});

function readLayoutFromElementSafe(el: HTMLElement) {
  return readLayoutFromAttrs({
    widthPct: el.getAttribute("data-width-pct"),
    align: el.getAttribute("data-align"),
    wrap: el.getAttribute("data-wrap"),
    offsetX: el.getAttribute("data-ox"),
    offsetY: el.getAttribute("data-oy"),
  });
}
