"use client";

import { useCallback, useEffect, useRef, useState, type PointerEvent } from "react";
import {
  DEFAULT_COVER_POSITION,
  DEFAULT_COVER_ZOOM,
  MAX_COVER_ZOOM,
  MIN_COVER_ZOOM,
  clampCoverCoord,
  clampCoverZoom,
  type CoverPosition,
} from "@/lib/noteCover";

type Props = {
  coverUrl: string;
  position: CoverPosition;
  zoom: number;
  canEdit: boolean;
  onChange: (next: { position: CoverPosition; zoom: number }) => void;
  onRemove: () => void;
};

export default function NoteCoverBanner({
  coverUrl,
  position,
  zoom,
  canEdit,
  onChange,
  onRemove,
}: Props) {
  const [adjusting, setAdjusting] = useState(false);
  const [localPos, setLocalPos] = useState(position);
  const [localZoom, setLocalZoom] = useState(zoom);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    origin: CoverPosition;
  } | null>(null);
  const pendingRef = useRef({ position, zoom });

  useEffect(() => {
    if (adjusting) return;
    setLocalPos(position);
    setLocalZoom(zoom);
    pendingRef.current = { position, zoom };
  }, [position, zoom, adjusting]);

  const commit = useCallback(
    (next: { position: CoverPosition; zoom: number }) => {
      pendingRef.current = next;
      onChange(next);
    },
    [onChange]
  );

  const exitAdjust = useCallback(() => {
    setAdjusting(false);
    commit(pendingRef.current);
  }, [commit]);

  useEffect(() => {
    if (!adjusting) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        exitAdjust();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [adjusting, exitAdjust]);

  // Non-passive wheel so we can prevent page scroll while zooming the cover.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el || !adjusting || !canEdit) return;
    const onWheelNative = (e: WheelEvent) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -0.08 : 0.08;
      const nextZoom = clampCoverZoom(pendingRef.current.zoom + delta);
      const next = { position: pendingRef.current.position, zoom: nextZoom };
      pendingRef.current = next;
      setLocalZoom(nextZoom);
      onChange(next);
    };
    el.addEventListener("wheel", onWheelNative, { passive: false });
    return () => el.removeEventListener("wheel", onWheelNative);
  }, [adjusting, canEdit, onChange]);

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (!adjusting || !canEdit) return;
    if (e.button !== 0) return;
    const el = wrapRef.current;
    if (!el) return;
    e.preventDefault();
    el.setPointerCapture(e.pointerId);
    dragRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      origin: { ...localPos },
    };
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    const el = wrapRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return;
    const z = localZoom || 1;
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    // Dragging the image: move focal point opposite to pointer travel.
    const next: CoverPosition = {
      x: clampCoverCoord(drag.origin.x - (dx / rect.width) * (100 / z)),
      y: clampCoverCoord(drag.origin.y - (dy / rect.height) * (100 / z)),
    };
    setLocalPos(next);
    pendingRef.current = { ...pendingRef.current, position: next };
  };

  const endDrag = (e: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    dragRef.current = null;
    try {
      wrapRef.current?.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    commit(pendingRef.current);
  };

  const setZoomFromSlider = (raw: number) => {
    const nextZoom = clampCoverZoom(raw);
    setLocalZoom(nextZoom);
    const next = { position: localPos, zoom: nextZoom };
    pendingRef.current = next;
    commit(next);
  };

  const pos = adjusting ? localPos : position;
  const z = adjusting ? localZoom : zoom;

  return (
    <div
      ref={wrapRef}
      className={`doc-cover${adjusting ? " is-adjusting" : ""}`}
      title={adjusting ? "拖曳移動焦點 · 滾輪縮放" : "封面"}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        className="doc-cover-img"
        src={coverUrl}
        alt=""
        draggable={false}
        style={{
          objectPosition: `${pos.x}% ${pos.y}%`,
          transform: z === 1 ? undefined : `scale(${z})`,
          transformOrigin: `${pos.x}% ${pos.y}%`,
        }}
      />
      {canEdit ? (
        <div className="doc-cover-actions">
          {adjusting ? (
            <>
              <label className="doc-cover-zoom">
                <span>縮放</span>
                <input
                  type="range"
                  min={MIN_COVER_ZOOM}
                  max={MAX_COVER_ZOOM}
                  step={0.05}
                  value={localZoom}
                  onChange={(e) => setZoomFromSlider(Number(e.target.value))}
                  onPointerDown={(e) => e.stopPropagation()}
                />
                <span className="doc-cover-zoom-val">{Math.round(localZoom * 100)}%</span>
              </label>
              <button
                type="button"
                className="doc-cover-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  const reset = {
                    position: { ...DEFAULT_COVER_POSITION },
                    zoom: DEFAULT_COVER_ZOOM,
                  };
                  setLocalPos(reset.position);
                  setLocalZoom(reset.zoom);
                  pendingRef.current = reset;
                  commit(reset);
                }}
              >
                重設
              </button>
              <button
                type="button"
                className="doc-cover-btn doc-cover-btn--primary"
                onClick={(e) => {
                  e.stopPropagation();
                  exitAdjust();
                }}
              >
                完成
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                className="doc-cover-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  setLocalPos(position);
                  setLocalZoom(zoom);
                  pendingRef.current = { position, zoom };
                  setAdjusting(true);
                }}
              >
                調整封面
              </button>
              <button
                type="button"
                className="doc-cover-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  onRemove();
                }}
              >
                移除封面
              </button>
            </>
          )}
        </div>
      ) : null}
      {adjusting ? (
        <div className="doc-cover-hint" aria-hidden>
          拖曳調整位置 · 滾輪或滑桿縮放
        </div>
      ) : null}
    </div>
  );
}
