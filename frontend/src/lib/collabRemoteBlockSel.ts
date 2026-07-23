/**
 * Sync Cadence multi-block 框選 across collaborators via Yjs awareness.
 * Local block highlights use BlockSelectionHighlight; remotes see this plugin.
 */

import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";
import type { Node as PmNode } from "@tiptap/pm/model";
import type { Awareness } from "y-protocols/awareness";

export type RemoteBlockSelRange = {
  parentFrom: number;
  start: number;
  end: number;
};

const remoteBlockSelKey = new PluginKey("albireusRemoteBlockSel");

function collectBlockDecos(
  doc: PmNode,
  range: RemoteBlockSelRange,
  color: string
): Decoration[] {
  if (range.start > range.end) return [];
  const decos: Decoration[] = [];
  const { parentFrom, start, end } = range;
  const style = `background-color: ${color}28; outline: 1.5px solid ${color}80; outline-offset: 1px; border-radius: 6px;`;

  if (parentFrom < 0) {
    let pos = 0;
    for (let i = 0; i < doc.childCount; i++) {
      const size = doc.child(i).nodeSize;
      if (i >= start && i <= end) {
        decos.push(
          Decoration.node(pos, pos + size, {
            class: "is-remote-block-selected",
            style,
          })
        );
      }
      pos += size;
    }
  } else {
    const parent = doc.nodeAt(parentFrom);
    if (!parent) return [];
    let pos = parentFrom + 1;
    for (let i = 0; i < parent.childCount; i++) {
      const size = parent.child(i).nodeSize;
      if (i >= start && i <= end) {
        decos.push(
          Decoration.node(pos, pos + size, {
            class: "is-remote-block-selected",
            style,
          })
        );
      }
      pos += size;
    }
  }
  return decos;
}

function buildRemoteDecorations(doc: PmNode, awareness: Awareness, localClient: number): DecorationSet {
  const decos: Decoration[] = [];
  awareness.getStates().forEach((state, clientId) => {
    if (clientId === localClient) return;
    const sel = state?.blockSel as RemoteBlockSelRange | null | undefined;
    if (!sel || typeof sel.parentFrom !== "number") return;
    if (typeof sel.start !== "number" || typeof sel.end !== "number") return;
    if (sel.start > sel.end) return;
    const user = state?.user as { color?: string } | undefined;
    const color = user?.color || "#3b82f6";
    decos.push(...collectBlockDecos(doc, sel, color));
  });
  return DecorationSet.create(doc, decos);
}

export type CollaborationRemoteBlockSelOptions = {
  awareness: Awareness;
};

/**
 * Renders other users' multi-block selections from awareness `blockSel`.
 */
export const CollaborationRemoteBlockSel = Extension.create<CollaborationRemoteBlockSelOptions>({
  name: "collaborationRemoteBlockSel",

  addOptions() {
    return {
      awareness: null as unknown as Awareness,
    };
  },

  addProseMirrorPlugins() {
    const { awareness } = this.options;
    if (!awareness) return [];

    return [
      new Plugin({
        key: remoteBlockSelKey,
        view(editorView: EditorView) {
          const onUpdate = () => {
            if (editorView.isDestroyed) return;
            editorView.dispatch(
              editorView.state.tr.setMeta(remoteBlockSelKey, Date.now()).setMeta("addToHistory", false)
            );
          };
          awareness.on("update", onUpdate);
          awareness.on("change", onUpdate);
          return {
            destroy() {
              awareness.off("update", onUpdate);
              awareness.off("change", onUpdate);
            },
          };
        },
        props: {
          decorations(state) {
            return buildRemoteDecorations(state.doc, awareness, awareness.clientID);
          },
        },
      }),
    ];
  },
});

/** Publish or clear local multi-block selection for remote peers. */
export function publishLocalBlockSel(
  awareness: Awareness | null | undefined,
  range: RemoteBlockSelRange | null
) {
  if (!awareness) return;
  const cur = awareness.getLocalState()?.blockSel as RemoteBlockSelRange | null | undefined;
  if (range === null) {
    if (cur == null) return;
    awareness.setLocalStateField("blockSel", null);
    return;
  }
  if (
    cur &&
    cur.parentFrom === range.parentFrom &&
    cur.start === range.start &&
    cur.end === range.end
  ) {
    return;
  }
  awareness.setLocalStateField("blockSel", range);
}
