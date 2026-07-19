/** Shared Cadence AI preference helpers for API payloads */

export type AiPrefPayload = {
  name?: string;
  style?: "concise" | "balanced" | "detailed";
};

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
