import { askPrompt } from "@/lib/dialogs";
import { InputRule, Node, mergeAttributes, nodeInputRule } from "@tiptap/core";
import type { NodeViewRendererProps } from "@tiptap/core";
import katex from "katex";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    mathInline: {
      setMathInline: (formula: string) => ReturnType;
    };
    mathBlock: {
      setMathBlock: (formula: string) => ReturnType;
    };
    noteEmbed: {
      setNoteEmbed: (attrs: {
        src: string;
        kind: string;
        title?: string;
        original?: string;
        frameable?: boolean;
      }) => ReturnType;
    };
  }
}

function renderKatex(formula: string, displayMode: boolean): string {
  try {
    return katex.renderToString(formula || "", {
      throwOnError: false,
      displayMode,
      output: "html",
    });
  } catch {
    return displayMode
      ? `<span class="rich-math-error">$$${formula}$$</span>`
      : `<span class="rich-math-error">$${formula}$</span>`;
  }
}

function attachMathEditor(
  dom: HTMLElement,
  opts: {
    label: string;
    getFormula: () => string;
    apply: (next: string) => void;
  }
) {
  dom.title = "雙擊編輯公式";
  dom.addEventListener("dblclick", (e) => {
    e.preventDefault();
    e.stopPropagation();
    void (async () => {
      const next = await askPrompt(opts.label, opts.getFormula());
      if (next === null) return;
      opts.apply(next.trim());
    })();
  });
}

export const MathInline = Node.create({
  name: "mathInline",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return {
      formula: { default: "" },
    };
  },
  parseHTML() {
    return [
      {
        tag: "span[data-math-inline]",
        getAttrs: (el) => ({
          formula: (el as HTMLElement).getAttribute("data-formula") || "",
        }),
      },
    ];
  },
  renderHTML({ HTMLAttributes }) {
    const formula = HTMLAttributes.formula || "";
    return [
      "span",
      mergeAttributes({
        class: "rich-math-inline",
        "data-math-inline": "1",
        "data-formula": formula,
        contenteditable: "false",
      }),
    ];
  },
  addNodeView() {
    return ({ node, getPos, editor }: NodeViewRendererProps) => {
      const dom = document.createElement("span");
      dom.className = "rich-math-inline";
      dom.setAttribute("data-math-inline", "1");
      dom.setAttribute("data-formula", node.attrs.formula || "");
      dom.contentEditable = "false";
      dom.innerHTML = renderKatex(node.attrs.formula || "", false);
      attachMathEditor(dom, {
        label: "行內 LaTeX（可插在文字中）",
        getFormula: () => dom.getAttribute("data-formula") || "",
        apply: (next) => {
          const pos = typeof getPos === "function" ? getPos() : null;
          if (typeof pos !== "number") return;
          editor
            .chain()
            .focus()
            .command(({ tr }) => {
              tr.setNodeMarkup(pos, undefined, { formula: next });
              return true;
            })
            .run();
        },
      });
      return {
        dom,
        update: (updated) => {
          if (updated.type.name !== "mathInline") return false;
          dom.setAttribute("data-formula", updated.attrs.formula || "");
          dom.innerHTML = renderKatex(updated.attrs.formula || "", false);
          return true;
        },
      };
    };
  },
  addInputRules() {
    return [
      // Type $E=mc^2$ → inline math (Notion-style)
      nodeInputRule({
        find: /\$([^$\n]+)\$$/,
        type: this.type,
        getAttributes: (match) => ({ formula: String(match[1] || "").trim() }),
      }),
    ];
  },
  addCommands() {
    return {
      setMathInline:
        (formula) =>
        ({ commands }) =>
          commands.insertContent([
            { type: this.name, attrs: { formula } },
            { type: "text", text: " " },
          ]),
    };
  },
});

export const MathBlock = Node.create({
  name: "mathBlock",
  group: "block",
  atom: true,
  defining: true,
  selectable: true,
  addAttributes() {
    return {
      formula: { default: "" },
    };
  },
  parseHTML() {
    return [
      {
        tag: "div[data-math-block]",
        getAttrs: (el) => ({
          formula: (el as HTMLElement).getAttribute("data-formula") || "",
        }),
      },
    ];
  },
  renderHTML({ HTMLAttributes }) {
    const formula = HTMLAttributes.formula || "";
    return [
      "div",
      mergeAttributes({
        class: "rich-math-block",
        "data-math-block": "1",
        "data-formula": formula,
        contenteditable: "false",
      }),
    ];
  },
  addNodeView() {
    return ({ node, getPos, editor }: NodeViewRendererProps) => {
      const dom = document.createElement("div");
      dom.className = "rich-math-block";
      dom.setAttribute("data-math-block", "1");
      dom.setAttribute("data-formula", node.attrs.formula || "");
      dom.contentEditable = "false";
      dom.innerHTML = renderKatex(node.attrs.formula || "", true);
      attachMathEditor(dom, {
        label: "區塊 LaTeX",
        getFormula: () => dom.getAttribute("data-formula") || "",
        apply: (next) => {
          const pos = typeof getPos === "function" ? getPos() : null;
          if (typeof pos !== "number") return;
          editor
            .chain()
            .focus()
            .command(({ tr }) => {
              tr.setNodeMarkup(pos, undefined, { formula: next });
              return true;
            })
            .run();
        },
      });
      return {
        dom,
        update: (updated) => {
          if (updated.type.name !== "mathBlock") return false;
          dom.setAttribute("data-formula", updated.attrs.formula || "");
          dom.innerHTML = renderKatex(updated.attrs.formula || "", true);
          return true;
        },
      };
    };
  },
  addInputRules() {
    return [
      new InputRule({
        find: /\$\$([^$\n]+)\$\$$/,
        handler: ({ range, match, chain }) => {
          const formula = String(match[1] || "").trim();
          if (!formula) return null;
          chain().deleteRange(range).insertContent({ type: this.name, attrs: { formula } }).run();
        },
      }),
    ];
  },
  addCommands() {
    return {
      setMathBlock:
        (formula) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs: { formula } }),
    };
  },
});

export const NoteEmbed = Node.create({
  name: "noteEmbed",
  group: "block",
  atom: true,
  draggable: true,
  addAttributes() {
    return {
      src: { default: null },
      kind: { default: "web" },
      title: { default: "嵌入" },
      original: { default: null },
      frameable: { default: true },
    };
  },
  parseHTML() {
    return [
      {
        tag: "div[data-note-embed]",
        getAttrs: (el) => {
          const d = el as HTMLElement;
          const frameAttr = d.getAttribute("data-frameable");
          return {
            src: d.getAttribute("data-src"),
            kind: d.getAttribute("data-kind") || "web",
            title: d.getAttribute("data-title") || "嵌入",
            original: d.getAttribute("data-original"),
            frameable: frameAttr == null ? true : frameAttr !== "0",
          };
        },
      },
    ];
  },
  renderHTML({ HTMLAttributes }) {
    const src = HTMLAttributes.src || "";
    const kind = HTMLAttributes.kind || "web";
    const title = HTMLAttributes.title || "嵌入";
    const original = HTMLAttributes.original || src;
    const frameable = HTMLAttributes.frameable !== false && HTMLAttributes.frameable !== "0";

    return [
      "div",
      mergeAttributes({
        class: `rich-embed rich-embed--${kind}${frameable ? "" : " rich-embed--card"}`,
        "data-note-embed": "1",
        "data-src": src,
        "data-kind": kind,
        "data-title": title,
        "data-original": original,
        "data-frameable": frameable ? "1" : "0",
        contenteditable: "false",
      }),
    ];
  },
  addNodeView() {
    return ({ node }) => {
      const dom = document.createElement("div");
      const sync = (n: typeof node) => {
        const src = String(n.attrs.src || "");
        const kind = String(n.attrs.kind || "web");
        const title = String(n.attrs.title || "嵌入");
        const original = String(n.attrs.original || src);
        const frameable = n.attrs.frameable !== false && n.attrs.frameable !== "0";
        let host = title;
        try {
          host = new URL(original).hostname;
        } catch {
          /* keep */
        }

        dom.className = `rich-embed rich-embed--${kind}${frameable ? "" : " rich-embed--card"}`;
        dom.setAttribute("data-note-embed", "1");
        dom.setAttribute("data-src", src);
        dom.setAttribute("data-kind", kind);
        dom.setAttribute("data-title", title);
        dom.setAttribute("data-original", original);
        dom.setAttribute("data-frameable", frameable ? "1" : "0");
        dom.contentEditable = "false";

        if (!frameable || kind === "link") {
          const fav =
            typeof window !== "undefined"
              ? `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64`
              : "";
          dom.innerHTML = `
            <div class="rich-embed-card-body">
              ${fav ? `<img class="rich-embed-favicon" src="${fav}" alt="" width="28" height="28" />` : ""}
              <div class="rich-embed-card-text">
                <div class="rich-embed-card-host">${escapeHtml(host)}</div>
                <div class="rich-embed-card-title">${escapeHtml(title === host ? original : title)}</div>
                <p class="rich-embed-card-hint">此網站不允許內嵌預覽（安全限制），請開啟原始連結瀏覽。</p>
              </div>
            </div>
            <a class="rich-embed-open" href="${escapeAttr(original)}" target="_blank" rel="noopener noreferrer">開啟原始連結</a>
          `;
          return;
        }

        const isPdfDirect = kind === "pdf" && !/drive\.google|officeapps|docs\.google/i.test(src);
        const allow = isPdfDirect
          ? ""
          : ` allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"`;
        const referrer = isPdfDirect ? "" : ` referrerpolicy="no-referrer-when-downgrade"`;
        dom.innerHTML = `
          <div class="rich-embed-label">${escapeHtml(title)}</div>
          <iframe class="rich-embed-frame" src="${escapeAttr(src)}" title="${escapeAttr(title)}" loading="lazy"${allow}${referrer}${isPdfDirect ? "" : " allowfullscreen"}></iframe>
          <a class="rich-embed-open" href="${escapeAttr(original)}" target="_blank" rel="noopener noreferrer">開啟原始連結</a>
        `;
      };

      sync(node);
      return {
        dom,
        update: (updated) => {
          if (updated.type.name !== "noteEmbed") return false;
          sync(updated);
          return true;
        },
      };
    };
  },
  addCommands() {
    return {
      setNoteEmbed:
        (attrs) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs }),
    };
  },
});

function escapeHtml(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttr(s: string) {
  return escapeHtml(s).replace(/'/g, "&#39;");
}
