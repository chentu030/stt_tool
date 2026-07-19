import type { Editor } from "@tiptap/react";
import { Fragment } from "@tiptap/pm/model";
import { TextSelection } from "@tiptap/pm/state";

/** Move the top-level block under the cursor up (-1) or down (1). */
export function moveTopLevelBlock(editor: Editor, direction: -1 | 1): boolean {
  const { state } = editor;
  const { $from } = state.selection;
  if ($from.depth < 1) return false;

  const index = $from.index(0);
  const target = index + direction;
  if (target < 0 || target >= state.doc.childCount) return false;

  const fromPos = $from.before(1);
  const node = state.doc.child(index);
  const tr = state.tr;

  if (direction === -1) {
    const prev = state.doc.child(index - 1);
    const start = fromPos - prev.nodeSize;
    const end = fromPos + node.nodeSize;
    tr.replaceWith(start, end, Fragment.from([node, prev]));
    const sel = Math.min(start + 1, tr.doc.content.size);
    tr.setSelection(TextSelection.near(tr.doc.resolve(sel)));
  } else {
    const next = state.doc.child(index + 1);
    const start = fromPos;
    const end = fromPos + node.nodeSize + next.nodeSize;
    tr.replaceWith(start, end, Fragment.from([next, node]));
    const sel = Math.min(start + next.nodeSize + 1, tr.doc.content.size);
    tr.setSelection(TextSelection.near(tr.doc.resolve(sel)));
  }

  editor.view.dispatch(tr.scrollIntoView());
  return true;
}

/** Move the top-level block that starts at `fromPos` to sit before `targetIndex`. */
export function moveBlockToIndex(editor: Editor, fromPos: number, targetIndex: number): boolean {
  const { state } = editor;
  const $pos = state.doc.resolve(fromPos + 1);
  if ($pos.depth < 1) return false;
  const fromIndex = $pos.index(0);
  if (fromIndex === targetIndex) return false;
  if (targetIndex < 0 || targetIndex >= state.doc.childCount) return false;

  const node = state.doc.child(fromIndex);
  if (fromIndex === targetIndex || fromIndex + 1 === targetIndex) return false;

  let tr = state.tr.delete(fromPos, fromPos + node.nodeSize);

  let insertPos = 0;
  const adjustedTarget = fromIndex < targetIndex ? targetIndex - 1 : targetIndex;
  for (let i = 0; i < adjustedTarget; i++) {
    insertPos += tr.doc.child(i).nodeSize;
  }
  tr = tr.insert(insertPos, node);
  const sel = Math.min(insertPos + 1, tr.doc.content.size);
  tr = tr.setSelection(TextSelection.near(tr.doc.resolve(sel)));
  editor.view.dispatch(tr.scrollIntoView());
  return true;
}

/** Resolve which top-level block contains a document position. */
export function topLevelBlockAt(editor: Editor, pos: number): { index: number; from: number; to: number } | null {
  const { doc } = editor.state;
  if (pos < 0 || pos > doc.content.size) return null;
  const $pos = doc.resolve(Math.min(pos, doc.content.size));
  if ($pos.depth < 1 && pos === 0 && doc.childCount > 0) {
    const node = doc.child(0);
    return { index: 0, from: 0, to: node.nodeSize };
  }
  if ($pos.depth < 1) return null;
  const index = $pos.index(0);
  const from = $pos.before(1);
  const node = doc.child(index);
  return { index, from, to: from + node.nodeSize };
}
