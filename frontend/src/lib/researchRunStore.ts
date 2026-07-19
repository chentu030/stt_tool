/**
 * In-memory store for mid-run deep research guidance (single-instance / warm serverless).
 * Client POSTs guidance by runId; the hunt loop drains between questions.
 */

export type ResearchRunState = {
  guidance: string[];
  createdAt: number;
  updatedAt: number;
};

const runs = new Map<string, ResearchRunState>();
const TTL_MS = 20 * 60 * 1000;

function gc() {
  const now = Date.now();
  for (const [id, s] of runs) {
    if (now - s.updatedAt > TTL_MS) runs.delete(id);
  }
}

export function createResearchRunId(): string {
  gc();
  return `rr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function ensureResearchRun(runId: string) {
  if (!runs.has(runId)) {
    runs.set(runId, { guidance: [], createdAt: Date.now(), updatedAt: Date.now() });
  }
}

export function pushResearchGuidance(runId: string, text: string): boolean {
  gc();
  const t = text.trim().slice(0, 2000);
  if (!t || !runId) return false;
  ensureResearchRun(runId);
  const s = runs.get(runId)!;
  s.guidance.push(t);
  s.updatedAt = Date.now();
  return true;
}

export function drainResearchGuidance(runId: string): string[] {
  const s = runs.get(runId);
  if (!s?.guidance.length) return [];
  const out = [...s.guidance];
  s.guidance = [];
  s.updatedAt = Date.now();
  return out;
}

export function endResearchRun(runId: string) {
  runs.delete(runId);
}
