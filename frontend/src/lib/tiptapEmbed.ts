import { InputRule, Node, mergeAttributes, nodeInputRule } from "@tiptap/core";
import type { NodeViewRendererProps } from "@tiptap/core";
import katex from "katex";
import {
  decodeFormulaAttr,
  encodeFormulaAttr,
  normalizeLatexFormula,
} from "@/lib/latexNormalize";

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
  const src = normalizeLatexFormula(formula || "");
  try {
    return katex.renderToString(src, {
      throwOnError: false,
      displayMode,
      output: "html",
      trust: false,
    });
  } catch {
    return displayMode
      ? `<span class="rich-math-error">$$${src}$$</span>`
      : `<span class="rich-math-error">$${src}$</span>`;
  }
}

function applyFormula(
  editor: NodeViewRendererProps["editor"],
  getPos: NodeViewRendererProps["getPos"],
  next: string
) {
  const pos = typeof getPos === "function" ? getPos() : null;
  if (typeof pos !== "number") return;
  const formula = normalizeLatexFormula(next);
  editor
    .chain()
    .focus()
    .command(({ tr }) => {
      tr.setNodeMarkup(pos, undefined, { formula });
      return true;
    })
    .run();
}

/** Obsidian-style: click rendered math → edit source in place; Enter/blur commits. */
function createInlineMathView({ node, getPos, editor }: NodeViewRendererProps) {
  const dom = document.createElement("span");
  dom.className = "rich-math-inline";
  dom.setAttribute("data-math-inline", "1");
  let formula = node.attrs.formula || "";
  let editing = false;
  let source: HTMLInputElement | null = null;

  const stop = (e: Event) => {
    e.stopPropagation();
  };

  const render = () => {
    editing = false;
    source = null;
    dom.classList.remove("is-editing");
    dom.contentEditable = "false";
    dom.setAttribute("data-formula", encodeFormulaAttr(formula));
    dom.title = "點一下編輯公式";
    dom.innerHTML = renderKatex(formula, false);
  };

  const commit = (nextRaw: string, moveCursorAfter = true) => {
    const next = normalizeLatexFormula(nextRaw.trim());
    formula = next;
    applyFormula(editor, getPos, next);
    render();
    if (moveCursorAfter) {
      const pos = typeof getPos === "function" ? getPos() : null;
      if (typeof pos === "number") {
        const after = pos + (editor.state.doc.nodeAt(pos)?.nodeSize || 1);
        editor.chain().focus().setTextSelection(after).run();
      }
    }
  };

  const startEdit = () => {
    if (editing || editor.isDestroyed || !editor.isEditable) return;
    editing = true;
    dom.classList.add("is-editing");
    dom.title = "Enter 完成 · Esc 取消";
    dom.innerHTML = "";
    const open = document.createElement("span");
    open.className = "rich-math-delim";
    open.textContent = "$";
    const input = document.createElement("input");
    input.type = "text";
    input.className = "rich-math-source";
    input.value = formula;
    input.setAttribute("aria-label", "編輯行內 LaTeX");
    const close = document.createElement("span");
    close.className = "rich-math-delim";
    close.textContent = "$";
    dom.append(open, input, close);
    source = input;

    const syncWidth = () => {
      const len = Math.max(2, input.value.length + 1);
      input.style.width = `${len}ch`;
    };
    syncWidth();

    input.addEventListener("mousedown", stop);
    input.addEventListener("pointerdown", stop);
    input.addEventListener("click", stop);
    input.addEventListener("input", syncWidth);
    input.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter") {
        e.preventDefault();
        commit(input.value);
      } else if (e.key === "Escape") {
        e.preventDefault();
        render();
        editor.commands.focus();
      }
    });
    input.addEventListener("blur", () => {
      requestAnimationFrame(() => {
        if (!editing || source !== input) return;
        commit(input.value, false);
      });
    });

    requestAnimationFrame(() => {
      input.focus();
      input.select();
    });
  };

  dom.addEventListener("mousedown", (e) => {
    if (editing) {
      stop(e);
      return;
    }
    if (editor.isEditable) {
      e.preventDefault();
      e.stopPropagation();
    }
  });
  dom.addEventListener("click", (e) => {
    if (!editor.isEditable) return;
    e.preventDefault();
    e.stopPropagation();
    startEdit();
  });

  render();

  return {
    dom,
    selectNode: () => {
      dom.classList.add("is-selected");
    },
    deselectNode: () => {
      dom.classList.remove("is-selected");
    },
    update: (updated: typeof node) => {
      if (updated.type.name !== "mathInline") return false;
      formula = updated.attrs.formula || "";
      dom.setAttribute("data-formula", encodeFormulaAttr(formula));
      if (!editing) render();
      return true;
    },
    stopEvent: (event: Event) => {
      if (!editing) return false;
      const t = event.target;
      return !!(t instanceof globalThis.Node && dom.contains(t));
    },
    ignoreMutation: () => editing,
  };
}

function createBlockMathView({ node, getPos, editor }: NodeViewRendererProps) {
  const dom = document.createElement("div");
  dom.className = "rich-math-block";
  dom.setAttribute("data-math-block", "1");
  let formula = node.attrs.formula || "";
  let editing = false;
  let source: HTMLTextAreaElement | null = null;

  const stop = (e: Event) => e.stopPropagation();

  const render = () => {
    editing = false;
    source = null;
    dom.classList.remove("is-editing");
    dom.contentEditable = "false";
    dom.setAttribute("data-formula", encodeFormulaAttr(formula));
    dom.title = "點一下編輯公式";
    dom.innerHTML = renderKatex(formula, true);
  };

  const commit = (nextRaw: string) => {
    const next = normalizeLatexFormula(nextRaw.trim());
    formula = next;
    applyFormula(editor, getPos, next);
    render();
  };

  const startEdit = () => {
    if (editing || editor.isDestroyed || !editor.isEditable) return;
    editing = true;
    dom.classList.add("is-editing");
    dom.title = "Enter 完成 · Esc 取消 · Shift+Enter 換行";
    dom.innerHTML = "";
    const label = document.createElement("div");
    label.className = "rich-math-source-label";
    label.textContent = "$$";
    const area = document.createElement("textarea");
    area.className = "rich-math-source rich-math-source--block";
    area.value = formula;
    area.rows = Math.min(8, Math.max(2, formula.split("\n").length + 1));
    area.setAttribute("aria-label", "編輯區塊 LaTeX");
    const labelEnd = document.createElement("div");
    labelEnd.className = "rich-math-source-label";
    labelEnd.textContent = "$$";
    dom.append(label, area, labelEnd);
    source = area;

    area.addEventListener("mousedown", stop);
    area.addEventListener("pointerdown", stop);
    area.addEventListener("click", stop);
    area.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        commit(area.value);
        editor.commands.focus();
      } else if (e.key === "Escape") {
        e.preventDefault();
        render();
        editor.commands.focus();
      }
    });
    area.addEventListener("blur", () => {
      requestAnimationFrame(() => {
        if (!editing || source !== area) return;
        commit(area.value);
      });
    });

    requestAnimationFrame(() => {
      area.focus();
      area.select();
    });
  };

  dom.addEventListener("mousedown", (e) => {
    if (editing) {
      stop(e);
      return;
    }
    if (editor.isEditable) {
      e.preventDefault();
      e.stopPropagation();
    }
  });
  dom.addEventListener("click", (e) => {
    if (!editor.isEditable) return;
    e.preventDefault();
    e.stopPropagation();
    startEdit();
  });

  render();

  return {
    dom,
    selectNode: () => dom.classList.add("is-selected"),
    deselectNode: () => dom.classList.remove("is-selected"),
    update: (updated: typeof node) => {
      if (updated.type.name !== "mathBlock") return false;
      formula = updated.attrs.formula || "";
      dom.setAttribute("data-formula", encodeFormulaAttr(formula));
      if (!editing) render();
      return true;
    },
    stopEvent: (event: Event) => {
      if (!editing) return false;
      const t = event.target;
      return !!(t instanceof globalThis.Node && dom.contains(t));
    },
    ignoreMutation: () => editing,
  };
}

export const MathInline = Node.create({
  name: "mathInline",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return {
      formula: {
        default: "",
        parseHTML: (el) =>
          normalizeLatexFormula(
            decodeFormulaAttr((el as HTMLElement).getAttribute("data-formula") || "")
          ),
        renderHTML: (attrs) => {
          const formula = normalizeLatexFormula(attrs.formula || "");
          if (!formula) return {};
          return {
            "data-math-inline": "1",
            "data-formula": encodeFormulaAttr(formula),
          };
        },
      },
    };
  },
  parseHTML() {
    return [
      {
        tag: "span[data-math-inline]",
        getAttrs: (el) => ({
          formula: normalizeLatexFormula(
            decodeFormulaAttr((el as HTMLElement).getAttribute("data-formula") || "")
          ),
        }),
      },
      {
        tag: "span.rich-math-inline",
        getAttrs: (el) => ({
          formula: normalizeLatexFormula(
            decodeFormulaAttr((el as HTMLElement).getAttribute("data-formula") || "")
          ),
        }),
      },
    ];
  },
  renderHTML({ HTMLAttributes }) {
    const formula = normalizeLatexFormula(
      HTMLAttributes.formula ||
        decodeFormulaAttr(String(HTMLAttributes["data-formula"] || ""))
    );
    // Include $...$ text so serializers that ignore empty atoms still keep the formula.
    return [
      "span",
      mergeAttributes(
        {
          class: "rich-math-inline",
          "data-math-inline": "1",
          "data-formula": encodeFormulaAttr(formula),
          contenteditable: "false",
        },
        HTMLAttributes,
        {
          // Avoid duplicating raw formula attr onto the DOM
          formula: undefined,
        }
      ),
      formula ? `$${formula}$` : "",
    ];
  },
  addNodeView() {
    return (props) => createInlineMathView(props);
  },
  addInputRules() {
    return [
      nodeInputRule({
        find: /\$([^$\n]+)\$$/,
        type: this.type,
        getAttributes: (match) => ({
          formula: normalizeLatexFormula(String(match[1] || "").trim()),
        }),
      }),
    ];
  },
  addCommands() {
    return {
      setMathInline:
        (formula) =>
        ({ commands }) =>
          commands.insertContent([
            { type: this.name, attrs: { formula: normalizeLatexFormula(formula) } },
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
      formula: {
        default: "",
        parseHTML: (el) =>
          normalizeLatexFormula(
            decodeFormulaAttr((el as HTMLElement).getAttribute("data-formula") || "")
          ),
        renderHTML: (attrs) => {
          const formula = normalizeLatexFormula(attrs.formula || "");
          if (!formula) return {};
          return {
            "data-math-block": "1",
            "data-formula": encodeFormulaAttr(formula),
          };
        },
      },
    };
  },
  parseHTML() {
    return [
      {
        tag: "div[data-math-block]",
        getAttrs: (el) => ({
          formula: normalizeLatexFormula(
            decodeFormulaAttr((el as HTMLElement).getAttribute("data-formula") || "")
          ),
        }),
      },
      {
        tag: "div.rich-math-block",
        getAttrs: (el) => ({
          formula: normalizeLatexFormula(
            decodeFormulaAttr((el as HTMLElement).getAttribute("data-formula") || "")
          ),
        }),
      },
    ];
  },
  renderHTML({ HTMLAttributes }) {
    const formula = normalizeLatexFormula(
      HTMLAttributes.formula ||
        decodeFormulaAttr(String(HTMLAttributes["data-formula"] || ""))
    );
    return [
      "div",
      mergeAttributes(
        {
          class: "rich-math-block",
          "data-math-block": "1",
          "data-formula": encodeFormulaAttr(formula),
          contenteditable: "false",
        },
        HTMLAttributes,
        {
          formula: undefined,
        }
      ),
      formula ? `$$\n${formula}\n$$` : "",
    ];
  },
  addNodeView() {
    return (props) => createBlockMathView(props);
  },
  addInputRules() {
    return [
      new InputRule({
        // Allow multiline formulas between $$ … $$
        find: /\$\$\s*([\s\S]+?)\s*\$\$$/,
        handler: ({ range, match, chain }) => {
          const formula = normalizeLatexFormula(String(match[1] || "").trim());
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
          commands.insertContent({
            type: this.name,
            attrs: { formula: normalizeLatexFormula(formula) },
          }),
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
