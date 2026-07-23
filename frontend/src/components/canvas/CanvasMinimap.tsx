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

const W = 168;
const H = 112;

export default function CanvasMinimap({ doc, viewport, onPan, onFit }: Props) {
  const [open, setOpen] = useState(true);
  const drag = useRef(false);

  const bounds = useMemo(() => boundsOf(doc), [doc]);
  const worldW = Math.max(400, (bounds?.maxX ?? 400) - (bounds?.minX ?? 0) + 80);
  const worldH = Math.max(300, (bounds?.maxY ?? 300) - (bounds?.minY ?? 0) + 80);
  const originX = (bounds?.minX ?? 0) - 40;
  const originY = (bounds?.minY ?? 0) - 40;
  const sx = W / worldW;
  const sy = H / worldH;
  const s = Math.min(sx, sy);

  const view = {
    x: (-doc.pan.x / doc.scale - originX) * s,
    y: (-doc.pan.y / doc.scale - originY) * s,
    w: (viewport.w / doc.scale) * s,
    h: (viewport.h / doc.scale) * s,
  };

  const jumpTo = useCallback(
    (clientX: number, clientY: number, el: HTMLElement) => {
      const r = el.getBoundingClientRect();
      const mx = clientX - r.left;
      const my = clientY - r.top;
      const wx = mx / s + originX;
      const wy = my / s + originY;
      onPan({
        x: viewport.w / 2 - wx * doc.scale,
        y: viewport.h / 2 - wy * doc.scale,
      });
    },
    [doc.scale, onPan, originX, originY, s, viewport.h, viewport.w]
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
            style={{
              left: (sec.x - originX) * s,
              top: (sec.y - originY) * s,
              width: Math.max(4, sec.w * s),
              height: Math.max(4, sec.h * s),
              borderColor: sec.color,
            }}
          />
        ))}
        {doc.stickies.map((st) => (
          <div
            key={st.id}
            className="cv-minimap-dot"
            style={{
              left: (st.x - originX) * s,
              top: (st.y - originY) * s,
              width: Math.max(3, st.w * s),
              height: Math.max(3, st.h * s),
            }}
          />
        ))}
        {(doc.media || []).map((m) => (
          <div
            key={m.id}
            className="cv-minimap-dot is-media"
            style={{
              left: (m.x - originX) * s,
              top: (m.y - originY) * s,
              width: Math.max(3, m.w * s),
              height: Math.max(3, m.h * s),
            }}
          />
        ))}
        <div
          className="cv-minimap-view"
          style={{
            left: view.x,
            top: view.y,
            width: Math.max(12, view.w),
            height: Math.max(12, view.h),
          }}
        />
      </div>
    </div>
  );
}
