import { InputRule, Node, mergeAttributes, nodeInputRule } from "@tiptap/core";
import type { Editor, NodeViewRendererProps } from "@tiptap/core";
import katex from "katex";
import {
  decodeFormulaAttr,
  encodeFormulaAttr,
  normalizeLatexFormula,
} from "@/lib/latexNormalize";
import { resolveEmbedUrl, type EmbedResolved } from "@/lib/embedUrls";
import {
  formatEmbedToken,
  layoutToDataAttrs,
  mediaLayoutTipTapAttributes,
  readLayoutFromAttrs,
} from "@/lib/mediaLayout";
import { mountLayoutChrome } from "@/lib/mediaLayoutDom";

const EMBED_KIND_UI: Record<string, { label: string; placeholder: string }> = {
  youtube: { label: "YouTube", placeholder: "貼上 YouTube 連結…" },
  vimeo: { label: "Vimeo", placeholder: "貼上 Vimeo 連結…" },
  loom: { label: "Loom", placeholder: "貼上 Loom 連結…" },
  figma: { label: "Figma", placeholder: "貼上 Figma 連結…" },
  drive: { label: "Google Drive", placeholder: "貼上 Drive／Docs 分享連結…" },
  pdf: { label: "PDF", placeholder: "貼上 PDF 網址…" },
  ppt: { label: "簡報", placeholder: "貼上簡報網址…" },
  office: { label: "Office", placeholder: "貼上文件網址…" },
  web: { label: "嵌入網頁", placeholder: "貼上網址…" },
  link: { label: "連結預覽", placeholder: "貼上網址…" },
};

function embedKindUi(kind: string) {
  return EMBED_KIND_UI[kind] || EMBED_KIND_UI.web;
}

/** Prefer filling an existing empty embed shell instead of inserting a duplicate. */
export function fillEmptyNoteEmbed(editor: Editor, emb: EmbedResolved): boolean {
  const { doc, selection } = editor.state;
  const cursor = selection.from;
  type Hit = { pos: number; dist: number };
  const hits: Hit[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name !== "noteEmbed") return;
    if (String(node.attrs.original || node.attrs.src || "").trim()) return;
    const kind = String(node.attrs.kind || "web");
    if (kind !== emb.kind) return;
    hits.push({ pos, dist: Math.abs(pos - cursor) });
  });
  if (!hits.length) return false;
  hits.sort((a, b) => a.dist - b.dist);
  // Always fill the nearest empty shell of this kind (avoids /youtube + paste creating duplicates).
  const pick = hits[0];
  return editor
    .chain()
    .command(({ tr }) => {
      tr.setNodeMarkup(pick.pos, undefined, {
        src: emb.src,
        kind: emb.kind,
        title: emb.title,
        original: emb.original,
        frameable: emb.frameable,
      });
      return true;
    })
    .run();
}

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
        src?: string | null;
        kind?: string;
        title?: string;
        original?: string | null;
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
      ...mediaLayoutTipTapAttributes(),
    };
  },
  parseHTML() {
    return [
      {
        tag: "div[data-note-embed]",
        getAttrs: (el) => {
          const d = el as HTMLElement;
          const frameAttr = d.getAttribute("data-frameable");
          const layout = readLayoutFromAttrs({
            widthPct: d.getAttribute("data-width-pct"),
            align: d.getAttribute("data-align"),
            wrap: d.getAttribute("data-wrap"),
            offsetX: d.getAttribute("data-ox"),
            offsetY: d.getAttribute("data-oy"),
          });
          return {
            src: d.getAttribute("data-src"),
            kind: d.getAttribute("data-kind") || "web",
            title: d.getAttribute("data-title") || "嵌入",
            original: d.getAttribute("data-original"),
            frameable: frameAttr == null ? true : frameAttr !== "0",
            ...layout,
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
    const layout = readLayoutFromAttrs(HTMLAttributes);
    const token = formatEmbedToken(kind, title, original || "", layout);

    return [
      "div",
      mergeAttributes({
        class: `rich-embed rich-embed--${kind}${frameable ? "" : " rich-embed--card"}${!original ? " is-empty" : ""} rich-media-frame`,
        "data-note-embed": "1",
        "data-src": src,
        "data-kind": kind,
        "data-title": title,
        "data-original": original,
        "data-frameable": frameable ? "1" : "0",
        ...layoutToDataAttrs(layout),
        contenteditable: "false",
      }),
      token,
    ];
  },
  addNodeView() {
    return ({ node, getPos, editor }: NodeViewRendererProps) => {
      let selected = false;
      let current = node;

      const patchAttrs = (patch: Record<string, unknown>, keepSelection = true) => {
        const pos = typeof getPos === "function" ? getPos() : null;
        if (typeof pos !== "number") return;
        const cur = editor.state.doc.nodeAt(pos);
        if (!cur || cur.type.name !== "noteEmbed") return;
        const chain = editor.chain().command(({ tr }) => {
          tr.setNodeMarkup(pos, undefined, { ...cur.attrs, ...patch });
          return true;
        });
        if (keepSelection) chain.setNodeSelection(pos);
        chain.run();
      };

      const chrome = mountLayoutChrome({
        updateAttributes: (patch) => patchAttrs(patch, false),
        onRequestSelect: () => {
          const pos = typeof getPos === "function" ? getPos() : null;
          if (typeof pos !== "number") return;
          editor.commands.setNodeSelection(pos);
        },
        onDelete: () => {
          const pos = typeof getPos === "function" ? getPos() : null;
          if (typeof pos !== "number") return;
          const cur = editor.state.doc.nodeAt(pos);
          if (!cur) return;
          editor
            .chain()
            .focus()
            .command(({ tr, dispatch }) => {
              tr.delete(pos, pos + cur.nodeSize);
              dispatch?.(tr);
              return true;
            })
            .run();
        },
        getReadOnly: () => !editor.isEditable,
      });

      const contentHost = document.createElement("div");
      contentHost.className = `rich-embed`;
      chrome.body.appendChild(contentHost);

      const applyResolved = (emb: EmbedResolved) => {
        const layout = readLayoutFromAttrs(current.attrs as Record<string, unknown>);
        patchAttrs({
          src: emb.src,
          kind: emb.kind,
          title: emb.title,
          original: emb.original,
          frameable: emb.frameable,
          ...layout,
        });
        editor.view.dom.dispatchEvent(
          new CustomEvent("cadence-embed-resolved", {
            bubbles: true,
            detail: emb,
          })
        );
      };

      const clearEmbed = (preferKind: string) => {
        const ui = embedKindUi(preferKind);
        const layout = readLayoutFromAttrs(current.attrs as Record<string, unknown>);
        patchAttrs({
          src: null,
          kind: preferKind || "web",
          title: ui.label,
          original: null,
          frameable: true,
          ...layout,
        });
      };

      const sync = (n: typeof node) => {
        current = n;
        const src = String(n.attrs.src || "");
        const kind = String(n.attrs.kind || "web");
        const title = String(n.attrs.title || embedKindUi(kind).label);
        const original = String(n.attrs.original || src || "");
        const frameable = n.attrs.frameable !== false && n.attrs.frameable !== "0";
        const layout = readLayoutFromAttrs(n.attrs as Record<string, unknown>);
        const ui = embedKindUi(kind);
        const empty = !original.trim();
        let host = title;
        try {
          if (original) host = new URL(original).hostname;
        } catch {
          /* keep */
        }

        contentHost.className = `rich-embed rich-embed--${kind}${frameable ? "" : " rich-embed--card"}${empty ? " is-empty" : ""}`;
        contentHost.setAttribute("data-note-embed", "1");
        contentHost.setAttribute("data-src", src);
        contentHost.setAttribute("data-kind", kind);
        contentHost.setAttribute("data-title", title);
        contentHost.setAttribute("data-original", original);
        contentHost.setAttribute("data-frameable", frameable ? "1" : "0");
        contentHost.contentEditable = "false";

        chrome.root.setAttribute("data-note-embed", "1");
        chrome.root.setAttribute("data-src", src);
        chrome.root.setAttribute("data-kind", kind);
        chrome.root.setAttribute("data-title", title);
        chrome.root.setAttribute("data-original", original);
        chrome.root.setAttribute("data-frameable", frameable ? "1" : "0");
        chrome.sync(n.attrs as Record<string, unknown>, selected, !editor.isEditable);

        const bar = `
          <div class="rich-embed-bar">
            <span class="rich-embed-label">${escapeHtml(ui.label)}</span>
            <input
              class="rich-embed-url-input"
              type="url"
              inputmode="url"
              spellcheck="false"
              placeholder="${escapeAttr(ui.placeholder)}"
              value="${escapeAttr(original)}"
              aria-label="${escapeAttr(ui.label)} 網址"
            />
            ${
              empty
                ? ""
                : `<button type="button" class="rich-embed-clear" title="清除網址">清除</button>`
            }
          </div>
        `;

        if (empty) {
          contentHost.innerHTML = `
            ${bar}
            <div class="rich-embed-empty-body">
              <p class="rich-embed-empty-hint">可貼上網址後按 Enter 嵌入；也可先留空。</p>
            </div>
          `;
        } else if (!frameable || kind === "link") {
          const fav =
            typeof window !== "undefined"
              ? `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64`
              : "";
          contentHost.innerHTML = `
            ${bar}
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
        } else {
          const isPdfDirect = kind === "pdf" && !/drive\.google|officeapps|docs\.google/i.test(src);
          const allow = isPdfDirect
            ? ""
            : ` allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"`;
          const referrer = isPdfDirect ? "" : ` referrerpolicy="no-referrer-when-downgrade"`;
          contentHost.innerHTML = `
            ${bar}
            <iframe class="rich-embed-frame" src="${escapeAttr(src)}" title="${escapeAttr(title)}" loading="lazy"${allow}${referrer}${isPdfDirect ? "" : " allowfullscreen"}></iframe>
            <a class="rich-embed-open" href="${escapeAttr(original)}" target="_blank" rel="noopener noreferrer">開啟原始連結</a>
          `;
        }

        // Keep markdown fallback text for serializers that read textContent
        const token = formatEmbedToken(kind, title, original, layout);
        let fallback = contentHost.querySelector(".rich-embed-md-fallback") as HTMLElement | null;
        if (!fallback) {
          fallback = document.createElement("span");
          fallback.className = "rich-embed-md-fallback";
          fallback.hidden = true;
          contentHost.appendChild(fallback);
        }
        fallback.textContent = token;

        const input = contentHost.querySelector(".rich-embed-url-input") as HTMLInputElement | null;
        const clearBtn = contentHost.querySelector(".rich-embed-clear") as HTMLButtonElement | null;

        const commitFromInput = () => {
          if (!input) return;
          const raw = input.value.trim();
          if (!raw) {
            if (!empty) clearEmbed(kind);
            return;
          }
          const emb = resolveEmbedUrl(raw);
          if (!emb) {
            input.classList.add("is-invalid");
            input.setAttribute("aria-invalid", "true");
            return;
          }
          input.classList.remove("is-invalid");
          input.removeAttribute("aria-invalid");
          if (emb.original === original && emb.src === src) return;
          applyResolved(emb);
        };

        if (input) {
          const stop = (e: Event) => e.stopPropagation();
          input.addEventListener("pointerdown", stop);
          input.addEventListener("mousedown", stop);
          input.addEventListener("click", stop);
          input.addEventListener("paste", (e) => {
            e.stopPropagation();
            queueMicrotask(() => commitFromInput());
          });
          input.addEventListener("keydown", (e) => {
            e.stopPropagation();
            if (e.key === "Enter") {
              e.preventDefault();
              commitFromInput();
            }
            if (e.key === "Escape") {
              e.preventDefault();
              input.value = original;
              input.blur();
            }
          });
        }
        if (clearBtn) {
          clearBtn.addEventListener("pointerdown", (e) => e.stopPropagation());
          clearBtn.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            clearEmbed(kind);
          });
        }
      };

      sync(node);
      const armInteractive = () => {
        contentHost.classList.add("is-interactive");
      };
      chrome.root.addEventListener("pointerdown", armInteractive);
      return {
        dom: chrome.root,
        selectNode: () => {
          selected = true;
          chrome.sync(current.attrs as Record<string, unknown>, true, !editor.isEditable);
        },
        deselectNode: () => {
          selected = false;
          chrome.sync(current.attrs as Record<string, unknown>, false, !editor.isEditable);
        },
        update: (updated) => {
          if (updated.type.name !== "noteEmbed") return false;
          const wasInteractive = contentHost.classList.contains("is-interactive");
          const active = document.activeElement;
          const keepFocus =
            active instanceof HTMLInputElement &&
            active.classList.contains("rich-embed-url-input") &&
            contentHost.contains(active);
          const draft = keepFocus ? active.value : null;
          const selStart = keepFocus ? active.selectionStart : null;
          const selEnd = keepFocus ? active.selectionEnd : null;
          sync(updated);
          if (wasInteractive) contentHost.classList.add("is-interactive");
          if (keepFocus && draft != null) {
            const next = contentHost.querySelector(".rich-embed-url-input") as HTMLInputElement | null;
            if (next) {
              next.value = draft;
              next.focus();
              if (selStart != null && selEnd != null) {
                try {
                  next.setSelectionRange(selStart, selEnd);
                } catch {
                  /* ignore */
                }
              }
            }
          }
          return true;
        },
        destroy: () => {
          chrome.root.removeEventListener("pointerdown", armInteractive);
          chrome.destroy();
        },
      };
    };
  },
  addCommands() {
    return {
      setNoteEmbed:
        (attrs) =>
        ({ commands }) =>
          commands.insertContent({
            type: this.name,
            attrs: {
              src: attrs.src ?? null,
              kind: attrs.kind || "web",
              title: attrs.title || embedKindUi(attrs.kind || "web").label,
              original: attrs.original ?? null,
              frameable: attrs.frameable !== false,
              ...readLayoutFromAttrs(attrs as Record<string, unknown>),
            },
          }),
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
