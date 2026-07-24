/**
 * Continuous force-directed simulation (Obsidian-like):
 * many-body repulsion, link springs, light center gravity,
 * collision, plus inter-component separation so unrelated clusters don't stack.
 */

export type ForceSimNode = {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Collision / visual radius */
  r: number;
  /** When set, node is pinned (dragging) */
  fx: number | null;
  fy: number | null;
};

export type ForceSimEdge = {
  source: string;
  target: string;
  /** Rest length */
  distance: number;
  /** Spring strength */
  strength: number;
  /** When true, edge joins a "strong" community (wiki). Used for cluster separation. */
  strong?: boolean;
};

export type ForceSimOpts = {
  centerX?: number;
  centerY?: number;
  /** Negative = repulsion */
  charge?: number;
  centerStrength?: number;
  collidePadding?: number;
  velocityDecay?: number;
  alphaDecay?: number;
  alphaMin?: number;
  /** Min distance between wiki-component centroids */
  componentGap?: number;
  /** How hard to push unrelated components apart */
  componentStrength?: number;
};

export class GraphForceSim {
  nodes: ForceSimNode[] = [];
  byId = new Map<string, ForceSimNode>();
  edges: ForceSimEdge[] = [];
  /** nodeId → component index (wiki / strong edges only) */
  componentOf = new Map<string, number>();
  componentCount = 0;
  alpha = 0;
  alphaTarget = 0;
  alphaMin: number;
  alphaDecay: number;
  velocityDecay: number;
  charge: number;
  centerStrength: number;
  collidePadding: number;
  componentGap: number;
  componentStrength: number;
  centerX: number;
  centerY: number;

  constructor(opts: ForceSimOpts = {}) {
    this.centerX = opts.centerX ?? 700;
    this.centerY = opts.centerY ?? 450;
    this.charge = opts.charge ?? -1100;
    this.centerStrength = opts.centerStrength ?? 0.014;
    this.collidePadding = opts.collidePadding ?? 22;
    this.velocityDecay = opts.velocityDecay ?? 0.52;
    this.alphaDecay = opts.alphaDecay ?? 0.022;
    this.alphaMin = opts.alphaMin ?? 0.0012;
    this.componentGap = opts.componentGap ?? 220;
    this.componentStrength = opts.componentStrength ?? 0.07;
  }

  setCenter(x: number, y: number) {
    this.centerX = x;
    this.centerY = y;
  }

  /** Replace graph structure; keeps velocity when id already exists. */
  setGraph(
    nodes: { id: string; x: number; y: number; r: number }[],
    edges: {
      source: string;
      target: string;
      distance?: number;
      strength?: number;
      strong?: boolean;
    }[]
  ) {
    const prev = this.byId;
    const next: ForceSimNode[] = nodes.map((n) => {
      const old = prev.get(n.id);
      if (old) {
        old.r = n.r;
        // Keep position/velocity unless brand-new placement (0,0 from builder)
        if (n.x !== 0 || n.y !== 0) {
          if (!Number.isFinite(old.x) || (old.x === 0 && old.y === 0)) {
            old.x = n.x;
            old.y = n.y;
          }
        }
        return old;
      }
      return {
        id: n.id,
        x: n.x,
        y: n.y,
        vx: 0,
        vy: 0,
        r: n.r,
        fx: null,
        fy: null,
      };
    });
    this.nodes = next;
    this.byId = new Map(next.map((n) => [n.id, n]));
    this.edges = edges
      .filter((e) => this.byId.has(e.source) && this.byId.has(e.target) && e.source !== e.target)
      .map((e) => ({
        source: e.source,
        target: e.target,
        distance: e.distance ?? 100,
        strength: e.strength ?? 0.6,
        strong: e.strong !== false && (e.strong === true || (e.strength ?? 0.6) >= 0.55),
      }));
    this.rebuildComponents();
  }

  /** Connected components from strong (wiki) edges only — tag/folder don't glue clusters. */
  rebuildComponents() {
    const parent = new Map<string, string>();
    const find = (id: string): string => {
      let p = parent.get(id) || id;
      while (p !== (parent.get(p) || p)) p = parent.get(p) || p;
      parent.set(id, p);
      return p;
    };
    const union = (a: string, b: string) => {
      const ra = find(a);
      const rb = find(b);
      if (ra !== rb) parent.set(ra, rb);
    };
    for (const n of this.nodes) parent.set(n.id, n.id);
    for (const e of this.edges) {
      if (!e.strong) continue;
      union(e.source, e.target);
    }
    const rootIndex = new Map<string, number>();
    this.componentOf = new Map();
    let count = 0;
    for (const n of this.nodes) {
      const root = find(n.id);
      let idx = rootIndex.get(root);
      if (idx == null) {
        idx = count++;
        rootIndex.set(root, idx);
      }
      this.componentOf.set(n.id, idx);
    }
    this.componentCount = count;
  }

  /**
   * Spread component seeds on a ring (call after setGraph when structure is new).
   * Helps unrelated groups start apart instead of collapsing into one ball.
   */
  seedComponentsApart(radius = 260) {
    if (this.componentCount <= 1) return;
    const buckets = new Map<number, ForceSimNode[]>();
    for (const n of this.nodes) {
      const c = this.componentOf.get(n.id) ?? 0;
      if (!buckets.has(c)) buckets.set(c, []);
      buckets.get(c)!.push(n);
    }
    const keys = [...buckets.keys()];
    keys.forEach((ci, i) => {
      const angle = (i / keys.length) * Math.PI * 2;
      const ox = this.centerX + Math.cos(angle) * radius;
      const oy = this.centerY + Math.sin(angle) * radius;
      const group = buckets.get(ci)!;
      // Only nudge groups that are still piled near the global center
      let cx = 0;
      let cy = 0;
      for (const n of group) {
        cx += n.x;
        cy += n.y;
      }
      cx /= group.length;
      cy /= group.length;
      const distCenter = Math.hypot(cx - this.centerX, cy - this.centerY);
      if (distCenter > radius * 0.45) return;
      const dx = ox - cx;
      const dy = oy - cy;
      for (const n of group) {
        if (n.fx != null) continue;
        n.x += dx;
        n.y += dy;
        n.vx = 0;
        n.vy = 0;
      }
    });
  }

  reheat(level = 0.45) {
    this.alpha = Math.max(this.alpha, level);
    this.alphaTarget = 0;
  }

  pin(id: string, x: number, y: number) {
    const n = this.byId.get(id);
    if (!n) return;
    n.fx = x;
    n.fy = y;
    n.x = x;
    n.y = y;
    n.vx = 0;
    n.vy = 0;
  }

  unpin(id: string) {
    const n = this.byId.get(id);
    if (!n) return;
    n.fx = null;
    n.fy = null;
  }

  isActive() {
    return this.alpha >= this.alphaMin;
  }

  /**
   * One simulation step. Returns true if still animating.
   */
  tick(): boolean {
    // Ease alpha toward target (0)
    this.alpha += (this.alphaTarget - this.alpha) * this.alphaDecay;
    if (this.alpha < this.alphaMin) {
      this.alpha = 0;
      // Still apply pins
      for (const n of this.nodes) {
        if (n.fx != null) {
          n.x = n.fx;
          n.y = n.fy ?? n.y;
          n.vx = 0;
          n.vy = 0;
        }
      }
      return false;
    }

    const {
      nodes,
      edges,
      alpha,
      charge,
      centerX,
      centerY,
      centerStrength,
      collidePadding,
      componentGap,
      componentStrength,
    } = this;
    const N = nodes.length;

    // Many-body repulsion (charge)
    for (let i = 0; i < N; i++) {
      const a = nodes[i];
      for (let j = i + 1; j < N; j++) {
        const b = nodes[j];
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let dist2 = dx * dx + dy * dy;
        if (dist2 < 0.01) {
          dx = (Math.random() - 0.5) * 0.5;
          dy = (Math.random() - 0.5) * 0.5;
          dist2 = dx * dx + dy * dy;
        }
        const dist = Math.sqrt(dist2);
        // Soften extreme close-range forces
        const force = (charge * alpha) / Math.max(dist2, 36);
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        a.vx += fx;
        a.vy += fy;
        b.vx -= fx;
        b.vy -= fy;
      }
    }

    // Link springs
    for (const e of edges) {
      const a = this.byId.get(e.source);
      const b = this.byId.get(e.target);
      if (!a || !b) continue;
      let dx = b.x - a.x;
      let dy = b.y - a.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 0.01;
      const ideal = e.distance;
      const force = ((dist - ideal) / dist) * e.strength * alpha;
      const fx = dx * force;
      const fy = dy * force;
      a.vx += fx;
      a.vy += fy;
      b.vx -= fx;
      b.vy -= fy;
    }

    // Inter-component separation (wiki communities) — keep unrelated groups from stacking
    if (this.componentCount > 1 && componentStrength > 0) {
      type Acc = { x: number; y: number; n: number; members: ForceSimNode[] };
      const cents: Acc[] = Array.from({ length: this.componentCount }, () => ({
        x: 0,
        y: 0,
        n: 0,
        members: [],
      }));
      for (const node of nodes) {
        const ci = this.componentOf.get(node.id) ?? 0;
        const c = cents[ci];
        c.x += node.x;
        c.y += node.y;
        c.n += 1;
        c.members.push(node);
      }
      for (const c of cents) {
        if (c.n > 0) {
          c.x /= c.n;
          c.y /= c.n;
        }
      }
      for (let i = 0; i < cents.length; i++) {
        const A = cents[i];
        if (!A.n) continue;
        for (let j = i + 1; j < cents.length; j++) {
          const B = cents[j];
          if (!B.n) continue;
          let dx = B.x - A.x;
          let dy = B.y - A.y;
          let dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < 1) {
            dx = (Math.random() - 0.5) * 2;
            dy = (Math.random() - 0.5) * 2;
            dist = Math.sqrt(dx * dx + dy * dy) || 1;
          }
          const minGap = componentGap + 18 * (Math.sqrt(A.n) + Math.sqrt(B.n));
          if (dist >= minGap) continue;
          const push = ((minGap - dist) / dist) * componentStrength * alpha;
          const fx = dx * push;
          const fy = dy * push;
          for (const n of A.members) {
            if (n.fx != null) continue;
            n.vx -= fx;
            n.vy -= fy;
          }
          for (const n of B.members) {
            if (n.fx != null) continue;
            n.vx += fx;
            n.vy += fy;
          }
        }
      }
    }

    // Light center gravity — just enough to keep the canvas from drifting forever
    for (const n of nodes) {
      n.vx += (centerX - n.x) * centerStrength * alpha;
      n.vy += (centerY - n.y) * centerStrength * alpha;
    }

    // Collision (hard separation so nodes don't overlap)
    for (let i = 0; i < N; i++) {
      const a = nodes[i];
      for (let j = i + 1; j < N; j++) {
        const b = nodes[j];
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let dist = Math.sqrt(dx * dx + dy * dy) || 0.01;
        const minDist = a.r + b.r + collidePadding;
        if (dist < minDist) {
          const overlap = (minDist - dist) / dist;
          const fx = dx * overlap * 0.55 * alpha;
          const fy = dy * overlap * 0.55 * alpha;
          a.vx -= fx;
          a.vy -= fy;
          b.vx += fx;
          b.vy += fy;
        }
      }
    }

    // Integrate
    const decay = this.velocityDecay;
    for (const n of nodes) {
      if (n.fx != null) {
        n.x = n.fx;
        n.y = n.fy ?? n.y;
        n.vx = 0;
        n.vy = 0;
        continue;
      }
      n.vx *= decay;
      n.vy *= decay;
      n.x += n.vx;
      n.y += n.vy;
    }

    return true;
  }
}
