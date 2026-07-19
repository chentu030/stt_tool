/** Build compact note context for Cadence AI prompts */

import { extractWikiLinks } from "@/lib/wiki";

export type NoteAiContextInput = {
  title: string;
  body: string;
  folder?: string;
  status?: string;
  tags?: string[];
  relatedTitles?: string[];
  maxBodyChars?: number;
};

export type NoteAiContextPack = {
  /** Short chip label for UI */
  chip: string;
  /** Full context block for API */
  context: string;
  body: string;
};

export function buildNoteAiContext(input: NoteAiContextInput): NoteAiContextPack {
  const title = (input.title || "未命名筆記").trim();
  const folder = (input.folder || "").trim();
  const status = (input.status || "").trim();
  const tags = (input.tags || []).map((t) => t.trim()).filter(Boolean);
  const links = extractWikiLinks(input.body || "");
  const related = (input.relatedTitles || []).filter(Boolean).slice(0, 8);
  const max = input.maxBodyChars ?? 10000;
  let body = (input.body || "").trim();
  if (body.length > max) body = `${body.slice(0, max)}\n\n…（正文已截斷）`;

  const metaParts: string[] = [`標題：${title}`];
  if (folder) metaParts.push(`資料夾：${folder}`);
  if (status) metaParts.push(`狀態：${status}`);
  if (tags.length) metaParts.push(`標籤：${tags.join(", ")}`);
  if (links.length) metaParts.push(`內文連結：${links.slice(0, 12).join("、")}`);
  if (related.length) metaParts.push(`相關筆記：${related.join("、")}`);

  const chipBits: string[] = [];
  if (folder) chipBits.push(folder);
  if (tags.length) chipBits.push(tags.slice(0, 3).join(" · "));
  if (links.length) chipBits.push(`${links.length} 個連結`);
  if (related.length) chipBits.push(`${related.length} 篇相關`);
  const chip = chipBits.length ? `脈絡：${chipBits.join(" ／ ")}` : "脈絡：本篇筆記";

  const context = [
    "—— Cadence 筆記脈絡 ——",
    ...metaParts,
    "",
    "—— 正文 ——",
    body || "（空白）",
    "—— 結束 ——",
  ].join("\n");

  return { chip, context, body };
}
