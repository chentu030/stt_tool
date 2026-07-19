"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import {
  listenToUserNotes,
  loginWithGoogle,
  createNote,
  updateNote,
  uploadNoteMedia,
  Note,
} from "@/lib/firebase";
import { appendMediaToNote, mediaMarkdownForFile, titleFromFileName } from "@/lib/noteMediaInsert";
import ScrambleText from "@/components/motion/ScrambleText";
import ShinyPill from "@/components/motion/ShinyPill";
import GraphToolbar from "@/components/graph/GraphToolbar";
import GraphAside from "@/components/graph/GraphAside";
import StageSelectionAi from "@/components/StageSelectionAi";
import WorkspaceSwitcher from "@/components/shell/WorkspaceSwitcher";
import ContinueChips, { spatialContinueChips } from "@/components/shell/ContinueChips";
import { downloadText } from "@/lib/libraryIndex";
import { toast } from "@/lib/toast";
import { askPrompt } from "@/lib/dialogs";
import {
  createGraph,
  deleteGraph,
  lastGraphKey,
  listenGraph,
  listenGraphs,
  updateGraph,
  type GraphConfig,
} from "@/lib/graphStore";
import {
  DEFAULT_FILTERS,
  GraphFilters,
  GraphNode,
  LayoutMode,
  applySavedPositions,
  boundsOf,
  buildGraph,
  colorForNode,
  computeStats,
  exportGraphJson,
  exportGraphMarkdown,
  filterGraph,
  folderBuckets,
  ghostTargets,
  layoutGraph,
  nodeIdForNote,
  orphanNotes,
  radiusForNode,
  shortestPath,
  tagBuckets,
  topHubs,
} from "@/lib/graphModel";
import {
  applyStageWheel,
  isDragGesture,
  isZoomInKey,
  isZoomOutKey,
  zoomAtClientPoint,
} from "@/lib/canvasNav";
import { usePrefs } from "@/components/PrefsProvider";

type DragState =
  | { kind: "pan"; sx: number; sy: number; ox: number; oy: number }
  | { kind: "node"; id: string; ox: number; oy: number; sx: number; sy: number }
  | null;

const PERSIST_MS = 450;

export default function GraphDetailPage() {
  const { user, loading } = useAuth();
  const { prefs } = usePrefs();
  const router = useRouter();
  const params = useParams();
  const searchParams = useSearchParams();
  const graphId = String(params.id || "");

  const [notes, setNotes] = useState<Note[]>([]);
  const [graphs, setGraphs] = useState<GraphConfig[]>([]);
  const [graph, setGraph] = useState<GraphConfig | null | undefined>(undefined);
  const [configReady, setConfigReady] = useState(false);
  const [filters, setFilters] = useState<GraphFilters>({ ...DEFAULT_FILTERS });
  const [layout, setLayout] = useState<LayoutMode>("force");
  /** Bump to force a full relayout once (not on every notes refresh). */
  const [relayoutNonce, setRelayoutNonce] = useState(0);
  const appliedRelayout = useRef(0);
  const [dragVer, setDragVer] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [pan, setPan] = useState({ x: 40, y: 40 });
  const [scale, setScale] = useState(1);
  const panRef = useRef(pan);
  const scaleRef = useRef(scale);
  panRef.current = pan;
  scaleRef.current = scale;
  const [spaceDown, setSpaceDown] = useState(false);
  const [pathMode, setPathMode] = useState(false);
  const [pathEnds, setPathEnds] = useState<[string | null, string | null]>([null, null]);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiText, setAiText] = useState("");
  const [aiError, setAiError] = useState("");
  const [selAiOpen, setSelAiOpen] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState>(null);
  const positionsRef = useRef<Record<string, { x: number; y: number }>>({});
  const seededId = useRef<string | null>(null);
  const skipPersist = useRef(false);
  const focusApplied = useRef(false);

  useEffect(() => {
    if (!user) return;
    return listenToUserNotes(user.uid, setNotes);
  }, [user]);

  useEffect(() => {
    if (!user) return;
    return listenGraphs(user.uid, setGraphs);
  }, [user]);

  useEffect(() => {
    seededId.current = null;
    setConfigReady(false);
    setGraph(undefined);
    setSelectedId(null);
    setPathMode(false);
    setPathEnds([null, null]);
    setAiText("");
    setAiError("");
    setSelAiOpen(false);
  }, [graphId]);

  useEffect(() => {
    if (!user || !graphId) return;
    return listenGraph(user.uid, graphId, (g) => {
      setGraph(g);
      if (g) localStorage.setItem(lastGraphKey(user.uid), graphId);
    });
  }, [user, graphId]);

  useEffect(() => {
    if (graph === null) {
      router.replace("/graph");
    }
  }, [graph, router]);

  useEffect(() => {
    if (!graph || graph.id !== graphId) return;
    if (seededId.current === graphId) return;
    seededId.current = graphId;
    skipPersist.current = true;
    setFilters(graph.filters);
    setLayout(graph.layout);
    positionsRef.current = { ...graph.positions };
    setConfigReady(true);
    setDragVer((v) => v + 1);
    queueMicrotask(() => {
      skipPersist.current = false;
    });
  }, [graph, graphId]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (
        e.code === "Space" &&
        !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)
      ) {
        e.preventDefault();
        setSpaceDown(true);
      }
      if (e.key === "Escape") {
        setSelectedId(null);
        setSelAiOpen(false);
        setPathMode(false);
        setPathEnds([null, null]);
        setFilters((f) => ({ ...f, egoId: "" }));
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Space") setSpaceDown(false);
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, []);

  const persistPositions = useCallback(() => {
    if (!user || !graphId || !configReady || skipPersist.current) return;
    void updateGraph(user.uid, graphId, { positions: { ...positionsRef.current } });
  }, [user, graphId, configReady]);

  // Debounced persist for filters + layout
  useEffect(() => {
    if (!user || !graphId || !configReady || skipPersist.current) return;
    const t = window.setTimeout(() => {
      void updateGraph(user.uid, graphId, { filters, layout });
    }, PERSIST_MS);
    return () => window.clearTimeout(t);
  }, [filters, layout, user, graphId, configReady]);

  const full = useMemo(() => buildGraph(notes), [notes]);

  // Apply layout when notes / mode / forced relayout change
  useEffect(() => {
    if (!configReady) return;
    const bundle = filterGraph(full, { ...DEFAULT_FILTERS, showGhosts: true });
    applySavedPositions(bundle, positionsRef.current);
    const forceAll = relayoutNonce !== appliedRelayout.current;
    if (forceAll) appliedRelayout.current = relayoutNonce;
    const missingNodes = bundle.nodes.filter((n) => !positionsRef.current[n.id]);

    const writeAll = () => {
      for (const n of bundle.nodes) {
        positionsRef.current[n.id] = { x: n.x, y: n.y };
        const t = full.byId.get(n.id);
        if (t) {
          t.x = n.x;
          t.y = n.y;
        }
      }
      persistPositions();
    };

    if (forceAll) {
      for (const n of bundle.nodes) delete positionsRef.current[n.id];
      layoutGraph(bundle, layout, 1400, 900, layout === "force" ? 90 : 1);
      writeAll();
    } else if (missingNodes.length === bundle.nodes.length && bundle.nodes.length > 0) {
      layoutGraph(bundle, layout, 1400, 900, layout === "force" ? 90 : 1);
      writeAll();
    } else if (missingNodes.length > 0) {
      const placed = bundle.nodes.filter((n) => positionsRef.current[n.id]);
      const cx =
        placed.reduce((s, n) => s + (positionsRef.current[n.id]?.x || 0), 0) /
          Math.max(placed.length, 1) || 700;
      const cy =
        placed.reduce((s, n) => s + (positionsRef.current[n.id]?.y || 0), 0) /
          Math.max(placed.length, 1) || 450;
      missingNodes.forEach((n, i) => {
        const a = (i / Math.max(missingNodes.length, 1)) * Math.PI * 2;
        const r = 120 + (i % 5) * 28;
        const pos = { x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r };
        positionsRef.current[n.id] = pos;
        n.x = pos.x;
        n.y = pos.y;
        const t = full.byId.get(n.id);
        if (t) {
          t.x = pos.x;
          t.y = pos.y;
        }
      });
      persistPositions();
    } else {
      for (const n of bundle.nodes) {
        const p = positionsRef.current[n.id];
        if (!p) continue;
        const t = full.byId.get(n.id);
        if (t) {
          t.x = p.x;
          t.y = p.y;
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [full, layout, relayoutNonce, notes.length, configReady]);

  const painted = useMemo(() => {
    const filtered = filterGraph(full, filters);
    for (const n of filtered.nodes) {
      const saved = positionsRef.current[n.id];
      const src = full.byId.get(n.id);
      if (saved) {
        n.x = saved.x;
        n.y = saved.y;
      } else if (src) {
        n.x = src.x;
        n.y = src.y;
      }
    }
    if (filtered.nodes.some((n) => n.x === 0 && n.y === 0 && !positionsRef.current[n.id])) {
      layoutGraph(filtered, "radial", 1400, 900, 1);
      for (const n of filtered.nodes) {
        positionsRef.current[n.id] = { x: n.x, y: n.y };
      }
    }
    return filtered;
    // dragVer forces redraw while dragging
  }, [full, filters, layout, relayoutNonce, dragVer]);

  const stats = useMemo(() => computeStats(full, notes.length), [full, notes.length]);
  const hubs = useMemo(() => topHubs(full, 8), [full]);
  const orphans = useMemo(() => orphanNotes(full, 10), [full]);
  const ghosts = useMemo(() => ghostTargets(full, 10), [full]);
  const folders = useMemo(() => folderBuckets(full), [full]);
  const tags = useMemo(() => tagBuckets(full), [full]);

  const folderNames = useMemo(
    () => folders.map((f) => f.name).filter((n) => n !== "未分類"),
    [folders]
  );
  const tagNames = useMemo(() => tags.map((t) => t.name), [tags]);

  const path = useMemo(() => {
    if (!pathEnds[0] || !pathEnds[1]) return null;
    return shortestPath(full, pathEnds[0], pathEnds[1], ["wiki"]);
  }, [full, pathEnds]);

  const pathNodeSet = useMemo(() => new Set(path?.nodes || []), [path]);
  const pathEdgeSet = useMemo(() => new Set(path?.edges || []), [path]);

  const highlight = useMemo(() => {
    const id = hoverId || selectedId;
    if (!id) return { nodes: new Set<string>(), edges: new Set<string>() };
    const nodeSet = new Set<string>([id]);
    const edgeSet = new Set<string>();
    for (const e of painted.edges) {
      if (e.from === id || e.to === id) {
        edgeSet.add(e.id);
        nodeSet.add(e.from);
        nodeSet.add(e.to);
      }
    }
    return { nodes: nodeSet, edges: edgeSet };
  }, [hoverId, selectedId, painted.edges]);

  useEffect(() => {
    const noteId = searchParams.get("note");
    if (!noteId || focusApplied.current || !configReady) return;
    const nid = nodeIdForNote(noteId);
    const node = painted.byId.get(nid) || full.byId.get(nid);
    if (!node) return;
    focusApplied.current = true;
    setSelectedId(nid);
    setSelAiOpen(true);
    const el = stageRef.current;
    if (!el) return;
    const w = el.clientWidth || 800;
    const h = el.clientHeight || 600;
    const s = scaleRef.current;
    setPan({
      x: w / 2 - node.x * s,
      y: h / 2 - node.y * s,
    });
  }, [searchParams, painted, full, configReady]);

  const patchFilters = (patch: Partial<GraphFilters>) => {
    setFilters((f) => ({ ...f, ...patch }));
  };

  const onRelayout = () => {
    setRelayoutNonce((t) => t + 1);
    toast("已重算佈局");
  };

  const onClearPositions = () => {
    if (!user || !graphId) return;
    positionsRef.current = {};
    void updateGraph(user.uid, graphId, { positions: {} });
    setRelayoutNonce((t) => t + 1);
    toast("已清除記住的位置");
  };

  const onFit = () => {
    const el = stageRef.current;
    if (!el) return;
    const b = boundsOf(painted.nodes, 60);
    const w = el.clientWidth;
    const h = el.clientHeight;
    const s = Math.min(1.4, Math.max(0.35, Math.min(w / b.w, h / b.h) * 0.92));
    setScale(s);
    setPan({
      x: (w - b.w * s) / 2 - b.minX * s,
      y: (h - b.h * s) / 2 - b.minY * s,
    });
  };

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.shiftKey && !e.ctrlKey && !e.metaKey && (e.key === "1" || e.key === "!" || e.code === "Digit1")) {
        e.preventDefault();
        onFit();
      }
      if (e.shiftKey && !e.ctrlKey && !e.metaKey && (e.key === "0" || e.key === ")" || e.code === "Digit0")) {
        e.preventDefault();
        setScale(1);
      }
      const mod = e.ctrlKey || e.metaKey;
      if (mod && (isZoomInKey(e) || isZoomOutKey(e))) {
        e.preventDefault();
        const rect = stageRef.current?.getBoundingClientRect();
        if (!rect) return;
        const dir = isZoomInKey(e) ? 1 : -1;
        const next = zoomAtClientPoint(
          { pan: panRef.current, scale: scaleRef.current },
          scaleRef.current + dir * 0.12,
          rect.left + rect.width / 2,
          rect.top + rect.height / 2,
          rect
        );
        panRef.current = next.pan;
        scaleRef.current = next.scale;
        setPan(next.pan);
        setScale(next.scale);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [painted.nodes]); // eslint-disable-line react-hooks/exhaustive-deps

  // Non-passive wheel so Ctrl+wheel zooms the graph instead of the browser page
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const onWheelNative = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const next = applyStageWheel(e, rect, { pan: panRef.current, scale: scaleRef.current });
      panRef.current = next.pan;
      scaleRef.current = next.scale;
      setPan(next.pan);
      setScale(next.scale);
    };
    el.addEventListener("wheel", onWheelNative, { passive: false });
    return () => el.removeEventListener("wheel", onWheelNative);
  }, [configReady]);

  const onZoom = (delta: number) => {
    const el = stageRef.current;
    if (!el) {
      const s = Math.min(2.5, Math.max(0.35, Math.round((scaleRef.current + delta) * 100) / 100));
      scaleRef.current = s;
      setScale(s);
      return;
    }
    const rect = el.getBoundingClientRect();
    const next = zoomAtClientPoint(
      { pan: panRef.current, scale: scaleRef.current },
      scaleRef.current + delta,
      rect.left + rect.width / 2,
      rect.top + rect.height / 2,
      rect
    );
    next.scale = Math.round(next.scale * 100) / 100;
    panRef.current = next.pan;
    scaleRef.current = next.scale;
    setPan(next.pan);
    setScale(next.scale);
  };

  const rightPanRef = useRef<{ sx: number; sy: number; moved: boolean } | null>(null);

  const onPointerDownStage = (e: ReactPointerEvent) => {
    if (e.button === 1 || spaceDown || e.button === 2) {
      if (e.button === 2) {
        e.preventDefault();
        rightPanRef.current = { sx: e.clientX, sy: e.clientY, moved: false };
      }
      dragRef.current = { kind: "pan", sx: e.clientX, sy: e.clientY, ox: pan.x, oy: pan.y };
      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    }
  };

  const onPointerDownNode = (e: ReactPointerEvent, id: string) => {
    e.stopPropagation();
    if (spaceDown || e.button === 1 || e.button === 2) {
      if (e.button === 2) e.preventDefault();
      dragRef.current = { kind: "pan", sx: e.clientX, sy: e.clientY, ox: pan.x, oy: pan.y };
      return;
    }
    const n = painted.byId.get(id) || full.byId.get(id);
    if (!n) return;

    if (pathMode) {
      setPathEnds(([a]) => {
        if (!a) return [id, null];
        if (id !== a) {
          toast("已標記路徑兩端");
          return [a, id];
        }
        return [id, null];
      });
      setSelectedId(id);
      setSelAiOpen(false);
      return;
    }

    setSelectedId(id);
    setSelAiOpen(n.kind === "note" && Boolean(n.noteId));
    dragRef.current = {
      kind: "node",
      id,
      ox: n.x,
      oy: n.y,
      sx: e.clientX,
      sy: e.clientY,
    };
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  };

  const onPointerMove = (e: ReactPointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    if (d.kind === "pan") {
      if (rightPanRef.current) {
        if (isDragGesture(e.clientX - rightPanRef.current.sx, e.clientY - rightPanRef.current.sy)) {
          rightPanRef.current.moved = true;
        }
      }
      setPan({ x: d.ox + (e.clientX - d.sx), y: d.oy + (e.clientY - d.sy) });
      return;
    }
    const dx = (e.clientX - d.sx) / scale;
    const dy = (e.clientY - d.sy) / scale;
    const nx = d.ox + dx;
    const ny = d.oy + dy;
    positionsRef.current[d.id] = { x: nx, y: ny };
    const t = full.byId.get(d.id);
    if (t) {
      t.x = nx;
      t.y = ny;
    }
    setDragVer((v) => v + 1);
  };

  const onPointerUp = () => {
    if (dragRef.current?.kind === "node") persistPositions();
    dragRef.current = null;
    rightPanRef.current = null;
  };

  const screenToWorld = (clientX: number, clientY: number) => {
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return {
      x: (clientX - rect.left - pan.x) / scale,
      y: (clientY - rect.top - pan.y) / scale,
    };
  };

  /** Find the note node under a world-space point (drop target), nearest circle wins. */
  const hitTestNoteNode = (wx: number, wy: number): GraphNode | null => {
    let best: GraphNode | null = null;
    let bestDist = Infinity;
    for (const n of painted.nodes) {
      if (n.kind !== "note" || !n.noteId) continue;
      const r = radiusForNode(n) + 6;
      const dist = Math.hypot(wx - n.x, wy - n.y);
      if (dist <= r && dist < bestDist) {
        bestDist = dist;
        best = n;
      }
    }
    return best;
  };

  const onDragOverStage = (e: ReactDragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  };

  const onDropStage = async (e: ReactDragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (!user) return;
    const files = Array.from(e.dataTransfer.files || []);
    if (!files.length) return;
    const world = screenToWorld(e.clientX, e.clientY);
    try {
      const hit = hitTestNoteNode(world.x, world.y);
      if (hit && hit.noteId) {
        const noteId = hit.noteId;
        let body = notes.find((nt) => nt.id === noteId)?.body_md || "";
        for (const file of files) {
          const res = await appendMediaToNote(user.uid, noteId, file, body);
          body = res.body_md;
        }
        setNotes((prev) => prev.map((nt) => (nt.id === noteId ? { ...nt, body_md: body } : nt)));
        setSelectedId(hit.id);
        setSelAiOpen(true);
        toast(files.length > 1 ? `已附加 ${files.length} 個檔案到「${hit.title}」` : `已附加到「${hit.title}」`);
      } else {
        let lastNodeId: string | null = null;
        for (let i = 0; i < files.length; i++) {
          const file = files[i];
          const title = titleFromFileName(file.name);
          const placeholder = `# ${title}\n\n`;
          const noteId = await createNote(user.uid, title, placeholder, undefined, []);
          const up = await uploadNoteMedia(user.uid, noteId, file);
          const body_md = `${placeholder}${mediaMarkdownForFile(up.url, file)}`;
          await updateNote(noteId, { body_md });
          const nodeId = nodeIdForNote(noteId);
          positionsRef.current[nodeId] = { x: world.x + i * 30, y: world.y + i * 30 };
          lastNodeId = nodeId;
        }
        persistPositions();
        setDragVer((v) => v + 1);
        if (lastNodeId) {
          setSelectedId(lastNodeId);
          setSelAiOpen(true);
        }
        toast(files.length > 1 ? `已建立 ${files.length} 則筆記` : "已建立筆記並附加檔案");
      }
    } catch (err) {
      toast(err instanceof Error ? err.message : "拖放失敗");
    }
  };

  const applySelAiTextToNote = async (noteId: string, text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    const current = notes.find((nt) => nt.id === noteId)?.body_md || "";
    const sep = current.endsWith("\n\n") ? "" : current.endsWith("\n") ? "\n" : "\n\n";
    const body_md = `${current}${sep}${trimmed}\n`;
    await updateNote(noteId, { body_md });
    setNotes((prev) => prev.map((nt) => (nt.id === noteId ? { ...nt, body_md } : nt)));
    toast("已加入筆記");
  };

  const applySelAiImageToNote = async (noteId: string, file: File) => {
    if (!user) return;
    const current = notes.find((nt) => nt.id === noteId)?.body_md || "";
    const res = await appendMediaToNote(user.uid, noteId, file, current);
    setNotes((prev) => prev.map((nt) => (nt.id === noteId ? { ...nt, body_md: res.body_md } : nt)));
    toast("已插入圖片到筆記");
  };

  const askAi = async () => {
    setAiBusy(true);
    setAiError("");
    try {
      const hubLines = hubs.map((h) => `- ${h.title}（出${h.outDegree}/入${h.inDegree}）`).join("\n");
      const ghostLines = ghosts.map((g) => `- [[${g.title}]] ×${g.inDegree}`).join("\n");
      const orphanLines = orphans.map((o) => `- ${o.title}`).join("\n");
      const prompt = `你是知識圖譜分析助手。根據以下 Cadence 筆記圖譜摘要，用繁體中文給出：
1) 目前知識結構的 3 個觀察
2) 建議優先補建的 5 個連結或幽靈筆記
3) 如何把孤兒筆記接進主網絡

統計：筆記 ${stats.notes}、Wiki 邊 ${stats.wikiEdges}、分量 ${stats.components}、孤兒 ${stats.orphans}、幽靈 ${stats.ghosts}、平均度 ${stats.avgDegree}、密度 ${stats.density}

樞紐：
${hubLines || "（無）"}

幽靈：
${ghostLines || "（無）"}

孤兒：
${orphanLines || "（無）"}`;

      const res = await fetch("/api/ai/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "custom",
          prompt,
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
      setAiText(data.text as string);
    } catch (err) {
      setAiError(err instanceof Error ? err.message : String(err));
    } finally {
      setAiBusy(false);
    }
  };

  const createGhostNote = async (title: string) => {
    if (!user) return;
    const id = await createNote(user.uid, title, `# ${title}\n\n`, undefined, []);
    toast(`已建立「${title}」`);
    setSelectedId(nodeIdForNote(id));
  };

  const onCreateGraph = async () => {
    if (!user) return;
    const name = await askPrompt({
      title: "新建圖譜",
      message: "為新圖譜命名",
      defaultValue: "新圖譜",
    });
    if (!name?.trim()) return;
    const newId = await createGraph(user.uid, name.trim());
    await updateGraph(user.uid, newId, {
      layout: prefs.graphDefaultLayout,
      filters: {
        ...DEFAULT_FILTERS,
        showGhosts: prefs.graphShowGhosts,
        showTagEdges: prefs.graphShowTagEdges,
      },
    });
    router.push(`/graph/${newId}`);
  };

  const onRenameGraph = (id: string, name: string) => {
    if (!user) return;
    void updateGraph(user.uid, id, { name });
  };

  const onDeleteGraph = async (id: string) => {
    if (!user) return;
    const others = graphs.filter((g) => g.id !== id);
    await deleteGraph(user.uid, id);
    if (others[0]) {
      router.replace(`/graph/${others[0].id}`);
      return;
    }
    const newId = await createGraph(user.uid, "主圖譜");
    router.replace(`/graph/${newId}`);
  };

  const pathInfo = useMemo(() => {
    if (!pathMode && !path) return "";
    if (pathMode && !pathEnds[0]) return "路徑模式：先點選起點節點";
    if (pathMode && pathEnds[0] && !pathEnds[1]) {
      const a = full.byId.get(pathEnds[0])?.title || "";
      return `起點：${a} — 再點選終點`;
    }
    if (path) {
      const titles = path.nodes.map((id) => full.byId.get(id)?.title || id);
      return `路徑（${path.nodes.length - 1} 步）：${titles.join(" → ")}`;
    }
    if (pathEnds[0] && pathEnds[1]) return "這兩點之間沒有 Wiki 路徑";
    return "";
  }, [pathMode, path, pathEnds, full.byId]);

  if (loading) return <p style={{ color: "var(--text-muted)" }}>載入中…</p>;
  if (!user) {
    return (
      <div className="gp-page gp-guest">
        <ScrambleText words="圖譜" as="h1" className="page-title font-display" />
        <p className="page-sub">登入後查看圖譜。</p>
        <ShinyPill onClick={() => loginWithGoogle()}>登入</ShinyPill>
      </div>
    );
  }

  if (graph === undefined || !configReady) {
    return <p style={{ color: "var(--text-muted)" }}>載入中…</p>;
  }

  if (graph === null) {
    return <p style={{ color: "var(--text-muted)" }}>載入中…</p>;
  }

  const edgeCounts = {
    wiki: painted.edges.filter((e) => e.kind === "wiki").length,
    tag: painted.edges.filter((e) => e.kind === "tag").length,
    folder: painted.edges.filter((e) => e.kind === "folder").length,
    visible: painted.edges.length,
  };

  const selectedNode = selectedId ? painted.byId.get(selectedId) || full.byId.get(selectedId) : null;
  const selectedNote =
    selectedNode?.kind === "note" && selectedNode.noteId
      ? notes.find((nt) => nt.id === selectedNode.noteId) || null
      : null;
  const showSelAi = selAiOpen && Boolean(selectedNote);
  const stageRect = stageRef.current?.getBoundingClientRect();
  const selAiAnchor = selectedNode
    ? {
        left: (stageRect?.left || 0) + selectedNode.x * scale + pan.x + radiusForNode(selectedNode) + 16,
        top: (stageRect?.top || 0) + selectedNode.y * scale + pan.y - 12,
      }
    : { top: 80, left: 80 };

  return (
    <div className="gp-page gp-immersive">
      <div className="gp-float-chrome">
        <WorkspaceSwitcher
          items={graphs.map((g) => ({ id: g.id, name: g.name }))}
          currentId={graphId}
          label="圖譜"
          onSelect={(id) => router.push(`/graph/${id}${window.location.search}`)}
          onCreate={() => void onCreateGraph()}
          onRename={onRenameGraph}
          onDelete={(id) => void onDeleteGraph(id)}
        />
        <ContinueChips
          className="gp-continue"
          chips={spatialContinueChips({
            kind: "graph",
            noteId: selectedNote?.id || searchParams.get("note"),
            title: selectedNote?.title,
          })}
        />
        <div className="gp-float-actions">
          <span className="gp-float-meta">
            {stats.notes} 筆記 · {stats.wikiEdges} 連線
          </span>
          <button type="button" className="btn btn-soft btn-sm" onClick={onFit}>
            檢視全部
          </button>
          {filters.egoId && (
            <button
              type="button"
              className="btn btn-soft btn-sm"
              onClick={() => patchFilters({ egoId: "" })}
            >
              退出焦點
            </button>
          )}
        </div>
      </div>

      <GraphToolbar
        filters={filters}
        onFilters={patchFilters}
        layout={layout}
        onLayout={(m) => {
          setLayout(m);
          setRelayoutNonce((t) => t + 1);
        }}
        folders={folderNames}
        tags={tagNames}
        scale={scale}
        onZoom={onZoom}
        onFit={onFit}
        onRelayout={onRelayout}
        onClearPositions={onClearPositions}
        onExportMd={() =>
          downloadText("cadence-graph.md", exportGraphMarkdown(painted, stats))
        }
        onExportJson={() =>
          downloadText("cadence-graph.json", exportGraphJson(painted), "application/json")
        }
        pathMode={pathMode}
        onTogglePath={() => {
          setPathMode((v) => !v);
          setPathEnds([null, null]);
        }}
        edgeCounts={edgeCounts}
      />

      <div className="gp-layout">
        <div
          ref={stageRef}
          className={`gp-stage${spaceDown ? " is-pan" : ""}`}
          onPointerDown={onPointerDownStage}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onContextMenu={(e) => e.preventDefault()}
          onDragOver={onDragOverStage}
          onDrop={(e) => void onDropStage(e)}
        >
          {painted.nodes.length === 0 ? (
            <div className="gp-empty">
              <p>目前沒有可顯示的節點。</p>
              <p>在筆記裡用 [[標題]] 互相連結，或放寬篩選條件。</p>
            </div>
          ) : (
            <svg className="gp-svg" width="100%" height="100%">
              <defs>
                <marker
                  id="gp-arrow"
                  viewBox="0 0 10 10"
                  refX="8"
                  refY="5"
                  markerWidth="6"
                  markerHeight="6"
                  orient="auto-start-reverse"
                >
                  <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--accent)" fillOpacity="0.55" />
                </marker>
              </defs>
              <g transform={`translate(${pan.x},${pan.y}) scale(${scale})`}>
                {painted.edges.map((e) => {
                  const a = painted.byId.get(e.from);
                  const b = painted.byId.get(e.to);
                  if (!a || !b) return null;
                  const onPath = pathEdgeSet.has(e.id);
                  const onHi = highlight.edges.has(e.id);
                  const dim = Boolean((selectedId || hoverId || path) && !onHi && !onPath);
                  const stroke =
                    e.kind === "wiki" ? "var(--accent)" : e.kind === "tag" ? "#7C3AED" : "#0369A1";
                  return (
                    <line
                      key={e.id}
                      x1={a.x}
                      y1={a.y}
                      x2={b.x}
                      y2={b.y}
                      className={`gp-edge${onPath ? " is-path" : ""}${onHi ? " is-hi" : ""}${dim ? " is-dim" : ""}`}
                      stroke={stroke}
                      strokeWidth={onPath ? 3.2 : onHi ? 2.4 : e.kind === "wiki" ? 1.4 : 1}
                      strokeOpacity={dim ? 0.12 : e.kind === "wiki" ? 0.5 : 0.28}
                      strokeDasharray={
                        e.kind === "wiki" ? undefined : e.kind === "tag" ? "4 3" : "2 4"
                      }
                      markerEnd={e.kind === "wiki" ? "url(#gp-arrow)" : undefined}
                    />
                  );
                })}

                {painted.nodes.map((n) => {
                  const r = radiusForNode(n);
                  const selected = selectedId === n.id;
                  const hovered = hoverId === n.id;
                  const onPath = pathNodeSet.has(n.id);
                  const onHi = highlight.nodes.has(n.id);
                  const dim = Boolean(
                    (selectedId || hoverId || path) && !onHi && !onPath && !selected
                  );
                  const fill = colorForNode(n);
                  return (
                    <g
                      key={n.id}
                      className={`gp-node${selected ? " is-sel" : ""}${dim ? " is-dim" : ""} ${n.kind}`}
                      transform={`translate(${n.x},${n.y})`}
                      onPointerDown={(ev) => onPointerDownNode(ev, n.id)}
                      onPointerEnter={() => setHoverId(n.id)}
                      onPointerLeave={() => setHoverId((h) => (h === n.id ? null : h))}
                      style={{ cursor: spaceDown ? "grab" : "pointer" }}
                    >
                      {(selected || onPath) && (
                        <circle
                          r={r + 5}
                          fill="none"
                          stroke="var(--accent)"
                          strokeWidth={2}
                          opacity={0.7}
                        />
                      )}
                      <circle
                        r={r}
                        fill={fill}
                        opacity={dim ? 0.25 : n.kind === "ghost" ? 0.55 : 0.92}
                        stroke={hovered || selected ? "var(--text-main)" : "transparent"}
                        strokeWidth={1.5}
                      />
                      {n.kind === "ghost" && (
                        <circle
                          r={r}
                          fill="none"
                          stroke="#94A3B8"
                          strokeDasharray="3 2"
                          strokeWidth={1.2}
                        />
                      )}
                      <text
                        y={r + 12}
                        textAnchor="middle"
                        className="gp-label"
                        fontSize={Math.max(9, 11 / Math.sqrt(scale))}
                      >
                        {n.title.length > 14 ? `${n.title.slice(0, 14)}…` : n.title}
                      </text>
                    </g>
                  );
                })}
              </g>
            </svg>
          )}

          <div className="gp-legend">
            <span>
              <i style={{ background: "var(--accent)" }} /> Wiki
            </span>
            <span>
              <i style={{ background: "#7C3AED" }} /> 標籤
            </span>
            <span>
              <i style={{ background: "#0369A1" }} /> 資料夾
            </span>
            <span>
              <i style={{ background: "#94A3B8" }} /> 幽靈
            </span>
          </div>

          <div className="gp-minimap">
            <MiniMap
              nodes={painted.nodes}
              pan={pan}
              scale={scale}
              stageW={stageRef.current?.clientWidth || 800}
              stageH={stageRef.current?.clientHeight || 560}
            />
          </div>
        </div>

        <GraphAside
          stats={stats}
          bundle={full}
          selectedId={selectedId}
          hubs={hubs}
          orphans={orphans}
          ghosts={ghosts}
          folders={folders}
          tags={tags}
          pathInfo={pathInfo}
          onSelect={setSelectedId}
          onEgo={(id) => patchFilters({ egoId: id || "" })}
          egoId={filters.egoId}
          onAskAi={askAi}
          aiBusy={aiBusy}
          aiText={aiText}
          aiError={aiError}
          onCreateGhost={createGhostNote}
        />
      </div>

      <StageSelectionAi
        open={showSelAi}
        onClose={() => setSelAiOpen(false)}
        selectionText={
          selectedNote ? `${selectedNote.title}\n\n${(selectedNote.body_md || "").slice(0, 800)}` : ""
        }
        context={selectedNote?.body_md || ""}
        title={selectedNote?.title}
        anchor={selAiAnchor}
        onApplyReplace={(text) => {
          if (selectedNote) void applySelAiTextToNote(selectedNote.id, text);
        }}
        onApplyInsert={(text) => {
          if (selectedNote) void applySelAiTextToNote(selectedNote.id, text);
        }}
        onGenerateImage={(file) => {
          if (selectedNote) return applySelAiImageToNote(selectedNote.id, file);
        }}
      />
    </div>
  );
}

function MiniMap({
  nodes,
  pan,
  scale,
  stageW,
  stageH,
}: {
  nodes: GraphNode[];
  pan: { x: number; y: number };
  scale: number;
  stageW: number;
  stageH: number;
}) {
  const b = boundsOf(nodes, 40);
  const mw = 140;
  const mh = 90;
  const s = Math.min(mw / b.w, mh / b.h);
  const viewX = -pan.x / scale;
  const viewY = -pan.y / scale;
  const viewW = stageW / scale;
  const viewH = stageH / scale;

  return (
    <svg width={mw} height={mh} className="gp-minimap-svg">
      <rect width={mw} height={mh} fill="var(--bg-muted)" rx={6} />
      {nodes.slice(0, 80).map((n) => (
        <circle
          key={n.id}
          cx={(n.x - b.minX) * s}
          cy={(n.y - b.minY) * s}
          r={1.6}
          fill={n.kind === "ghost" ? "#94A3B8" : "var(--accent)"}
          opacity={0.7}
        />
      ))}
      <rect
        x={(viewX - b.minX) * s}
        y={(viewY - b.minY) * s}
        width={viewW * s}
        height={viewH * s}
        fill="none"
        stroke="var(--accent)"
        strokeWidth={1}
        opacity={0.8}
      />
    </svg>
  );
}
