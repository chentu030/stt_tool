"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/components/AuthProvider";
import { listenToUserNotes, loginWithGoogle, Note } from "@/lib/firebase";
import { extractWikiLinks } from "@/lib/wiki";
import ScrambleText from "@/components/motion/ScrambleText";
import ShinyPill from "@/components/motion/ShinyPill";

/** Obsidian-style local graph of [[wikilinks]] */
export default function GraphPage() {
  const { user, loading } = useAuth();
  const [notes, setNotes] = useState<Note[]>([]);

  useEffect(() => {
    if (!user) return;
    return listenToUserNotes(user.uid, setNotes);
  }, [user]);

  const graph = useMemo(() => {
    const byTitle = new Map(notes.map((n) => [n.title.trim().toLowerCase(), n]));
    const nodes = notes.map((n, i) => {
      const angle = (i / Math.max(notes.length, 1)) * Math.PI * 2;
      const r = 140 + (i % 5) * 28;
      return {
        id: n.id,
        title: n.title,
        x: 320 + Math.cos(angle) * r,
        y: 260 + Math.sin(angle) * r,
      };
    });
    const edges: { from: string; to: string }[] = [];
    for (const n of notes) {
      for (const link of extractWikiLinks(n.body_md)) {
        const target = byTitle.get(link.trim().toLowerCase());
        if (target && target.id !== n.id) edges.push({ from: n.id, to: target.id });
      }
    }
    return { nodes, edges };
  }, [notes]);

  if (loading) return <p style={{ color: "var(--text-muted)" }}>載入中…</p>;
  if (!user) {
    return (
      <div style={{ textAlign: "center", padding: "3rem 1rem" }}>
        <ScrambleText words="圖譜" as="h1" className="page-title font-display" />
        <p className="page-sub">登入後查看筆記雙向連結圖。</p>
        <ShinyPill onClick={() => loginWithGoogle()}>登入</ShinyPill>
      </div>
    );
  }

  return (
    <div>
      <ScrambleText words="圖譜" as="h1" className="page-title font-display" />
      <p className="page-sub">Obsidian 風格：依 [[wikilink]] 畫出知識連結（{graph.edges.length} 條邊）。</p>

      <div className="card" style={{ padding: 0, overflow: "hidden", height: "min(70vh, 640px)" }}>
        <svg width="100%" height="100%" viewBox="0 0 640 520" style={{ display: "block", background: "var(--bg-muted)" }}>
          {graph.edges.map((e, i) => {
            const a = graph.nodes.find((n) => n.id === e.from);
            const b = graph.nodes.find((n) => n.id === e.to);
            if (!a || !b) return null;
            return (
              <line
                key={i}
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                stroke="var(--accent)"
                strokeOpacity={0.45}
                strokeWidth={1.5}
              />
            );
          })}
          {graph.nodes.map((n) => (
            <g key={n.id}>
              <Link href={`/notes/${n.id}`}>
                <circle cx={n.x} cy={n.y} r={10} fill="var(--accent-2)" />
                <text x={n.x} y={n.y + 22} textAnchor="middle" fontSize="11" fill="var(--text-main)">
                  {n.title.slice(0, 12)}
                </text>
              </Link>
            </g>
          ))}
        </svg>
      </div>
    </div>
  );
}
