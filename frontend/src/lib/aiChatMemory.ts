/** Rolling conversation memory for the AI rail: summarize every 15 turns, then send summary + last 5. */

export type ChatTurn = {
  role: "user" | "assistant";
  text: string;
};

export const AI_CHAT_SUMMARY_EVERY = 15;
export const AI_CHAT_HOT_TURNS = 5;

export type ChatMemoryState = {
  /** Condensed prior conversation */
  contextSummary: string;
  /** How many messages (from the start) are already folded into contextSummary */
  summaryCovered: number;
};

export function shouldRefreshChatSummary(
  msgCount: number,
  memory: ChatMemoryState | null | undefined
): boolean {
  const covered = memory?.summaryCovered ?? 0;
  const summary = (memory?.contextSummary || "").trim();
  if (!summary && msgCount >= AI_CHAT_SUMMARY_EVERY) return true;
  if (summary && msgCount - covered >= AI_CHAT_SUMMARY_EVERY) return true;
  return false;
}

/** Next slice of messages to fold into the summary. */
export function nextSummaryBatch<T extends ChatTurn>(
  msgs: T[],
  memory: ChatMemoryState | null | undefined
): { batch: T[]; nextCovered: number } | null {
  if (!shouldRefreshChatSummary(msgs.length, memory)) return null;
  const covered = memory?.summaryCovered ?? 0;
  const end = Math.min(msgs.length, covered + AI_CHAT_SUMMARY_EVERY);
  if (end <= covered) return null;
  return {
    batch: msgs.slice(covered, end),
    nextCovered: end,
  };
}

/** History turns to send to the model (excludes the current last user prompt). */
export function buildChatApiHistory(
  msgs: ChatTurn[],
  memory: ChatMemoryState | null | undefined
): Array<{ role: "user" | "model"; text: string }> {
  const summary = (memory?.contextSummary || "").trim();
  const hotLimit = summary ? AI_CHAT_HOT_TURNS : AI_CHAT_SUMMARY_EVERY - 1;
  const hot = msgs.slice(-Math.max(hotLimit, 1));
  // Drop the latest user turn — it is sent as `prompt`
  const prior = hot.slice(0, -1);
  const mapped = prior.map((m) => ({
    role: (m.role === "assistant" ? "model" : "user") as "user" | "model",
    text: m.text,
  }));
  return mapped;
}

/** Inject rolling summary into the context block (keeps Vertex history roles clean). */
export function withChatSummaryContext(
  context: string | undefined,
  memory: ChatMemoryState | null | undefined
): string | undefined {
  const summary = (memory?.contextSummary || "").trim();
  if (!summary) return context;
  const block = `【先前對話摘要】\n${summary}\n（請接續此摘要與後續對話回答，勿忘記使用者稍早提到的重點。）`;
  if (!context?.trim()) return block;
  return `${context.trim()}\n\n${block}`;
}

export function formatTurnsForSummary(batch: ChatTurn[]): string {
  return batch
    .map((m) => `${m.role === "user" ? "使用者" : "助手"}：${(m.text || "").trim()}`)
    .filter((line) => line.length > 4)
    .join("\n\n");
}

export function buildSummaryPrompt(
  previousSummary: string,
  batch: ChatTurn[]
): string {
  const transcript = formatTurnsForSummary(batch);
  if (previousSummary.trim()) {
    return [
      "請把「舊摘要」與「新對話」合併成一份精簡摘要。",
      "使用繁體中文、條列優先；保留：使用者目標、偏好、已確認事實、未完成事項、重要專有名詞。",
      "不要寫成對使用者的回覆，只輸出摘要本文。",
      "",
      "【舊摘要】",
      previousSummary.trim(),
      "",
      "【新對話】",
      transcript,
    ].join("\n");
  }
  return [
    "請將以下對話濃縮成精簡摘要。",
    "使用繁體中文、條列優先；保留：使用者目標、偏好、已確認事實、未完成事項、重要專有名詞。",
    "不要寫成對使用者的回覆，只輸出摘要本文。",
    "",
    "【對話】",
    transcript,
  ].join("\n");
}
