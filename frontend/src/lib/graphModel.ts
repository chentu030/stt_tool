/** Knowledge graph model: wiki links, tags, folders, layouts, analytics */

import { extractWikiLinks, extractTagsFromText } from "@/lib/wiki";

export type GraphNote = {
  id: string;
  title: string;
  body_md: string;
  tags?: string[];
  folder?: string;
  status?: string;
  updated_at: Date;
  created_at: Date;
};

export type EdgeKind = "wiki" | "tag" | "folder";

export type GraphNodeKind = "note" | "ghost" | "tag" | "folder";

export type GraphNode = {
  id: string;
  kind: GraphNodeKind;
  title: string;
  noteId?: string;
  folder?: string;
  tags: string[];
  words: number;
  updatedAt: number;
  /** wiki out / in */
  outDegree: number;
  inDegree: number;
  degree: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
};

export type GraphEdge = {
  id: string;
  from: string;
  to: string;
  kind: EdgeKind;
  weight: number;
  label?: string;
};

export type LayoutMode = "force" | "radial" | "cluster" | "grid" | "timeline";

export type GraphFilters = {
  q: string;
  folder: string;
  tag: string;
  minDegree: number;
  showGhosts: boolean;
  showTagEdges: boolean;
  showFolderEdges: boolean;
  onlyOrphans: boolean;
  onlyHubs: boolean;
  recentDays: number; // 0 = all
  egoId: string; // focus neighborhood
};

export type GraphStats = {
  notes: number;
  nodes: number;
  edges: number;
  wikiEdges: number;
  tagEdges: number;
  folderEdges: number;
  ghosts: number;
  orphans: number;
  hubs: number;
  components: number;
  density: number;
  avgDegree: number;
  maxDegree: number;
  linkedNotes: number;
};

export type GraphBundle = {
  nodes: GraphNode[];
  edges: GraphEdge[];
  byId: Map<string, GraphNode>;
};

export type PathResult = { nodes: string[]; edges: string[] } | null;

export const DEFAULT_FILTERS: GraphFilters = {
  q: "",
  folder: "",
  tag: "",
  minDegree: 0,
  showGhosts: true,
  showTagEdges: false,
  showFolderEdges: false,
  onlyOrphans: false,
  onlyHubs: false,
  recentDays: 0,
  egoId: "",
};

export const LAYOUT_OPTIONS: { id: LayoutMode; label: string; hint: string }[] = [
  { id: "force", label: "力導向", hint: "相關聚攏、不相關分量拉開距離" },
  { id: "radial", label: "放射", hint: "以樞紐為中心向外" },
  { id: "cluster", label: "資料夾簇", hint: "同資料夾聚在一起" },
  { id: "grid", label: "網格", hint: "依度數排序整齊排列" },
  { id: "timeline", label: "時間線", hint: "依更新時間左右排" },
];

export const GRAPH_TIPS = [
  "力導向佈局會持續模擬：節點互相推開、連線拉近，整體聚成一球。",
  "拖曳節點時其他節點會被引力帶動；放開後會慢慢穩定。",
  "點選節點可查看入鏈／出鏈與鄰居。",
  "按住空白鍵或中鍵可平移；Ctrl+滾輪或 Ctrl+/- 縮放。",
  "開啟「標籤邊」可看出共同主題；「資料夾邊」看分組。",
  "幽靈節點代表 [[連結]] 到尚未建立的標題。",
  "焦點模式只顯示選中節點的一階鄰居。",
  "把檔案拖到某個筆記節點上可直接附加；拖到空白處會建立新筆記。",
  "點選筆記節點會彈出「詢問 AI」面板，可直接生成內容或插圖並加入筆記。",
];

const POS_KEY = "cadence_graph_pos_v1_";

function countWords(text: string): number {
  const t = (text || "").trim();
  if (!t) return 0;
  const cjk = (t.match(/[\u4e00-\u9fff]/g) || []).length;
  const latin = t
    .replace(/[\u4e00-\u9fff]/g, " ")
    .split(/\s+/)
    .filter(Boolean).length;
  return cjk + latin;
}

function titleKey(title: string) {
  return title.trim().toLowerCase();
}

export function nodeIdForNote(noteId: string) {
  return `n:${noteId}`;
}

export function nodeIdForGhost(title: string) {
  return `g:${titleKey(title)}`;
}

export function nodeIdForTag(tag: string) {
  return `t:${tag.toLowerCase()}`;
}

export function nodeIdForFolder(folder: string) {
  return `f:${folder.trim().toLowerCase() || "未分類"}`;
}

export function loadPositions(uid: string): Record<string, { x: number; y: number }> {
  try {
    const raw = localStorage.getItem(POS_KEY + uid);
    if (!raw) return {};
    return JSON.parse(raw) as Record<string, { x: number; y: number }>;
  } catch {
    return {};
  }
}

export function savePositions(uid: string, map: Record<string, { x: number; y: number }>) {
  try {
    localStorage.setItem(POS_KEY + uid, JSON.stringify(map));
  } catch {
    /* ignore */
  }
}

export function clearPositions(uid: string) {
  try {
    localStorage.removeItem(POS_KEY + uid);
  } catch {
    /* ignore */
  }
}

/** Build full graph from notes */
export function buildGraph(
  notes: GraphNote[],
  opts?: {
    includeTagNodes?: boolean;
    includeFolderNodes?: boolean;
    tagEdgeMinShared?: number;
  }
): GraphBundle {
  const includeTagNodes = opts?.includeTagNodes ?? false;
  const includeFolderNodes = opts?.includeFolderNodes ?? false;
  const tagEdgeMinShared = opts?.tagEdgeMinShared ?? 1;

  const byTitle = new Map<string, GraphNote>();
  for (const n of notes) {
    const k = titleKey(n.title);
    if (k && !byTitle.has(k)) byTitle.set(k, n);
  }

  const nodes: GraphNode[] = [];
  const byId = new Map<string, GraphNode>();
  const edges: GraphEdge[] = [];
  const edgeKeys = new Set<string>();

  const addNode = (node: GraphNode) => {
    if (byId.has(node.id)) return byId.get(node.id)!;
    nodes.push(node);
    byId.set(node.id, node);
    return node;
  };

  const addEdge = (from: string, to: string, kind: EdgeKind, weight = 1, label?: string) => {
    if (from === to) return;
    const key = `${kind}|${from}|${to}`;
    if (edgeKeys.has(key)) return;
    edgeKeys.add(key);
    edges.push({
      id: key,
      from,
      to,
      kind,
      weight,
      label,
    });
  };

  // note nodes
  for (const n of notes) {
    const tags = [
      ...new Set([
        ...(n.tags || []),
        ...extractTagsFromText(n.body_md),
      ].map((t) => t.trim()).filter(Boolean)),
    ];
    addNode({
      id: nodeIdForNote(n.id),
      kind: "note",
      title: n.title || "未命名",
      noteId: n.id,
      folder: n.folder?.trim() || "",
      tags,
      words: countWords(n.body_md),
      updatedAt: n.updated_at?.getTime?.() || Date.now(),
      outDegree: 0,
      inDegree: 0,
      degree: 0,
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
    });
  }

  // wiki edges + ghosts
  for (const n of notes) {
    const from = nodeIdForNote(n.id);
    for (const link of extractWikiLinks(n.body_md)) {
      const target = byTitle.get(titleKey(link));
      if (target) {
        addEdge(from, nodeIdForNote(target.id), "wiki", 1, link);
      } else {
        const gid = nodeIdForGhost(link);
        addNode({
          id: gid,
          kind: "ghost",
          title: link.trim(),
          folder: "",
          tags: [],
          words: 0,
          updatedAt: 0,
          outDegree: 0,
          inDegree: 0,
          degree: 0,
          x: 0,
          y: 0,
          vx: 0,
          vy: 0,
        });
        addEdge(from, gid, "wiki", 1, link);
      }
    }
  }

  // tag co-occurrence soft edges between notes
  const tagToNotes = new Map<string, string[]>();
  for (const node of nodes) {
    if (node.kind !== "note") continue;
    for (const t of node.tags) {
      const k = t.toLowerCase();
      if (!tagToNotes.has(k)) tagToNotes.set(k, []);
      tagToNotes.get(k)!.push(node.id);
    }
  }

  for (const [tag, ids] of tagToNotes) {
    if (includeTagNodes) {
      const tid = nodeIdForTag(tag);
      addNode({
        id: tid,
        kind: "tag",
        title: `#${tag}`,
        folder: "",
        tags: [tag],
        words: 0,
        updatedAt: 0,
        outDegree: 0,
        inDegree: 0,
        degree: 0,
        x: 0,
        y: 0,
        vx: 0,
        vy: 0,
      });
      for (const nid of ids) addEdge(tid, nid, "tag", 1, tag);
    } else if (ids.length >= 2 && tagEdgeMinShared >= 1) {
      for (let i = 0; i < ids.length; i++) {
        for (let j = i + 1; j < ids.length; j++) {
          addEdge(ids[i], ids[j], "tag", 0.5, tag);
          if (edges.filter((e) => e.kind === "tag").length > 400) break;
        }
        if (edges.filter((e) => e.kind === "tag").length > 400) break;
      }
    }
  }

  // folder hub edges
  const folderToNotes = new Map<string, string[]>();
  for (const node of nodes) {
    if (node.kind !== "note") continue;
    const f = node.folder?.trim() || "未分類";
    if (!folderToNotes.has(f)) folderToNotes.set(f, []);
    folderToNotes.get(f)!.push(node.id);
  }

  if (includeFolderNodes) {
    for (const [folder, ids] of folderToNotes) {
      if (ids.length < 2) continue;
      const fid = nodeIdForFolder(folder);
      addNode({
        id: fid,
        kind: "folder",
        title: folder,
        folder,
        tags: [],
        words: 0,
        updatedAt: 0,
        outDegree: 0,
        inDegree: 0,
        degree: 0,
        x: 0,
        y: 0,
        vx: 0,
        vy: 0,
      });
      for (const nid of ids) addEdge(fid, nid, "folder", 0.4, folder);
    }
  } else {
    for (const [folder, ids] of folderToNotes) {
      if (ids.length < 2) continue;
      for (let i = 0; i < Math.min(ids.length, 12); i++) {
        for (let j = i + 1; j < Math.min(ids.length, 12); j++) {
          addEdge(ids[i], ids[j], "folder", 0.25, folder);
        }
      }
    }
  }

  // degrees (wiki only for primary stats feel, but count all for layout)
  for (const e of edges) {
    const a = byId.get(e.from);
    const b = byId.get(e.to);
    if (!a || !b) continue;
    if (e.kind === "wiki") {
      a.outDegree += 1;
      b.inDegree += 1;
    }
    a.degree += 1;
    b.degree += 1;
  }

  return { nodes, edges, byId };
}

export function applySavedPositions(
  bundle: GraphBundle,
  saved: Record<string, { x: number; y: number }>
) {
  for (const n of bundle.nodes) {
    const p = saved[n.id];
    if (p) {
      n.x = p.x;
      n.y = p.y;
    }
  }
}

export function computeStats(bundle: GraphBundle, noteCount: number): GraphStats {
  const wikiEdges = bundle.edges.filter((e) => e.kind === "wiki").length;
  const tagEdges = bundle.edges.filter((e) => e.kind === "tag").length;
  const folderEdges = bundle.edges.filter((e) => e.kind === "folder").length;
  const ghosts = bundle.nodes.filter((n) => n.kind === "ghost").length;
  const noteNodes = bundle.nodes.filter((n) => n.kind === "note");
  const orphans = noteNodes.filter((n) => n.inDegree + n.outDegree === 0).length;
  const hubs = noteNodes.filter((n) => n.degree >= 3 || n.inDegree + n.outDegree >= 3).length;
  const linkedNotes = noteNodes.filter((n) => n.inDegree + n.outDegree > 0).length;
  const components = countComponents(bundle, "wiki");
  const n = Math.max(noteNodes.length, 1);
  const maxDegree = noteNodes.reduce((m, x) => Math.max(m, x.inDegree + x.outDegree), 0);
  const sumDeg = noteNodes.reduce((s, x) => s + x.inDegree + x.outDegree, 0);
  const dens = n > 1 ? (2 * wikiEdges) / (n * (n - 1)) : 0;

  return {
    notes: noteCount,
    nodes: bundle.nodes.length,
    edges: bundle.edges.length,
    wikiEdges,
    tagEdges,
    folderEdges,
    ghosts,
    orphans,
    hubs,
    components,
    density: Math.round(dens * 1000) / 1000,
    avgDegree: Math.round((sumDeg / n) * 10) / 10,
    maxDegree,
    linkedNotes,
  };
}

function countComponents(bundle: GraphBundle, kind: EdgeKind | "all"): number {
  const ids = bundle.nodes.filter((n) => n.kind === "note" || n.kind === "ghost").map((n) => n.id);
  const adj = new Map<string, string[]>();
  for (const id of ids) adj.set(id, []);
  for (const e of bundle.edges) {
    if (kind !== "all" && e.kind !== kind) continue;
    if (!adj.has(e.from) || !adj.has(e.to)) continue;
    adj.get(e.from)!.push(e.to);
    adj.get(e.to)!.push(e.from);
  }
  const seen = new Set<string>();
  let c = 0;
  for (const id of ids) {
    if (seen.has(id)) continue;
    c += 1;
    const stack = [id];
    while (stack.length) {
      const cur = stack.pop()!;
      if (seen.has(cur)) continue;
      seen.add(cur);
      for (const nb of adj.get(cur) || []) if (!seen.has(nb)) stack.push(nb);
    }
  }
  return c;
}

export function filterGraph(bundle: GraphBundle, filters: GraphFilters): GraphBundle {
  const q = filters.q.trim().toLowerCase();
  const now = Date.now();
  const recentCut = filters.recentDays > 0 ? now - filters.recentDays * 86400000 : 0;

  let keep = new Set<string>();

  for (const n of bundle.nodes) {
    if (n.kind === "ghost" && !filters.showGhosts) continue;
    if (n.kind === "tag" || n.kind === "folder") {
      keep.add(n.id);
      continue;
    }
    if (filters.folder && (n.folder || "") !== filters.folder) continue;
    if (filters.tag && !n.tags.map((t) => t.toLowerCase()).includes(filters.tag.toLowerCase())) continue;
    const wikiDeg = n.inDegree + n.outDegree;
    if (filters.minDegree > 0 && wikiDeg < filters.minDegree) continue;
    if (filters.onlyOrphans && wikiDeg > 0) continue;
    if (filters.onlyHubs && wikiDeg < 3 && n.degree < 3) continue;
    if (recentCut && n.kind === "note" && n.updatedAt < recentCut) continue;
    if (q) {
      const hay = `${n.title} ${n.tags.join(" ")} ${n.folder || ""}`.toLowerCase();
      if (!hay.includes(q)) continue;
    }
    keep.add(n.id);
  }

  // ego neighborhood
  if (filters.egoId && bundle.byId.has(filters.egoId)) {
    const neigh = new Set<string>([filters.egoId]);
    for (const e of bundle.edges) {
      if (e.from === filters.egoId) neigh.add(e.to);
      if (e.to === filters.egoId) neigh.add(e.from);
    }
    keep = new Set([...keep].filter((id) => neigh.has(id)));
  }

  const edges = bundle.edges.filter((e) => {
    if (!keep.has(e.from) || !keep.has(e.to)) return false;
    if (e.kind === "tag" && !filters.showTagEdges) return false;
    if (e.kind === "folder" && !filters.showFolderEdges) return false;
    return true;
  });

  // keep endpoints of surviving edges
  for (const e of edges) {
    keep.add(e.from);
    keep.add(e.to);
  }

  const nodes = bundle.nodes.filter((n) => keep.has(n.id));
  const byId = new Map(nodes.map((n) => [n.id, n]));
  return { nodes, edges, byId };
}

export function layoutGraph(
  bundle: GraphBundle,
  mode: LayoutMode,
  width = 1200,
  height = 800,
  iterations = 80
) {
  const nodes = bundle.nodes;
  if (!nodes.length) return;

  const cx = width / 2;
  const cy = height / 2;

  if (mode === "radial") {
    const sorted = [...nodes].sort(
      (a, b) => b.inDegree + b.outDegree - (a.inDegree + a.outDegree)
    );
    const hub = sorted[0];
    hub.x = cx;
    hub.y = cy;
    const rest = sorted.slice(1);
    rest.forEach((n, i) => {
      const angle = (i / Math.max(rest.length, 1)) * Math.PI * 2;
      const ring = 1 + Math.floor(i / 12);
      const r = 90 + ring * 70 + (n.degree % 5) * 10;
      n.x = cx + Math.cos(angle) * r;
      n.y = cy + Math.sin(angle) * r;
    });
    return;
  }

  if (mode === "cluster") {
    const folders = new Map<string, GraphNode[]>();
    for (const n of nodes) {
      const key =
        n.kind === "folder"
          ? n.title
          : n.kind === "ghost"
            ? "幽靈"
            : n.folder?.trim() || "未分類";
      if (!folders.has(key)) folders.set(key, []);
      folders.get(key)!.push(n);
    }
    const keys = [...folders.keys()];
    keys.forEach((key, fi) => {
      const angle = (fi / Math.max(keys.length, 1)) * Math.PI * 2;
      const R = 160 + keys.length * 6;
      const ox = cx + Math.cos(angle) * R;
      const oy = cy + Math.sin(angle) * R;
      const group = folders.get(key)!;
      group.forEach((n, i) => {
        const a = (i / Math.max(group.length, 1)) * Math.PI * 2;
        const r = 28 + Math.floor(i / 6) * 28;
        n.x = ox + Math.cos(a) * r;
        n.y = oy + Math.sin(a) * r;
      });
    });
    return;
  }

  if (mode === "grid") {
    const sorted = [...nodes].sort(
      (a, b) => b.inDegree + b.outDegree - (a.inDegree + a.outDegree) || a.title.localeCompare(b.title, "zh-Hant")
    );
    const cols = Math.ceil(Math.sqrt(sorted.length));
    const gapX = 110;
    const gapY = 88;
    const startX = cx - ((cols - 1) * gapX) / 2;
    const rows = Math.ceil(sorted.length / cols);
    const startY = cy - ((rows - 1) * gapY) / 2;
    sorted.forEach((n, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      n.x = startX + col * gapX;
      n.y = startY + row * gapY;
    });
    return;
  }

  if (mode === "timeline") {
    const sorted = [...nodes].sort((a, b) => a.updatedAt - b.updatedAt);
    const times = sorted.map((n) => n.updatedAt).filter((t) => t > 0);
    const minT = times.length ? Math.min(...times) : 0;
    const maxT = times.length ? Math.max(...times) : 1;
    const span = Math.max(maxT - minT, 1);
    sorted.forEach((n, i) => {
      const t = n.updatedAt > 0 ? n.updatedAt : minT + (i / Math.max(sorted.length, 1)) * span;
      n.x = 80 + ((t - minT) / span) * (width - 160);
      n.y = 100 + ((i % 8) * 70) + (Math.floor(i / 8) % 2) * 20;
    });
    return;
  }

  // force (seed for continuous sim / one-shot when needed)
  const N = nodes.length;
  const seedR = Math.min(width, height) * 0.32;
  nodes.forEach((n, i) => {
    if (n.x === 0 && n.y === 0) {
      const a = (i / Math.max(N, 1)) * Math.PI * 2 + (i % 3) * 0.35;
      const ring = seedR * (0.35 + (i % 9) * 0.07);
      n.x = cx + Math.cos(a) * ring;
      n.y = cy + Math.sin(a) * ring;
    }
    n.vx = 0;
    n.vy = 0;
  });

  const wikiEdges = bundle.edges.filter(
    (e) => e.kind === "wiki" || e.kind === "tag" || e.kind === "folder"
  );
  const iters = Math.max(iterations, 120);
  for (let iter = 0; iter < iters; iter++) {
    const cooling = Math.max(0.15, 1 - iter / iters);
    // repulsion + collision
    for (let i = 0; i < N; i++) {
      for (let j = i + 1; j < N; j++) {
        const a = nodes[i];
        const b = nodes[j];
        let dx = a.x - b.x;
        let dy = a.y - b.y;
        let dist = Math.sqrt(dx * dx + dy * dy) || 0.01;
        const minDist = 44;
        let force = (7200 / (dist * dist)) * cooling;
        if (dist < minDist) force += ((minDist - dist) / dist) * 12 * cooling;
        dx = (dx / dist) * force;
        dy = (dy / dist) * force;
        a.vx += dx;
        a.vy += dy;
        b.vx -= dx;
        b.vy -= dy;
      }
    }
    // attraction
    for (const e of wikiEdges) {
      const a = bundle.byId.get(e.from);
      const b = bundle.byId.get(e.to);
      if (!a || !b) continue;
      let dx = b.x - a.x;
      let dy = b.y - a.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 0.01;
      const ideal = e.kind === "wiki" ? 180 : e.kind === "tag" ? 320 : 380;
      const spring = e.kind === "wiki" ? 0.028 : 0.01;
      const force = (dist - ideal) * spring * e.weight * cooling;
      dx = (dx / dist) * force;
      dy = (dy / dist) * force;
      a.vx += dx;
      a.vy += dy;
      b.vx -= dx;
      b.vy -= dy;
    }
    // light center gravity (avoid collapsing all components into one ball)
    for (const n of nodes) {
      n.vx += (cx - n.x) * 0.005 * cooling;
      n.vy += (cy - n.y) * 0.005 * cooling;
      n.vx *= 0.82;
      n.vy *= 0.82;
      n.x += n.vx;
      n.y += n.vy;
    }
  }
}

export function neighborsOf(
  bundle: GraphBundle,
  nodeId: string
): { inbound: GraphNode[]; outbound: GraphNode[]; undirected: GraphNode[] } {
  const inbound: GraphNode[] = [];
  const outbound: GraphNode[] = [];
  const undirected: GraphNode[] = [];
  const seen = new Set<string>();
  for (const e of bundle.edges) {
    if (e.from === nodeId) {
      const n = bundle.byId.get(e.to);
      if (n) {
        if (e.kind === "wiki") outbound.push(n);
        else if (!seen.has(n.id)) {
          undirected.push(n);
          seen.add(n.id);
        }
      }
    }
    if (e.to === nodeId) {
      const n = bundle.byId.get(e.from);
      if (n) {
        if (e.kind === "wiki") inbound.push(n);
        else if (!seen.has(n.id)) {
          undirected.push(n);
          seen.add(n.id);
        }
      }
    }
  }
  return { inbound, outbound, undirected };
}

/** BFS shortest path on undirected wiki (+ optional) edges */
export function shortestPath(
  bundle: GraphBundle,
  fromId: string,
  toId: string,
  kinds: EdgeKind[] = ["wiki"]
): PathResult {
  if (!bundle.byId.has(fromId) || !bundle.byId.has(toId)) return null;
  if (fromId === toId) return { nodes: [fromId], edges: [] };

  const allow = new Set(kinds);
  const adj = new Map<string, { to: string; edgeId: string }[]>();
  for (const n of bundle.nodes) adj.set(n.id, []);
  for (const e of bundle.edges) {
    if (!allow.has(e.kind)) continue;
    adj.get(e.from)?.push({ to: e.to, edgeId: e.id });
    adj.get(e.to)?.push({ to: e.from, edgeId: e.id });
  }

  const prev = new Map<string, { id: string; edgeId: string }>();
  const q = [fromId];
  const seen = new Set([fromId]);
  while (q.length) {
    const cur = q.shift()!;
    for (const nb of adj.get(cur) || []) {
      if (seen.has(nb.to)) continue;
      seen.add(nb.to);
      prev.set(nb.to, { id: cur, edgeId: nb.edgeId });
      if (nb.to === toId) {
        const nodes: string[] = [toId];
        const edges: string[] = [];
        let walk = toId;
        while (walk !== fromId) {
          const p = prev.get(walk)!;
          edges.push(p.edgeId);
          nodes.push(p.id);
          walk = p.id;
        }
        nodes.reverse();
        edges.reverse();
        return { nodes, edges };
      }
      q.push(nb.to);
    }
  }
  return null;
}

export function topHubs(bundle: GraphBundle, limit = 8): GraphNode[] {
  return [...bundle.nodes]
    .filter((n) => n.kind === "note")
    .sort((a, b) => b.inDegree + b.outDegree - (a.inDegree + a.outDegree) || b.degree - a.degree)
    .slice(0, limit);
}

export function orphanNotes(bundle: GraphBundle, limit = 12): GraphNode[] {
  return bundle.nodes
    .filter((n) => n.kind === "note" && n.inDegree + n.outDegree === 0)
    .slice(0, limit);
}

export function ghostTargets(bundle: GraphBundle, limit = 12): GraphNode[] {
  return bundle.nodes
    .filter((n) => n.kind === "ghost")
    .sort((a, b) => b.inDegree - a.inDegree)
    .slice(0, limit);
}

export function folderBuckets(bundle: GraphBundle): { name: string; count: number }[] {
  const map = new Map<string, number>();
  for (const n of bundle.nodes) {
    if (n.kind !== "note") continue;
    const k = n.folder?.trim() || "未分類";
    map.set(k, (map.get(k) || 0) + 1);
  }
  return [...map.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "zh-Hant"));
}

export function tagBuckets(bundle: GraphBundle): { name: string; count: number }[] {
  const map = new Map<string, number>();
  for (const n of bundle.nodes) {
    if (n.kind !== "note") continue;
    for (const t of n.tags) map.set(t, (map.get(t) || 0) + 1);
  }
  return [...map.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "zh-Hant"));
}

export function exportGraphMarkdown(bundle: GraphBundle, stats: GraphStats): string {
  const lines = [
    `# Albireus 知識圖譜`,
    ``,
    `- 筆記：${stats.notes}`,
    `- 節點：${stats.nodes}`,
    `- Wiki 連線：${stats.wikiEdges}`,
    `- 連通分量：${stats.components}`,
    `- 孤兒筆記：${stats.orphans}`,
    `- 幽靈連結：${stats.ghosts}`,
    ``,
    `## 樞紐`,
    ...topHubs(bundle, 15).map(
      (n) => `- ${n.title}（出 ${n.outDegree} / 入 ${n.inDegree}）`
    ),
    ``,
    `## 幽靈節點（尚未建立）`,
    ...ghostTargets(bundle, 20).map((n) => `- [[${n.title}]] ← ${n.inDegree} 次`),
    ``,
    `## 連線`,
    ...bundle.edges
      .filter((e) => e.kind === "wiki")
      .slice(0, 200)
      .map((e) => {
        const a = bundle.byId.get(e.from)?.title || e.from;
        const b = bundle.byId.get(e.to)?.title || e.to;
        return `- ${a} → ${b}`;
      }),
    ``,
  ];
  return lines.join("\n");
}

export function exportGraphJson(bundle: GraphBundle) {
  return JSON.stringify(
    {
      version: 1,
      nodes: bundle.nodes.map((n) => ({
        id: n.id,
        kind: n.kind,
        title: n.title,
        noteId: n.noteId,
        folder: n.folder,
        tags: n.tags,
        x: Math.round(n.x),
        y: Math.round(n.y),
        inDegree: n.inDegree,
        outDegree: n.outDegree,
      })),
      edges: bundle.edges.map((e) => ({
        id: e.id,
        from: e.from,
        to: e.to,
        kind: e.kind,
        weight: e.weight,
        label: e.label,
      })),
    },
    null,
    2
  );
}

export function suggestMissingLinks(bundle: GraphBundle, nodeId: string, limit = 6): GraphNode[] {
  const node = bundle.byId.get(nodeId);
  if (!node || node.kind !== "note") return [];
  const connected = new Set<string>();
  for (const e of bundle.edges) {
    if (e.kind !== "wiki") continue;
    if (e.from === nodeId) connected.add(e.to);
    if (e.to === nodeId) connected.add(e.from);
  }
  const tagSet = new Set(node.tags.map((t) => t.toLowerCase()));
  const scored: { n: GraphNode; score: number }[] = [];
  for (const other of bundle.nodes) {
    if (other.kind !== "note" || other.id === nodeId || connected.has(other.id)) continue;
    let score = 0;
    if (node.folder && other.folder === node.folder) score += 3;
    for (const t of other.tags) if (tagSet.has(t.toLowerCase())) score += 4;
    // shared neighbors
    for (const e of bundle.edges) {
      if (e.kind !== "wiki") continue;
      const touchesOther = e.from === other.id || e.to === other.id;
      if (!touchesOther) continue;
      const otherEnd = e.from === other.id ? e.to : e.from;
      if (connected.has(otherEnd)) score += 2;
    }
    if (score > 0) scored.push({ n: other, score });
  }
  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.n);
}

export function boundsOf(nodes: GraphNode[], pad = 80) {
  if (!nodes.length) return { minX: 0, minY: 0, maxX: 800, maxY: 600, w: 800, h: 600 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const n of nodes) {
    minX = Math.min(minX, n.x);
    minY = Math.min(minY, n.y);
    maxX = Math.max(maxX, n.x);
    maxY = Math.max(maxY, n.y);
  }
  return {
    minX: minX - pad,
    minY: minY - pad,
    maxX: maxX + pad,
    maxY: maxY + pad,
    w: Math.max(400, maxX - minX + pad * 2),
    h: Math.max(300, maxY - minY + pad * 2),
  };
}

export function colorForNode(n: GraphNode): string {
  if (n.kind === "ghost") return "#94A3B8";
  if (n.kind === "tag") return "#7C3AED";
  if (n.kind === "folder") return "#0369A1";
  const folder = n.folder || "";
  let h = 0;
  for (let i = 0; i < folder.length; i++) h = (h * 31 + folder.charCodeAt(i)) % 360;
  if (!folder) h = 172; // teal default
  return `hsl(${h} 55% 42%)`;
}

export function radiusForNode(n: GraphNode): number {
  if (n.kind === "ghost") return 7;
  if (n.kind === "tag" || n.kind === "folder") return 9;
  const d = n.inDegree + n.outDegree;
  return Math.min(22, 8 + Math.sqrt(d) * 3 + Math.min(n.words / 800, 4));
}

/**
 * Line endpoints on circle borders (not centers), so arrow tips sit on the rim
 * instead of stacking inside the target node.
 */
export function edgeEndpointsOnCircles(
  ax: number,
  ay: number,
  ar: number,
  bx: number,
  by: number,
  br: number,
  /** Extra gap before the target rim so a marker tip lands on the circumference */
  tipGap = 0
): { x1: number; y1: number; x2: number; y2: number } | null {
  const dx = bx - ax;
  const dy = by - ay;
  const dist = Math.hypot(dx, dy);
  if (dist < 0.001) return null;
  const ux = dx / dist;
  const uy = dy / dist;
  // Keep a tiny visible segment even when nodes almost touch
  const maxTrim = Math.max(0, dist - 2);
  const startPad = Math.min(ar, maxTrim * 0.45);
  const endPad = Math.min(br + tipGap, maxTrim * 0.45);
  return {
    x1: ax + ux * startPad,
    y1: ay + uy * startPad,
    x2: bx - ux * endPad,
    y2: by - uy * endPad,
  };
}
