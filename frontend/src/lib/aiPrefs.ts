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
  const name = (prefs?.name || "Cadence AI").trim() || "Cadence AI";
  const style = prefs?.style || "balanced";
  const styleLine =
    style === "concise"
      ? "回答精簡：少廢話、條列優先。"
      : style === "detailed"
        ? "回答可較完整：補背景、例子與下一步。"
        : "回答清楚平衡：重點明確、適度細節。";
  return `你是「${name}」，Cadence 知識工作助手。${styleLine}使用繁體中文。`;
}

/** Payload fragment for /api/ai/generate from user prefs */
export function assistantPayloadFromPrefs(prefs?: {
  aiAssistantName?: string;
  aiStyle?: AiStyle;
  aiModel?: string;
} | null): AiPrefPayload {
  return {
    name: prefs?.aiAssistantName,
    style: prefs?.aiStyle,
    model: prefs?.aiModel,
  };
}
