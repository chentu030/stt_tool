/** Cadence block model + Markdown bridge (Phase A) */

export type BlockType =
  | "paragraph"
  | "heading1"
  | "heading2"
  | "heading3"
  | "bullet"
  | "numbered"
  | "todo"
  | "quote"
  | "divider"
  | "image";

export type Block = {
  id: string;
  type: BlockType;
  text: string;
  checked?: boolean;
  /** image URL when type === "image" */
  src?: string;
};

export function newBlockId(): string {
  return `b_${Math.random().toString(36).slice(2, 10)}_${Date.now().toString(36)}`;
}

export function createBlock(partial?: Partial<Block>): Block {
  return {
    id: newBlockId(),
    type: "paragraph",
    text: "",
    ...partial,
  };
}

export function blocksToMarkdown(blocks: Block[]): string {
  const lines: string[] = [];
  let numbered = 0;

  for (const b of blocks) {
    switch (b.type) {
      case "heading1":
        lines.push(`# ${b.text}`);
        numbered = 0;
        break;
      case "heading2":
        lines.push(`## ${b.text}`);
        numbered = 0;
        break;
      case "heading3":
        lines.push(`### ${b.text}`);
        numbered = 0;
        break;
      case "bullet":
        lines.push(`- ${b.text}`);
        numbered = 0;
        break;
      case "numbered":
        numbered += 1;
        lines.push(`${numbered}. ${b.text}`);
        break;
      case "todo":
        lines.push(`- [${b.checked ? "x" : " "}] ${b.text}`);
        numbered = 0;
        break;
      case "quote":
        lines.push(`> ${b.text}`);
        numbered = 0;
        break;
      case "divider":
        lines.push("---");
        numbered = 0;
        break;
      case "image":
        lines.push(`![${b.text || "image"}](${b.src || ""})`);
        numbered = 0;
        break;
      default:
        lines.push(b.text);
        numbered = 0;
        break;
    }
  }
  return lines.join("\n");
}

export function markdownToBlocks(md: string): Block[] {
  const raw = (md || "").replace(/\r\n/g, "\n");
  if (!raw.trim()) return [createBlock()];

  const lines = raw.split("\n");
  const blocks: Block[] = [];

  for (const line of lines) {
    const img = line.match(/^!\[([^\]]*)\]\(([^)]*)\)\s*$/);
    if (img) {
      blocks.push(createBlock({ type: "image", text: img[1], src: img[2] }));
    } else if (/^#{3}\s+/.test(line)) {
      blocks.push(createBlock({ type: "heading3", text: line.replace(/^#{3}\s+/, "") }));
    } else if (/^#{2}\s+/.test(line)) {
      blocks.push(createBlock({ type: "heading2", text: line.replace(/^#{2}\s+/, "") }));
    } else if (/^#\s+/.test(line)) {
      blocks.push(createBlock({ type: "heading1", text: line.replace(/^#\s+/, "") }));
    } else if (/^---+$/.test(line.trim())) {
      blocks.push(createBlock({ type: "divider", text: "" }));
    } else if (/^>\s?/.test(line)) {
      blocks.push(createBlock({ type: "quote", text: line.replace(/^>\s?/, "") }));
    } else if (/^-\s\[[xX ]\]\s/.test(line)) {
      const checked = /^-\s\[[xX]\]\s/.test(line);
      blocks.push(createBlock({
        type: "todo",
        checked,
        text: line.replace(/^-\s\[[xX ]\]\s/, ""),
      }));
    } else if (/^[-*]\s+/.test(line)) {
      blocks.push(createBlock({ type: "bullet", text: line.replace(/^[-*]\s+/, "") }));
    } else if (/^\d+\.\s+/.test(line)) {
      blocks.push(createBlock({ type: "numbered", text: line.replace(/^\d+\.\s+/, "") }));
    } else {
      blocks.push(createBlock({ type: "paragraph", text: line }));
    }
  }

  return blocks.length ? blocks : [createBlock()];
}

export type SlashItem = {
  id: string;
  label: string;
  hint: string;
  type: BlockType;
  checked?: boolean;
};

export const SLASH_ITEMS: SlashItem[] = [
  { id: "p", label: "文字", hint: "一般段落", type: "paragraph" },
  { id: "h1", label: "標題 1", hint: "大型標題", type: "heading1" },
  { id: "h2", label: "標題 2", hint: "中型標題", type: "heading2" },
  { id: "h3", label: "標題 3", hint: "小型標題", type: "heading3" },
  { id: "bullet", label: "項目清單", hint: "無序清單", type: "bullet" },
  { id: "numbered", label: "編號清單", hint: "有序清單", type: "numbered" },
  { id: "todo", label: "待辦", hint: "可勾選任務", type: "todo", checked: false },
  { id: "quote", label: "引用", hint: "引用區塊", type: "quote" },
  { id: "image", label: "圖片", hint: "以網址插入圖片", type: "image" },
  { id: "divider", label: "分隔線", hint: "水平線", type: "divider" },
];

export function wrapSelection(text: string, start: number, end: number, before: string, after = before) {
  const selected = text.slice(start, end) || "文字";
  const next = text.slice(0, start) + before + selected + after + text.slice(end);
  return {
    text: next,
    caret: start + before.length + selected.length + after.length,
  };
}
