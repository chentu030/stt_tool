/**
 * Vertex AI Gemini client (Vercel server-only).
 * Uses aiplatform.googleapis.com — never generativelanguage.googleapis.com.
 *
 * Vercel env:
 *   VERTEX_API_KEYS=key1,key2,key3   (comma/newline separated, 3-key rotate)
 *   VERTEX_MODEL=gemini-3.5-flash
 *   VERTEX_IMAGE_MODEL=gemini-3-pro-image   (optional; AI /create-photo)
 *   VERTEX_LOCATION=global
 *   VERTEX_PROJECT_ID=your-gcp-project   (optional; enables project-scoped URL)
 */

const DEFAULT_MODEL = "gemini-3.5-flash";
const DEFAULT_LOCATION = "global";

let rotateIndex = 0;

function getKeys(): string[] {
  const raw = process.env.VERTEX_API_KEYS || "";
  return raw
    .split(/[\n,]+/)
    .map((k) => k.trim())
    .filter(Boolean);
}

/** Exported for vocab AI proxy and other server routes. */
export function getVertexApiKeys(): string[] {
  return getKeys();
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

export type VertexGroundingSource = {
  title: string;
  uri: string;
};

export type VertexGenerateResult = {
  text: string;
  model: string;
  keyIndex: number;
  /** Present when Google Search grounding was used */
  groundingUsed?: boolean;
  sources?: VertexGroundingSource[];
  searchQueries?: string[];
};

export type VertexChatMessage = {
  role: "user" | "model";
  text: string;
};

export type VertexImageResult = {
  mimeType: string;
  /** Raw base64 (no data: prefix) */
  data: string;
  caption?: string;
  model: string;
  keyIndex: number;
};

const DEFAULT_IMAGE_MODEL = "gemini-3-pro-image";

function parseGroundingMetadata(data: unknown): {
  groundingUsed: boolean;
  sources: VertexGroundingSource[];
  searchQueries: string[];
} {
  const meta = (data as {
    candidates?: Array<{
      groundingMetadata?: {
        webSearchQueries?: string[];
        groundingChunks?: Array<{ web?: { uri?: string; title?: string } }>;
      };
    }>;
  })?.candidates?.[0]?.groundingMetadata;

  if (!meta) {
    return { groundingUsed: false, sources: [], searchQueries: [] };
  }

  const searchQueries = (meta.webSearchQueries || []).filter(Boolean);
  const seen = new Set<string>();
  const sources: VertexGroundingSource[] = [];
  for (const chunk of meta.groundingChunks || []) {
    const uri = chunk.web?.uri?.trim();
    if (!uri || seen.has(uri)) continue;
    seen.add(uri);
    sources.push({
      title: (chunk.web?.title || uri).trim(),
      uri,
    });
  }

  return {
    groundingUsed: searchQueries.length > 0 || sources.length > 0,
    sources,
    searchQueries,
  };
}

export async function vertexGenerateContent(prompt: string, opts?: {
  system?: string;
  temperature?: number;
  maxOutputTokens?: number;
  /** Multi-turn history before the current `prompt` (user turn). */
  history?: VertexChatMessage[];
  /** Override Vertex model id (e.g. gemini-3.5-flash). */
  model?: string;
  /** Enable Grounding with Google Search (model may search the web). */
  grounding?: boolean;
  /** Abort in-flight Vertex fetch (client cancel / disconnect). */
  signal?: AbortSignal;
}): Promise<VertexGenerateResult> {
  const keys = getKeys();
  if (!keys.length) {
    throw new Error("VERTEX_API_KEYS 未設定（請在 Vercel 環境變數加入逗號分隔的 3 組金鑰）");
  }

  const model = (opts?.model || process.env.VERTEX_MODEL || DEFAULT_MODEL).trim();
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
    ...(opts?.grounding
      ? { tools: [{ googleSearch: {} }] }
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
        signal: opts?.signal,
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

      const grounding = parseGroundingMetadata(data);
      return {
        text,
        model,
        keyIndex,
        groundingUsed: grounding.groundingUsed,
        sources: grounding.sources.length ? grounding.sources : undefined,
        searchQueries: grounding.searchQueries.length
          ? grounding.searchQueries
          : undefined,
      };
    } catch (e) {
      if (opts?.signal?.aborted || (e instanceof Error && e.name === "AbortError")) {
        throw e instanceof Error ? e : new Error("ABORTED");
      }
      lastError = e instanceof Error ? e.message : String(e);
    }
  }

  if (opts?.signal?.aborted) {
    const err = new Error("ABORTED");
    err.name = "AbortError";
    throw err;
  }
  throw new Error(`Vertex AI 全部金鑰嘗試失敗：${lastError}`);
}

/** Generate an image with gemini-3-pro-image (Nano Banana Pro). */
export async function vertexGenerateImage(
  prompt: string,
  opts?: { aspectRatio?: string }
): Promise<VertexImageResult> {
  const keys = getKeys();
  if (!keys.length) {
    throw new Error("VERTEX_API_KEYS 未設定（請在 Vercel 環境變數加入逗號分隔的 3 組金鑰）");
  }

  const model = process.env.VERTEX_IMAGE_MODEL || DEFAULT_IMAGE_MODEL;
  const url = endpoint(model);
  const aspectRatio = opts?.aspectRatio || "1:1";
  const body = {
    contents: [
      {
        role: "user",
        parts: [{ text: prompt.trim() }],
      },
    ],
    generationConfig: {
      responseModalities: ["TEXT", "IMAGE"],
      imageConfig: {
        aspectRatio,
      },
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
        if ([401, 403, 429, 500, 503].includes(res.status)) continue;
        throw new Error(lastError);
      }

      const parts: Array<{
        text?: string;
        inlineData?: { mimeType?: string; data?: string };
        inline_data?: { mime_type?: string; data?: string };
      }> = data?.candidates?.[0]?.content?.parts || [];

      let caption = "";
      let mimeType = "";
      let b64 = "";

      for (const part of parts) {
        if (part.text) caption += part.text;
        const inline = part.inlineData
          ? { mimeType: part.inlineData.mimeType, data: part.inlineData.data }
          : part.inline_data
            ? { mimeType: part.inline_data.mime_type, data: part.inline_data.data }
            : null;
        if (inline?.data) {
          b64 = inline.data;
          mimeType = inline.mimeType || "image/png";
        }
      }

      if (!b64) {
        lastError = data?.candidates?.[0]?.finishReason
          ? `未產出圖片（${data.candidates[0].finishReason}）`
          : "模型未回傳圖片";
        continue;
      }

      return {
        mimeType,
        data: b64,
        caption: caption.trim() || undefined,
        model,
        keyIndex,
      };
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
    }
  }

  throw new Error(`圖片生成失敗：${lastError}`);
}

/** Exposed for health checks — does not leak key values */
export function vertexConfigStatus() {
  const keys = getKeys();
  return {
    configured: keys.length > 0,
    keyCount: keys.length,
    model: process.env.VERTEX_MODEL || DEFAULT_MODEL,
    imageModel: process.env.VERTEX_IMAGE_MODEL || DEFAULT_IMAGE_MODEL,
    location: process.env.VERTEX_LOCATION || DEFAULT_LOCATION,
    project: process.env.VERTEX_PROJECT_ID || null,
    host: "aiplatform.googleapis.com",
  };
}
