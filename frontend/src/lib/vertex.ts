/**
 * Vertex AI Gemini client (Vercel server-only).
 * Uses aiplatform.googleapis.com — never generativelanguage.googleapis.com.
 *
 * Vercel env:
 *   VERTEX_API_KEYS=key1,key2,key3   (comma/newline separated, 3-key rotate)
 *   VERTEX_MODEL=gemini-3-flash-preview
 *   VERTEX_LOCATION=global
 *   VERTEX_PROJECT_ID=your-gcp-project   (optional; enables project-scoped URL)
 */

const DEFAULT_MODEL = "gemini-3-flash-preview";
const DEFAULT_LOCATION = "global";

let rotateIndex = 0;

function getKeys(): string[] {
  const raw = process.env.VERTEX_API_KEYS || "";
  return raw
    .split(/[\n,]+/)
    .map((k) => k.trim())
    .filter(Boolean);
}

function endpoint(model: string): string {
  const location = process.env.VERTEX_LOCATION || DEFAULT_LOCATION;
  const project = process.env.VERTEX_PROJECT_ID?.trim();
  if (project) {
    return `https://aiplatform.googleapis.com/v1/projects/${project}/locations/${location}/publishers/google/models/${model}:generateContent`;
  }
  // Express / API-key friendly publisher path on Vertex host
  return `https://aiplatform.googleapis.com/v1/publishers/google/models/${model}:generateContent`;
}

export type VertexGenerateResult = {
  text: string;
  model: string;
  keyIndex: number;
};

export type VertexChatMessage = {
  role: "user" | "model";
  text: string;
};

export async function vertexGenerateContent(prompt: string, opts?: {
  system?: string;
  temperature?: number;
  maxOutputTokens?: number;
  /** Multi-turn history before the current `prompt` (user turn). */
  history?: VertexChatMessage[];
}): Promise<VertexGenerateResult> {
  const keys = getKeys();
  if (!keys.length) {
    throw new Error("VERTEX_API_KEYS 未設定（請在 Vercel 環境變數加入逗號分隔的 3 組金鑰）");
  }

  const model = process.env.VERTEX_MODEL || DEFAULT_MODEL;
  const url = endpoint(model);
  const history = (opts?.history || [])
    .filter((m) => m.text?.trim())
    .map((m) => ({
      role: m.role === "model" ? "model" : "user",
      parts: [{ text: m.text.trim() }],
    }));

  const body = {
    contents: [
      ...history,
      {
        role: "user",
        parts: [{ text: prompt }],
      },
    ],
    ...(opts?.system
      ? { systemInstruction: { parts: [{ text: opts.system }] } }
      : {}),
    generationConfig: {
      temperature: opts?.temperature ?? 0.7,
      maxOutputTokens: opts?.maxOutputTokens ?? 4096,
    },
  };

  let lastError = "unknown";
  const start = rotateIndex;

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

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        lastError = data?.error?.message || `${res.status} ${res.statusText}`;
        // rotate on quota / auth / rate limit
        if ([401, 403, 429, 500, 503].includes(res.status)) continue;
        throw new Error(lastError);
      }

      const text =
        data?.candidates?.[0]?.content?.parts
          ?.map((p: { text?: string }) => p.text || "")
          .join("")
          ?.trim() || "";

      if (!text) {
        lastError = "模型未回傳文字";
        continue;
      }

      return { text, model, keyIndex };
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
    }
  }

  throw new Error(`Vertex AI 全部金鑰嘗試失敗：${lastError}`);
}

/** Exposed for health checks — does not leak key values */
export function vertexConfigStatus() {
  const keys = getKeys();
  return {
    configured: keys.length > 0,
    keyCount: keys.length,
    model: process.env.VERTEX_MODEL || DEFAULT_MODEL,
    location: process.env.VERTEX_LOCATION || DEFAULT_LOCATION,
    project: process.env.VERTEX_PROJECT_ID || null,
    host: "aiplatform.googleapis.com",
  };
}
