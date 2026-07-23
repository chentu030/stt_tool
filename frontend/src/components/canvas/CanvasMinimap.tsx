"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CanvasDoc, Point } from "@/lib/canvasStore";
import { boundsOf, clampScale } from "@/lib/canvasStore";

type Props = {
  doc: CanvasDoc;
  viewport: { w: number; h: number };
  onPan: (pan: Point) => void;
  onFit: () => void;
};

/** Slightly larger so content + viewport both read clearly. */
const W = 200;
const H = 132;
const PAD = 48;

type Box = { minX: number; minY: number; maxX: number; maxY: number };

function unionBox(a: Box, b: Box): Box {
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  };
}

export default function CanvasMinimap({ doc, viewport, onPan, onFit }: Props) {
  const [open, setOpen] = useState(true);
  const drag = useRef(false);

  const layout = useMemo(() => {
    const scale = Math.max(0.05, doc.scale || 1);
    const viewWorld: Box = {
      minX: -doc.pan.x / scale,
      minY: -doc.pan.y / scale,
      maxX: -doc.pan.x / scale + viewport.w / scale,
      maxY: -doc.pan.y / scale + viewport.h / scale,
    };
    const content = boundsOf(doc);
    // Always include the live viewport so the blue frame never swallows the whole map
    // when content is small or the user is zoomed in on a local cluster.
    let world = content ? unionBox(content, viewWorld) : viewWorld;
    world = {
      minX: world.minX - PAD,
      minY: world.minY - PAD,
      maxX: world.maxX + PAD,
      maxY: world.maxY + PAD,
    };
    const worldW = Math.max(120, world.maxX - world.minX);
    const worldH = Math.max(90, world.maxY - world.minY);
    const s = Math.min(W / worldW, H / worldH);
    const ox = (W - worldW * s) / 2;
    const oy = (H - worldH * s) / 2;
    return { world, worldW, worldH, s, ox, oy, viewWorld, scale };
  }, [doc, viewport.h, viewport.w]);

  const { world, s, ox, oy, viewWorld } = layout;

  const view = {
    x: ox + (viewWorld.minX - world.minX) * s,
    y: oy + (viewWorld.minY - world.minY) * s,
    w: Math.max(10, (viewWorld.maxX - viewWorld.minX) * s),
    h: Math.max(10, (viewWorld.maxY - viewWorld.minY) * s),
  };

  const toMap = (x: number, y: number, w: number, h: number) => ({
    left: ox + (x - world.minX) * s,
    top: oy + (y - world.minY) * s,
    width: Math.max(4, w * s),
    height: Math.max(4, h * s),
  });

  const jumpTo = useCallback(
    (clientX: number, clientY: number, el: HTMLElement) => {
      const r = el.getBoundingClientRect();
      const mx = clientX - r.left;
      const my = clientY - r.top;
      const wx = (mx - ox) / s + world.minX;
      const wy = (my - oy) / s + world.minY;
      onPan({
        x: viewport.w / 2 - wx * doc.scale,
        y: viewport.h / 2 - wy * doc.scale,
      });
    },
    [doc.scale, onPan, ox, oy, s, viewport.h, viewport.w, world.minX, world.minY]
  );

  useEffect(() => {
    const onUp = () => {
      drag.current = false;
    };
    window.addEventListener("pointerup", onUp);
    return () => window.removeEventListener("pointerup", onUp);
  }, []);

  if (!open) {
    return (
      <div className="cv-minimap is-collapsed">
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(true)}>
          地圖 {Math.round(clampScale(doc.scale) * 100)}%
        </button>
      </div>
    );
  }

  return (
    <div className="cv-minimap">
      <div className="cv-minimap-head">
        <span>{Math.round(doc.scale * 100)}%</span>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onFit}>
          適中
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(false)}>
          收合
        </button>
      </div>
      <div
        className="cv-minimap-body"
        style={{ width: W, height: H }}
        onPointerDown={(e) => {
          drag.current = true;
          jumpTo(e.clientX, e.clientY, e.currentTarget);
          e.currentTarget.setPointerCapture?.(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (!drag.current) return;
          jumpTo(e.clientX, e.clientY, e.currentTarget);
        }}
      >
        {(doc.sections || []).map((sec) => (
          <div
            key={sec.id}
            className="cv-minimap-sec"
            style={{ ...toMap(sec.x, sec.y, sec.w, sec.h), borderColor: sec.color }}
          />
        ))}
        {doc.stickies.map((st) => (
          <div key={st.id} className="cv-minimap-dot" style={toMap(st.x, st.y, st.w, st.h)} />
        ))}
        {(doc.media || []).map((m) => (
          <div key={m.id} className="cv-minimap-dot is-media" style={toMap(m.x, m.y, m.w, m.h)} />
        ))}
        {doc.shapes.map((sh) => (
          <div key={sh.id} className="cv-minimap-dot is-shape" style={toMap(sh.x, sh.y, sh.w, sh.h)} />
        ))}
        {doc.notes.map((n) => (
          <div
            key={n.noteId}
            className="cv-minimap-dot is-note"
            style={toMap(n.x, n.y, n.w, n.h)}
          />
        ))}
        <div
          className="cv-minimap-view"
          style={{
            left: view.x,
            top: view.y,
            width: view.w,
            height: view.h,
          }}
        />
      </div>
    </div>
  );
}
