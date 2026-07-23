"use client";
import { aiFetch } from "@/lib/aiFetch";

import PageLoading from "@/components/motion/PageLoading";

import { askPrompt } from "@/lib/dialogs";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  Suspense,
  type PointerEvent as REPointerEvent,
} from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import { loginWithGoogle, getNote, uploadCanvasMedia, type Note } from "@/lib/firebase";
import {
  loadJobPlainTranscript,
  startTranscriptionJob,
  summarizeTranscript,
  watchJob,
} from "@/lib/noteMediaIngest";
import { useNotesList } from "@/components/notes/NotesListProvider";
import ScrambleText from "@/components/motion/ScrambleText";
import ShinyPill from "@/components/motion/ShinyPill";
import CanvasToolbar from "@/components/canvas/CanvasToolbar";
import CanvasAside from "@/components/canvas/CanvasAside";
import CanvasMediaCard from "@/components/canvas/CanvasMediaCard";
import CanvasSelectionChrome, { selectionKindOf } from "@/components/canvas/CanvasSelectionChrome";
import CanvasMinimap from "@/components/canvas/CanvasMinimap";
import CanvasAiActionPreview from "@/components/canvas/CanvasAiActionPreview";
import WorkspaceSwitcher from "@/components/shell/WorkspaceSwitcher";
import StageSelectionAi from "@/components/StageSelectionAi";
import CanvasShareDialog from "@/components/canvas/CanvasShareDialog";
import {
  parseCanvasShare,
  syncCanvasShareSnapshot,
  type CanvasShare,
} from "@/lib/canvasShare";
import { resolveEmbedUrl } from "@/lib/embedUrls";
import { toast } from "@/lib/toast";
import {
  type CanvasDoc,
  type CanvasEdge,
  type CanvasShape,
  type CanvasMedia,
  type CanvasMediaKind,
  type Selectable,
  type ToolId,
  type ClipboardPayload,
  type CanvasAiOp,
  MEDIA_DEFAULT_SIZE,
  autoLayoutNotes,
  clampScale,
  edgePath,
  emptyDoc,
  exportCanvasJson,
  fitView,
  importCanvasJson,
  nodeCenter,
  nodePortPoint,
  nearestPort,
  edgeEndpoint,
  EDGE_PORTS,
  snapVal,
  uid,
  createSticky,
  createSection,
  alignBoxes,
  itemsInsideSection,
  type AlignMode,
  copySelection,
  pasteClipboard,
  serializeCanvasForAi,
  parseCanvasAiResponse,
  applyCanvasOps,
  mediaKindFromFile,
  createMediaItem,
  colorToShapeHex,
  resolveStickyStyle,
  type EdgePort,
} from "@/lib/canvasStore";
import { applyStageWheel, isDragGesture, isZoomInKey, isZoomOutKey, zoomAtClientPoint } from "@/lib/canvasNav";
import {
  listenCanvases,
  listenCanvas,
  createCanvas,
  renameCanvas,
  deleteCanvas,
  lastCanvasKey,
  type CanvasMeta,
} from "@/lib/canvasCloud";
import { saveCanvasWithSync } from "@/lib/offlineSync";
import { usePrefs } from "@/components/PrefsProvider";
import { useRedirectSpecialtyToNote } from "@/components/workspace/useRedirectSpecialtyToNote";

type ResizeHandle = "nw" | "ne" | "sw" | "se" | "e" | "w" | "n" | "s";

const MIN_W = 80;
const MIN_H = 60;

function canvasDocSig(d: CanvasDoc): string {
  try {
    return JSON.stringify({
      name: d.name,
      pan: d.pan,
      scale: d.scale,
      stickies: d.stickies,
      shapes: d.shapes,
      edges: d.edges,
      notes: d.notes,
      media: d.media,
      grid: d.grid,
      snap: d.snap,
    });
  } catch {
    return String(Date.now());
  }
}

export default function CanvasIdPage() {
  return (
    <Suspense fallback={<PageLoading />}>
      <CanvasIdPageInner />
    </Suspense>
  );
}

function CanvasIdPageInner() {
  const params = useParams();
  const canvasId = String(params.id || "");
  const router = useRouter();
  const searchParams = useSearchParams();
  const embed = searchParams.get("embed") === "1";
  const { user, loading } = useAuth();
  const { prefs } = usePrefs();
  useRedirectSpecialtyToNote("canvas", canvasId);
  const { notes: sharedNotes } = useNotesList();
  const [pinnedNotes, setPinnedNotes] = useState<Note[]>([]);
  const [list, setList] = useState<CanvasMeta[]>([]);
  const [doc, setDoc] = useState<CanvasDoc>(() => emptyDoc());
  const [ready, setReady] = useState(false);
  const [tool, setTool] = useState<ToolId>(prefs.canvasDefaultTool);
  const [stickyColor, setStickyColor] = useState<string>("yellow");
  const [selected, setSelected] = useState<Selectable[]>([]);
  const focusApplied = useRef(false);
  const lastCloudSig = useRef("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingShape, setEditingShape] = useState<string | null>(null);
  const [connectFrom, setConnectFrom] = useState<{ ref: string; port?: EdgePort } | null>(null);
  const [hoverConnectRef, setHoverConnectRef] = useState<string | null>(null);
  const [connectCursor, setConnectCursor] = useState<{ x: number; y: number } | null>(null);
  const [edgeDragPreview, setEdgeDragPreview] = useState<{
    edgeId: string;
    which: "from" | "to";
    point: { x: number; y: number };
    hoverRef: string | null;
  } | null>(null);
  const [history, setHistory] = useState<CanvasDoc[]>([]);
  const [asideOpen, setAsideOpen] = useState(false);
  const [clipboard, setClipboard] = useState<ClipboardPayload | null>(null);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null);
  const [marquee, setMarquee] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const [spaceDown, setSpaceDown] = useState(false);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [stageAiOpen, setStageAiOpen] = useState(false);
  const [stageAiAnchor, setStageAiAnchor] = useState<{ top: number; left: number } | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [aiPreview, setAiPreview] = useState<{
    title: string;
    busy: boolean;
    error?: string;
    lines: string[];
  } | null>(null);
  const [stageSize, setStageSize] = useState({ w: 800, h: 600 });
  const [canvasShare, setCanvasShare] = useState<CanvasShare | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const sync = () => {
      const r = el.getBoundingClientRect();
      setStageSize({ w: r.width, h: r.height });
    };
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ready]);
  const skipCloud = useRef(false);
  const baseUpdatedAt = useRef(0);
  const rightPan = useRef<{ sx: number; sy: number; moved: boolean } | null>(null);
  const drag = useRef<{
    mode: "move" | "pan" | "marquee" | "resize" | "edge-end";
    ids?: Selectable[];
    startX: number;
    startY: number;
    worldX?: number;
    worldY?: number;
    origin?: Record<string, { x: number; y: number; w?: number; h?: number }>;
    pan0?: { x: number; y: number };
    handle?: ResizeHandle;
    moved?: boolean;
    edgeId?: string;
    edgeWhich?: "from" | "to";
  } | null>(null);

  // Clear connect session when leaving the tool.
  useEffect(() => {
    if (tool === "connect") return;
    setConnectFrom(null);
    setConnectCursor(null);
    setHoverConnectRef(null);
  }, [tool]);

  useEffect(() => {
    if (!user) return;
    if (embed) return;
    return listenCanvases(user.uid, setList);
  }, [user, embed]);

  useEffect(() => {
    if (!user || !canvasId) return;
    setReady(false);
    lastCloudSig.current = "";
    const unsub = listenCanvas(user.uid, canvasId, (d) => {
      if (!d) {
        router.replace("/canvas");
        return;
      }
      if (skipCloud.current) return;
      const sig = canvasDocSig(d);
      if (sig === lastCloudSig.current) {
        setReady(true);
        return;
      }
      lastCloudSig.current = sig;
      const withAt = d as CanvasDoc & { updated_at?: Date };
      if (withAt.updated_at) baseUpdatedAt.current = withAt.updated_at.getTime();
      setDoc(d);
      setCanvasShare(parseCanvasShare((d as { share?: unknown }).share));
      setReady(true);
      try {
        localStorage.setItem(lastCanvasKey(user.uid), canvasId);
      } catch {
        /* ignore */
      }
    });
    const onReload = (ev: Event) => {
      const id = (ev as CustomEvent<{ canvasId?: string }>).detail?.canvasId;
      if (id && id !== canvasId) return;
      // Force next snapshot apply
      skipCloud.current = false;
      lastCloudSig.current = "";
    };
    window.addEventListener("albireus:canvas-reload", onReload);
    return () => {
      unsub();
      window.removeEventListener("albireus:canvas-reload", onReload);
    };
  }, [user, canvasId, router]);

  useEffect(() => {
    if (!user || !canvasId || !ready) return;
    const t = setTimeout(() => {
      skipCloud.current = true;
      lastCloudSig.current = canvasDocSig(doc);
      void saveCanvasWithSync(user.uid, canvasId, doc, baseUpdatedAt.current || Date.now())
        .then((status) => {
          if (status === "saved") {
            baseUpdatedAt.current = Date.now();
            const share = parseCanvasShare((doc as { share?: unknown }).share) || canvasShare;
            void syncCanvasShareSnapshot(user.uid, canvasId, doc, share);
          }
        })
        .finally(() => {
          setTimeout(() => {
            skipCloud.current = false;
          }, 200);
        });
    }, 500);
    return () => clearTimeout(t);
  }, [doc, user, canvasId, ready, canvasShare]);

  // Embed iframe: only fetch pinned note cards (never full notes listen).
  useEffect(() => {
    if (!embed || !user || !ready) {
      setPinnedNotes([]);
      return;
    }
    const ids = [...new Set(doc.notes.map((n) => n.noteId).filter(Boolean))];
    if (!ids.length) {
      setPinnedNotes([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      const rows = await Promise.all(ids.map((id) => getNote(id).catch(() => null)));
      if (cancelled) return;
      setPinnedNotes(rows.filter((n): n is Note => !!n));
    })();
    return () => {
      cancelled = true;
    };
  }, [embed, user, ready, doc.notes]);

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

  /** Set color preference + apply to selected stickies / shapes.
   *  Text stickies: color = font color (no fill). Stickies/shapes: fill/stroke. */
  const applyCanvasColor = useCallback(
    (color: string) => {
      setStickyColor(color);
      const stickyIds = new Set(selected.filter((s) => s.type === "sticky").map((s) => s.id));
      const shapeIds = new Set(selected.filter((s) => s.type === "shape").map((s) => s.id));
      const sectionIds = new Set(selected.filter((s) => s.type === "section").map((s) => s.id));
      if (!stickyIds.size && !shapeIds.size && !sectionIds.size) return;
      const shapeHex = colorToShapeHex(color);
      updateDoc((d) => ({
        ...d,
        stickies: d.stickies.map((s) => {
          if (!stickyIds.has(s.id)) return s;
          if (s.variant === "text") return { ...s, color: shapeHex };
          return { ...s, color };
        }),
        shapes: d.shapes.map((s) => (shapeIds.has(s.id) ? { ...s, color: shapeHex } : s)),
        sections: (d.sections || []).map((s) => (sectionIds.has(s.id) ? { ...s, color: shapeHex } : s)),
      }));
    },
    [selected, updateDoc]
  );

  // Mirror selection color into the toolbar swatches.
  useEffect(() => {
    if (selected.length !== 1) return;
    const hit = selected[0];
    if (hit.type === "sticky") {
      const st = doc.stickies.find((s) => s.id === hit.id);
      if (st?.color) setStickyColor(st.color);
    } else if (hit.type === "shape") {
      const sh = doc.shapes.find((s) => s.id === hit.id);
      if (sh?.color) setStickyColor(sh.color);
    }
  }, [selected, doc.stickies, doc.shapes]);

  const undo = () => {
    setHistory((h) => {
      if (!h.length) return h;
      const prev = h[h.length - 1];
      setDoc(prev);
      return h.slice(0, -1);
    });
    toast("已復原");
  };

  const notes = embed ? pinnedNotes : sharedNotes;

  const noteMap = useMemo(() => {
    const m = new Map<string, Note>();
    notes.forEach((n) => m.set(n.id, n));
    return m;
  }, [notes]);

  const clientToWorld = (clientX: number, clientY: number) => {
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return {
      x: (clientX - rect.left - doc.pan.x) / doc.scale,
      y: (clientY - rect.top - doc.pan.y) / doc.scale,
    };
  };
  const screenToWorld = clientToWorld;

  const worldToClient = (x: number, y: number) => {
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return {
      x: rect.left + x * doc.scale + doc.pan.x,
      y: rect.top + y * doc.scale + doc.pan.y,
    };
  };

  const refIdForSelectable = (s: Selectable): string =>
    s.type === "note" ? `note:${s.id}` : s.id;

  const hitTest = (world: { x: number; y: number }): Selectable | null => {
    const media = [...(doc.media || [])].sort((a, b) => b.z - a.z);
    for (const m of media) {
      if (world.x >= m.x && world.x <= m.x + m.w && world.y >= m.y && world.y <= m.y + m.h) {
        return { type: "media", id: m.id };
      }
    }
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
    for (const sec of [...(doc.sections || [])].reverse()) {
      if (world.x >= sec.x && world.x <= sec.x + sec.w && world.y >= sec.y && world.y <= sec.y + sec.h) {
        return { type: "section", id: sec.id };
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
    if (s.type === "media") {
      const m = (doc.media || []).find((x) => x.id === s.id);
      return m ? { x: m.x, y: m.y, w: m.w, h: m.h } : null;
    }
    if (s.type === "note") {
      const n = doc.notes.find((x) => x.noteId === s.id);
      return n ? { x: n.x, y: n.y, w: n.w, h: n.h } : null;
    }
    if (s.type === "section") {
      const sec = (doc.sections || []).find((x) => x.id === s.id);
      return sec ? { x: sec.x, y: sec.y, w: sec.w, h: sec.h } : null;
    }
    return null;
  };

  const selectionInfo = useMemo(() => {
    if (!selected.length) return null;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    const texts: string[] = [];
    for (const s of selected) {
      const b = boxOf(s);
      if (b) {
        minX = Math.min(minX, b.x);
        minY = Math.min(minY, b.y);
        maxX = Math.max(maxX, b.x + b.w);
        maxY = Math.max(maxY, b.y + b.h);
      }
      if (s.type === "sticky") {
        const st = doc.stickies.find((x) => x.id === s.id);
        if (st?.text.trim()) texts.push(st.text.trim());
      } else if (s.type === "shape") {
        const sh = doc.shapes.find((x) => x.id === s.id);
        if (sh?.label.trim()) texts.push(sh.label.trim());
      } else if (s.type === "note") {
        const n = noteMap.get(s.id);
        if (n?.title.trim()) texts.push(n.title.trim());
      } else if (s.type === "media") {
        const m = (doc.media || []).find((x) => x.id === s.id);
        if (m?.transcript?.trim()) texts.push(m.transcript.trim());
        else if (m?.title?.trim()) texts.push(m.title.trim());
      }
    }
    if (!Number.isFinite(minX) || !Number.isFinite(minY)) return null;
    return {
      box: { x: minX, y: minY, w: Math.max(0, maxX - minX), h: Math.max(0, maxY - minY) },
      text: texts.join("\n"),
    };
  }, [selected, doc.stickies, doc.shapes, doc.media, noteMap, boxOf]);

  const selectionAnchorRef = (): string | null => {
    if (selected.length !== 1) return null;
    const s = selected[0];
    if (s.type === "edge") return null;
    if (s.type === "note") return `note:${s.id}`;
    return s.id;
  };

  const landStickiesFromAi = (texts: string[], connect = true) => {
    const chunks = texts.map((t) => t.trim()).filter(Boolean);
    if (!chunks.length) return;
    const box = selectionInfo?.box;
    const origin = box
      ? { x: box.x + box.w + 36, y: box.y }
      : viewportCenterWorld();
    const fromRef = connect ? selectionAnchorRef() : null;
    const created: string[] = [];
    updateDoc((d) => {
      let next = { ...d, stickies: [...d.stickies], edges: [...d.edges] };
      chunks.forEach((text, i) => {
        const sticky = createSticky({
          x: snapVal(origin.x + (i % 3) * 28, 22, d.snap),
          y: snapVal(origin.y + i * 48, 22, d.snap),
          w: 220,
          h: Math.min(280, 80 + Math.ceil(text.length / 40) * 22),
          text,
          color: stickyColor,
        });
        created.push(sticky.id);
        next.stickies.push(sticky);
        if (fromRef) {
          next.edges.push({
            id: uid("e"),
            kind: "edge",
            from: fromRef,
            to: sticky.id,
            fromPort: "e",
            toPort: "w",
          });
        }
      });
      return next;
    });
    if (created.length) setSelected(created.map((id) => ({ type: "sticky" as const, id })));
    toast(created.length > 1 ? `已新增 ${created.length} 張便利貼` : "已新增便利貼");
  };

  const applyStageAiReplace = (text: string) => {
    const clean = text.trim();
    if (!clean) return;
    if (selected.length === 1 && selected[0].type === "sticky") {
      const id = selected[0].id;
      updateDoc((d) => ({
        ...d,
        stickies: d.stickies.map((s) => (s.id === id ? { ...s, text: clean } : s)),
      }));
      toast("已更新便利貼");
      return;
    }
    landStickiesFromAi([clean], true);
  };

  const applyStageAiInsert = (text: string) => {
    const clean = text.trim();
    if (!clean) return;
    landStickiesFromAi([clean], true);
  };

  const runSelectionSummarize = async () => {
    const src = (selectionInfo?.text || "").trim();
    if (!src) {
      toast("請先選取內容");
      return;
    }
    await runAiPreview(
      "摘要到白板",
      src,
      "請用繁體中文產出簡潔摘要，每行一個重點，最多 6 行。不要編號、不要 markdown。"
    );
    setStageAiOpen(false);
  };

  const runSelectionMindMap = async () => {
    const src = (selectionInfo?.text || "").trim();
    if (!src) {
      toast("請先選取內容");
      return;
    }
    await runAiPreview(
      "心智圖草稿",
      src,
      "請把內容整理成心智圖草稿：第一行是中心主題，其後每行一個節點（短句、不要編號、不要 markdown）。最多 8 行。"
    );
    setStageAiOpen(false);
  };

  const patchMedia = (id: string, patch: Partial<CanvasMedia>) => {
    updateDoc((d) => ({
      ...d,
      media: (d.media || []).map((m) => (m.id === id ? { ...m, ...patch } : m)),
    }));
  };

  const startMediaTranscribe = async (mediaId: string) => {
    if (!user) return;
    const item = (doc.media || []).find((m) => m.id === mediaId);
    if (!item) return;
    if (item.media !== "youtube" && item.media !== "video" && item.media !== "audio") {
      toast("此媒體類型不支援轉錄");
      return;
    }
    patchMedia(mediaId, { transcriptStatus: "queued", transcriptError: "" });
    try {
      const getIdToken = async () => {
        const t = await user.getIdToken();
        return t;
      };
      let jobId = "";
      if (item.media === "youtube") {
        jobId = await startTranscriptionJob({
          uid: user.uid,
          getIdToken,
          media: {
            kind: "youtube",
            youtubeUrl: item.originalUrl || item.url,
            label: item.title || "YouTube",
          },
        });
      } else {
        const res = await fetch(item.url);
        if (!res.ok) throw new Error("無法讀取媒體檔案");
        const blob = await res.blob();
        const ext =
          item.media === "audio"
            ? "webm"
            : (item.title.match(/\.[a-z0-9]+$/i)?.[0] || ".mp4").replace(/^\./, "");
        const file = new File([blob], item.title || `canvas-${item.media}.${ext}`, {
          type: blob.type || item.mime || (item.media === "audio" ? "audio/webm" : "video/mp4"),
        });
        jobId = await startTranscriptionJob({
          uid: user.uid,
          getIdToken,
          media: { kind: "file", file, label: item.title || file.name },
        });
      }
      patchMedia(mediaId, { jobId, transcriptStatus: "running" });
      const { promise } = watchJob(jobId, (job) => {
        const st = job.status === "queued" ? "queued" : job.status === "done" ? "done" : job.status === "error" ? "error" : "running";
        patchMedia(mediaId, { transcriptStatus: st as CanvasMedia["transcriptStatus"] });
      });
      const done = await promise;
      const transcript = await loadJobPlainTranscript(done);
      patchMedia(mediaId, {
        transcript,
        transcriptStatus: "done",
        jobId,
        // expand card height a bit for transcript panel
        h: Math.max(item.h, 320),
      });
      toast("轉錄完成");
    } catch (e) {
      patchMedia(mediaId, {
        transcriptStatus: "error",
        transcriptError: e instanceof Error ? e.message : "轉錄失敗",
      });
      toast(e instanceof Error ? e.message : "轉錄失敗");
    }
  };

  const summarizeMedia = async (mediaId: string) => {
    const item = (doc.media || []).find((m) => m.id === mediaId);
    if (!item?.transcript?.trim()) {
      toast("尚無逐字稿");
      return;
    }
    setSelected([{ type: "media", id: mediaId }]);
    try {
      const summary = await summarizeTranscript({
        title: item.title || "媒體",
        transcript: item.transcript,
        assistant: {
          name: prefs.aiAssistantName,
          style: prefs.aiStyle,
          model: prefs.aiModel,
          grounding: prefs.aiGrounding,
        },
      });
      if (summary) landStickiesFromAi([summary], true);
    } catch (e) {
      toast(e instanceof Error ? e.message : "摘要失敗");
    }
  };

  const mindMapMedia = async (mediaId: string) => {
    const item = (doc.media || []).find((m) => m.id === mediaId);
    if (!item?.transcript?.trim()) {
      toast("尚無逐字稿");
      return;
    }
    setSelected([{ type: "media", id: mediaId }]);
    await runAiPreview(
      "心智圖草稿",
      item.transcript,
      "請把逐字稿整理成心智圖草稿：第一行是中心主題，其後每行一個節點（短句、不要編號、不要 markdown）。最多 8 行。"
    );
  };


  const alignSelected = (mode: AlignMode) => {
    const boxes = selected
      .filter((s) => s.type !== "edge")
      .map((s) => {
        const b = boxOf(s);
        if (!b) return null;
        return { id: s.type === "note" ? s.id : s.id, sel: s, ...b };
      })
      .filter(Boolean) as { id: string; sel: Selectable; x: number; y: number; w: number; h: number }[];
    if (boxes.length < 2) return;
    const map = alignBoxes(
      boxes.map((b) => ({ id: `${b.sel.type}:${b.sel.id}`, x: b.x, y: b.y, w: b.w, h: b.h })),
      mode
    );
    updateDoc((d) => {
      let stickies = d.stickies;
      let shapes = d.shapes;
      let media = d.media || [];
      let notes = d.notes;
      let sections = d.sections || [];
      for (const b of boxes) {
        const next = map.get(`${b.sel.type}:${b.sel.id}`);
        if (!next) continue;
        if (b.sel.type === "sticky") {
          stickies = stickies.map((s) => (s.id === b.sel.id ? { ...s, ...next } : s));
        } else if (b.sel.type === "shape") {
          shapes = shapes.map((s) => (s.id === b.sel.id ? { ...s, ...next } : s));
        } else if (b.sel.type === "media") {
          media = media.map((m) => (m.id === b.sel.id ? { ...m, ...next } : m));
        } else if (b.sel.type === "note") {
          notes = notes.map((n) => (n.noteId === b.sel.id ? { ...n, ...next } : n));
        } else if (b.sel.type === "section") {
          sections = sections.map((s) => (s.id === b.sel.id ? { ...s, ...next } : s));
        }
      }
      return { ...d, stickies, shapes, media, notes, sections };
    });
  };

  const runAiPreview = async (title: string, sourceText: string, prompt: string) => {
    setAiPreview({ title, busy: true, lines: [] });
    try {
      const res = await aiFetch("/api/ai/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "ask_selection",
          title,
          selection: sourceText.slice(0, 14000),
          body: sourceText.slice(0, 14000),
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
      const lines = String(data.text || "")
        .split(/\n+/)
        .map((l: string) => l.replace(/^[-*•\d.、）)\s]+/, "").trim())
        .filter(Boolean)
        .slice(0, 10);
      if (!lines.length) throw new Error("沒有產生內容");
      setAiPreview({ title, busy: false, lines });
    } catch (e) {
      setAiPreview({
        title,
        busy: false,
        error: e instanceof Error ? e.message : "AI 失敗",
        lines: [],
      });
    }
  };

  const splitMediaToCards = async (mediaId: string) => {
    const item = (doc.media || []).find((m) => m.id === mediaId);
    if (!item?.transcript?.trim()) {
      toast("尚無逐字稿");
      return;
    }
    setSelected([{ type: "media", id: mediaId }]);
    await runAiPreview(
      "拆成知識卡",
      item.transcript,
      "請把逐字稿拆成 5 到 8 張知識卡。每行一張：標題必須是可直接引用的短句（論點），不要編號、不要 markdown。只輸出標題行。"
    );
  };

  const insertSectionAtCenter = () => {
    const center = viewportCenterWorld();
    const sec = createSection({
      x: snapVal(center.x - 240, 22, doc.snap),
      y: snapVal(center.y - 160, 22, doc.snap),
      title: "分區",
      color: colorToShapeHex(stickyColor),
    });
    updateDoc((d) => ({ ...d, sections: [...(d.sections || []), sec] }));
    setSelected([{ type: "section", id: sec.id }]);
    setTool("select");
    toast("已新增分區");
  };

  const applyStageAiImage = async (file: File) => {

    if (!user || !canvasId) return;
    setUploadBusy(true);
    try {
      const up = await uploadCanvasMedia(user.uid, canvasId, file);
      const size = MEDIA_DEFAULT_SIZE.image;
      const box = selectionInfo?.box;
      const center = box
        ? { x: box.x + box.w / 2, y: box.y + box.h + 24 + size.h / 2 }
        : viewportCenterWorld();
      placeMedia({
        media: "image",
        x: snapVal(center.x - size.w / 2, 22, doc.snap),
        y: snapVal(center.y - size.h / 2, 22, doc.snap),
        w: size.w,
        h: size.h,
        url: up.url,
        originalUrl: up.url,
        title: up.name,
        mime: up.contentType,
        storagePath: up.path,
        frameable: true,
      });
    } catch (e) {
      toast(e instanceof Error ? e.message : "上傳失敗");
    } finally {
      setUploadBusy(false);
    }
  };

  const viewportCenterWorld = () => {
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect) return { x: 80, y: 80 };
    return {
      x: (rect.width / 2 - doc.pan.x) / doc.scale,
      y: (rect.height / 2 - doc.pan.y) / doc.scale,
    };
  };

  const placeMedia = (item: Omit<CanvasMedia, "id" | "kind" | "z">) => {
    const m = createMediaItem(item);
    updateDoc((d) => ({ ...d, media: [...(d.media || []), m] }));
    setSelected([{ type: "media", id: m.id }]);
    setTool("select");
    toast(`已插入${item.title || "媒體"}`);
  };

  const insertFiles = async (files: FileList | File[], at?: { x: number; y: number }) => {
    if (!user || !canvasId) return;
    const list = Array.from(files);
    if (!list.length) return;
    setUploadBusy(true);
    try {
      const center = at ?? viewportCenterWorld();
      let i = 0;
      for (const file of list) {
        const kind = mediaKindFromFile(file);
        const size = MEDIA_DEFAULT_SIZE[kind];
        const up = await uploadCanvasMedia(user.uid, canvasId, file);
        let url = up.url;
        let frameable = kind === "pdf" || kind === "image" || kind === "video" || kind === "audio";
        if (kind === "ppt") {
          frameable = false;
        }
        if (kind === "pdf") {
          // native PDF URL works in most browsers inside iframe
          frameable = true;
        }
        placeMedia({
          media: kind,
          x: snapVal(center.x - size.w / 2 + i * 28, 22, doc.snap),
          y: snapVal(center.y - size.h / 2 + i * 28, 22, doc.snap),
          w: size.w,
          h: size.h,
          url,
          originalUrl: up.url,
          title: up.name,
          mime: up.contentType,
          storagePath: up.path,
          frameable,
        });
        i += 1;
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : "上傳失敗");
    } finally {
      setUploadBusy(false);
    }
  };

  const insertUrl = async () => {
    const raw = await askPrompt({
      title: "插入網址",
      message: "YouTube、網頁、PDF 連結等",
      placeholder: "https://…",
    });
    if (!raw?.trim()) return;
    const resolved = resolveEmbedUrl(raw.trim());
    if (!resolved) {
      toast("無法解析網址");
      return;
    }
    const mediaMap: Record<string, CanvasMediaKind> = {
      youtube: "youtube",
      vimeo: "video",
      loom: "video",
      pdf: "pdf",
      ppt: "ppt",
      web: "web",
      drive: "web",
      figma: "web",
      office: "web",
      link: "link",
    };
    const media = mediaMap[resolved.kind] || "link";
    const size = MEDIA_DEFAULT_SIZE[media];
    const center = viewportCenterWorld();
    placeMedia({
      media,
      x: snapVal(center.x - size.w / 2, 22, doc.snap),
      y: snapVal(center.y - size.h / 2, 22, doc.snap),
      w: size.w,
      h: size.h,
      url: resolved.src,
      originalUrl: resolved.original,
      title: resolved.title || resolved.original,
      frameable: resolved.frameable,
    });
  };

  const onPointerDown = (e: REPointerEvent) => {
    const t = e.target as HTMLElement;
    // Connect ports / edge ends handle themselves — don't steal those events.
    if (t.closest(".cv-port, .cv-edge-end")) return;
    // Connect mode must hit note cards even when the title <a> is under the cursor.
    if (tool === "connect") {
      if (t.closest("textarea,button,input,audio,video,iframe,.cv-handle,.cv-ctx,.cv-media-open,.cv-media-file,.cv-media-actions,.cv-media-tx")) return;
    } else if (t.closest("textarea,a,button,input,audio,video,iframe,.cv-handle,.cv-ctx,.cv-media-open,.cv-media-file,.cv-media-actions,.cv-media-tx")) {
      return;
    }
    setCtxMenu(null);
    const world = screenToWorld(e.clientX, e.clientY);
    stageRef.current?.setPointerCapture?.(e.pointerId);

    // Middle button, Space, Alt+select, or pan tool → pan
    // Right button → pan (context menu only if little movement)
    if (
      tool === "pan" ||
      e.button === 1 ||
      e.button === 2 ||
      spaceDown ||
      (tool === "select" && e.altKey)
    ) {
      if (e.button === 2) {
        rightPan.current = { sx: e.clientX, sy: e.clientY, moved: false };
        e.preventDefault();
      }
      drag.current = { mode: "pan", startX: e.clientX, startY: e.clientY, pan0: { ...doc.pan } };
      return;
    }

    if (e.button !== 0) return;

    if (tool === "connect") {
      const hit = hitTest(world);
      if (!hit || hit.type === "edge") {
        setConnectFrom(null);
        setConnectCursor(null);
        return;
      }
      const ref = refIdForSelectable(hit);
      const port = nearestPort(doc, ref, world);
      if (!connectFrom) {
        setConnectFrom({ ref, port });
        setConnectCursor(world);
        toast("已選起點，再點終點或錨點");
        return;
      }
      if (connectFrom.ref === ref) {
        setConnectFrom(null);
        setConnectCursor(null);
        return;
      }
      const edge: CanvasEdge = {
        id: uid("e"),
        kind: "edge",
        from: connectFrom.ref,
        to: ref,
        fromPort: connectFrom.port,
        toPort: port,
      };
      updateDoc((d) => ({ ...d, edges: [...d.edges, edge] }));
      setConnectFrom(null);
      setConnectCursor(null);
      toast("已建立連線");
      return;
    }

    if (tool === "sticky" || tool === "text" || tool === "rect" || tool === "ellipse" || tool === "frame") {
      const x = snapVal(world.x, 22, doc.snap);
      const y = snapVal(world.y, 22, doc.snap);
      const z = Date.now();
      if (tool === "sticky" || tool === "text") {
        const isText = tool === "text";
        const sticky = createSticky({
          x,
          y,
          w: isText ? 220 : 180,
          h: isText ? 48 : 160,
          text: "",
          // Text: no fill/border; color drives font color (default dark, not sticky yellow).
          color: isText
            ? stickyColor === "yellow"
              ? "#1f2937"
              : colorToShapeHex(stickyColor)
            : stickyColor,
          z,
          variant: isText ? "text" : "sticky",
        });
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
        color: colorToShapeHex(stickyColor),
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
    let moveIds = [...ids];
    for (const s of ids) {
      const b = boxOf(s);
      if (!b) continue;
      const key = s.id;
      origin[key] = { x: b.x, y: b.y, w: b.w, h: b.h };
      if (s.type === "section") {
        const sec = (doc.sections || []).find((x) => x.id === s.id);
        if (!sec) continue;
        const inside = itemsInsideSection(doc, sec);
        for (const id of inside.stickies) {
          const st = doc.stickies.find((x) => x.id === id);
          if (!st) continue;
          origin[id] = { x: st.x, y: st.y, w: st.w, h: st.h };
          if (!moveIds.some((m) => m.type === "sticky" && m.id === id)) {
            moveIds.push({ type: "sticky", id });
          }
        }
        for (const id of inside.shapes) {
          const sh = doc.shapes.find((x) => x.id === id);
          if (!sh) continue;
          origin[id] = { x: sh.x, y: sh.y, w: sh.w, h: sh.h };
          if (!moveIds.some((m) => m.type === "shape" && m.id === id)) {
            moveIds.push({ type: "shape", id });
          }
        }
        for (const id of inside.media) {
          const m = (doc.media || []).find((x) => x.id === id);
          if (!m) continue;
          origin[id] = { x: m.x, y: m.y, w: m.w, h: m.h };
          if (!moveIds.some((x) => x.type === "media" && x.id === id)) {
            moveIds.push({ type: "media", id });
          }
        }
        for (const id of inside.notes) {
          const n = doc.notes.find((x) => x.noteId === id);
          if (!n) continue;
          origin[id] = { x: n.x, y: n.y, w: n.w, h: n.h };
          if (!moveIds.some((x) => x.type === "note" && x.id === id)) {
            moveIds.push({ type: "note", id });
          }
        }
      }
    }
    drag.current = {
      mode: "move",
      ids: moveIds,
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

  /** Connect-tool: click a port to start/finish a link (does not resize). */
  const onPortPointerDown = (e: REPointerEvent, ref: string, port: EdgePort) => {
    e.stopPropagation();
    e.preventDefault();
    if (tool !== "connect" || e.button !== 0) return;
    setCtxMenu(null);
    if (!connectFrom) {
      setConnectFrom({ ref, port });
      const pt = nodePortPoint(doc, ref, port);
      if (pt) setConnectCursor(pt);
      toast("已選起點錨點，再點終點");
      return;
    }
    if (connectFrom.ref === ref) {
      setConnectFrom(null);
      setConnectCursor(null);
      return;
    }
    const edge: CanvasEdge = {
      id: uid("e"),
      kind: "edge",
      from: connectFrom.ref,
      to: ref,
      fromPort: connectFrom.port,
      toPort: port,
    };
    updateDoc((d) => ({ ...d, edges: [...d.edges, edge] }));
    setConnectFrom(null);
    setConnectCursor(null);
    toast("已建立連線");
  };

  /** Drag an existing edge endpoint to reconnect. */
  const startEdgeEndDrag = (e: REPointerEvent, edgeId: string, which: "from" | "to") => {
    e.stopPropagation();
    e.preventDefault();
    if (e.button !== 0) return;
    const world = screenToWorld(e.clientX, e.clientY);
    drag.current = {
      mode: "edge-end",
      startX: world.x,
      startY: world.y,
      edgeId,
      edgeWhich: which,
      moved: false,
    };
    setEdgeDragPreview({ edgeId, which, point: world, hoverRef: null });
    setSelected([{ type: "edge", id: edgeId }]);
    stageRef.current?.setPointerCapture?.(e.pointerId);
  };

  const onPointerMove = (e: REPointerEvent) => {
    const world = screenToWorld(e.clientX, e.clientY);

    // Connect-mode hover + rubber-band preview (even when not dragging).
    if (tool === "connect" && !drag.current) {
      const hit = hitTest(world);
      const ref =
        hit && hit.type !== "edge" ? refIdForSelectable(hit) : null;
      setHoverConnectRef(ref);
      if (connectFrom) setConnectCursor(world);
    }

    const d = drag.current;
    if (!d) return;
    if (d.mode === "pan" && d.pan0) {
      if (rightPan.current) {
        if (isDragGesture(e.clientX - rightPan.current.sx, e.clientY - rightPan.current.sy)) {
          rightPan.current.moved = true;
        }
      }
      setDoc((prev) => ({
        ...prev,
        pan: {
          x: d.pan0!.x + (e.clientX - d.startX),
          y: d.pan0!.y + (e.clientY - d.startY),
        },
      }));
      return;
    }
    if (d.mode === "edge-end" && d.edgeId && d.edgeWhich) {
      d.moved = true;
      const hit = hitTest(world);
      const hoverRef =
        hit && hit.type !== "edge" ? refIdForSelectable(hit) : null;
      setEdgeDragPreview({
        edgeId: d.edgeId,
        which: d.edgeWhich,
        point: world,
        hoverRef,
      });
      if (hoverRef) setHoverConnectRef(hoverRef);
      return;
    }
    if (d.mode === "marquee" && d.worldX != null && d.worldY != null) {
      setMarquee({ x0: d.worldX, y0: d.worldY, x1: world.x, y1: world.y });
      return;
    }
    if (d.mode === "resize" && d.ids?.[0] && d.origin && d.handle) {
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
        if (s.type === "media") {
          return {
            ...prev,
            media: (prev.media || []).map((m) => (m.id === s.id ? { ...m, x, y, w, h } : m)),
          };
        }
        if (s.type === "note") {
          return {
            ...prev,
            notes: prev.notes.map((n) => (n.noteId === s.id ? { ...n, x, y, w, h } : n)),
          };
        }
        if (s.type === "section") {
          return {
            ...prev,
            sections: (prev.sections || []).map((sec) =>
              sec.id === s.id ? { ...sec, x, y, w: Math.max(160, w), h: Math.max(120, h) } : sec
            ),
          };
        }
        return prev;
      });
      return;
    }
    if (d.mode === "move" && d.ids && d.origin) {
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
        const media = (prev.media || []).map((m) => {
          const o = d.origin![m.id];
          if (!o || !d.ids!.some((i) => i.type === "media" && i.id === m.id)) return m;
          return {
            ...m,
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
        const sections = (prev.sections || []).map((s) => {
          const o = d.origin![s.id];
          if (!o || !d.ids!.some((i) => i.type === "section" && i.id === s.id)) return s;
          return {
            ...s,
            x: snapVal(o.x + dx, 22, prev.snap),
            y: snapVal(o.y + dy, 22, prev.snap),
          };
        });
        return { ...prev, stickies, shapes, media, notes: notesPins, sections };
      });
    }
  };

  const onPointerUp = () => {
    const d = drag.current;
    if (d?.mode === "edge-end" && d.edgeId && d.edgeWhich) {
      const preview = edgeDragPreview;
      const world = preview?.point;
      if (world) {
        const hit = hitTest(world);
        if (hit && hit.type !== "edge") {
          const ref = refIdForSelectable(hit);
          const edge = doc.edges.find((e) => e.id === d.edgeId);
          const other = d.edgeWhich === "from" ? edge?.to : edge?.from;
          if (edge && ref !== other) {
            const port = nearestPort(doc, ref, world);
            updateDoc((prev) => ({
              ...prev,
              edges: prev.edges.map((e) => {
                if (e.id !== d.edgeId) return e;
                if (d.edgeWhich === "from") {
                  return { ...e, from: ref, fromPort: port };
                }
                return { ...e, to: ref, toPort: port };
              }),
            }));
            toast("已更新連線");
          }
        }
      }
      setEdgeDragPreview(null);
      setHoverConnectRef(null);
    }
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
        for (const m of doc.media || []) {
          if (m.x + m.w >= x1 && m.x <= x2 && m.y + m.h >= y1 && m.y <= y2) {
            hits.push({ type: "media", id: m.id });
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
      const mediaIds = new Set(selected.filter((s) => s.type === "media").map((s) => s.id));
      const noteIds = new Set(selected.filter((s) => s.type === "note").map((s) => s.id));
      const edgeIds = new Set(selected.filter((s) => s.type === "edge").map((s) => s.id));
      const sectionIds = new Set(selected.filter((s) => s.type === "section").map((s) => s.id));
      const removeRefs = new Set([
        ...Array.from(stickyIds),
        ...Array.from(shapeIds),
        ...Array.from(mediaIds),
        ...Array.from(noteIds).map((id) => `note:${id}`),
      ]);
      return {
        ...d,
        stickies: d.stickies.filter((s) => !stickyIds.has(s.id)),
        shapes: d.shapes.filter((s) => !shapeIds.has(s.id)),
        media: (d.media || []).filter((m) => !mediaIds.has(m.id)),
        notes: d.notes.filter((n) => !noteIds.has(n.noteId)),
        sections: (d.sections || []).filter((s) => !sectionIds.has(s.id)),
        edges: d.edges.filter(
          (e) => !edgeIds.has(e.id) && !removeRefs.has(e.from) && !removeRefs.has(e.to)
        ),
      };
    });
    setSelected([]);
    toast("已刪除");
  }, [selected, updateDoc]);

  const doCopy = useCallback(() => {
    if (!selected.length) return;
    setClipboard(copySelection(doc, selected));
    toast("已複製");
  }, [doc, selected]);

  const doCut = useCallback(() => {
    if (!selected.length) return;
    setClipboard(copySelection(doc, selected));
    deleteSelected();
    toast("已剪下");
  }, [doc, selected, deleteSelected]);

  const doPaste = useCallback(() => {
    if (!clipboard) return;
    const { doc: next, selected: sel } = pasteClipboard(doc, clipboard);
    updateDoc(() => next);
    setSelected(sel);
    toast("已貼上");
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
    toast("已釘上畫布");
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

  useEffect(() => {
    const noteId = searchParams.get("note");
    if (!noteId || !ready || focusApplied.current) return;
    focusApplied.current = true;
    setDoc((d) => {
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
    // Focus after pin lands in state on next tick
    requestAnimationFrame(() => {
      setSelected([{ type: "note", id: noteId }]);
      setDoc((d) => {
        const pin = d.notes.find((n) => n.noteId === noteId);
        if (!pin) return d;
        return {
          ...d,
          pan: { x: 120 - pin.x * d.scale, y: 120 - pin.y * d.scale },
        };
      });
    });
  }, [searchParams, ready]);

  const askCanvasAi = async (prompt: string) => {
    const selectedIds = selected.map((s) => (s.type === "note" ? `note:${s.id}` : s.id));
    const res = await aiFetch("/api/ai/generate", {
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
    toast(`已套用 ${ops.length} 項 AI 變更`);
  };

  const fitAll = useCallback(() => {
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect) return;
    setDoc((d) => ({ ...d, ...fitView(d, { w: rect.width, h: rect.height }) }));
  }, []);

  const resetZoom = useCallback(() => {
    setDoc((d) => ({ ...d, scale: 1 }));
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // Never steal keys while a Cadence dialog is open (URL paste etc.)
      if (document.querySelector(".cadence-dialog-backdrop")) return;
      const t = e.target as HTMLElement | null;
      if (
        t instanceof HTMLInputElement ||
        t instanceof HTMLTextAreaElement ||
        t instanceof HTMLSelectElement ||
        t?.isContentEditable ||
        t?.closest?.(".cadence-dialog, [contenteditable='true']")
      ) {
        return;
      }
      if (e.code === "Space") {
        e.preventDefault();
        setSpaceDown(true);
      }
      // Shift+1 fit all, Shift+0 = 100%
      if (e.shiftKey && !e.ctrlKey && !e.metaKey && e.key === "!") {
        // Shift+1 may come as "!" on some layouts
        e.preventDefault();
        fitAll();
      }
      if (e.shiftKey && !e.ctrlKey && !e.metaKey && (e.key === "1" || e.code === "Digit1")) {
        e.preventDefault();
        fitAll();
      }
      if (e.shiftKey && !e.ctrlKey && !e.metaKey && (e.key === ")" || e.key === "0" || e.code === "Digit0")) {
        e.preventDefault();
        resetZoom();
      }
      const k = e.key.toLowerCase();
      const mod = e.ctrlKey || e.metaKey;
      if (mod && (isZoomInKey(e) || isZoomOutKey(e))) {
        e.preventDefault();
        const rect = stageRef.current?.getBoundingClientRect();
        if (!rect) return;
        const dir = isZoomInKey(e) ? 1 : -1;
        setDoc((d) => {
          const next = zoomAtClientPoint(
            { pan: d.pan, scale: d.scale },
            d.scale + dir * 0.12,
            rect.left + rect.width / 2,
            rect.top + rect.height / 2,
            rect,
            clampScale
          );
          return { ...d, pan: next.pan, scale: next.scale };
        });
        return;
      }
      if (!mod) {
        if (k === "v") setTool("select");
        if (k === "h") setTool("pan");
        if (k === "s") setTool("sticky");
        if (k === "t") setTool("text");
        if (k === "r") setTool("rect");
        if (k === "o") setTool("ellipse");
        if (k === "f") setTool("frame");
        if (k === "c" && !spaceDown) setTool("connect");
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
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Space") setSpaceDown(false);
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [deleteSelected, doCopy, doCut, doPaste, fitAll, resetZoom, spaceDown]);

  // Non-passive wheel so Ctrl+wheel zooms the canvas instead of the browser page
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const onWheelNative = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      setDoc((d) => {
        const next = applyStageWheel(e, rect, { pan: d.pan, scale: d.scale }, clampScale);
        return { ...d, pan: next.pan, scale: next.scale };
      });
    };
    el.addEventListener("wheel", onWheelNative, { passive: false });
    return () => el.removeEventListener("wheel", onWheelNative);
  }, [ready]);

  if (loading) return <PageLoading />;
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
  const resizeBox = single && single.type !== "edge" && tool !== "connect" ? boxOf(single) : null;

  /** Boxes that should show 8 connect ports in connect mode / edge-end drag. */
  const connectPortTargets = useMemo(() => {
    const dragHover = edgeDragPreview ? edgeDragPreview.hoverRef : null;
    const reconnecting = edgeDragPreview != null;
    if (tool !== "connect" && !reconnecting) {
      return [] as { ref: string; x: number; y: number; w: number; h: number }[];
    }
    const selectedRef = single && single.type !== "edge" ? refIdForSelectable(single) : null;
    const out: { ref: string; x: number; y: number; w: number; h: number }[] = [];
    const want = (ref: string) =>
      Boolean(connectFrom) ||
      reconnecting ||
      hoverConnectRef === ref ||
      dragHover === ref ||
      selectedRef === ref;
    for (const s of doc.stickies) {
      if (want(s.id)) out.push({ ref: s.id, x: s.x, y: s.y, w: s.w, h: s.h });
    }
    for (const s of doc.shapes) {
      if (want(s.id)) out.push({ ref: s.id, x: s.x, y: s.y, w: s.w, h: s.h });
    }
    for (const n of doc.notes) {
      const ref = `note:${n.noteId}`;
      if (want(ref)) out.push({ ref, x: n.x, y: n.y, w: n.w, h: n.h });
    }
    for (const m of doc.media || []) {
      if (want(m.id)) out.push({ ref: m.id, x: m.x, y: m.y, w: m.w, h: m.h });
    }
    return out;
  }, [
    tool,
    doc.stickies,
    doc.shapes,
    doc.notes,
    doc.media,
    connectFrom,
    hoverConnectRef,
    single,
    edgeDragPreview,
  ]);

  const openStageAi = () => {
    if (!selectionInfo) return;
    const p = worldToClient(selectionInfo.box.x, selectionInfo.box.y + selectionInfo.box.h);
    setStageAiAnchor({ top: p.y + 8, left: p.x });
    setStageAiOpen(true);
  };

  return (
    <div className="cv-page cv-immersive">
      <div className="cv-float-chrome">
        <WorkspaceSwitcher
          label="白板"
          items={list}
          currentId={canvasId}
          onSelect={(id) => router.push(`/canvas/${id}${window.location.search}`)}
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
        <div className="cv-float-actions">
          <button
            type="button"
            className={`btn btn-ghost btn-sm${canvasShare?.enabled ? " is-on" : ""}`}
            onClick={() => setShareOpen(true)}
            title={canvasShare?.enabled ? "分享中" : "分享白板"}
          >
            {canvasShare?.enabled ? "分享中" : "分享"}
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={undo} disabled={!history.length}>
            復原
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAsideOpen((v) => !v)}>
            {asideOpen ? "收合側欄" : "側欄"}
          </button>
        </div>
      </div>


      <CanvasToolbar
          tool={tool}
          onTool={setTool}
          stickyColor={stickyColor}
          onStickyColor={applyCanvasColor}
          scale={doc.scale}
          grid={doc.grid}
          snap={doc.snap}
          onZoomIn={() => setDoc((d) => ({ ...d, scale: clampScale(d.scale + 0.1) }))}
          onZoomOut={() => setDoc((d) => ({ ...d, scale: clampScale(d.scale - 0.1) }))}
          onFit={fitAll}
          onReset={resetZoom}
          onToggleGrid={() => setDoc((d) => ({ ...d, grid: !d.grid }))}
          onToggleSnap={() => setDoc((d) => ({ ...d, snap: !d.snap }))}
          onDelete={deleteSelected}
          onDuplicate={() => {
            doCopy();
            doPaste();
          }}
          onAutoLayout={() => {
            updateDoc((d) => ({ ...d, notes: autoLayoutNotes(d.notes) }));
            toast("已自動排版");
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
                toast("JSON 無效");
                return;
              }
              updateDoc(() => next);
            })();
          }}
          canEditSelection={selected.length > 0}
          selectionCount={selected.length}
          onInsertFiles={(files) => {
            void insertFiles(files);
          }}
          onInsertSection={insertSectionAtCenter}
          onInsertUrl={() => {
            void insertUrl();
          }}
          uploadBusy={uploadBusy}
          onShare={() => setShareOpen(true)}
          shareEnabled={Boolean(canvasShare?.enabled)}
        />

      <div className={`cv-layout cv-layout--immersive${asideOpen ? "" : " cv-layout--wide"}`}>
        <div
          ref={stageRef}
          className={`cv-stage${doc.grid ? " has-grid" : ""}${spaceDown || tool === "pan" ? " is-panning" : ""} tool-${tool}`}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={onPointerUp}
          onContextMenu={(e) => {
            e.preventDefault();
            const rp = rightPan.current;
            rightPan.current = null;
            if (rp?.moved) return;
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
            if (!hit) {
              // Double-click empty → sticky (Shift = plain text)
              const asText = e.shiftKey;
              const sticky = createSticky({
                x: snapVal(world.x, 22, doc.snap),
                y: snapVal(world.y, 22, doc.snap),
                w: asText ? 220 : 200,
                h: asText ? 48 : 160,
                text: "",
                color: asText
                  ? stickyColor === "yellow"
                    ? "#1f2937"
                    : colorToShapeHex(stickyColor)
                  : stickyColor,
                variant: asText ? "text" : "sticky",
              });
              updateDoc((d) => ({ ...d, stickies: [...d.stickies, sticky] }));
              setSelected([{ type: "sticky", id: sticky.id }]);
              setEditingId(sticky.id);
              setTool("select");
              return;
            }
            if (hit.type === "section") {
              setSelected([hit]);
              return;
            }
            if (hit.type === "sticky") {
              setSelected([hit]);
              setEditingId(hit.id);
            }
            if (hit.type === "shape") {
              setSelected([hit]);
              setEditingShape(hit.id);
            }
          }}
          onDragOver={(e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = "copy";
          }}
          onDrop={(e) => {
            e.preventDefault();
            if (e.dataTransfer.files?.length) {
              const at = clientToWorld(e.clientX, e.clientY);
              void insertFiles(e.dataTransfer.files, at);
            }
          }}
        >
          <div
            className="cv-world"
            style={{
              transform: `translate3d(${doc.pan.x}px, ${doc.pan.y}px, 0) scale(${doc.scale})`,
              transformOrigin: "0 0",
            }}
          >
            {(doc.sections || []).map((sec) => (
              <div
                key={sec.id}
                className={`cv-section${isSelected("section", sec.id) ? " is-on" : ""}`}
                style={{
                  left: sec.x,
                  top: sec.y,
                  width: sec.w,
                  height: sec.h,
                  zIndex: sec.z || 0,
                  ["--sec-color" as string]: sec.color,
                }}
              >
                <input
                  className="cv-section-title"
                  value={sec.title}
                  onChange={(e) => {
                    const title = e.target.value;
                    setDoc((d) => ({
                      ...d,
                      sections: (d.sections || []).map((x) => (x.id === sec.id ? { ...x, title } : x)),
                    }));
                  }}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    setSelected([{ type: "section", id: sec.id }]);
                  }}
                />
              </div>
            ))}
            <svg className="cv-edges" width="8000" height="6000">
              {doc.edges.map((edge) => {
                const ca = nodeCenter(doc, edge.from);
                const cb = nodeCenter(doc, edge.to);
                if (!ca || !cb) return null;
                let a = edgeEndpoint(doc, edge.from, edge.fromPort, cb) ?? ca;
                let b = edgeEndpoint(doc, edge.to, edge.toPort, ca) ?? cb;
                // While dragging an endpoint, preview the moving side.
                if (edgeDragPreview?.edgeId === edge.id) {
                  if (edgeDragPreview.which === "from") a = edgeDragPreview.point;
                  else b = edgeDragPreview.point;
                }
                const selectedEdge = isSelected("edge", edge.id);
                return (
                  <g key={edge.id}>
                    <path
                      d={edgePath(a, b)}
                      className={`cv-edge${selectedEdge ? " is-on" : ""}`}
                      onPointerDown={(ev) => {
                        ev.stopPropagation();
                        setSelected([{ type: "edge", id: edge.id }]);
                      }}
                    />
                    {selectedEdge && tool !== "connect" ? (
                      <>
                        <circle
                          className="cv-edge-end"
                          cx={a.x}
                          cy={a.y}
                          r={6}
                          onPointerDown={(ev) => {
                            startEdgeEndDrag(ev as unknown as REPointerEvent, edge.id, "from");
                          }}
                        />
                        <circle
                          className="cv-edge-end"
                          cx={b.x}
                          cy={b.y}
                          r={6}
                          onPointerDown={(ev) => {
                            startEdgeEndDrag(ev as unknown as REPointerEvent, edge.id, "to");
                          }}
                        />
                      </>
                    ) : null}
                  </g>
                );
              })}
              {tool === "connect" && connectFrom && connectCursor ? (
                (() => {
                  const start =
                    (connectFrom.port
                      ? nodePortPoint(doc, connectFrom.ref, connectFrom.port)
                      : null) ||
                    nodeCenter(doc, connectFrom.ref);
                  if (!start) return null;
                  return (
                    <path
                      d={edgePath(start, connectCursor)}
                      className="cv-edge cv-edge--preview"
                    />
                  );
                })()
              ) : null}
            </svg>

            {doc.shapes.map((s) => (
              <div
                key={s.id}
                className={`cv-shape cv-shape--${s.shape}${isSelected("shape", s.id) ? " is-on" : ""}${connectFrom?.ref === s.id || hoverConnectRef === s.id ? " is-connect" : ""}`}
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
              const pal = resolveStickyStyle(s.color);
              const isText = s.variant === "text";
              const connectOn = connectFrom?.ref === s.id || hoverConnectRef === s.id;
              const textColor = isText ? colorToShapeHex(s.color) : undefined;
              return (
                <div
                  key={s.id}
                  className={`cv-sticky${isText ? " cv-sticky--text" : ""}${isSelected("sticky", s.id) ? " is-on" : ""}${connectOn ? " is-connect" : ""}`}
                  style={{
                    left: s.x,
                    top: s.y,
                    width: s.w,
                    height: s.h,
                    ...(isText
                      ? {
                          background: "transparent",
                          border: "none",
                          boxShadow: "none",
                          color: textColor || "var(--text-main)",
                        }
                      : {
                          background: pal.bg,
                          borderColor: pal.border,
                        }),
                    zIndex: s.z,
                  }}
                >
                  {editingId === s.id ? (
                    <textarea
                      autoFocus
                      value={s.text}
                      placeholder={isText ? "輸入文字…" : ""}
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
                    <p className={!s.text ? "is-placeholder" : undefined}>
                      {s.text || (isText ? "雙擊編輯文字…" : "雙擊編輯…")}
                    </p>
                  )}
                </div>
              );
            })}

            {doc.notes.map((pin) => {
              const n = noteMap.get(pin.noteId);
              if (!n) return null;
              const noteRef = `note:${pin.noteId}`;
              const connectOn = connectFrom?.ref === noteRef || hoverConnectRef === noteRef;
              return (
                <div
                  key={pin.noteId}
                  className={`cv-note${isSelected("note", pin.noteId) ? " is-on" : ""}${connectOn ? " is-connect" : ""}`}
                  style={{ left: pin.x, top: pin.y, width: pin.w, height: pin.h }}
                >
                  <Link
                    href={`/notes/${n.id}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (tool === "connect") e.preventDefault();
                    }}
                    onPointerDown={(e) => {
                      if (tool === "connect") return; // let stage handle connect hit-test
                      e.stopPropagation();
                    }}
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

            {(doc.media || []).map((m) => (
              <CanvasMediaCard
                key={m.id}
                item={m}
                selected={isSelected("media", m.id)}
                onTranscribe={startMediaTranscribe}
                onSummarize={summarizeMedia}
                onMindMap={mindMapMedia}
                onSplitCards={splitMediaToCards}
                onPatchMedia={patchMedia}
              />
            ))}

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

            {(tool === "connect" || edgeDragPreview) &&
              connectPortTargets.map((t) => (
                <div
                  key={`ports-${t.ref}`}
                  className="cv-port-box"
                  style={{ left: t.x, top: t.y, width: t.w, height: t.h }}
                >
                  {EDGE_PORTS.map((p) => (
                    <button
                      key={p}
                      type="button"
                      className={`cv-port cv-port--${p}${
                        connectFrom?.ref === t.ref && connectFrom.port === p ? " is-on" : ""
                      }${edgeDragPreview?.hoverRef === t.ref ? " is-on" : ""}`}
                      title="連線錨點"
                      onPointerDown={(e) => {
                        if (edgeDragPreview) return; // drop handled on pointer up
                        onPortPointerDown(e, t.ref, p);
                      }}
                    />
                  ))}
                </div>
              ))}

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

            {selectionInfo && !stageAiOpen && (() => {
              const kind = selectionKindOf(selected);
              const mediaSel = selected.length === 1 && selected[0].type === "media"
                ? (doc.media || []).find((m) => m.id === selected[0].id)
                : null;
              const stickySel = selected.length === 1 && selected[0].type === "sticky"
                ? doc.stickies.find((s) => s.id === selected[0].id)
                : null;
              const shapeSel = selected.length === 1 && selected[0].type === "shape"
                ? doc.shapes.find((s) => s.id === selected[0].id)
                : null;
              const sectionSel = selected.length === 1 && selected[0].type === "section"
                ? (doc.sections || []).find((s) => s.id === selected[0].id)
                : null;
              const colorNow = stickySel?.color || shapeSel?.color || sectionSel?.color;
              return (
                <CanvasSelectionChrome
                  box={selectionInfo.box}
                  count={selected.length}
                  kind={kind}
                  color={colorNow}
                  canTranscribe={Boolean(mediaSel && (mediaSel.media === "youtube" || mediaSel.media === "video" || mediaSel.media === "audio"))}
                  hasTranscript={Boolean(mediaSel?.transcript?.trim())}
                  onDuplicate={() => { doCopy(); doPaste(); }}
                  onDelete={deleteSelected}
                  onAi={openStageAi}
                  onColor={applyCanvasColor}
                  onAlign={alignSelected}
                  onTranscribe={mediaSel ? () => void startMediaTranscribe(mediaSel.id) : undefined}
                  onSummarize={mediaSel ? () => void summarizeMedia(mediaSel.id) : undefined}
                  onMindMap={mediaSel ? () => void mindMapMedia(mediaSel.id) : undefined}
                  onSplitCards={mediaSel ? () => void splitMediaToCards(mediaSel.id) : undefined}
                />
              );
            })()}
          </div>
        </div>

        {asideOpen && (
          <CanvasAside
            notes={notes}
            doc={doc}
            selectedIds={selected.map((s) => (s.type === "note" ? `note:${s.id}` : s.id))}
            onPinNote={pinNote}
            onFocusNote={focusNote}
          />
        )}
      </div>

      {ctxMenu && (
        <div
          className="cv-ctx"
          style={{ left: ctxMenu.x, top: ctxMenu.y }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          {!selected.length ? (
            <>
              <button type="button" onClick={() => {
                const world = screenToWorld(ctxMenu.x, ctxMenu.y);
                const sticky = createSticky({
                  x: snapVal(world.x, 22, doc.snap),
                  y: snapVal(world.y, 22, doc.snap),
                  text: "",
                  color: stickyColor,
                });
                updateDoc((d) => ({ ...d, stickies: [...d.stickies, sticky] }));
                setSelected([{ type: "sticky", id: sticky.id }]);
                setEditingId(sticky.id);
                setCtxMenu(null);
              }}>新增便利貼</button>
              <button type="button" onClick={() => {
                insertSectionAtCenter();
                setCtxMenu(null);
              }}>新增分區</button>
              <button type="button" onClick={() => { void insertUrl(); setCtxMenu(null); }}>插入網址</button>
              <button type="button" onClick={() => { doPaste(); setCtxMenu(null); }}>貼上</button>
            </>
          ) : (
            <>
              <button type="button" onClick={() => { startEdit(); setCtxMenu(null); }}>編輯</button>
              <button type="button" onClick={() => { doCut(); setCtxMenu(null); }}>剪下</button>
              <button type="button" onClick={() => { doCopy(); setCtxMenu(null); }}>複製</button>
              <button type="button" onClick={() => { doPaste(); setCtxMenu(null); }}>貼上</button>
              {selected.length === 1 && selected[0].type === "media" && (
                <button type="button" onClick={() => {
                  const id = selected[0].id;
                  void splitMediaToCards(id);
                  setCtxMenu(null);
                }}>拆成知識卡</button>
              )}
              <button type="button" className="is-danger" onClick={() => { deleteSelected(); setCtxMenu(null); }}>
                刪除
              </button>
            </>
          )}
        </div>
      )}

      {stageAiOpen && stageAiAnchor && selectionInfo && (
        <StageSelectionAi
          open={stageAiOpen}
          onClose={() => setStageAiOpen(false)}
          selectionText={selectionInfo.text}
          title={doc.name}
          anchor={stageAiAnchor}
          onApplyReplace={applyStageAiReplace}
          onApplyInsert={applyStageAiInsert}
          onGenerateImage={applyStageAiImage}
          onSummarizeSelection={() => void runSelectionSummarize()}
          onMindMapSelection={() => void runSelectionMindMap()}
          insertLabel="放到白板"
        />
      )}

      <CanvasMinimap
        doc={doc}
        viewport={stageSize}
        onPan={(pan) => setDoc((d) => ({ ...d, pan }))}
        onFit={fitAll}
      />

      {aiPreview && (
        <CanvasAiActionPreview
          open
          title={aiPreview.title}
          busy={aiPreview.busy}
          error={aiPreview.error}
          previewLines={aiPreview.lines}
          onCancel={() => setAiPreview(null)}
          onConfirm={(lines) => {
            landStickiesFromAi(lines, true);
            setAiPreview(null);
            setStageAiOpen(false);
          }}
        />
      )}

      {shareOpen && user && (
        <CanvasShareDialog
          open={shareOpen}
          onClose={() => setShareOpen(false)}
          uid={user.uid}
          canvasId={canvasId}
          doc={doc}
          share={canvasShare}
          onShareChange={setCanvasShare}
        />
      )}

      {connectFrom && <p className="cv-toast">連線中… 點錨點或物件作為終點</p>}
    </div>
  );
}
