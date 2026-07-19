/** TipTap layout nodes: columns + toggle heading */

import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer, NodeViewWrapper, NodeViewContent } from "@tiptap/react";
import React from "react";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    columns: { setColumns: (count: 2 | 3 | 4 | 5) => ReturnType };
    toggleHeading: { setToggleHeading: (level: 1 | 2 | 3 | 4, title?: string) => ReturnType };
  }
}

function ColumnView() {
  return (
    <NodeViewWrapper className="rich-column" data-note-column="1">
      <NodeViewContent className="rich-column-inner" />
    </NodeViewWrapper>
  );
}

export const Column = Node.create({
  name: "column",
  content: "block+",
  isolating: true,
  defining: true,
  parseHTML() {
    return [{ tag: "div[data-note-column]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { class: "rich-column", "data-note-column": "1" }), 0];
  },
  addNodeView() {
    return ReactNodeViewRenderer(ColumnView as never);
  },
});

export const Columns = Node.create({
  name: "columns",
  group: "block",
  content: "column{2,5}",
  defining: true,
  parseHTML() {
    return [
      {
        tag: "div[data-note-columns]",
        getAttrs: (el) => ({
          count: Number((el as HTMLElement).getAttribute("data-count") || "2") || 2,
        }),
      },
    ];
  },
  addAttributes() {
    return {
      count: { default: 2 },
    };
  },
  renderHTML({ HTMLAttributes }) {
    const count = HTMLAttributes.count || 2;
    return [
      "div",
      mergeAttributes({
        class: `rich-columns rich-columns--${count}`,
        "data-note-columns": "1",
        "data-count": String(count),
      }),
      0,
    ];
  },
  addCommands() {
    return {
      setColumns:
        (count: 2 | 3 | 4 | 5) =>
        ({ commands }) => {
          const cols = Array.from({ length: count }, () => ({
            type: "column",
            content: [{ type: "paragraph" }],
          }));
          return commands.insertContent({
            type: this.name,
            attrs: { count },
            content: cols,
          });
        },
    };
  },
});

function ToggleHeadingView({
  node,
  updateAttributes,
}: {
  node: { attrs: { title: string; open: boolean; level: number } };
  updateAttributes: (a: Record<string, unknown>) => void;
}) {
  const open = !!node.attrs.open;
  const level = Math.min(4, Math.max(1, Number(node.attrs.level) || 1));
  return (
    <NodeViewWrapper
      className={`rich-toggle-heading rich-toggle-heading--h${level}${open ? " is-open" : ""}`}
      data-note-toggle-heading="1"
      data-level={level}
      data-open={open ? "1" : "0"}
      data-title={node.attrs.title || ""}
    >
      <div className="rich-toggle-heading-head" contentEditable={false}>
        <button
          type="button"
          className="rich-toggle-chevron"
          onClick={() => updateAttributes({ open: !open })}
          aria-label={open ? "收合" : "展開"}
        >
          {open ? "▾" : "▸"}
        </button>
        <input
          className={`rich-toggle-heading-title rich-toggle-heading-title--h${level}`}
          value={node.attrs.title || ""}
          onChange={(e) => updateAttributes({ title: e.target.value })}
          placeholder={`摺疊標題 ${level}`}
        />
      </div>
      <NodeViewContent
        className="rich-toggle-heading-body"
        style={{ display: open ? undefined : "none" }}
      />
    </NodeViewWrapper>
  );
}

export const ToggleHeading = Node.create({
  name: "toggleHeading",
  group: "block",
  content: "block+",
  defining: true,
  addAttributes() {
    return {
      title: { default: "摺疊標題" },
      open: { default: true },
      level: { default: 1 },
    };
  },
  parseHTML() {
    return [
      {
        tag: "div[data-note-toggle-heading]",
        getAttrs: (el) => {
          const d = el as HTMLElement;
          return {
            title: d.getAttribute("data-title") || "摺疊標題",
            open: d.getAttribute("data-open") !== "0",
            level: Number(d.getAttribute("data-level") || "1") || 1,
          };
        },
      },
    ];
  },
  renderHTML({ HTMLAttributes }) {
    const level = HTMLAttributes.level || 1;
    return [
      "div",
      mergeAttributes({
        class: `rich-toggle-heading rich-toggle-heading--h${level}`,
        "data-note-toggle-heading": "1",
        "data-title": HTMLAttributes.title || "摺疊標題",
        "data-open": HTMLAttributes.open ? "1" : "0",
        "data-level": String(level),
      }),
      0,
    ];
  },
  addNodeView() {
    return ReactNodeViewRenderer(ToggleHeadingView as never);
  },
  addCommands() {
    return {
      setToggleHeading:
        (level: 1 | 2 | 3 | 4, title?: string) =>
        ({ commands }) =>
          commands.insertContent({
            type: this.name,
            attrs: {
              level,
              title: title || `摺疊標題 ${level}`,
              open: true,
            },
            content: [{ type: "paragraph", content: [{ type: "text", text: "折疊內文…" }] }],
          }),
    };
  },
});
