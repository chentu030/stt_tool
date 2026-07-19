"use client";

import { askPrompt } from "@/lib/dialogs";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as REPointerEvent,
} from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import { listenToUserNotes, loginWithGoogle, type Note } from "@/lib/firebase";
import ScrambleText from "@/components/motion/ScrambleText";
import ShinyPill from "@/components/motion/ShinyPill";
import CanvasToolbar from "@/components/canvas/CanvasToolbar";
import CanvasAside from "@/components/canvas/CanvasAside";
import WorkspaceSwitcher from "@/components/shell/WorkspaceSwitcher";
import {
  type CanvasDoc,
  type CanvasEdge,
  type CanvasShape,
  type CanvasSticky,
  type Selectable,
  type StickyColor,
  type ToolId,
  type ClipboardPayload,
  type CanvasAiOp,
  STICKY_COLORS,
  SHAPE_COLORS,
  autoLayoutNotes,
  clampScale,
  edgePath,
  emptyDoc,
  exportCanvasJson,
  fitView,
  importCanvasJson,
  nodeCenter,
  snapVal,
  uid,
  copySelection,
  pasteClipboard,
  serializeCanvasForAi,
  parseCanvasAiResponse,
  applyCanvasOps,
} from "@/lib/canvasStore";
import {
  listenCanvases,
  listenCanvas,
  createCanvas,
  saveCanvas,
  renameCanvas,
  deleteCanvas,
  lastCanvasKey,
  type CanvasMeta,
} from "@/lib/canvasCloud";
import { usePrefs } from "@/components/PrefsProvider";

type ResizeHandle = "nw" | "ne" | "sw" | "se" | "e" | "w" | "n" | "s";

const MIN_W = 80;
const MIN_H = 60;

export default function CanvasIdPage() {
  const params = useParams();
  const canvasId = String(params.id || "");
  const router = useRouter();
  const { user, loading } = useAuth();
  const { prefs } = usePrefs();
  const [notes, setNotes] = useState<Note[]>([]);
  const [list, setList] = useState<CanvasMeta[]>([]);
  const [doc, setDoc] = useState<CanvasDoc>(() => emptyDoc());
  const [ready, setReady] = useState(false);
  const [tool, setTool] = useState<ToolId>(prefs.canvasDefaultTool);
  const [stickyColor, setStickyColor] = useState<StickyColor>("yellow");
  const [selected, setSelected] = useState<Selectable[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingShape, setEditingShape] = useState<string | null>(null);
  const [connectFrom, setConnectFrom] = useState<string | null>(null);
  const [toast, setToast] = useState("");
  const [history, setHistory] = useState<CanvasDoc[]>([]);
  const [asideOpen, setAsideOpen] = useState(true);
  const [clipboard, setClipboard] = useState<ClipboardPayload | null>(null);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null);
  const [marquee, setMarquee] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const skipCloud = useRef(false);
  const drag = useRef<{
    mode: "move" | "pan" | "marquee" | "resize";
    ids?: Selectable[];
    startX: number;
    startY: number;
    worldX?: number;
    worldY?: number;
    origin?: Record<string, { x: number; y: number; w?: number; h?: number }>;
    pan0?: { x: number; y: number };
    handle?: ResizeHandle;
    moved?: boolean;
  } | null>(null);

  useEffect(() => {
    if (!user) return;
    return listenToUserNotes(user.uid, setNotes);
  }, [user]);

  useEffect(() => {
    if (!user) return;
    return listenCanvases(user.uid, setList);
  }, [user]);

  useEffect(() => {
    if (!user || !canvasId) return;
    setReady(false);
    const unsub = listenCanvas(user.uid, canvasId, (d) => {
      if (!d) {
        router.replace("/canvas");
        return;
      }
      if (skipCloud.current) return;
      setDoc(d);
      setReady(true);
      localStorage.setItem(lastCanvasKey(user.uid), canvasId);
    });
    return () => unsub();
  }, [user, canvasId, router]);

  useEffect(() => {
    if (!user || !canvasId || !ready) return;
    const t = setTimeout(() => {
      skipCloud.current = true;
      void saveCanvas(user.uid, canvasId, doc).finally(() => {
        setTimeout(() => {
          skipCloud.current = false;
        }, 200);
      });
    }, 500);
    return () => clearTimeout(t);
  }, [doc, user, canvasId, ready]);

  const flash = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(""), 2000);
  };

  const pushHistory = useCallback((prev: CanvasDoc) => {
    setHistory((h) => [...h.slice(-29), prev]);
  }, []);

  const updateDoc = useCallback(
    (updater: (d: CanvasDoc) => CanvasDoc, record = true) => {
      setDoc((prev) => {
        if (record) pushHistory(prev);
        return updater(prev);
      });
    },
    [pushHistory]
  );

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

  const refIdForSelectable = (s: Selectable): string =>
    s.type === "note" ? `note:${s.id}` : s.id;

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

  const boxOf = (s: Selectable): { x: number; y: number; w: number; h: number } | null => {
    if (s.type === "sticky") {
      const st = doc.stickies.find((x) => x.id === s.id);
      return st ? { x: st.x, y: st.y, w: st.w, h: st.h } : null;
    }
    if (s.type === "shape") {
      const sh = doc.shapes.find((x) => x.id === s.id);
      return sh ? { x: sh.x, y: sh.y, w: sh.w, h: sh.h } : null;
    }
    if (s.type === "note") {
      const n = doc.notes.find((x) => x.noteId === s.id);
      return n ? { x: n.x, y: n.y, w: n.w, h: n.h } : null;
    }
    return null;
  };

  const onPointerDown = (e: REPointerEvent) => {
    if ((e.target as HTMLElement).closest("textarea,a,button,input,.cv-handle,.cv-ctx")) return;
    setCtxMenu(null);
    if (e.button === 2) return;
    const world = screenToWorld(e.clientX, e.clientY);
    stageRef.current?.setPointerCapture?.(e.pointerId);

    if (tool === "pan" || e.button === 1 || (tool === "select" && e.altKey)) {
      drag.current = { mode: "pan", startX: e.clientX, startY: e.clientY, pan0: { ...doc.pan } };
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
      const edge: CanvasEdge = { id: uid("e"), kind: "edge", from: connectFrom, to: ref };
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
        setEditingId(sticky.id);
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

    const hit = hitTest(world);
    if (!hit) {
      if (!e.shiftKey) setSelected([]);
      drag.current = {
        mode: "marquee",
        startX: e.clientX,
        startY: e.clientY,
        worldX: world.x,
        worldY: world.y,
      };
      setMarquee({ x0: world.x, y0: world.y, x1: world.x, y1: world.y });
      return;
    }

    setSelected((prev) => {
      if (e.shiftKey) {
        const exists = prev.some((p) => p.type === hit.type && p.id === hit.id);
        return exists ? prev.filter((p) => !(p.type === hit.type && p.id === hit.id)) : [...prev, hit];
      }
      const already = prev.some((p) => p.type === hit.type && p.id === hit.id);
      return already ? prev : [hit];
    });

    const ids = e.shiftKey
      ? (() => {
          const exists = selected.some((p) => p.type === hit.type && p.id === hit.id);
          return exists
            ? selected.filter((p) => !(p.type === hit.type && p.id === hit.id))
            : [...selected, hit];
        })()
      : selected.some((p) => p.type === hit.type && p.id === hit.id)
        ? selected
        : [hit];

    const origin: Record<string, { x: number; y: number; w?: number; h?: number }> = {};
    for (const s of ids) {
      const b = boxOf(s);
      if (!b) continue;
      const key = s.type === "note" ? s.id : s.id;
      origin[key] = { x: b.x, y: b.y, w: b.w, h: b.h };
    }
    drag.current = {
      mode: "move",
      ids,
      startX: world.x,
      startY: world.y,
      origin,
      moved: false,
    };
  };

  const startResize = (e: REPointerEvent, handle: ResizeHandle) => {
    e.stopPropagation();
    e.preventDefault();
    if (selected.length !== 1) return;
    const s = selected[0];
    if (s.type === "edge") return;
    const b = boxOf(s);
    if (!b) return;
    const world = screenToWorld(e.clientX, e.clientY);
    const key = s.id;
    drag.current = {
      mode: "resize",
      ids: [s],
      startX: world.x,
      startY: world.y,
      handle,
      origin: { [key]: { x: b.x, y: b.y, w: b.w, h: b.h } },
    };
    stageRef.current?.setPointerCapture?.(e.pointerId);
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
    if (d.mode === "marquee" && d.worldX != null && d.worldY != null) {
      const world = screenToWorld(e.clientX, e.clientY);
      setMarquee({ x0: d.worldX, y0: d.worldY, x1: world.x, y1: world.y });
      return;
    }
    if (d.mode === "resize" && d.ids?.[0] && d.origin && d.handle) {
      const world = screenToWorld(e.clientX, e.clientY);
      const s = d.ids[0];
      const o = d.origin[s.id];
      if (!o || o.w == null || o.h == null) return;
      let { x, y, w, h } = { x: o.x, y: o.y, w: o.w, h: o.h };
      const dx = world.x - d.startX;
      const dy = world.y - d.startY;
      const hdl = d.handle;
      if (hdl.includes("e")) w = Math.max(MIN_W, o.w + dx);
      if (hdl.includes("s")) h = Math.max(MIN_H, o.h + dy);
      if (hdl.includes("w")) {
        w = Math.max(MIN_W, o.w - dx);
        x = o.x + o.w - w;
      }
      if (hdl.includes("n")) {
        h = Math.max(MIN_H, o.h - dy);
        y = o.y + o.h - h;
      }
      x = snapVal(x, 22, doc.snap);
      y = snapVal(y, 22, doc.snap);
      setDoc((prev) => {
        if (s.type === "sticky") {
          return {
            ...prev,
            stickies: prev.stickies.map((st) => (st.id === s.id ? { ...st, x, y, w, h } : st)),
          };
        }
        if (s.type === "shape") {
          return {
            ...prev,
            shapes: prev.shapes.map((sh) => (sh.id === s.id ? { ...sh, x, y, w, h } : sh)),
          };
        }
        if (s.type === "note") {
          return {
            ...prev,
            notes: prev.notes.map((n) => (n.noteId === s.id ? { ...n, x, y, w, h } : n)),
          };
        }
        return prev;
      });
      return;
    }
    if (d.mode === "move" && d.ids && d.origin) {
      const world = screenToWorld(e.clientX, e.clientY);
      const dx = world.x - d.startX;
      const dy = world.y - d.startY;
      if (!d.moved && Math.hypot(dx, dy) < 3) return;
      d.moved = true;
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
    const d = drag.current;
    if (d?.mode === "marquee" && marquee) {
      const x1 = Math.min(marquee.x0, marquee.x1);
      const y1 = Math.min(marquee.y0, marquee.y1);
      const x2 = Math.max(marquee.x0, marquee.x1);
      const y2 = Math.max(marquee.y0, marquee.y1);
      if (x2 - x1 > 4 || y2 - y1 > 4) {
        const hits: Selectable[] = [];
        for (const s of doc.stickies) {
          if (s.x + s.w >= x1 && s.x <= x2 && s.y + s.h >= y1 && s.y <= y2) {
            hits.push({ type: "sticky", id: s.id });
          }
        }
        for (const s of doc.shapes) {
          if (s.x + s.w >= x1 && s.x <= x2 && s.y + s.h >= y1 && s.y <= y2) {
            hits.push({ type: "shape", id: s.id });
          }
        }
        for (const n of doc.notes) {
          if (n.x + n.w >= x1 && n.x <= x2 && n.y + n.h >= y1 && n.y <= y2) {
            hits.push({ type: "note", id: n.noteId });
          }
        }
        setSelected(hits);
      }
      setMarquee(null);
    }
    if (d?.mode === "move" && d.moved) pushHistory(doc);
    if (d?.mode === "resize") pushHistory(doc);
    drag.current = null;
  };

  const deleteSelected = useCallback(() => {
    if (!selected.length) return;
    updateDoc((d) => {
      const stickyIds = new Set(selected.filter((s) => s.type === "sticky").map((s) => s.id));
      const shapeIds = new Set(selected.filter((s) => s.type === "shape").map((s) => s.id));
      const noteIds = new Set(selected.filter((s) => s.type === "note").map((s) => s.id));
      const edgeIds = new Set(selected.filter((s) => s.type === "edge").map((s) => s.id));
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
        edges: d.edges.filter(
          (e) => !edgeIds.has(e.id) && !removeRefs.has(e.from) && !removeRefs.has(e.to)
        ),
      };
    });
    setSelected([]);
    flash("已刪除");
  }, [selected, updateDoc]);

  const doCopy = useCallback(() => {
    if (!selected.length) return;
    setClipboard(copySelection(doc, selected));
    flash("已複製");
  }, [doc, selected]);

  const doCut = useCallback(() => {
    if (!selected.length) return;
    setClipboard(copySelection(doc, selected));
    deleteSelected();
    flash("已剪下");
  }, [doc, selected, deleteSelected]);

  const doPaste = useCallback(() => {
    if (!clipboard) return;
    const { doc: next, selected: sel } = pasteClipboard(doc, clipboard);
    updateDoc(() => next);
    setSelected(sel);
    flash("已貼上");
  }, [clipboard, doc, updateDoc]);

  const startEdit = () => {
    const s = selected[0];
    if (!s) return;
    if (s.type === "sticky") setEditingId(s.id);
    if (s.type === "shape") setEditingShape(s.id);
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
      pan: { x: 120 - pin.x * d.scale, y: 120 - pin.y * d.scale },
    }));
    setSelected([{ type: "note", id: noteId }]);
  };

  const askCanvasAi = async (prompt: string) => {
    const selectedIds = selected.map((s) => (s.type === "note" ? `note:${s.id}` : s.id));
    const res = await fetch("/api/ai/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "canvas",
        prompt,
        canvasSummary: serializeCanvasForAi(
          doc,
          notes.map((n) => ({ id: n.id, title: n.title })),
          selectedIds
        ),
        selectedIds,
        assistant: {
          name: prefs.aiAssistantName,
          style: prefs.aiStyle,
          model: prefs.aiModel,
          grounding: prefs.aiGrounding,
        },
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "AI 失敗");
    return parseCanvasAiResponse(data.text as string);
  };

  const applyOps = (ops: CanvasAiOp[]) => {
    if (!ops.length) return;
    updateDoc((d) => applyCanvasOps(d, ops, new Set(notes.map((n) => n.id))));
    flash(`已套用 ${ops.length} 項 AI 變更`);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "TEXTAREA" || tag === "INPUT") return;
      const k = e.key.toLowerCase();
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) {
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
        return;
      }
      if (k === "z") {
        e.preventDefault();
        undo();
      }
      if (k === "c") {
        e.preventDefault();
        doCopy();
      }
      if (k === "x") {
        e.preventDefault();
        doCut();
      }
      if (k === "v") {
        e.preventDefault();
        doPaste();
      }
      if (k === "d") {
        e.preventDefault();
        doCopy();
        doPaste();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [deleteSelected, doCopy, doCut, doPaste]);

  if (loading) return <p style={{ color: "var(--text-muted)", padding: "1rem" }}>載入中…</p>;
  if (!user) {
    return (
      <div className="cv-page cv-guest">
        <ScrambleText words="白板" as="h1" className="page-title font-display" />
        <p className="page-sub">登入後使用白板。</p>
        <ShinyPill onClick={() => loginWithGoogle()}>登入</ShinyPill>
      </div>
    );
  }

  const isSelected = (type: Selectable["type"], id: string) =>
    selected.some((s) => s.type === type && s.id === id);

  const single = selected.length === 1 ? selected[0] : null;
  const resizeBox = single && single.type !== "edge" ? boxOf(single) : null;

  return (
    <div className="cv-page cv-immersive">
      <div className="cv-float-chrome">
        <WorkspaceSwitcher
          label="白板"
          items={list}
          currentId={canvasId}
          onSelect={(id) => router.push(`/canvas/${id}`)}
          onCreate={() => {
            void (async () => {
              const id = await createCanvas(user.uid, "新白板");
              router.push(`/canvas/${id}`);
            })();
          }}
          onRename={(id, name) => {
            void renameCanvas(user.uid, id, name);
            setDoc((d) => ({ ...d, name }));
          }}
          onDelete={(id) => {
            void (async () => {
              await deleteCanvas(user.uid, id);
              const next = list.find((c) => c.id !== id);
              if (next) router.push(`/canvas/${next.id}`);
              else router.push("/canvas");
            })();
          }}
        />
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
          onReset={() => setDoc((d) => ({ ...d, scale: 1, pan: { x: 48, y: 48 } }))}
          onFit={() => {
            const rect = stageRef.current?.getBoundingClientRect();
            if (!rect) return;
            setDoc((d) => ({ ...d, ...fitView(d, { w: rect.width, h: rect.height }) }));
          }}
          onToggleGrid={() => setDoc((d) => ({ ...d, grid: !d.grid }))}
          onToggleSnap={() => setDoc((d) => ({ ...d, snap: !d.snap }))}
          onDelete={deleteSelected}
          onDuplicate={() => {
            doCopy();
            doPaste();
          }}
          onAutoLayout={() => {
            updateDoc((d) => ({ ...d, notes: autoLayoutNotes(d.notes) }));
            flash("已自動排版");
          }}
          onExport={() => {
            const blob = new Blob([exportCanvasJson(doc)], { type: "application/json" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `cadence-canvas-${Date.now()}.json`;
            a.click();
            URL.revokeObjectURL(url);
          }}
          onImport={() => {
            void (async () => {
              const raw = await askPrompt({
                title: "匯入白板",
                message: "貼上白板 JSON",
                multiline: true,
              });
              if (!raw) return;
              const next = importCanvasJson(raw);
              if (!next) {
                flash("JSON 無效");
                return;
              }
              updateDoc(() => next);
            })();
          }}
          canEditSelection={selected.length > 0}
        />
        <div className="cv-float-actions">
          <button type="button" className="btn btn-ghost btn-sm" onClick={undo} disabled={!history.length}>
            復原
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAsideOpen((v) => !v)}>
            {asideOpen ? "收合側欄" : "側欄"}
          </button>
        </div>
      </div>

      <div className={`cv-layout cv-layout--immersive${asideOpen ? "" : " cv-layout--wide"}`}>
        <div
          ref={stageRef}
          className={`cv-stage${doc.grid ? " has-grid" : ""} tool-${tool}`}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={onPointerUp}
          onContextMenu={(e) => {
            e.preventDefault();
            const world = screenToWorld(e.clientX, e.clientY);
            const hit = hitTest(world);
            if (hit) {
              const already = selected.some((s) => s.type === hit.type && s.id === hit.id);
              if (!already) setSelected([hit]);
            }
            setCtxMenu({ x: e.clientX, y: e.clientY });
          }}
          onDoubleClick={(e) => {
            if ((e.target as HTMLElement).closest("textarea,a,button,input")) return;
            const world = screenToWorld(e.clientX, e.clientY);
            const hit = hitTest(world);
            if (!hit) return;
            if (hit.type === "sticky") {
              setSelected([hit]);
              setEditingId(hit.id);
            }
            if (hit.type === "shape") {
              setSelected([hit]);
              setEditingShape(hit.id);
            }
          }}
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
            style={{ transform: `translate(${doc.pan.x}px, ${doc.pan.y}px) scale(${doc.scale})` }}
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
                    onPointerDown={(ev) => {
                      ev.stopPropagation();
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
                  background: s.shape === "frame" ? "transparent" : `${s.color}22`,
                  borderRadius: s.shape === "ellipse" ? "50%" : s.shape === "frame" ? 16 : 12,
                  zIndex: s.z,
                }}
              >
                {editingShape === s.id ? (
                  <input
                    className="cv-shape-edit"
                    autoFocus
                    value={s.label}
                    onChange={(e) => {
                      const label = e.target.value;
                      setDoc((d) => ({
                        ...d,
                        shapes: d.shapes.map((x) => (x.id === s.id ? { ...x, label } : x)),
                      }));
                    }}
                    onBlur={() => setEditingShape(null)}
                    onPointerDown={(e) => e.stopPropagation()}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") setEditingShape(null);
                    }}
                  />
                ) : (
                  <span className="cv-shape-label">{s.label || "雙擊編輯"}</span>
                )}
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
                    height: s.h,
                    background: pal.bg,
                    borderColor: pal.border,
                    zIndex: s.z,
                  }}
                >
                  {editingId === s.id ? (
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
                      onBlur={() => setEditingId(null)}
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
                  style={{ left: pin.x, top: pin.y, width: pin.w, height: pin.h }}
                >
                  <Link
                    href={`/notes/${n.id}`}
                    onClick={(e) => e.stopPropagation()}
                    onPointerDown={(e) => e.stopPropagation()}
                  >
                    {n.title || "未命名"}
                  </Link>
                  <p>
                    {n.body_md
                      .replace(/<!--[\s\S]*?-->/g, "")
                      .replace(/[#>*`\[\]]/g, "")
                      .slice(0, 90) || "（空白）"}
                  </p>
                </div>
              );
            })}

            {resizeBox && (
              <div
                className="cv-resize-box"
                style={{
                  left: resizeBox.x,
                  top: resizeBox.y,
                  width: resizeBox.w,
                  height: resizeBox.h,
                }}
              >
                {(["nw", "ne", "sw", "se", "n", "s", "e", "w"] as ResizeHandle[]).map((h) => (
                  <span
                    key={h}
                    className={`cv-handle cv-handle--${h}`}
                    onPointerDown={(e) => startResize(e, h)}
                  />
                ))}
              </div>
            )}

            {marquee && (
              <div
                className="cv-marquee"
                style={{
                  left: Math.min(marquee.x0, marquee.x1),
                  top: Math.min(marquee.y0, marquee.y1),
                  width: Math.abs(marquee.x1 - marquee.x0),
                  height: Math.abs(marquee.y1 - marquee.y0),
                }}
              />
            )}
          </div>
        </div>

        {asideOpen && (
          <CanvasAside
            notes={notes}
            doc={doc}
            selectedIds={selected.map((s) => (s.type === "note" ? `note:${s.id}` : s.id))}
            onPinNote={pinNote}
            onFocusNote={focusNote}
            onAskCanvasAi={askCanvasAi}
            onApplyOps={applyOps}
          />
        )}
      </div>

      {ctxMenu && (
        <div
          className="cv-ctx"
          style={{ left: ctxMenu.x, top: ctxMenu.y }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <button type="button" onClick={() => { startEdit(); setCtxMenu(null); }}>編輯</button>
          <button type="button" onClick={() => { doCut(); setCtxMenu(null); }}>剪下</button>
          <button type="button" onClick={() => { doCopy(); setCtxMenu(null); }}>複製</button>
          <button type="button" onClick={() => { doPaste(); setCtxMenu(null); }}>貼上</button>
          <button type="button" className="is-danger" onClick={() => { deleteSelected(); setCtxMenu(null); }}>
            刪除
          </button>
        </div>
      )}

      {toast && <p className="cv-toast">{toast}</p>}
      {connectFrom && <p className="cv-toast">連線中… 再點終點</p>}
    </div>
  );
}
