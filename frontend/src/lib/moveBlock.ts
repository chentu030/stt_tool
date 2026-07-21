import type { Editor } from "@tiptap/react";
import { Fragment } from "@tiptap/pm/model";
import { NodeSelection, TextSelection } from "@tiptap/pm/state";

const LIST_ITEM = new Set(["listItem", "taskItem"]);
const LIST_PARENT = new Set(["bulletList", "orderedList", "taskList"]);

export type DragBlock = {
  from: number;
  to: number;
  /** Index among siblings inside parent */
  index: number;
  /** Start pos of parent node; -1 = document root */
  parentFrom: number;
};

/** Move the top-level block under the cursor up (-1) or down (1). */
export function moveTopLevelBlock(editor: Editor, direction: -1 | 1): boolean {
  const { state } = editor;
  const { $from } = state.selection;
  if ($from.depth < 1) return false;

  // Prefer moving a list item when inside a list
  const drag = draggableBlockAt(editor, $from.pos);
  if (drag && drag.parentFrom >= 0) {
    const target = drag.index + direction;
    const parent = state.doc.nodeAt(drag.parentFrom);
    if (!parent) return false;
    if (target < 0 || target >= parent.childCount) return false;
    return !!moveSiblingRange(editor, drag.parentFrom, drag.index, drag.index, direction < 0 ? target : target + 1);
  }

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

/**
 * Move a contiguous range of top-level blocks [startIndex, endIndex] so the
 * group sits before `targetIndex` (0…childCount). Returns the new index range
 * after the move, or null if nothing changed.
 */
export function moveBlocksToIndex(
  editor: Editor,
  startIndex: number,
  endIndex: number,
  targetIndex: number
): { start: number; end: number } | null {
  const { state } = editor;
  const n = state.doc.childCount;
  if (n === 0) return null;

  const a = Math.max(0, Math.min(startIndex, endIndex));
  const b = Math.min(n - 1, Math.max(startIndex, endIndex));
  const t = Math.max(0, Math.min(targetIndex, n));
  const count = b - a + 1;

  if (t >= a && t <= b + 1) return null;

  const nodes = [];
  for (let i = a; i <= b; i++) nodes.push(state.doc.child(i));
  const fragment = Fragment.from(nodes);

  let fromPos = 0;
  for (let i = 0; i < a; i++) fromPos += state.doc.child(i).nodeSize;
  let toPos = fromPos;
  for (let i = a; i <= b; i++) toPos += state.doc.child(i).nodeSize;

  let tr = state.tr.delete(fromPos, toPos);
  const adjustedT = t > b ? t - count : t;

  let insertPos = 0;
  for (let i = 0; i < adjustedT; i++) {
    insertPos += tr.doc.child(i).nodeSize;
  }
  tr = tr.insert(insertPos, fragment);
  const sel = Math.min(insertPos + 1, tr.doc.content.size);
  tr = tr.setSelection(TextSelection.near(tr.doc.resolve(sel)));
  editor.view.dispatch(tr.scrollIntoView());
  return { start: adjustedT, end: adjustedT + count - 1 };
}

/**
 * Move contiguous siblings inside a parent node (doc or list).
 * `parentFrom` = -1 for document root; otherwise the list/container node pos.
 * `targetIndex` = place before this sibling index (0…childCount).
 */
export function moveSiblingRange(
  editor: Editor,
  parentFrom: number,
  startIndex: number,
  endIndex: number,
  targetIndex: number
): { start: number; end: number; parentFrom: number } | null {
  if (parentFrom < 0) {
    const r = moveBlocksToIndex(editor, startIndex, endIndex, targetIndex);
    return r ? { ...r, parentFrom: -1 } : null;
  }

  const { state } = editor;
  const parent = state.doc.nodeAt(parentFrom);
  if (!parent || parent.childCount === 0) return null;

  const n = parent.childCount;
  const a = Math.max(0, Math.min(startIndex, endIndex));
  const b = Math.min(n - 1, Math.max(startIndex, endIndex));
  const t = Math.max(0, Math.min(targetIndex, n));
  const count = b - a + 1;
  if (t >= a && t <= b + 1) return null;

  const nodes = [];
  for (let i = a; i <= b; i++) nodes.push(parent.child(i));
  const fragment = Fragment.from(nodes);

  let fromPos = parentFrom + 1;
  for (let i = 0; i < a; i++) fromPos += parent.child(i).nodeSize;
  let toPos = fromPos;
  for (let i = a; i <= b; i++) toPos += parent.child(i).nodeSize;

  let tr = state.tr.delete(fromPos, toPos);
  const adjustedT = t > b ? t - count : t;
  const parentAfter = tr.doc.nodeAt(parentFrom);
  if (!parentAfter) return null;

  let insertPos = parentFrom + 1;
  for (let i = 0; i < adjustedT; i++) {
    insertPos += parentAfter.child(i).nodeSize;
  }
  tr = tr.insert(insertPos, fragment);
  const sel = Math.min(insertPos + 1, tr.doc.content.size);
  tr = tr.setSelection(TextSelection.near(tr.doc.resolve(sel)));
  editor.view.dispatch(tr.scrollIntoView());
  return { start: adjustedT, end: adjustedT + count - 1, parentFrom };
}

/**
 * Notion-style draggable unit: each list/todo item is its own block;
 * otherwise the top-level doc child.
 */
export function draggableBlockAt(editor: Editor, pos: number): DragBlock | null {
  const { doc } = editor.state;
  if (doc.childCount === 0) return null;
  const clamped = Math.max(0, Math.min(pos, doc.content.size));
  const $pos = doc.resolve(clamped);

  for (let d = $pos.depth; d >= 1; d--) {
    const node = $pos.node(d);
    if (LIST_ITEM.has(node.type.name)) {
      return {
        from: $pos.before(d),
        to: $pos.after(d),
        index: $pos.index(d - 1),
        parentFrom: $pos.before(d - 1),
      };
    }
  }

  // Inside a list but not resolved to an item (rare) — pick nearest item by walking
  if ($pos.depth >= 1 && LIST_PARENT.has($pos.node(1).type.name)) {
    const listFrom = $pos.before(1);
    const list = $pos.node(1);
    let p = listFrom + 1;
    for (let i = 0; i < list.childCount; i++) {
      const child = list.child(i);
      const to = p + child.nodeSize;
      if (clamped >= p && clamped <= to) {
        return { from: p, to, index: i, parentFrom: listFrom };
      }
      // also if between items, use closer
      p = to;
    }
    // fallback first item
    if (list.childCount > 0) {
      return {
        from: listFrom + 1,
        to: listFrom + 1 + list.child(0).nodeSize,
        index: 0,
        parentFrom: listFrom,
      };
    }
  }

  if ($pos.depth < 1) {
    if (pos === 0 && doc.childCount > 0) {
      const node = doc.child(0);
      // If first child is a list, return first item
      if (LIST_PARENT.has(node.type.name) && node.childCount > 0) {
        return {
          from: 1,
          to: 1 + node.child(0).nodeSize,
          index: 0,
          parentFrom: 0,
        };
      }
      return { index: 0, from: 0, to: node.nodeSize, parentFrom: -1 };
    }
    return null;
  }

  // Top-level block — but expand lists into their items for the handle
  const top = $pos.node(1);
  const topFrom = $pos.before(1);
  if (LIST_PARENT.has(top.type.name) && top.childCount > 0) {
    let p = topFrom + 1;
    let best: DragBlock | null = null;
    let bestDist = Infinity;
    for (let i = 0; i < top.childCount; i++) {
      const sz = top.child(i).nodeSize;
      const mid = p + sz / 2;
      // Use pos relative - we only have doc pos; compare clamped to range
      if (clamped >= p && clamped <= p + sz) {
        return { from: p, to: p + sz, index: i, parentFrom: topFrom };
      }
      const dist = Math.min(Math.abs(clamped - p), Math.abs(clamped - (p + sz)));
      if (dist < bestDist) {
        bestDist = dist;
        best = { from: p, to: p + sz, index: i, parentFrom: topFrom };
      }
      p += sz;
    }
    return best;
  }

  return {
    from: topFrom,
    to: $pos.after(1),
    index: $pos.index(0),
    parentFrom: -1,
  };
}

/** Find the top-level (or list-item) block whose DOM rect contains clientY. */
export function draggableBlockAtClientY(editor: Editor, clientY: number): DragBlock | null {
  const { doc } = editor.state;
  if (doc.childCount === 0) return null;
  let offset = 0;
  for (let i = 0; i < doc.childCount; i++) {
    const node = doc.child(i);
    const from = offset;
    const to = offset + node.nodeSize;
    if (LIST_PARENT.has(node.type.name) && node.childCount > 0) {
      let p = from + 1;
      for (let j = 0; j < node.childCount; j++) {
        const item = node.child(j);
        const itemFrom = p;
        const itemTo = p + item.nodeSize;
        const dom = editor.view.nodeDOM(itemFrom);
        if (dom instanceof HTMLElement) {
          const br = dom.getBoundingClientRect();
          if (clientY >= br.top - 4 && clientY <= br.bottom + 4) {
            return { from: itemFrom, to: itemTo, index: j, parentFrom: from };
          }
        }
        p = itemTo;
      }
    } else {
      const dom = editor.view.nodeDOM(from);
      if (dom instanceof HTMLElement) {
        const br = dom.getBoundingClientRect();
        if (clientY >= br.top - 4 && clientY <= br.bottom + 4) {
          return { from, to, index: i, parentFrom: -1 };
        }
      }
    }
    offset = to;
  }
  return null;
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

/** Top-level block index range covered by the current text selection. */
export function topLevelBlockRangeFromSelection(
  editor: Editor
): { start: number; end: number } | null {
  const { from, to, empty } = editor.state.selection;
  if (empty) {
    const one = topLevelBlockAt(editor, from);
    return one ? { start: one.index, end: one.index } : null;
  }
  const a = topLevelBlockAt(editor, from);
  const b = topLevelBlockAt(editor, Math.max(from, to - 1));
  if (!a || !b) return null;
  return { start: Math.min(a.index, b.index), end: Math.max(a.index, b.index) };
}

/** Document positions for a top-level block index. */
export function topLevelBlockPos(
  editor: Editor,
  index: number
): { from: number; to: number } | null {
  const { doc } = editor.state;
  if (index < 0 || index >= doc.childCount) return null;
  let from = 0;
  for (let i = 0; i < index; i++) from += doc.child(i).nodeSize;
  return { from, to: from + doc.child(index).nodeSize };
}

/** Positions for sibling index inside parent (-1 = doc). */
export function siblingBlockPos(
  editor: Editor,
  parentFrom: number,
  index: number
): { from: number; to: number } | null {
  const { doc } = editor.state;
  if (parentFrom < 0) return topLevelBlockPos(editor, index);
  const parent = doc.nodeAt(parentFrom);
  if (!parent || index < 0 || index >= parent.childCount) return null;
  let from = parentFrom + 1;
  for (let i = 0; i < index; i++) from += parent.child(i).nodeSize;
  return { from, to: from + parent.child(index).nodeSize };
}

export function siblingCount(editor: Editor, parentFrom: number): number {
  if (parentFrom < 0) return editor.state.doc.childCount;
  return editor.state.doc.nodeAt(parentFrom)?.childCount ?? 0;
}

/** Doc positions covering siblings [start, end] inclusive. */
export function siblingRangeBounds(
  editor: Editor,
  parentFrom: number,
  start: number,
  end: number
): { from: number; to: number } | null {
  const a = Math.min(start, end);
  const b = Math.max(start, end);
  const first = siblingBlockPos(editor, parentFrom, a);
  const last = siblingBlockPos(editor, parentFrom, b);
  if (!first || !last) return null;
  return { from: first.from, to: last.to };
}

/** Sync ProseMirror selection to the painted block range (enables native shortcuts). */
export function selectSiblingRange(
  editor: Editor,
  parentFrom: number,
  start: number,
  end: number
): boolean {
  const bounds = siblingRangeBounds(editor, parentFrom, start, end);
  if (!bounds) return false;
  const { state } = editor;
  try {
    if (start === end) {
      const node = state.doc.nodeAt(bounds.from);
      if (node && (node.isAtom || node.type.isAtom || !node.inlineContent)) {
        editor.view.dispatch(
          state.tr.setSelection(NodeSelection.create(state.doc, bounds.from)).scrollIntoView()
        );
        return true;
      }
    }
    editor.view.dispatch(
      state.tr
        .setSelection(TextSelection.create(state.doc, bounds.from, bounds.to))
        .scrollIntoView()
    );
    return true;
  } catch {
    try {
      editor.view.dispatch(
        state.tr.setSelection(TextSelection.near(state.doc.resolve(bounds.from))).scrollIntoView()
      );
    } catch {
      /* ignore */
    }
    return false;
  }
}

/** Delete sibling blocks [start, end] and place the caret nearby. */
export function deleteSiblingRange(
  editor: Editor,
  parentFrom: number,
  start: number,
  end: number
): boolean {
  const bounds = siblingRangeBounds(editor, parentFrom, start, end);
  if (!bounds) return false;
  const { state } = editor;
  let tr = state.tr.delete(bounds.from, bounds.to);
  if (tr.doc.content.size === 0) {
    const para = state.schema.nodes.paragraph?.create();
    if (para) tr = tr.insert(0, para);
  }
  const selPos = Math.min(bounds.from, tr.doc.content.size);
  try {
    tr = tr.setSelection(TextSelection.near(tr.doc.resolve(selPos)));
  } catch {
    /* ignore */
  }
  editor.view.dispatch(tr.scrollIntoView());
  return true;
}

/** Copy sibling range to the clipboard (HTML + plain text). */
export function copySiblingRange(
  editor: Editor,
  parentFrom: number,
  start: number,
  end: number,
  event?: ClipboardEvent
): boolean {
  const bounds = siblingRangeBounds(editor, parentFrom, start, end);
  if (!bounds) return false;
  const slice = editor.state.doc.slice(bounds.from, bounds.to);
  const { dom, text } = editor.view.serializeForClipboard(slice);
  const html = dom.innerHTML;
  if (event?.clipboardData) {
    event.clipboardData.clearData();
    event.clipboardData.setData("text/html", html);
    event.clipboardData.setData("text/plain", text);
    event.preventDefault();
    return true;
  }
  try {
    void navigator.clipboard.write([
      new ClipboardItem({
        "text/plain": new Blob([text], { type: "text/plain" }),
        "text/html": new Blob([html], { type: "text/html" }),
      }),
    ]);
  } catch {
    void navigator.clipboard.writeText(text);
  }
  return true;
}

/** Apply/remove `.is-block-selected` on sibling nodes in a parent. */
export function paintBlockSelection(
  editor: Editor,
  parentFrom: number,
  start: number,
  end: number
) {
  const { doc } = editor.state;
  const clearAll = () => {
    doc.descendants((node, pos) => {
      if (node.isBlock) {
        const dom = editor.view.nodeDOM(pos);
        if (dom instanceof HTMLElement) dom.classList.remove("is-block-selected");
      }
      return true;
    });
  };
  clearAll();
  if (start > end) return;

  if (parentFrom < 0) {
    let pos = 0;
    for (let i = 0; i < doc.childCount; i++) {
      const dom = editor.view.nodeDOM(pos);
      if (dom instanceof HTMLElement) {
        dom.classList.toggle("is-block-selected", i >= start && i <= end);
      }
      pos += doc.child(i).nodeSize;
    }
    return;
  }

  const parent = doc.nodeAt(parentFrom);
  if (!parent) return;
  let pos = parentFrom + 1;
  for (let i = 0; i < parent.childCount; i++) {
    const dom = editor.view.nodeDOM(pos);
    if (dom instanceof HTMLElement) {
      dom.classList.toggle("is-block-selected", i >= start && i <= end);
    }
    pos += parent.child(i).nodeSize;
  }
}

/** Duplicate the top-level block under the cursor (Notion-style Ctrl/Cmd+D). */
export function duplicateTopLevelBlock(editor: Editor): boolean {
  const { state } = editor;
  const { $from } = state.selection;
  if ($from.depth < 1) return false;

  const drag = draggableBlockAt(editor, $from.pos);
  if (drag) {
    const node = state.doc.nodeAt(drag.from);
    if (!node) return false;
    const insertAt = drag.to;
    const tr = state.tr.insert(insertAt, node.copy(node.content));
    const sel = Math.min(insertAt + 1, tr.doc.content.size);
    tr.setSelection(TextSelection.near(tr.doc.resolve(sel)));
    editor.view.dispatch(tr.scrollIntoView());
    return true;
  }

  const index = $from.index(0);
  const node = state.doc.child(index);
  const fromPos = $from.before(1);
  const insertAt = fromPos + node.nodeSize;
  const tr = state.tr.insert(insertAt, node.copy(node.content));
  const sel = Math.min(insertAt + 1, tr.doc.content.size);
  tr.setSelection(TextSelection.near(tr.doc.resolve(sel)));
  editor.view.dispatch(tr.scrollIntoView());
  return true;
}
