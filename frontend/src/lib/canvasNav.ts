/** Shared infinite-canvas navigation helpers (Figma/Miro-style). */

export type PanZoom = { pan: { x: number; y: number }; scale: number };

export function clampCanvasScale(s: number, min = 0.35, max = 2.5) {
  return Math.min(max, Math.max(min, s));
}

/**
 * Wheel on stage:
 * - Ctrl/Cmd + wheel → zoom toward cursor
 * - Shift + wheel → horizontal pan
 * - else → pan (trackpad two-finger / mouse wheel)
 */
export function applyStageWheel(
  e: {
    ctrlKey: boolean;
    metaKey: boolean;
    shiftKey: boolean;
    deltaX: number;
    deltaY: number;
    deltaMode: number;
    clientX: number;
    clientY: number;
  },
  rect: DOMRect,
  state: PanZoom,
  clamp = clampCanvasScale
): PanZoom {
  // Normalize line/page deltas to pixels roughly
  const line = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 40 : 1;
  const dx = e.deltaX * line;
  const dy = e.deltaY * line;

  if (e.ctrlKey || e.metaKey) {
    const factor = Math.exp(-dy * 0.0015);
    const next = clamp(state.scale * factor);
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const wx = (mx - state.pan.x) / state.scale;
    const wy = (my - state.pan.y) / state.scale;
    return {
      scale: next,
      pan: { x: mx - wx * next, y: my - wy * next },
    };
  }

  if (e.shiftKey) {
    // Prefer deltaY as horizontal when shift (mouse wheel); also honor deltaX
    const hx = Math.abs(dx) > Math.abs(dy) ? dx : dy;
    return {
      ...state,
      pan: { x: state.pan.x - hx, y: state.pan.y },
    };
  }

  return {
    ...state,
    pan: { x: state.pan.x - dx, y: state.pan.y - dy },
  };
}

/** True if pointer moved enough to count as a drag (vs click). */
export function isDragGesture(dx: number, dy: number, threshold = 4) {
  return Math.hypot(dx, dy) >= threshold;
}
