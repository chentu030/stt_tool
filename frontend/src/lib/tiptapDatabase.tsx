"use client";

import { Node, mergeAttributes } from "@tiptap/core";
import {
  NodeViewWrapper,
  ReactNodeViewRenderer,
  type ReactNodeViewProps,
} from "@tiptap/react";
import DatabaseView from "@/components/database/DatabaseView";
import { useAuth } from "@/components/AuthProvider";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    cadenceDatabase: {
      setCadenceDatabase: (attrs: { databaseId: string; viewId?: string }) => ReturnType;
    };
  }
}

function DatabaseNodeView({ node, updateAttributes }: ReactNodeViewProps) {
  const { user } = useAuth();
  const databaseId = String(node.attrs.databaseId || "");
  const viewId = node.attrs.viewId ? String(node.attrs.viewId) : undefined;
  if (!databaseId) {
    return (
      <NodeViewWrapper className="cdb-node">
        <p className="cdb-empty">資料庫未指定</p>
      </NodeViewWrapper>
    );
  }
  if (!user) {
    return (
      <NodeViewWrapper className="cdb-node">
        <p className="cdb-empty">請登入以檢視資料庫</p>
      </NodeViewWrapper>
    );
  }
  return (
    <NodeViewWrapper className="cdb-node">
      <span className="cdb-node-drag" data-drag-handle contentEditable={false} title="拖曳區塊" aria-hidden>
        ⋮⋮
      </span>
      <DatabaseView
        databaseId={databaseId}
        userId={user.uid}
        viewId={viewId}
        compact
        onViewChange={(id) => updateAttributes({ viewId: id })}
      />
    </NodeViewWrapper>
  );
}

export const CadenceDatabase = Node.create({
  name: "cadenceDatabase",
  group: "block",
  atom: true,
  draggable: true,
  addAttributes() {
    return {
      databaseId: { default: null },
      viewId: { default: null },
    };
  },
  parseHTML() {
    return [
      {
        tag: "div[data-cadence-database]",
        getAttrs: (el) => {
          const d = el as HTMLElement;
          return {
            databaseId: d.getAttribute("data-database-id"),
            viewId: d.getAttribute("data-view-id"),
          };
        },
      },
    ];
  },
  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes({
        "data-cadence-database": "1",
        "data-database-id": HTMLAttributes.databaseId || "",
        "data-view-id": HTMLAttributes.viewId || "",
        class: "cdb-embed-shell",
      }),
    ];
  },
  addNodeView() {
    return ReactNodeViewRenderer(DatabaseNodeView);
  },
  addCommands() {
    return {
      setCadenceDatabase:
        (attrs) =>
        ({ commands }) =>
          commands.insertContent({
            type: this.name,
            attrs,
          }),
    };
  },
});
