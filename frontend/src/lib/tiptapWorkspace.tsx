"use client";

import { Node, mergeAttributes } from "@tiptap/core";
import {
  NodeViewWrapper,
  ReactNodeViewRenderer,
  type ReactNodeViewProps,
} from "@tiptap/react";
import WebPageView from "@/components/workspace/WebPageView";
import { noteAppEmbedHref, type NoteAppLinkType } from "@/lib/workspacePages";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    cadenceBoard: {
      setCadenceBoard: (attrs: { boardId: string }) => ReturnType;
    };
    cadenceCanvas: {
      setCadenceCanvas: (attrs: { canvasId: string }) => ReturnType;
    };
    cadenceGraph: {
      setCadenceGraph: (attrs: { graphId: string }) => ReturnType;
    };
    cadenceWeb: {
      setCadenceWeb: (attrs: { url: string; title?: string }) => ReturnType;
    };
  }
}

function FrameEmbed({
  type,
  appId,
  label,
}: {
  type: Exclude<NoteAppLinkType, "web" | "database">;
  appId: string;
  label: string;
}) {
  const href = noteAppEmbedHref({ type, id: appId });
  if (!appId || !href) {
    return (
      <NodeViewWrapper className="ws-embed-node">
        <p className="cdb-empty">{label}未指定</p>
      </NodeViewWrapper>
    );
  }
  return (
    <NodeViewWrapper className="ws-embed-node" data-drag-handle>
      <div className="note-app-surface note-app-surface--frame is-compact">
        <iframe
          className="note-app-frame"
          src={href}
          title={label}
          allow="clipboard-read; clipboard-write"
        />
      </div>
    </NodeViewWrapper>
  );
}

function BoardNodeView({ node }: ReactNodeViewProps) {
  return <FrameEmbed type="board" appId={String(node.attrs.boardId || "")} label="看板" />;
}
function CanvasNodeView({ node }: ReactNodeViewProps) {
  return <FrameEmbed type="canvas" appId={String(node.attrs.canvasId || "")} label="白板" />;
}
function GraphNodeView({ node }: ReactNodeViewProps) {
  return <FrameEmbed type="graph" appId={String(node.attrs.graphId || "")} label="圖譜" />;
}

function WebNodeView({ node, updateAttributes }: ReactNodeViewProps) {
  const url = String(node.attrs.url || "");
  const title = String(node.attrs.title || "網頁");
  return (
    <NodeViewWrapper className="ws-embed-node" data-drag-handle>
      <WebPageView
        compact
        ephemeral
        note={{
          id: "embed-web",
          title,
          props: { web_url: url },
          app_link: { type: "web", id: "embed" },
        }}
        onUrlChange={(next) => updateAttributes({ url: next })}
        onTitleHint={(t) => updateAttributes({ title: t })}
      />
    </NodeViewWrapper>
  );
}

export const CadenceBoard = Node.create({
  name: "cadenceBoard",
  group: "block",
  atom: true,
  draggable: true,
  addAttributes() {
    return { boardId: { default: null } };
  },
  parseHTML() {
    return [
      {
        tag: "div[data-cadence-board]",
        getAttrs: (el) => ({
          boardId: (el as HTMLElement).getAttribute("data-board-id"),
        }),
      },
    ];
  },
  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes({
        "data-cadence-board": "1",
        "data-board-id": HTMLAttributes.boardId || "",
        class: "ws-board-embed-shell",
      }),
    ];
  },
  addNodeView() {
    return ReactNodeViewRenderer(BoardNodeView);
  },
  addCommands() {
    return {
      setCadenceBoard:
        (attrs) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs }),
    };
  },
});

export const CadenceCanvas = Node.create({
  name: "cadenceCanvas",
  group: "block",
  atom: true,
  draggable: true,
  addAttributes() {
    return { canvasId: { default: null } };
  },
  parseHTML() {
    return [
      {
        tag: "div[data-cadence-canvas]",
        getAttrs: (el) => ({
          canvasId: (el as HTMLElement).getAttribute("data-canvas-id"),
        }),
      },
    ];
  },
  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes({
        "data-cadence-canvas": "1",
        "data-canvas-id": HTMLAttributes.canvasId || "",
        class: "ws-canvas-embed-shell",
      }),
    ];
  },
  addNodeView() {
    return ReactNodeViewRenderer(CanvasNodeView);
  },
  addCommands() {
    return {
      setCadenceCanvas:
        (attrs) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs }),
    };
  },
});

export const CadenceGraph = Node.create({
  name: "cadenceGraph",
  group: "block",
  atom: true,
  draggable: true,
  addAttributes() {
    return { graphId: { default: null } };
  },
  parseHTML() {
    return [
      {
        tag: "div[data-cadence-graph]",
        getAttrs: (el) => ({
          graphId: (el as HTMLElement).getAttribute("data-graph-id"),
        }),
      },
    ];
  },
  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes({
        "data-cadence-graph": "1",
        "data-graph-id": HTMLAttributes.graphId || "",
        class: "ws-graph-embed-shell",
      }),
    ];
  },
  addNodeView() {
    return ReactNodeViewRenderer(GraphNodeView);
  },
  addCommands() {
    return {
      setCadenceGraph:
        (attrs) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs }),
    };
  },
});

export const CadenceWeb = Node.create({
  name: "cadenceWeb",
  group: "block",
  atom: true,
  draggable: true,
  addAttributes() {
    return {
      url: { default: "" },
      title: { default: "" },
    };
  },
  parseHTML() {
    return [
      {
        tag: "div[data-cadence-web]",
        getAttrs: (el) => {
          const d = el as HTMLElement;
          return {
            url: d.getAttribute("data-url") || "",
            title: d.getAttribute("data-title") || "",
          };
        },
      },
    ];
  },
  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes({
        "data-cadence-web": "1",
        "data-url": HTMLAttributes.url || "",
        "data-title": HTMLAttributes.title || "",
        class: "ws-web-embed-shell",
      }),
    ];
  },
  addNodeView() {
    return ReactNodeViewRenderer(WebNodeView);
  },
  addCommands() {
    return {
      setCadenceWeb:
        (attrs) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs }),
    };
  },
});
