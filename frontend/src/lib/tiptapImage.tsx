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
  readHideUrlBarFromElement,
  readLayoutFromAttrs,
  type MediaLayout,
} from "@/lib/mediaLayout";

/** GIF / APNG — Chromium can freeze these under CSS transform; restart when visible. */
function isAnimatedImageSrc(src: string): boolean {
  const s = (src || "").trim();
  if (!s) return false;
  if (/^data:image\/(gif|apng)\b/i.test(s)) return true;
  try {
    const path = decodeURIComponent(new URL(s, "https://local.invalid").pathname);
    return /\.(gif|apng)$/i.test(path);
  } catch {
    return /\.(gif|apng)(\?|#|$)/i.test(s);
  }
}

function ImageUrlView({
  node,
  updateAttributes,
  selected,
  editor,
  getPos,
  deleteNode,
}: ReactNodeViewProps) {
  const src = String(node.attrs.src || "");
  const alt = String(node.attrs.alt || "");
  const [draft, setDraft] = useState(src);
  const empty = !src.trim();
  const readOnly = !editor?.isEditable;
  const [localActive, setLocalActive] = useState(false);
  const imgRef = React.useRef<HTMLImageElement | null>(null);
  const isAnimated = !empty && isAnimatedImageSrc(src);

  useEffect(() => {
    setDraft(src);
  }, [src]);

  // Animated GIF/APNG under CSS transform / off-screen can freeze in Chromium — restart when visible.
  useEffect(() => {
    if (!isAnimated || !src) return;
    const img = imgRef.current;
    if (!img) return;
    const restart = () => {
      const cur = img.getAttribute("src") || src;
      img.removeAttribute("src");
      void img.offsetWidth;
      img.setAttribute("src", cur);
    };
    let wasVisible = false;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting && !wasVisible) {
            wasVisible = true;
            restart();
          } else if (!e.isIntersecting) {
            wasVisible = false;
          }
        }
      },
      { threshold: 0.05 }
    );
    io.observe(img);
    return () => io.disconnect();
  }, [isAnimated, src]);

  useEffect(() => {
    if (selected) setLocalActive(true);
  }, [selected]);

  // Hide chrome when clicking outside — also clear TipTap NodeSelection
  // (otherwise `selected` stays true and the toolbar never dismisses).
  useEffect(() => {
    if (readOnly) return;
    if (!localActive && !selected) return;
    const onDoc = (ev: PointerEvent) => {
      const t = ev.target as HTMLElement | null;
      if (
        t?.closest?.(
          ".rich-image-shell, .rich-media-frame, .rich-media-toolbar, .rich-media-wrap-pop"
        )
      ) {
        return;
      }
      setLocalActive(false);
      if (!editor) return;
      const pos = typeof getPos === "function" ? getPos() : null;
      if (typeof pos !== "number") return;
      const after = Math.min(pos + node.nodeSize, editor.state.doc.content.size);
      editor.chain().setTextSelection(after).run();
    };
    document.addEventListener("pointerdown", onDoc, true);
    return () => document.removeEventListener("pointerdown", onDoc, true);
  }, [localActive, selected, readOnly, editor, getPos, node.nodeSize]);

  const selectSelf = () => {
    if (!editor || readOnly) return;
    const pos = typeof getPos === "function" ? getPos() : null;
    if (typeof pos !== "number") return;
    setLocalActive(true);
    editor.commands.setNodeSelection(pos);
  };

  const commit = (raw: string) => {
    const url = raw.trim();
    updateAttributes({ src: url || null, alt: alt || undefined });
  };

  const patchLayout = (patch: Partial<MediaLayout>) => {
    updateAttributes(patch);
  };

  const removeSelf = () => {
    try {
      deleteNode();
    } catch {
      const pos = typeof getPos === "function" ? getPos() : null;
      if (typeof pos !== "number" || !editor) return;
      editor
        .chain()
        .focus()
        .command(({ tr, dispatch }) => {
          tr.delete(pos, pos + node.nodeSize);
          dispatch?.(tr);
          return true;
        })
        .run();
    }
  };

  const showChrome = (!!selected || localActive) && !readOnly;

  const emptyUrlBar = (
    <div className="rich-bookmark-bar" onPointerDown={() => selectSelf()}>
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
        onFocus={selectSelf}
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
  );

  const toolbarUrl = !empty ? (
    <>
      <span className="rich-media-toolbar-sep" />
      <input
        className="rich-media-toolbar-url"
        type="url"
        inputMode="url"
        spellCheck={false}
        placeholder="圖片網址…"
        title={draft || "圖片網址"}
        value={draft}
        onMouseDown={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
        onFocus={selectSelf}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          if (draft.trim() !== src.trim()) commit(draft);
        }}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter") {
            e.preventDefault();
            commit(draft);
            (e.target as HTMLInputElement).blur();
          }
        }}
        aria-label="圖片網址"
      />
      <button
        type="button"
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
    </>
  ) : null;

  const inner = empty ? (
    <>
      {emptyUrlBar}
      <p className="rich-embed-empty-hint">可貼上網址後按 Enter；也可先留空。</p>
    </>
  ) : (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      ref={imgRef}
      className={`rich-image${isAnimated ? " rich-image--animated" : ""}`}
      src={src}
      alt={alt}
      draggable={false}
      decoding="async"
      onPointerDown={(e) => {
        e.stopPropagation();
        selectSelf();
      }}
    />
  );

  return (
    <NodeViewWrapper
      className={`rich-image-shell${empty ? " is-empty" : ""}${showChrome ? " is-active" : ""}`}
      onClick={(e: React.MouseEvent) => {
        const t = e.target as HTMLElement;
        if (t.closest("input, button, a, textarea")) return;
        selectSelf();
      }}
    >
      <MediaLayoutChrome
        attrs={node.attrs as Record<string, unknown>}
        updateAttributes={patchLayout}
        onRequestSelect={selectSelf}
        onDelete={readOnly ? undefined : removeSelf}
        toolbarExtra={readOnly ? null : toolbarUrl}
        selected={showChrome}
        readOnly={!!readOnly}
      >
        {inner}
      </MediaLayoutChrome>
    </NodeViewWrapper>
  );
}

/** Image with in-note URL field + layout (size / align / wrap). */
export const NoteImage = Image.extend({
  selectable: true,
  draggable: true,
  addAttributes() {
    return {
      ...this.parent?.(),
      src: {
        default: null,
      },
      // Kept for old docs; URL now lives on the floating toolbar (no in-card bar).
      hideUrlBar: {
        default: true,
        parseHTML: (el: HTMLElement) => {
          const shell = el.closest(".rich-image-shell, .rich-media-frame") as HTMLElement | null;
          // Prefer explicit attr; otherwise default hidden (toolbar-only).
          if (shell?.hasAttribute("data-hide-url-bar") || el.hasAttribute("data-hide-url-bar")) {
            return readHideUrlBarFromElement(shell) || readHideUrlBarFromElement(el);
          }
          return true;
        },
        renderHTML: () => ({ "data-hide-url-bar": "1" }),
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
            hideUrlBar: true,
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
            hideUrlBar: true,
            ...layout,
          };
        },
      },
      {
        tag: "img[src]",
        getAttrs: (el) => {
          const img = el as HTMLImageElement;
          if (img.closest(".rich-image-shell, [data-note-embed]")) return false;
          const layout = readLayoutFromElementSafe(img);
          return {
            src: img.getAttribute("src"),
            alt: img.getAttribute("alt"),
            hideUrlBar: true,
            ...layout,
          };
        },
      },
    ];
  },
  renderHTML({ HTMLAttributes }) {
    const layout = readLayoutFromAttrs(HTMLAttributes as Record<string, unknown>);
    const data = layoutToDataAttrs(layout);
    const { hideUrlBar: _h, widthPct: _w, align: _a, wrap: _wr, offsetX: _x, offsetY: _y, ...rest } =
      HTMLAttributes as Record<string, unknown>;
    return [
      "div",
      mergeAttributes(
        { class: "rich-image-shell rich-media-frame", "data-hide-url-bar": "1" },
        data
      ),
      [
        "img",
        mergeAttributes(
          { class: "rich-image", "data-hide-url-bar": "1" },
          data,
          rest
        ),
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
