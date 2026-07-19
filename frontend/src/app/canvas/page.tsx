"use client";

import { useEffect, useMemo, useRef, useState, PointerEvent } from "react";
import Link from "next/link";
import { useAuth } from "@/components/AuthProvider";
import { listenToUserNotes, loginWithGoogle, Note } from "@/lib/firebase";
import ScrambleText from "@/components/motion/ScrambleText";
import ShinyPill from "@/components/motion/ShinyPill";

type CardPos = { id: string; x: number; y: number };

const STORAGE_KEY = "cadence_canvas_positions_v1";

function loadPositions(): Record<string, { x: number; y: number }> {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
  } catch {
    return {};
  }
}

function savePositions(map: Record<string, { x: number; y: number }>) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
}

export default function CanvasPage() {
  const { user, loading } = useAuth();
  const [notes, setNotes] = useState<Note[]>([]);
  const [pos, setPos] = useState<Record<string, { x: number; y: number }>>({});
  const [scale, setScale] = useState(1);
  const [pan, setPan] = useState({ x: 40, y: 40 });
  const drag = useRef<{ id: string; ox: number; oy: number } | null>(null);
  const panning = useRef<{ x: number; y: number; px: number; py: number } | null>(null);

  useEffect(() => {
    if (!user) return;
    setPos(loadPositions());
    return listenToUserNotes(user.uid, setNotes);
  }, [user]);

  const cards: CardPos[] = useMemo(() => {
    return notes.slice(0, 40).map((n, i) => {
      const p = pos[n.id] || { x: 40 + (i % 5) * 220, y: 40 + Math.floor(i / 5) * 160 };
      return { id: n.id, x: p.x, y: p.y };
    });
  }, [notes, pos]);

  const onCardPointerDown = (e: PointerEvent, id: string) => {
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    const p = pos[id] || cards.find((c) => c.id === id)!;
    drag.current = { id, ox: e.clientX / scale - p.x - pan.x / scale, oy: e.clientY / scale - p.y - pan.y / scale };
  };

  const onPointerMove = (e: PointerEvent) => {
    if (drag.current) {
      const { id, ox, oy } = drag.current;
      const next = {
        ...pos,
        [id]: {
          x: e.clientX / scale - ox - pan.x / scale,
          y: e.clientY / scale - oy - pan.y / scale,
        },
      };
      setPos(next);
      return;
    }
    if (panning.current) {
      setPan({
        x: e.clientX - panning.current.px + panning.current.x,
        y: e.clientY - panning.current.py + panning.current.y,
      });
    }
  };

  const onPointerUp = () => {
    if (drag.current) savePositions(pos);
    drag.current = null;
    panning.current = null;
  };

  if (loading) return <p style={{ color: "var(--text-muted)" }}>載入中…</p>;
  if (!user) {
    return (
      <div style={{ textAlign: "center", padding: "3rem 1rem" }}>
        <ScrambleText words="白板" as="h1" className="page-title font-display" />
        <p className="page-sub">登入後把筆記放到空間畫布上。</p>
        <ShinyPill onClick={() => loginWithGoogle()}>登入</ShinyPill>
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", gap: "0.75rem", flexWrap: "wrap", alignItems: "flex-end", marginBottom: "0.75rem" }}>
        <div>
          <ScrambleText words="白板" as="h1" className="page-title font-display" />
          <p className="page-sub" style={{ marginBottom: 0 }}>Heptabase 風格：拖曳卡片、滾輪縮放、空白處平移。</p>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <button className="btn btn-ghost btn-sm" type="button" onClick={() => setScale((s) => Math.min(1.6, s + 0.1))}>＋</button>
          <button className="btn btn-ghost btn-sm" type="button" onClick={() => setScale((s) => Math.max(0.5, s - 0.1))}>－</button>
          <button className="btn btn-ghost btn-sm" type="button" onClick={() => { setScale(1); setPan({ x: 40, y: 40 }); }}>重置</button>
        </div>
      </div>

      <div
        className="card"
        style={{
          height: "min(72vh, 720px)",
          overflow: "hidden",
          position: "relative",
          background:
            "radial-gradient(circle at 1px 1px, rgba(148,163,184,0.25) 1px, transparent 0)",
          backgroundSize: "22px 22px",
          cursor: panning.current ? "grabbing" : "grab",
          touchAction: "none",
        }}
        onPointerDown={(e) => {
          if ((e.target as HTMLElement).closest("[data-card]")) return;
          panning.current = { x: pan.x, y: pan.y, px: e.clientX, py: e.clientY };
        }}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
        onWheel={(e) => {
          e.preventDefault();
          setScale((s) => Math.min(1.8, Math.max(0.45, s + (e.deltaY > 0 ? -0.06 : 0.06))));
        }}
      >
        <div style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})`, transformOrigin: "0 0", width: "100%", height: "100%", position: "relative" }}>
          {cards.map((c) => {
            const n = notes.find((x) => x.id === c.id);
            if (!n) return null;
            return (
              <div
                key={c.id}
                data-card
                onPointerDown={(e) => onCardPointerDown(e, c.id)}
                className="surface"
                style={{
                  position: "absolute",
                  left: c.x,
                  top: c.y,
                  width: 200,
                  padding: "0.75rem 0.85rem",
                  cursor: "grab",
                  boxShadow: "var(--shadow)",
                  userSelect: "none",
                }}
              >
                <Link href={`/notes/${n.id}`} onClick={(e) => e.stopPropagation()} style={{ fontWeight: 650, fontSize: "0.92rem" }}>
                  {n.title}
                </Link>
                <p style={{ fontSize: "0.72rem", color: "var(--text-muted)", marginTop: 6, maxHeight: 48, overflow: "hidden" }}>
                  {n.body_md.replace(/[#>*`\[\]]/g, "").slice(0, 80) || "（空白）"}
                </p>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
