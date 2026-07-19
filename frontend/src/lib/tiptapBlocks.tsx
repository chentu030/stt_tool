/** TipTap block nodes: callout, toggle, toc, bookmark, app cards */

import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer, NodeViewWrapper, NodeViewContent } from "@tiptap/react";
import React, { useEffect, useState } from "react";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    callout: { setCallout: (tone?: string) => ReturnType };
    toggleBlock: { setToggleBlock: (title?: string) => ReturnType };
    tocBlock: { setTocBlock: () => ReturnType };
    bookmark: { setBookmark: (attrs: { href: string; title?: string }) => ReturnType };
    appCard: {
      setAppCard: (attrs: { href: string; kind: string; title: string; hint?: string }) => ReturnType;
    };
    templateBtn: {
      setTemplateBtn: (attrs: { templateId: string; label: string }) => ReturnType;
    };
  }
}

const TONES = ["info", "tip", "warn", "danger"] as const;

function CalloutView({ node, updateAttributes }: {
  node: { attrs: { tone: string } };
  updateAttributes: (a: Record<string, string>) => void;
}) {
  const tone = node.attrs.tone || "info";
  return (
    <NodeViewWrapper className={`rich-callout rich-callout--${tone}`} data-tone={tone} data-note-callout="1">
      <select
        className="rich-callout-tone"
        contentEditable={false}
        value={tone}
        onChange={(e) => updateAttributes({ tone: e.target.value })}
      >
        {TONES.map((t) => (
          <option key={t} value={t}>{t}</option>
        ))}
      </select>
      <NodeViewContent className="rich-callout-body" />
    </NodeViewWrapper>
  );
}

export const Callout = Node.create({
  name: "callout",
  group: "block",
  content: "block+",
  defining: true,
  addAttributes() {
    return { tone: { default: "info" } };
  },
  parseHTML() {
    return [
      {
        tag: "aside[data-note-callout]",
        getAttrs: (el) => ({ tone: (el as HTMLElement).getAttribute("data-tone") || "info" }),
      },
    ];
  },
  renderHTML({ HTMLAttributes }) {
    const tone = HTMLAttributes.tone || "info";
    return [
      "aside",
      mergeAttributes({
        class: `rich-callout rich-callout--${tone}`,
        "data-note-callout": "1",
        "data-tone": tone,
      }),
      0,
    ];
  },
  addNodeView() {
    return ReactNodeViewRenderer(CalloutView as never);
  },
  addCommands() {
    return {
      setCallout:
        (tone = "info") =>
        ({ commands }) =>
          commands.insertContent({
            type: this.name,
            attrs: { tone },
            content: [{ type: "paragraph", content: [{ type: "text", text: "在此寫重點提示…" }] }],
          }),
    };
  },
});

function ToggleView({
  node,
  updateAttributes,
}: {
  node: { attrs: { title: string; open: boolean } };
  updateAttributes: (a: Record<string, unknown>) => void;
}) {
  const open = !!node.attrs.open;
  return (
    <NodeViewWrapper
      className={`rich-toggle${open ? " is-open" : ""}`}
      data-note-toggle="1"
      data-open={open ? "1" : "0"}
      data-title={node.attrs.title || "詳細"}
    >
      <div className="rich-toggle-head" contentEditable={false}>
        <button
          type="button"
          className="rich-toggle-chevron"
          onClick={() => updateAttributes({ open: !open })}
        >
          {open ? "▾" : "▸"}
        </button>
        <input
          className="rich-toggle-title"
          value={node.attrs.title || ""}
          onChange={(e) => updateAttributes({ title: e.target.value })}
          placeholder="折疊標題"
        />
      </div>
      <NodeViewContent
        className="rich-toggle-body"
        style={{ display: open ? undefined : "none" }}
      />
    </NodeViewWrapper>
  );
}

export const ToggleBlock = Node.create({
  name: "toggleBlock",
  group: "block",
  content: "block+",
  defining: true,
  addAttributes() {
    return {
      title: { default: "詳細內容" },
      open: { default: true },
    };
  },
  parseHTML() {
    return [
      {
        tag: "div[data-note-toggle]",
        getAttrs: (el) => {
          const d = el as HTMLElement;
          return {
            title: d.getAttribute("data-title") || "詳細內容",
            open: d.getAttribute("data-open") !== "0",
          };
        },
      },
    ];
  },
  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes({
        class: "rich-toggle",
        "data-note-toggle": "1",
        "data-title": HTMLAttributes.title || "詳細內容",
        "data-open": HTMLAttributes.open ? "1" : "0",
      }),
      0,
    ];
  },
  addNodeView() {
    return ReactNodeViewRenderer(ToggleView as never);
  },
  addCommands() {
    return {
      setToggleBlock:
        (title = "詳細內容") =>
        ({ commands }) =>
          commands.insertContent({
            type: this.name,
            attrs: { title, open: true },
            content: [{ type: "paragraph", content: [{ type: "text", text: "折疊內文…" }] }],
          }),
    };
  },
});

function TocView({
  editor,
}: {
  editor: {
    state: {
      doc: {
        descendants: (
          fn: (node: {
            type: { name: string };
            attrs: { level?: number };
            textContent: string;
          }) => void
        ) => void;
      };
    };
    on: (event: string, cb: () => void) => void;
    off: (event: string, cb: () => void) => void;
  };
}) {
  const [items, setItems] = useState<{ level: number; text: string }[]>([]);
  useEffect(() => {
    const collect = () => {
      const next: { level: number; text: string }[] = [];
      editor.state.doc.descendants((node) => {
        if (node.type.name === "heading") {
          const text = (node.textContent || "").trim();
          if (text) next.push({ level: node.attrs.level || 1, text });
        }
      });
      setItems(next);
    };
    collect();
    editor.on("update", collect);
    return () => {
      editor.off("update", collect);
    };
  }, [editor]);

  return (
    <NodeViewWrapper className="rich-toc" data-note-toc="1" contentEditable={false}>
      <p className="rich-toc-label">目錄</p>
      {items.length === 0 ? (
        <p className="rich-toc-empty">尚無標題（用 H1–H3）</p>
      ) : (
        <ul>
          {items.map((h, i) => (
            <li key={`${i}-${h.text}`} className={`level-${h.level}`}>
              {h.text}
            </li>
          ))}
        </ul>
      )}
    </NodeViewWrapper>
  );
}

export const TocBlock = Node.create({
  name: "tocBlock",
  group: "block",
  atom: true,
  selectable: true,
  parseHTML() {
    return [{ tag: "nav[data-note-toc]" }];
  },
  renderHTML() {
    return ["nav", { class: "rich-toc", "data-note-toc": "1" }, ["p", {}, "目錄"]];
  },
  addNodeView() {
    return ReactNodeViewRenderer(TocView as never);
  },
  addCommands() {
    return {
      setTocBlock:
        () =>
        ({ commands }) =>
          commands.insertContent({ type: this.name }),
    };
  },
});

export const Bookmark = Node.create({
  name: "bookmark",
  group: "block",
  atom: true,
  selectable: true,
  addAttributes() {
    return {
      href: { default: "" },
      title: { default: "" },
    };
  },
  parseHTML() {
    return [
      {
        tag: "a[data-note-bookmark]",
        getAttrs: (el) => ({
          href: (el as HTMLElement).getAttribute("href") || "",
          title: (el as HTMLElement).getAttribute("data-title") || (el as HTMLElement).textContent || "",
        }),
      },
    ];
  },
  renderHTML({ HTMLAttributes }) {
    const href = HTMLAttributes.href || "#";
    const title = HTMLAttributes.title || href;
    return [
      "a",
      mergeAttributes({
        class: "rich-bookmark",
        "data-note-bookmark": "1",
        "data-title": title,
        href,
        target: "_blank",
        rel: "noopener noreferrer",
      }),
      ["span", { class: "rich-bookmark-label" }, "書籤"],
      ["span", { class: "rich-bookmark-title" }, title],
      ["span", { class: "rich-bookmark-url" }, href],
    ];
  },
  addCommands() {
    return {
      setBookmark:
        (attrs) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs }),
    };
  },
});

export const AppCard = Node.create({
  name: "appCard",
  group: "block",
  atom: true,
  selectable: true,
  addAttributes() {
    return {
      href: { default: "/" },
      kind: { default: "app" },
      title: { default: "應用" },
      hint: { default: "" },
    };
  },
  parseHTML() {
    return [
      {
        tag: "a[data-note-app]",
        getAttrs: (el) => {
          const d = el as HTMLElement;
          return {
            href: d.getAttribute("href") || "/",
            kind: d.getAttribute("data-kind") || "app",
            title: d.getAttribute("data-title") || "應用",
            hint: d.getAttribute("data-hint") || "",
          };
        },
      },
    ];
  },
  renderHTML({ HTMLAttributes }) {
    const href = HTMLAttributes.href || "/";
    const title = HTMLAttributes.title || "應用";
    const hint = HTMLAttributes.hint || "";
    const kind = HTMLAttributes.kind || "app";
    return [
      "a",
      mergeAttributes({
        class: `rich-app-card rich-app-card--${kind}`,
        "data-note-app": "1",
        "data-kind": kind,
        "data-title": title,
        "data-hint": hint,
        href,
      }),
      ["strong", {}, title],
      hint ? ["span", {}, hint] : ["span", {}, href],
    ];
  },
  addCommands() {
    return {
      setAppCard:
        (attrs) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs }),
    };
  },
});

export const TemplateBtn = Node.create({
  name: "templateBtn",
  group: "block",
  atom: true,
  selectable: true,
  addAttributes() {
    return {
      templateId: { default: "meeting" },
      label: { default: "插入範本" },
    };
  },
  parseHTML() {
    return [
      {
        tag: "button[data-note-template-btn]",
        getAttrs: (el) => ({
          templateId: (el as HTMLElement).getAttribute("data-template") || "meeting",
          label: (el as HTMLElement).textContent || "插入範本",
        }),
      },
    ];
  },
  renderHTML({ HTMLAttributes }) {
    return [
      "button",
      mergeAttributes({
        class: "rich-template-btn",
        "data-note-template-btn": "1",
        "data-template": HTMLAttributes.templateId || "meeting",
        type: "button",
      }),
      HTMLAttributes.label || "插入範本",
    ];
  },
  addNodeView() {
    return ({ node, editor, getPos }) => {
      const dom = document.createElement("button");
      dom.type = "button";
      dom.className = "rich-template-btn";
      dom.setAttribute("data-note-template-btn", "1");
      dom.setAttribute("data-template", node.attrs.templateId || "meeting");
      dom.textContent = node.attrs.label || "插入範本";
      dom.contentEditable = "false";
      dom.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const id = node.attrs.templateId || "meeting";
        window.dispatchEvent(
          new CustomEvent("cadence-insert-template", {
            detail: { templateId: id, pos: typeof getPos === "function" ? getPos() : null },
          })
        );
        // Also try to notify via editor storage if needed
        void editor;
      });
      return { dom };
    };
  },
  addCommands() {
    return {
      setTemplateBtn:
        (attrs) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs }),
    };
  },
});
