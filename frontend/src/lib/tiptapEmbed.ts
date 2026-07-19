import { askPrompt } from "@/lib/dialogs";
import { Node, mergeAttributes } from "@tiptap/core";
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

export const MathInline = Node.create({
  name: "mathInline",
  group: "inline",
  inline: true,
  atom: true,
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
      ["span", { class: "rich-math-render" }, ""],
    ];
  },
  addNodeView() {
    return ({ node }) => {
      const dom = document.createElement("span");
      dom.className = "rich-math-inline";
      dom.setAttribute("data-math-inline", "1");
      dom.setAttribute("data-formula", node.attrs.formula || "");
      dom.contentEditable = "false";
      dom.innerHTML = renderKatex(node.attrs.formula || "", false);
      dom.title = "雙擊編輯公式";
      dom.addEventListener("dblclick", () => {
        void (async () => {
          const next = await askPrompt("LaTeX 行內公式", node.attrs.formula || "");
          if (next === null) return;
          dom.dispatchEvent(
            new CustomEvent("cadence-edit-math", {
              bubbles: true,
              detail: { type: "mathInline", formula: next, pos: null },
            })
          );
        })();
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
  addCommands() {
    return {
      setMathInline:
        (formula) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs: { formula } }),
    };
  },
});

export const MathBlock = Node.create({
  name: "mathBlock",
  group: "block",
  atom: true,
  defining: true,
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
    return ({ node }) => {
      const dom = document.createElement("div");
      dom.className = "rich-math-block";
      dom.setAttribute("data-math-block", "1");
      dom.setAttribute("data-formula", node.attrs.formula || "");
      dom.contentEditable = "false";
      dom.innerHTML = renderKatex(node.attrs.formula || "", true);
      dom.title = "雙擊編輯公式";
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
    };
  },
  parseHTML() {
    return [
      {
        tag: "div[data-note-embed]",
        getAttrs: (el) => {
          const d = el as HTMLElement;
          return {
            src: d.getAttribute("data-src"),
            kind: d.getAttribute("data-kind") || "web",
            title: d.getAttribute("data-title") || "嵌入",
            original: d.getAttribute("data-original"),
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
    const isPdfDirect = kind === "pdf" && !/drive\.google|officeapps/i.test(src);

    const inner = isPdfDirect
      ? [
          "iframe",
          {
            class: "rich-embed-frame",
            src,
            title,
            loading: "lazy",
          },
        ]
      : [
          "iframe",
          {
            class: "rich-embed-frame",
            src,
            title,
            loading: "lazy",
            allow:
              "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen",
            allowfullscreen: "true",
            referrerpolicy: "no-referrer-when-downgrade",
          },
        ];

    return [
      "div",
      mergeAttributes({
        class: `rich-embed rich-embed--${kind}`,
        "data-note-embed": "1",
        "data-src": src,
        "data-kind": kind,
        "data-title": title,
        "data-original": original,
        contenteditable: "false",
      }),
      ["div", { class: "rich-embed-label" }, title],
      inner,
      [
        "a",
        {
          class: "rich-embed-open",
          href: original,
          target: "_blank",
          rel: "noopener noreferrer",
        },
        "開啟原始連結",
      ],
    ];
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
