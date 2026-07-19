import { marked } from "marked";
import TurndownService from "turndown";

const turndown = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
  bulletListMarker: "-",
});

turndown.addRule("strikethrough", {
  filter: ["del", "s"] as unknown as TurndownService.Filter,
  replacement: (content) => `~~${content}~~`,
});

turndown.addRule("taskList", {
  filter: (node) =>
    node.nodeName === "LI" &&
    (node as HTMLElement).getAttribute?.("data-type") === "taskItem",
  replacement: (content, node) => {
    const checked = (node as HTMLElement).getAttribute("data-checked") === "true";
    const text = content.replace(/^\s*/, "").trim();
    return `- [${checked ? "x" : " "}] ${text}\n`;
  },
});

marked.setOptions({ gfm: true, breaks: false });

export function markdownToHtml(md: string): string {
  const raw = (md || "").trim();
  if (!raw) return "<p></p>";
  return marked.parse(raw, { async: false }) as string;
}

export function htmlToMarkdown(html: string): string {
  if (!html || html === "<p></p>" || html === '<p><br></p>') return "";
  return turndown.turndown(html).trim();
}
