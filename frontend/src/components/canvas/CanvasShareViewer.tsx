"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CanvasDoc } from "@/lib/canvasStore";
import {
  clampScale,
  edgeEndpoint,
  edgePath,
  fitView,
  nodeCenter,
  resolveStickyStyle,
} from "@/lib/canvasStore";
import CanvasMediaCard from "@/components/canvas/CanvasMediaCard";

type Props = {
  doc: CanvasDoc;
};

export default function CanvasShareViewer({ doc }: Props) {
  const stageRef = useRef<HTMLDivElement>(null);
  const [pan, setPan] = useState(doc.pan || { x: 48, y: 48 });
  const [scale, setScale] = useState(typeof doc.scale === "number" ? doc.scale : 1);
  const [panning, setPanning] = useState(false);
  const drag = useRef<{ sx: number; sy: number; pan0: { x: number; y: number } } | null>(null);
  const fitted = useRef(false);

  useEffect(() => {
    if (fitted.current) return;
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect || rect.width < 40) return;
    const next = fitView(doc, { w: rect.width, h: rect.height });
    setPan(next.pan);
    setScale(next.scale);
    fitted.current = true;
  }, [doc]);

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button > 2) return;
    e.preventDefault();
    drag.current = { sx: e.clientX, sy: e.clientY, pan0: { ...pan } };
    setPanning(true);
    stageRef.current?.setPointerCapture?.(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current) return;
    const d = drag.current;
    setPan({
      x: d.pan0.x + (e.clientX - d.sx),
      y: d.pan0.y + (e.clientY - d.sy),
    });
  };

  const onPointerUp = () => {
    drag.current = null;
    setPanning(false);
  };

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const dir = e.deltaY > 0 ? -1 : 1;
      setScale((prev) => {
        const nextScale = clampScale(prev + dir * 0.1);
        const cx = e.clientX - rect.left;
        const cy = e.clientY - rect.top;
        setPan((p) => {
          const wx = (cx - p.x) / prev;
          const wy = (cy - p.y) / prev;
          return { x: cx - wx * nextScale, y: cy - wy * nextScale };
        });
        return nextScale;
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const fit = useCallback(() => {
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect) return;
    const next = fitView(doc, { w: rect.width, h: rect.height });
    setPan(next.pan);
    setScale(next.scale);
  }, [doc]);

  const empty =
    !doc.stickies.length &&
    !doc.shapes.length &&
    !doc.notes.length &&
    !(doc.media || []).length;

  const edgeEls = useMemo(
    () =>
      doc.edges.map((edge) => {
        const ca = nodeCenter(doc, edge.from);
        const cb = nodeCenter(doc, edge.to);
        if (!ca || !cb) return null;
        const a = edgeEndpoint(doc, edge.from, edge.fromPort, cb) ?? ca;
        const b = edgeEndpoint(doc, edge.to, edge.toPort, ca) ?? cb;
        return <path key={edge.id} d={edgePath(a, b)} className="cv-edge" />;
      }),
    [doc]
  );

  return (
    <div
      ref={stageRef}
      className={`cv-share-stage${panning ? " is-panning" : ""}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="cv-float-actions" style={{ position: "absolute", right: 12, top: 12, zIndex: 5 }}>
        <button type="button" className="btn btn-ghost btn-sm" onClick={fit}>
          適中
        </button>
        <span className="share-pill" style={{ marginLeft: 6 }}>
          {Math.round(scale * 100)}%
        </span>
      </div>
      <div
        className="cv-world"
        style={{
          transform: `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${scale})`,
          transformOrigin: "0 0",
        }}
      >
        {(doc.sections || []).map((sec) => (
          <div
            key={sec.id}
            className="cv-section"
            style={{
              left: sec.x,
              top: sec.y,
              width: sec.w,
              height: sec.h,
              zIndex: sec.z || 0,
              ["--sec-color" as string]: sec.color,
            }}
          >
            <span className="cv-section-title">{sec.title}</span>
          </div>
        ))}
        <svg className="cv-edges" width="8000" height="6000">
          {edgeEls}
        </svg>
        {doc.shapes.map((s) => (
          <div
            key={s.id}
            className={`cv-shape cv-shape--${s.shape}`}
            style={{
              left: s.x,
              top: s.y,
              width: s.w,
              height: s.h,
              zIndex: s.z,
              borderColor: s.color,
            }}
          >
            {s.label ? <span className="cv-shape-label">{s.label}</span> : null}
          </div>
        ))}
        {doc.stickies.map((s) => {
          const pal = resolveStickyStyle(s.color);
          const isText = s.variant === "text";
          return (
            <div
              key={s.id}
              className={`cv-sticky${isText ? " cv-sticky--text" : ""}`}
              style={{
                left: s.x,
                top: s.y,
                width: s.w,
                height: s.h,
                zIndex: s.z,
                ...(isText
                  ? { background: "transparent", border: "none", boxShadow: "none" }
                  : { background: pal.bg, borderColor: pal.border }),
              }}
            >
              <p>{s.text}</p>
            </div>
          );
        })}
        {doc.notes.map((n) => (
          <div
            key={n.noteId}
            className="cv-note"
            style={{ left: n.x, top: n.y, width: n.w, height: n.h }}
          >
            <a href={`/notes/${n.noteId}`}>筆記</a>
          </div>
        ))}
        {(doc.media || []).map((m) => (
          <CanvasMediaCard key={m.id} item={m} selected={false} readOnly />
        ))}
      </div>
      {empty && <p className="cv-share-empty">此白板尚無內容</p>}
    </div>
  );
}
