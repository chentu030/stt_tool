/** Cadence block model + Markdown bridge */

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
  | "image"
  | "callout"
  | "code"
  | "toggle"
  | "table";

export type Block = {
  id: string;
  type: BlockType;
  text: string;
  checked?: boolean;
  /** image URL / code language / callout tone */
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
      case "callout":
        lines.push(`> [!${b.src || "info"}] ${b.text}`);
        numbered = 0;
        break;
      case "code": {
        const lang = b.src || "";
        lines.push("```" + lang, b.text, "```");
        numbered = 0;
        break;
      }
      case "toggle": {
        const open = b.checked ? "open" : "closed";
        const [title, ...rest] = b.text.split("\n");
        lines.push(`:::toggle ${open} ${title || "詳細"}`);
        if (rest.length) lines.push(rest.join("\n"));
        lines.push(":::");
        numbered = 0;
        break;
      }
      case "table":
        lines.push(b.text.trim() || "| 欄1 | 欄2 |\n| --- | --- |\n|  |  |");
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
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.startsWith("```")) {
      const lang = line.slice(3).trim();
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !lines[i].startsWith("```")) {
        body.push(lines[i]);
        i += 1;
      }
      blocks.push(createBlock({ type: "code", text: body.join("\n"), src: lang }));
      i += 1;
      continue;
    }

    if (line.startsWith(":::toggle")) {
      const m = line.match(/^:::toggle\s+(open|closed)\s+(.*)$/);
      const open = m?.[1] === "open";
      const title = m?.[2] || "詳細";
      const body: string[] = [];
      i += 1;
      while (i < lines.length && lines[i].trim() !== ":::") {
        body.push(lines[i]);
        i += 1;
      }
      blocks.push(createBlock({
        type: "toggle",
        text: [title, ...body].join("\n"),
        checked: open,
      }));
      i += 1;
      continue;
    }

    if (line.includes("|") && line.trim().startsWith("|") && i + 1 < lines.length && /^\|?\s*-+/.test(lines[i + 1])) {
      const table: string[] = [line];
      i += 1;
      while (i < lines.length && lines[i].includes("|")) {
        table.push(lines[i]);
        i += 1;
      }
      blocks.push(createBlock({ type: "table", text: table.join("\n") }));
      continue;
    }

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
    } else if (/^>\s*\[!(\w+)\]\s?/.test(line)) {
      const m = line.match(/^>\s*\[!(\w+)\]\s?(.*)$/);
      blocks.push(createBlock({ type: "callout", src: m?.[1] || "info", text: m?.[2] || "" }));
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
    i += 1;
  }

  return blocks.length ? blocks : [createBlock()];
}

export type SlashItem = {
  id: string;
  label: string;
  hint: string;
  type: BlockType;
  checked?: boolean;
  src?: string;
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
  { id: "callout", label: "Callout", hint: "重點提示框", type: "callout", src: "info" },
  { id: "code", label: "程式碼", hint: "Code block", type: "code", src: "" },
  { id: "toggle", label: "Toggle", hint: "可摺疊區塊", type: "toggle", checked: true },
  { id: "table", label: "表格", hint: "簡易表格", type: "table" },
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

export const DEFAULT_TABLE = `| 欄1 | 欄2 | 欄3 |
| --- | --- | --- |
|  |  |  |
|  |  |  |`;
