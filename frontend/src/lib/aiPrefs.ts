/** Cadence Gemini text-model catalog + prompt helpers */

export type AiStyle = "concise" | "balanced" | "detailed";

export type AiTextModelId =
  | "gemini-3.5-flash"
  | "gemini-3.1-flash-lite"
  | "gemini-3.1-pro-preview"
  | "gemini-3-flash-preview";

export type AiPrefPayload = {
  name?: string;
  style?: AiStyle;
  model?: string;
  /** Grounding with Google Search */
  grounding?: boolean;
};

export const AI_TEXT_MODELS: {
  id: AiTextModelId;
  label: string;
  hint: string;
}[] = [
  {
    id: "gemini-3.5-flash",
    label: "Gemini 3.5 Flash",
    hint: "快速、智能（建議）",
  },
  {
    id: "gemini-3.1-flash-lite",
    label: "Gemini 3.1 Flash-Lite",
    hint: "最輕量、高吞吐",
  },
  {
    id: "gemini-3.1-pro-preview",
    label: "Gemini 3.1 Pro",
    hint: "深度推理、複雜任務",
  },
  {
    id: "gemini-3-flash-preview",
    label: "Gemini 3 Flash",
    hint: "舊版預覽",
  },
];

const MODEL_IDS = new Set(AI_TEXT_MODELS.map((m) => m.id));

export function isAiTextModelId(id: string | undefined | null): id is AiTextModelId {
  return !!id && MODEL_IDS.has(id as AiTextModelId);
}

/** Resolve a safe Vertex model id for text generation */
export function resolveAiTextModel(preferred?: string | null): string {
  if (isAiTextModelId(preferred)) return preferred;
  const env = process.env.VERTEX_MODEL?.trim();
  if (env && isAiTextModelId(env)) return env;
  if (env) return env; // allow custom env override not in catalog
  return "gemini-3.5-flash";
}

export function assistantSystemPrefix(prefs?: AiPrefPayload | null): string {
  const name = (prefs?.name || "Albireus AI").trim() || "Albireus AI";
  const style = prefs?.style || "balanced";
  const styleLine =
    style === "concise"
      ? "回答精簡：少廢話、條列優先。"
      : style === "detailed"
        ? "回答可較完整：補背景、例子與下一步。"
        : "回答清楚平衡：重點明確、適度細節。";
  const groundingLine = prefs?.grounding
    ? "已啟用 Google 搜尋 grounding：需要最新資訊或事實查證時請上網查詢，並在回答中標明依據。"
    : "";
  return `你是「${name}」，Albireus 知識工作助手。${styleLine}${groundingLine}使用繁體中文。`;
}

/** Payload fragment for /api/ai/generate from user prefs */
export function assistantPayloadFromPrefs(prefs?: {
  aiAssistantName?: string;
  aiStyle?: AiStyle;
  aiModel?: string;
  aiGrounding?: boolean;
} | null): AiPrefPayload {
  return {
    name: prefs?.aiAssistantName,
    style: prefs?.aiStyle,
    model: prefs?.aiModel,
    grounding: !!prefs?.aiGrounding,
  };
}

/** Append web sources to assistant text when grounding was used.
 * Use short markdown links — never dump Vertex redirect URLs into the body. */
export function appendGroundingSources(
  text: string,
  sources?: Array<{ title?: string; uri?: string }> | null
): string {
  if (!sources?.length) return text;
  const lines = sources
    .map((s, i) => {
      const uri = (s.uri || "").trim();
      const rawTitle = (s.title || "").trim();
      const label = groundingSourceLabel(rawTitle, uri);
      if (!label && !uri) return null;
      if (uri) return `${i + 1}. [${label}](${uri})`;
      return `${i + 1}. ${label}`;
    })
    .filter(Boolean);
  if (!lines.length) return text;
  return `${text.trim()}\n\n—— 網路來源 ——\n${lines.join("\n")}`;
}

/** Prefer a short human label (domain / title), never a raw redirect URL. */
export function groundingSourceLabel(title?: string, uri?: string): string {
  const t = (title || "").trim();
  const u = (uri || "").trim();
  if (t && !looksLikeRawUrl(t) && !isVertexGroundingRedirect(t)) {
    // Title is sometimes just the hostname already (e.g. ettoday.net)
    return t.length > 60 ? `${t.slice(0, 57)}…` : t;
  }
  const host = hostnameFromUrl(u) || hostnameFromUrl(t);
  if (host) return host;
  if (isVertexGroundingRedirect(u) || isVertexGroundingRedirect(t)) return "網頁來源";
  return t || u || "來源";
}

function looksLikeRawUrl(s: string): boolean {
  return /^https?:\/\//i.test(s) || s.length > 120;
}

export function isVertexGroundingRedirect(s: string): boolean {
  return /vertexaisearch\.cloud\.google\.com\/grounding-api-redirect/i.test(s);
}

function hostnameFromUrl(s: string): string | null {
  if (!s) return null;
  try {
    const host = new URL(s).hostname.replace(/^www\./, "");
    if (!host || host.includes("vertexaisearch.cloud.google.com")) return null;
    return host;
  } catch {
    // Bare hostname like "ettoday.net"
    if (/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(s) && !s.includes("/")) return s.replace(/^www\./, "");
    return null;
  }
}

/**
 * Compact long grounding URLs already stored in chat markdown
 * (older messages / plain-text dumps).
 */
export function compactGroundingSourcesInText(text: string): string {
  if (!text?.includes("—— 網路來源 ——") && !isVertexGroundingRedirect(text)) {
    return text;
  }
  let out = text;
  // "1. title — https://…" or "1. https://…"
  out = out.replace(
    /^(\s*\d+\.\s+)(.+)$/gm,
    (full, prefix: string, rest: string) => {
      const m = rest.match(/^(.*?)\s+[—–-]\s+(https?:\/\/\S+)\s*$/);
      if (m) {
        const label = groundingSourceLabel(m[1].trim(), m[2].trim());
        return `${prefix}[${label}](${m[2].trim()})`;
      }
      const onlyUrl = rest.trim().match(/^(https?:\/\/\S+)$/);
      if (onlyUrl) {
        const label = groundingSourceLabel("", onlyUrl[1]);
        return `${prefix}[${label}](${onlyUrl[1]})`;
      }
      return full;
    }
  );
  // Any remaining bare Vertex redirect URLs
  out = out.replace(
    /(?<!\]\()https:\/\/vertexaisearch\.cloud\.google\.com\/grounding-api-redirect\/[A-Za-z0-9_\-]+/g,
    (url) => `[網頁來源](${url})`
  );
  return out;
}
