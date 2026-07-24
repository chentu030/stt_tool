/** Live canvas snapshot + apply bridge for the global AI rail. */

import {
  applyCanvasOps,
  parseCanvasAiResponse,
  serializeCanvasForAi,
  type CanvasAiOp,
  type CanvasDoc,
} from "@/lib/canvasStore";

export type CanvasAiLiveSnapshot = {
  canvasId: string;
  name: string;
  summary: string;
  selectedIds: string[];
  noteCatalog: { id: string; title: string }[];
  updatedAt: number;
};

export type CanvasAiEdit = {
  ops: CanvasAiOp[];
  message?: string;
};

export const CANVAS_AI_LIVE_EVENT = "albireus:canvas-live";
export const CANVAS_AI_APPLY_EVENT = "albireus:ai-canvas-ops";

let liveSnap: CanvasAiLiveSnapshot | null = null;
let applyHandler: ((ops: CanvasAiOp[]) => void) | null = null;

export function publishCanvasLiveSnapshot(snap: Omit<CanvasAiLiveSnapshot, "updatedAt">) {
  liveSnap = { ...snap, updatedAt: Date.now() };
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(CANVAS_AI_LIVE_EVENT));
  }
}

export function clearCanvasLiveSnapshot() {
  liveSnap = null;
}

export function readCanvasLiveSnapshot(): CanvasAiLiveSnapshot | null {
  if (!liveSnap) return null;
  if (Date.now() - liveSnap.updatedAt > 180_000) return null;
  return liveSnap;
}

export function buildCanvasLiveSnapshot(
  canvasId: string,
  doc: CanvasDoc,
  notes: { id: string; title: string }[],
  selectedIds: string[]
): Omit<CanvasAiLiveSnapshot, "updatedAt"> {
  return {
    canvasId,
    name: doc.name || "白板",
    summary: serializeCanvasForAi(doc, notes, selectedIds),
    selectedIds,
    noteCatalog: notes.slice(0, 80).map((n) => ({ id: n.id, title: n.title || "未命名" })),
  };
}

/** Canvas page registers this so the rail can apply without navigating. */
export function registerCanvasAiApplyHandler(handler: ((ops: CanvasAiOp[]) => void) | null) {
  applyHandler = handler;
}

export function requestApplyCanvasOps(ops: CanvasAiOp[]): boolean {
  if (!ops.length) return false;
  if (applyHandler) {
    applyHandler(ops);
    return true;
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(CANVAS_AI_APPLY_EVENT, { detail: { ops } }));
    return true;
  }
  return false;
}

export function applyCanvasOpsToDoc(
  doc: CanvasDoc,
  ops: CanvasAiOp[],
  validNoteIds: Set<string>
): CanvasDoc {
  return applyCanvasOps(doc, ops, validNoteIds);
}

export function parseCanvasAiEdit(raw: string): {
  edit: CanvasAiEdit | null;
  displayText: string;
} {
  const parsed = parseCanvasAiResponse(raw);
  if (!parsed.ops.length) {
    return { edit: null, displayText: parsed.message || raw };
  }
  return {
    edit: { ops: parsed.ops.slice(0, 12), message: parsed.message },
    displayText: parsed.message || `已準備套用 ${parsed.ops.length} 項白板修改。`,
  };
}

export function summarizeCanvasOps(ops: CanvasAiOp[]): string {
  const counts: Record<string, number> = {};
  for (const op of ops) {
    counts[op.op] = (counts[op.op] || 0) + 1;
  }
  const labels: Record<string, string> = {
    add_sticky: "新增便利貼",
    add_shape: "新增形狀",
    add_media: "新增媒體",
    update: "更新物件",
    delete: "刪除",
    connect: "連線",
    pin_note: "釘上筆記",
    layout_hint: "排版提示",
  };
  return Object.entries(counts)
    .map(([k, n]) => `${labels[k] || k}×${n}`)
    .join("、");
}

export function userAskedToEditCanvas(prompt: string): boolean {
  const t = prompt.trim();
  if (!t) return false;
  return /整理|區塊|框架|連線|連接|釘上|新增|加上|加入|刪除|刪掉|移除|移動|改成|改寫|擴寫|便利貼|形狀|白板|畫布|排版|佈局|重排|建議連|拆成|拆卡|圖片|影片|YouTube|youtube|插圖|配圖/.test(
    t
  );
}
