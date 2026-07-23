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
  const hideUrlBar = !!node.attrs.hideUrlBar;
  const [draft, setDraft] = useState(src);
  const empty = !src.trim();
  const readOnly = !editor?.isEditable;
  const [localActive, setLocalActive] = useState(false);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    setDraft(src);
  }, [src]);

  useEffect(() => {
    if (selected) setLocalActive(true);
  }, [selected]);

  useEffect(() => {
    if (!localActive || selected) return;
    const onDoc = (ev: PointerEvent) => {
      const t = ev.target as HTMLElement | null;
      if (t?.closest?.(".rich-image-shell, .rich-media-toolbar, .rich-media-wrap-pop, .rich-image-ctx"))
        return;
      setLocalActive(false);
    };
    document.addEventListener("pointerdown", onDoc, true);
    return () => document.removeEventListener("pointerdown", onDoc, true);
  }, [localActive, selected]);

  useEffect(() => {
    if (!ctxMenu) return;
    const close = (ev?: Event) => {
      const t = (ev as Event & { target?: EventTarget | null })?.target as HTMLElement | null;
      if (t?.closest?.(".rich-image-ctx")) return;
      setCtxMenu(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setCtxMenu(null);
    };
    const onScroll = () => setCtxMenu(null);
    window.addEventListener("pointerdown", close, true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      window.removeEventListener("pointerdown", close, true);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [ctxMenu]);

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

  const showChrome = (!!selected || localActive) && !readOnly;
  const showUrlBar = empty || !hideUrlBar;

  const openCtxMenu = (e: React.MouseEvent) => {
    if (readOnly || empty) return;
    e.preventDefault();
    e.stopPropagation();
    selectSelf();
    setCtxMenu({ x: e.clientX, y: e.clientY });
  };

  const urlBar = (
    <div className="rich-bookmark-bar" onPointerDown={() => selectSelf()}>
      <span className="rich-bookmark-label">{empty ? "圖片網址" : "圖片"}</span>
      <input
        className="rich-embed-url-input"
        type="url"
        inputMode="url"
        spellCheck={false}
        placeholder={empty ? "貼上圖片網址…" : "圖片網址…"}
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
      {!empty && (
        <>
          <button
            type="button"
            className="rich-embed-clear"
            title="隱藏網址列"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.preventDefault();
              updateAttributes({ hideUrlBar: true });
            }}
          >
            隱藏
          </button>
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
          <button
            type="button"
            className="rich-embed-clear"
            title="移除圖片"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.preventDefault();
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
            }}
          >
            刪除
          </button>
        </>
      )}
    </div>
  );

  const inner = empty ? (
    <>
      {urlBar}
      <p className="rich-embed-empty-hint">可貼上網址後按 Enter；也可先留空。</p>
    </>
  ) : (
    <>
      {showUrlBar ? urlBar : null}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        className="rich-image"
        src={src}
        alt={alt}
        draggable={false}
        onPointerDown={(e) => {
          // Select for layout chrome; don't start block-drag.
          e.stopPropagation();
          selectSelf();
        }}
        onContextMenu={openCtxMenu}
      />
    </>
  );

  return (
    <NodeViewWrapper
      className={`rich-image-shell${empty ? " is-empty" : ""}${showChrome ? " is-active" : ""}${
        hideUrlBar && !empty ? " is-urlbar-hidden" : ""
      }`}
      onClick={(e: React.MouseEvent) => {
        const t = e.target as HTMLElement;
        if (t.closest("input, button, a, textarea, .rich-image-ctx")) return;
        selectSelf();
      }}
      onContextMenu={(e: React.MouseEvent) => {
        const t = e.target as HTMLElement;
        if (t.closest("input, button, a, textarea")) return;
        openCtxMenu(e);
      }}
    >
      <MediaLayoutChrome
        attrs={node.attrs as Record<string, unknown>}
        updateAttributes={patchLayout}
        onRequestSelect={selectSelf}
        onDelete={
          readOnly
            ? undefined
            : () => {
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
              }
        }
        selected={showChrome}
        readOnly={!!readOnly}
      >
        {inner}
      </MediaLayoutChrome>
      {ctxMenu && !readOnly && !empty ? (
        <div
          className="rich-image-ctx"
          role="menu"
          style={{ left: ctxMenu.x, top: ctxMenu.y }}
          onPointerDown={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            role="menuitem"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              updateAttributes({ hideUrlBar: !hideUrlBar });
              setCtxMenu(null);
            }}
          >
            {hideUrlBar ? "顯示網址列" : "隱藏網址列"}
          </button>
        </div>
      ) : null}
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
      hideUrlBar: {
        default: false,
        parseHTML: (el: HTMLElement) => {
          const shell = el.closest(".rich-image-shell, .rich-media-frame") as HTMLElement | null;
          return readHideUrlBarFromElement(shell) || readHideUrlBarFromElement(el);
        },
        renderHTML: (attrs: Record<string, unknown>) =>
          attrs.hideUrlBar ? { "data-hide-url-bar": "1" } : {},
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
            hideUrlBar: readHideUrlBarFromElement(shell) || readHideUrlBarFromElement(img),
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
            hideUrlBar: readHideUrlBarFromElement(img),
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
            hideUrlBar: readHideUrlBarFromElement(img),
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
    const hideUrlBar = !!HTMLAttributes.hideUrlBar;
    return [
      "div",
      mergeAttributes({
        class: "rich-image-shell rich-media-frame",
        ...layoutToDataAttrs(layout),
        ...(hideUrlBar ? { "data-hide-url-bar": "1" } : {}),
      }),
      [
        "img",
        mergeAttributes({
          class: "rich-image",
          src,
          alt,
          ...layoutToDataAttrs(layout),
          ...(hideUrlBar ? { "data-hide-url-bar": "1" } : {}),
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
