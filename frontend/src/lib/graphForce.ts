/**
 * Continuous force-directed simulation (Obsidian-like):
 * many-body repulsion, link springs, center gravity, collision.
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
};

export class GraphForceSim {
  nodes: ForceSimNode[] = [];
  byId = new Map<string, ForceSimNode>();
  edges: ForceSimEdge[] = [];
  alpha = 0;
  alphaTarget = 0;
  alphaMin: number;
  alphaDecay: number;
  velocityDecay: number;
  charge: number;
  centerStrength: number;
  collidePadding: number;
  centerX: number;
  centerY: number;

  constructor(opts: ForceSimOpts = {}) {
    this.centerX = opts.centerX ?? 700;
    this.centerY = opts.centerY ?? 450;
    this.charge = opts.charge ?? -520;
    this.centerStrength = opts.centerStrength ?? 0.06;
    this.collidePadding = opts.collidePadding ?? 10;
    this.velocityDecay = opts.velocityDecay ?? 0.55;
    this.alphaDecay = opts.alphaDecay ?? 0.028;
    this.alphaMin = opts.alphaMin ?? 0.0015;
  }

  setCenter(x: number, y: number) {
    this.centerX = x;
    this.centerY = y;
  }

  /** Replace graph structure; keeps velocity when id already exists. */
  setGraph(
    nodes: { id: string; x: number; y: number; r: number }[],
    edges: { source: string; target: string; distance?: number; strength?: number }[]
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
      }));
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

    const { nodes, edges, alpha, charge, centerX, centerY, centerStrength, collidePadding } =
      this;
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
        const force = (charge * alpha) / Math.max(dist2, 25);
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

    // Center gravity → ball cluster
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
