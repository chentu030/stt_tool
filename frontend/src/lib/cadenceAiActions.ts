/** Albireus AI action catalog (slash / space / aside chips) */

export type CadenceAiInsertMode = "cursor" | "replace" | "append" | "chat";

export type CadenceAiAction = {
  id: string;
  /** API action name sent to /api/ai/generate */
  apiAction: string;
  label: string;
  hint: string;
  group: "write" | "draft" | "think" | "visual";
  insertMode: CadenceAiInsertMode;
  /** Fixed prompt when no free-text needed */
  prompt?: string;
};

export const CADENCE_AI_ACTIONS: CadenceAiAction[] = [
  {
    id: "summarize",
    apiAction: "summarize",
    label: "摘要",
    hint: "條列重點",
    group: "write",
    insertMode: "append",
  },
  {
    id: "actions",
    apiAction: "actions",
    label: "待辦",
    hint: "抽出行動項",
    group: "write",
    insertMode: "append",
  },
  {
    id: "rewrite",
    apiAction: "rewrite",
    label: "改寫",
    hint: "更清晰",
    group: "write",
    insertMode: "replace",
  },
  {
    id: "expand",
    apiAction: "expand",
    label: "擴寫",
    hint: "補細節",
    group: "write",
    insertMode: "replace",
  },
  {
    id: "explain",
    apiAction: "explain",
    label: "說明",
    hint: "白話解釋",
    group: "think",
    insertMode: "append",
  },
  {
    id: "outline",
    apiAction: "outline",
    label: "大綱",
    hint: "結構整理",
    group: "write",
    insertMode: "append",
  },
  {
    id: "quiz",
    apiAction: "quiz",
    label: "測驗",
    hint: "出題複習",
    group: "think",
    insertMode: "append",
  },
  {
    id: "draft-meeting",
    apiAction: "draft_meeting",
    label: "會議草稿",
    hint: "議程與紀錄骨架",
    group: "draft",
    insertMode: "cursor",
    prompt: "依這篇筆記產出完整會議紀錄草稿（議程、討論、決議、待辦）",
  },
  {
    id: "draft-email",
    apiAction: "draft_email",
    label: "信件草稿",
    hint: "正式／半正式信",
    group: "draft",
    insertMode: "cursor",
    prompt: "依這篇筆記產出一封可用的信件草稿（含主旨建議）",
  },
  {
    id: "draft-outline",
    apiAction: "draft_outline",
    label: "簡報大綱",
    hint: "適合做成投影片",
    group: "draft",
    insertMode: "cursor",
    prompt: "產出適合簡報的 Markdown 大綱（## 為投影片標題）",
  },
  {
    id: "write-anything",
    apiAction: "write_anything",
    label: "自由撰寫",
    hint: "依提示寫一段",
    group: "write",
    insertMode: "cursor",
  },
  {
    id: "table",
    apiAction: "make_table",
    label: "表格",
    hint: "整理成 Markdown 表",
    group: "visual",
    insertMode: "cursor",
    prompt: "把重點整理成 Markdown 表格，只輸出表格",
  },
  {
    id: "mermaid",
    apiAction: "make_mermaid",
    label: "流程圖",
    hint: "Mermaid 圖",
    group: "visual",
    insertMode: "cursor",
    prompt: "用 Mermaid flowchart 表達流程，輸出 ```mermaid 程式碼區塊",
  },
  {
    id: "draft-blog",
    apiAction: "write_anything",
    label: "文章草稿",
    hint: "長文初稿",
    group: "draft",
    insertMode: "cursor",
    prompt: "依這篇筆記寫一篇可發布的繁體中文文章草稿（含標題與小標）",
  },
  {
    id: "brainstorm",
    apiAction: "write_anything",
    label: "腦力激盪",
    hint: "10 個點子",
    group: "think",
    insertMode: "append",
    prompt: "針對這篇筆記主題腦力激盪 10 個點子，條列並各一句說明",
  },
  {
    id: "weekly-plan",
    apiAction: "write_anything",
    label: "本週計畫",
    hint: "行程與優先",
    group: "draft",
    insertMode: "cursor",
    prompt: "依筆記內容產出「本週計畫」：目標、每日重點、風險與待辦 checklist",
  },
  {
    id: "ask",
    apiAction: "note",
    label: "詢問 AI",
    hint: "開啟對話",
    group: "think",
    insertMode: "chat",
  },
];

export const AI_SLASH_ALIASES: Record<string, string[]> = {
  ai: CADENCE_AI_ACTIONS.map((a) => `ai-${a.id}`).concat(["create-photo"]),
  ask: ["ai-ask"],
  summarize: ["ai-summarize"],
  draft: ["ai-draft-meeting", "ai-draft-email", "ai-draft-outline"],
  mermaid: ["ai-mermaid"],
  // Do not use key "table" — it collides with the real /table grid command
  aitable: ["ai-table"],
  "ai-table": ["ai-table"],
  "create-photo": ["create-photo"],
};

export function findCadenceAiAction(id: string): CadenceAiAction | undefined {
  const key = id.replace(/^ai-/, "");
  return (
    CADENCE_AI_ACTIONS.find((a) => a.id === key || a.id === id) ||
    CADENCE_AI_ACTIONS.find((a) => a.apiAction === key || a.apiAction === id)
  );
}
