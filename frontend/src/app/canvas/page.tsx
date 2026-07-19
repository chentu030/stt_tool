"use client";

import { useCallback, useEffect, useMemo, useRef, useState, PointerEvent as REPointerEvent } from "react";
import Link from "next/link";
import { useAuth } from "@/components/AuthProvider";
import { listenToUserNotes, loginWithGoogle, Note } from "@/lib/firebase";
import ScrambleText from "@/components/motion/ScrambleText";
import ShinyPill from "@/components/motion/ShinyPill";
import CanvasToolbar from "@/components/canvas/CanvasToolbar";
import CanvasAside from "@/components/canvas/CanvasAside";
import {
  CanvasDoc,
  CanvasEdge,
  CanvasShape,
  CanvasSticky,
  Selectable,
  StickyColor,
  ToolId,
  STICKY_COLORS,
  SHAPE_COLORS,
  autoLayoutNotes,
  clampScale,
  edgePath,
  emptyDoc,
  exportCanvasJson,
  fitView,
  importCanvasJson,
  loadDoc,
  nodeCenter,
  saveDoc,
  snapVal,
  uid,
} from "@/lib/canvasStore";
import { usePrefs } from "@/components/PrefsProvider";

export default function CanvasPage() {
  const { user, loading } = useAuth();
  const { prefs } = usePrefs();
  const [notes, setNotes] = useState<Note[]>([]);
  const [doc, setDoc] = useState<CanvasDoc>(() => emptyDoc());
  const [tool, setTool] = useState<ToolId>(prefs.canvasDefaultTool);
  const [stickyColor, setStickyColor] = useState<StickyColor>("yellow");
  const [selected, setSelected] = useState<Selectable[]>([]);
  const [editingSticky, setEditingSticky] = useState<string | null>(null);
  const [connectFrom, setConnectFrom] = useState<string | null>(null);
  const [toast, setToast] = useState("");
  const [history, setHistory] = useState<CanvasDoc[]>([]);
  const [prefsSeeded, setPrefsSeeded] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{
    mode: "move" | "pan" | "draw";
    ids?: Selectable[];
    startX: number;
    startY: number;
    origin?: Record<string, { x: number; y: number }>;
    pan0?: { x: number; y: number };
    drawKind?: "rect" | "ellipse" | "frame" | "sticky" | "text";
    draftId?: string;
  } | null>(null);

  useEffect(() => {
    if (!user) return;
    const loaded = loadDoc(user.uid);
    // Apply prefs defaults only when canvas is still pristine / first open feel
    if (
      loaded.stickies.length === 0 &&
      loaded.shapes.length === 0 &&
      loaded.notes.length === 0 &&
      loaded.edges.length === 0
    ) {
      loaded.grid = prefs.canvasGrid;
      loaded.snap = prefs.canvasSnap;
    }
    setDoc(loaded);
    if (!prefsSeeded) {
      setTool(prefs.canvasDefaultTool);
      setPrefsSeeded(true);
    }
    return listenToUserNotes(user.uid, setNotes);
  }, [user]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!user) return;
    const t = setTimeout(() => saveDoc(user.uid, doc), 250);
    return () => clearTimeout(t);
  }, [doc, user]);

  const flash = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(""), 2000);
  };

  const pushHistory = useCallback((prev: CanvasDoc) => {
    setHistory((h) => [...h.slice(-29), prev]);
  }, []);

  const updateDoc = useCallback((updater: (d: CanvasDoc) => CanvasDoc, record = true) => {
    setDoc((prev) => {
      if (record) pushHistory(prev);
      return updater(prev);
    });
  }, [pushHistory]);

  const undo = () => {
    setHistory((h) => {
      if (!h.length) return h;
      const prev = h[h.length - 1];
      setDoc(prev);
      return h.slice(0, -1);
    });
    flash("已復原");
  };

  const noteMap = useMemo(() => {
    const m = new Map<string, Note>();
    notes.forEach((n) => m.set(n.id, n));
    return m;
  }, [notes]);

  const screenToWorld = (clientX: number, clientY: number) => {
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return {
      x: (clientX - rect.left - doc.pan.x) / doc.scale,
      y: (clientY - rect.top - doc.pan.y) / doc.scale,
    };
  };

  const refIdForSelectable = (s: Selectable): string => {
    if (s.type === "note") return `note:${s.id}`;
    return s.id;
  };

  const hitTest = (world: { x: number; y: number }): Selectable | null => {
    const stickies = [...doc.stickies].sort((a, b) => b.z - a.z);
    for (const s of stickies) {
      if (world.x >= s.x && world.x <= s.x + s.w && world.y >= s.y && world.y <= s.y + s.h) {
        return { type: "sticky", id: s.id };
      }
    }
    const shapes = [...doc.shapes].sort((a, b) => b.z - a.z);
    for (const s of shapes) {
      if (world.x >= s.x && world.x <= s.x + s.w && world.y >= s.y && world.y <= s.y + s.h) {
        return { type: "shape", id: s.id };
      }
    }
    for (const n of [...doc.notes].reverse()) {
      if (world.x >= n.x && world.x <= n.x + n.w && world.y >= n.y && world.y <= n.y + n.h) {
        return { type: "note", id: n.noteId };
      }
    }
    return null;
  };

  const onPointerDown = (e: REPointerEvent) => {
    if ((e.target as HTMLElement).closest("textarea,a,button,input")) return;
    const world = screenToWorld(e.clientX, e.clientY);
    stageRef.current?.setPointerCapture?.(e.pointerId);

    if (tool === "pan" || e.button === 1 || (tool === "select" && e.altKey)) {
      drag.current = {
        mode: "pan",
        startX: e.clientX,
        startY: e.clientY,
        pan0: { ...doc.pan },
      };
      return;
    }

    if (tool === "connect") {
      const hit = hitTest(world);
      if (!hit) {
        setConnectFrom(null);
        return;
      }
      const ref = refIdForSelectable(hit);
      if (!connectFrom) {
        setConnectFrom(ref);
        flash("已選起點，再點終點");
        return;
      }
      if (connectFrom === ref) {
        setConnectFrom(null);
        return;
      }
      const edge: CanvasEdge = {
        id: uid("e"),
        kind: "edge",
        from: connectFrom,
        to: ref,
      };
      updateDoc((d) => ({ ...d, edges: [...d.edges, edge] }));
      setConnectFrom(null);
      flash("已建立連線");
      return;
    }

    if (tool === "sticky" || tool === "text" || tool === "rect" || tool === "ellipse" || tool === "frame") {
      const x = snapVal(world.x, 22, doc.snap);
      const y = snapVal(world.y, 22, doc.snap);
      const z = Date.now();
      if (tool === "sticky" || tool === "text") {
        const sticky: CanvasSticky = {
          id: uid("st"),
          kind: "sticky",
          x,
          y,
          w: tool === "text" ? 240 : 180,
          h: tool === "text" ? 100 : 160,
          text: tool === "text" ? "文字" : "",
          color: stickyColor,
          z,
        };
        updateDoc((d) => ({ ...d, stickies: [...d.stickies, sticky] }));
        setSelected([{ type: "sticky", id: sticky.id }]);
        setEditingSticky(sticky.id);
        setTool("select");
        return;
      }
      const shape: CanvasShape = {
        id: uid("sh"),
        kind: "shape",
        shape: tool === "ellipse" ? "ellipse" : tool === "frame" ? "frame" : "rect",
        x,
        y,
        w: 160,
        h: 110,
        label: tool === "frame" ? "區塊" : "",
        color: SHAPE_COLORS[Math.floor(Math.random() * SHAPE_COLORS.length)],
        z,
      };
      updateDoc((d) => ({ ...d, shapes: [...d.shapes, shape] }));
      setSelected([{ type: "shape", id: shape.id }]);
      setTool("select");
      return;
    }

    // select / move
    const hit = hitTest(world);
    if (!hit) {
      if (!e.shiftKey) setSelected([]);
      return;
    }
    setSelected((prev) => {
      if (e.shiftKey) {
        const exists = prev.some((p) => p.type === hit.type && p.id === hit.id);
        return exists ? prev.filter((p) => !(p.type === hit.type && p.id === hit.id)) : [...prev, hit];
      }
      return [hit];
    });

    const ids = e.shiftKey
      ? [...selected.filter((p) => !(p.type === hit.type && p.id === hit.id)), hit]
      : [hit];

    const origin: Record<string, { x: number; y: number }> = {};
    for (const s of ids) {
      if (s.type === "sticky") {
        const st = doc.stickies.find((x) => x.id === s.id);
        if (st) origin[s.id] = { x: st.x, y: st.y };
      } else if (s.type === "shape") {
        const sh = doc.shapes.find((x) => x.id === s.id);
        if (sh) origin[s.id] = { x: sh.x, y: sh.y };
      } else if (s.type === "note") {
        const n = doc.notes.find((x) => x.noteId === s.id);
        if (n) origin[s.id] = { x: n.x, y: n.y };
      }
    }
    drag.current = {
      mode: "move",
      ids,
      startX: world.x,
      startY: world.y,
      origin,
    };
  };

  const onPointerMove = (e: REPointerEvent) => {
    const d = drag.current;
    if (!d) return;
    if (d.mode === "pan" && d.pan0) {
      setDoc((prev) => ({
        ...prev,
        pan: {
          x: d.pan0!.x + (e.clientX - d.startX),
          y: d.pan0!.y + (e.clientY - d.startY),
        },
      }));
      return;
    }
    if (d.mode === "move" && d.ids && d.origin) {
      const world = screenToWorld(e.clientX, e.clientY);
      const dx = world.x - d.startX;
      const dy = world.y - d.startY;
      setDoc((prev) => {
        const stickies = prev.stickies.map((s) => {
          const o = d.origin![s.id];
          if (!o || !d.ids!.some((i) => i.type === "sticky" && i.id === s.id)) return s;
          return {
            ...s,
            x: snapVal(o.x + dx, 22, prev.snap),
            y: snapVal(o.y + dy, 22, prev.snap),
          };
        });
        const shapes = prev.shapes.map((s) => {
          const o = d.origin![s.id];
          if (!o || !d.ids!.some((i) => i.type === "shape" && i.id === s.id)) return s;
          return {
            ...s,
            x: snapVal(o.x + dx, 22, prev.snap),
            y: snapVal(o.y + dy, 22, prev.snap),
          };
        });
        const notesPins = prev.notes.map((n) => {
          const o = d.origin![n.noteId];
          if (!o || !d.ids!.some((i) => i.type === "note" && i.id === n.noteId)) return n;
          return {
            ...n,
            x: snapVal(o.x + dx, 22, prev.snap),
            y: snapVal(o.y + dy, 22, prev.snap),
          };
        });
        return { ...prev, stickies, shapes, notes: notesPins };
      });
    }
  };

  const onPointerUp = () => {
    if (drag.current?.mode === "move") {
      // commit history once at end
      pushHistory(doc);
    }
    drag.current = null;
  };

  const deleteSelected = () => {
    if (!selected.length) return;
    updateDoc((d) => {
      const stickyIds = new Set(selected.filter((s) => s.type === "sticky").map((s) => s.id));
      const shapeIds = new Set(selected.filter((s) => s.type === "shape").map((s) => s.id));
      const noteIds = new Set(selected.filter((s) => s.type === "note").map((s) => s.id));
      const removeRefs = new Set([
        ...Array.from(stickyIds),
        ...Array.from(shapeIds),
        ...Array.from(noteIds).map((id) => `note:${id}`),
      ]);
      return {
        ...d,
        stickies: d.stickies.filter((s) => !stickyIds.has(s.id)),
        shapes: d.shapes.filter((s) => !shapeIds.has(s.id)),
        notes: d.notes.filter((n) => !noteIds.has(n.noteId)),
        edges: d.edges.filter((e) => !removeRefs.has(e.from) && !removeRefs.has(e.to)),
      };
    });
    setSelected([]);
    flash("已刪除");
  };

  const duplicateSelected = () => {
    if (!selected.length) return;
    updateDoc((d) => {
      const stickies = [...d.stickies];
      const shapes = [...d.shapes];
      for (const s of selected) {
        if (s.type === "sticky") {
          const src = d.stickies.find((x) => x.id === s.id);
          if (src) stickies.push({ ...src, id: uid("st"), x: src.x + 24, y: src.y + 24, z: Date.now() });
        }
        if (s.type === "shape") {
          const src = d.shapes.find((x) => x.id === s.id);
          if (src) shapes.push({ ...src, id: uid("sh"), x: src.x + 24, y: src.y + 24, z: Date.now() });
        }
      }
      return { ...d, stickies, shapes };
    });
    flash("已複製");
  };

  const pinNote = (noteId: string) => {
    updateDoc((d) => {
      if (d.notes.some((n) => n.noteId === noteId)) return d;
      const i = d.notes.length;
      return {
        ...d,
        notes: [
          ...d.notes,
          {
            noteId,
            x: 60 + (i % 5) * 230,
            y: 60 + Math.floor(i / 5) * 160,
            w: 200,
            h: 120,
          },
        ],
      };
    });
    flash("已釘上畫布");
  };

  const focusNote = (noteId: string) => {
    const pin = doc.notes.find((n) => n.noteId === noteId);
    if (!pin) return;
    setDoc((d) => ({
      ...d,
      pan: {
        x: 120 - pin.x * d.scale,
        y: 120 - pin.y * d.scale,
      },
    }));
    setSelected([{ type: "note", id: noteId }]);
  };

  const autoLayout = () => {
    updateDoc((d) => ({ ...d, notes: autoLayoutNotes(d.notes) }));
    flash("已自動排版筆記卡");
  };

  const fit = () => {
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect) return;
    const view = fitView(doc, { w: rect.width, h: rect.height });
    setDoc((d) => ({ ...d, ...view }));
  };

  const onExport = () => {
    const blob = new Blob([exportCanvasJson(doc)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `cadence-canvas-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    flash("已匯出 JSON");
  };

  const onImport = () => {
    const raw = window.prompt("貼上白板 JSON");
    if (!raw) return;
    const next = importCanvasJson(raw);
    if (!next) {
      flash("JSON 無效");
      return;
    }
    updateDoc(() => next);
    flash("已匯入");
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === "TEXTAREA" || (e.target as HTMLElement)?.tagName === "INPUT") return;
      const k = e.key.toLowerCase();
      if (k === "v") setTool("select");
      if (k === "h") setTool("pan");
      if (k === "s") setTool("sticky");
      if (k === "t") setTool("text");
      if (k === "r") setTool("rect");
      if (k === "o") setTool("ellipse");
      if (k === "f") setTool("frame");
      if (k === "c") setTool("connect");
      if (k === "delete" || k === "backspace") {
        e.preventDefault();
        deleteSelected();
      }
      if ((e.ctrlKey || e.metaKey) && k === "z") {
        e.preventDefault();
        undo();
      }
      if ((e.ctrlKey || e.metaKey) && k === "d") {
        e.preventDefault();
        duplicateSelected();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, doc]);

  const askAi = async (prompt: string) => {
    const res = await fetch("/api/ai/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "custom", prompt }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "AI 失敗");
    return data.text as string;
  };

  if (loading) return <p style={{ color: "var(--text-muted)" }}>載入中…</p>;
  if (!user) {
    return (
      <div className="cv-page cv-guest">
        <ScrambleText words="白板" as="h1" className="page-title font-display" />
        <p className="page-sub">登入後在空間畫布上擺筆記、便利貼與連線。</p>
        <ShinyPill onClick={() => loginWithGoogle()}>登入</ShinyPill>
      </div>
    );
  }

  const isSelected = (type: Selectable["type"], id: string) =>
    selected.some((s) => s.type === type && s.id === id);

  return (
    <div className="cv-page">
      <header className="cv-hero">
        <div>
          <ScrambleText words="白板" as="h1" className="page-title font-display" speed={22} />
          <p className="page-sub">
            空間思考：筆記卡、便利貼、框架與連線。空白拖曳平移，滾輪縮放。
            {connectFrom ? " · 連線中…" : ""}
          </p>
        </div>
        <div className="cv-hero-actions">
          <button type="button" className="btn btn-ghost btn-sm" onClick={undo} disabled={!history.length}>
            復原
          </button>
          <input
            className="input"
            style={{ width: 160 }}
            value={doc.name}
            onChange={(e) => setDoc((d) => ({ ...d, name: e.target.value }))}
          />
        </div>
      </header>

      <CanvasToolbar
        tool={tool}
        onTool={setTool}
        stickyColor={stickyColor}
        onStickyColor={setStickyColor}
        scale={doc.scale}
        grid={doc.grid}
        snap={doc.snap}
        onZoomIn={() => setDoc((d) => ({ ...d, scale: clampScale(d.scale + 0.1) }))}
        onZoomOut={() => setDoc((d) => ({ ...d, scale: clampScale(d.scale - 0.1) }))}
        onFit={fit}
        onReset={() => setDoc((d) => ({ ...d, scale: 1, pan: { x: 48, y: 48 } }))}
        onToggleGrid={() => setDoc((d) => ({ ...d, grid: !d.grid }))}
        onToggleSnap={() => setDoc((d) => ({ ...d, snap: !d.snap }))}
        onDelete={deleteSelected}
        onDuplicate={duplicateSelected}
        onAutoLayout={autoLayout}
        onExport={onExport}
        onImport={onImport}
        canEditSelection={selected.length > 0}
      />

      <div className="cv-layout">
        <div
          ref={stageRef}
          className={`cv-stage${doc.grid ? " has-grid" : ""} tool-${tool}`}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={onPointerUp}
          onWheel={(e) => {
            e.preventDefault();
            setDoc((d) => ({
              ...d,
              scale: clampScale(d.scale + (e.deltaY > 0 ? -0.06 : 0.06)),
            }));
          }}
        >
          <div
            className="cv-world"
            style={{
              transform: `translate(${doc.pan.x}px, ${doc.pan.y}px) scale(${doc.scale})`,
            }}
          >
            <svg className="cv-edges" width="8000" height="6000">
              {doc.edges.map((edge) => {
                const a = nodeCenter(doc, edge.from);
                const b = nodeCenter(doc, edge.to);
                if (!a || !b) return null;
                return (
                  <path
                    key={edge.id}
                    d={edgePath(a, b)}
                    className={`cv-edge${isSelected("edge", edge.id) ? " is-on" : ""}`}
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      setSelected([{ type: "edge", id: edge.id }]);
                    }}
                  />
                );
              })}
            </svg>

            {doc.shapes.map((s) => (
              <div
                key={s.id}
                className={`cv-shape cv-shape--${s.shape}${isSelected("shape", s.id) ? " is-on" : ""}`}
                style={{
                  left: s.x,
                  top: s.y,
                  width: s.w,
                  height: s.h,
                  borderColor: s.color,
                  background:
                    s.shape === "frame"
                      ? "transparent"
                      : `${s.color}22`,
                  borderRadius: s.shape === "ellipse" ? "50%" : s.shape === "frame" ? 16 : 12,
                  zIndex: s.z,
                }}
              >
                {s.label && <span className="cv-shape-label">{s.label}</span>}
              </div>
            ))}

            {doc.stickies.map((s) => {
              const pal = STICKY_COLORS.find((c) => c.id === s.color)!;
              return (
                <div
                  key={s.id}
                  className={`cv-sticky${isSelected("sticky", s.id) ? " is-on" : ""}`}
                  style={{
                    left: s.x,
                    top: s.y,
                    width: s.w,
                    minHeight: s.h,
                    background: pal.bg,
                    borderColor: pal.border,
                    zIndex: s.z,
                  }}
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    setEditingSticky(s.id);
                  }}
                >
                  {editingSticky === s.id ? (
                    <textarea
                      autoFocus
                      value={s.text}
                      onChange={(e) => {
                        const text = e.target.value;
                        setDoc((d) => ({
                          ...d,
                          stickies: d.stickies.map((x) => (x.id === s.id ? { ...x, text } : x)),
                        }));
                      }}
                      onBlur={() => setEditingSticky(null)}
                      onPointerDown={(e) => e.stopPropagation()}
                    />
                  ) : (
                    <p>{s.text || "雙擊編輯…"}</p>
                  )}
                </div>
              );
            })}

            {doc.notes.map((pin) => {
              const n = noteMap.get(pin.noteId);
              if (!n) return null;
              return (
                <div
                  key={pin.noteId}
                  className={`cv-note${isSelected("note", pin.noteId) ? " is-on" : ""}`}
                  style={{ left: pin.x, top: pin.y, width: pin.w, minHeight: pin.h }}
                >
                  <Link href={`/notes/${n.id}`} onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}>
                    {n.title || "未命名"}
                  </Link>
                  <p>
                    {n.body_md.replace(/<!--[\s\S]*?-->/g, "").replace(/[#>*`\[\]]/g, "").slice(0, 90) || "（空白）"}
                  </p>
                  <div className="cv-note-meta">
                    {n.folder ? <span>{n.folder}</span> : null}
                    {(n.tags || []).slice(0, 2).map((t) => (
                      <span key={t}>#{t}</span>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <CanvasAside
          notes={notes}
          doc={doc}
          onPinNote={pinNote}
          onFocusNote={focusNote}
          onAskAi={askAi}
        />
      </div>

      {toast && <p className="cv-toast">{toast}</p>}
    </div>
  );
}
