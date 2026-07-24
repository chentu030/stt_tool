/**
 * Vertex text embeddings (server-only) — mirrors vertex.ts auth/host rules.
 * Model: text-multilingual-embedding-002 @ 768-d (CJK-friendly).
 */

const DEFAULT_EMBED_MODEL = "text-multilingual-embedding-002";
export const EMBEDDING_DIM = 768;

let rotateIndex = 0;

function getKeys(): string[] {
  const raw = process.env.VERTEX_API_KEYS || "";
  return raw
    .split(/[\n,]+/)
    .map((k) => k.trim())
    .filter(Boolean);
}

export function embeddingModelId(): string {
  return (process.env.VERTEX_EMBEDDING_MODEL || DEFAULT_EMBED_MODEL).trim();
}

function predictUrl(model: string): string {
  const location = (process.env.VERTEX_LOCATION || "us-central1").trim();
  const project = process.env.VERTEX_PROJECT_ID?.trim();
  if (project) {
    const loc = location === "global" ? "us-central1" : location;
    return `https://${loc}-aiplatform.googleapis.com/v1/projects/${project}/locations/${loc}/publishers/google/models/${model}:predict`;
  }
  return `https://aiplatform.googleapis.com/v1/publishers/google/models/${model}:predict`;
}

function parsePrediction(p: Record<string, unknown>): number[] {
  const emb = p.embeddings ?? p.values;
  let values: unknown = emb;
  if (emb && typeof emb === "object" && !Array.isArray(emb)) {
    values = (emb as { values?: unknown }).values;
  }
  if (!Array.isArray(values)) {
    throw new Error("embedding 回應格式異常");
  }
  const nums = values.map((x) => Number(x));
  if (nums.length !== EMBEDDING_DIM || nums.some((n) => !Number.isFinite(n))) {
    throw new Error(`embedding 維度異常（${nums.length}，預期 ${EMBEDDING_DIM}）`);
  }
  return nums;
}

/** Embed up to 5 texts per call (Vertex batch limit). */
export async function vertexEmbedTexts(
  texts: string[],
  opts?: { taskType?: string }
): Promise<number[][]> {
  const keys = getKeys();
  if (!keys.length) {
    throw new Error("VERTEX_API_KEYS 未設定");
  }
  const cleaned = texts.map((t) => t.trim().slice(0, 6000)).filter(Boolean);
  if (!cleaned.length) return [];

  const model = embeddingModelId();
  const url = predictUrl(model);
  const taskType = opts?.taskType || "RETRIEVAL_DOCUMENT";
  const out: number[][] = [];

  for (let i = 0; i < cleaned.length; i += 5) {
    const batch = cleaned.slice(i, i + 5);
    const body = {
      instances: batch.map((content) => ({ content, task_type: taskType })),
      parameters: { outputDimensionality: EMBEDDING_DIM },
    };

    let lastError = "unknown";
    const start = rotateIndex;
    let ok = false;

    for (let attempt = 0; attempt < keys.length; attempt++) {
      const keyIndex = (start + attempt) % keys.length;
      const apiKey = keys[keyIndex];
      rotateIndex = (keyIndex + 1) % keys.length;

      try {
        const res = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": apiKey,
          },
          body: JSON.stringify(body),
        });
        const data = (await res.json().catch(() => ({}))) as {
          error?: { message?: string };
          predictions?: Array<Record<string, unknown>>;
        };
        if (!res.ok) {
          lastError = data?.error?.message || `${res.status} ${res.statusText}`;
          if ([401, 403, 429, 500, 503].includes(res.status)) continue;
          throw new Error(lastError);
        }
        const preds = data.predictions || [];
        if (preds.length !== batch.length) {
          lastError = `embedding 筆數不符（${preds.length}/${batch.length}）`;
          continue;
        }
        for (const p of preds) out.push(parsePrediction(p));
        ok = true;
        break;
      } catch (e) {
        lastError = e instanceof Error ? e.message : String(e);
      }
    }

    if (!ok) {
      throw new Error(`Vertex embedding 失敗：${lastError}`);
    }
  }

  return out;
}
