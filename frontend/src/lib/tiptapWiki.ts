import { Mark, mergeAttributes } from "@tiptap/core";

/** Wiki / bi-directional link: [[Title]] rendered as <a class="rich-wiki" data-wiki="…"> */
export const WikiLink = Mark.create({
  name: "wikiLink",
  inclusive: false,
  excludes: "link",

  addAttributes() {
    return {
      title: {
        default: null,
        parseHTML: (el) => el.getAttribute("data-wiki"),
        renderHTML: (attrs) => (attrs.title ? { "data-wiki": String(attrs.title) } : {}),
      },
      href: {
        default: "#",
        parseHTML: (el) => el.getAttribute("href") || "#",
        renderHTML: (attrs) => ({ href: String(attrs.href || "#") }),
      },
      missing: {
        default: false,
        parseHTML: (el) => el.classList.contains("is-missing"),
        renderHTML: () => ({}),
      },
    };
  },

  parseHTML() {
    return [{ tag: "a[data-wiki]" }];
  },

  renderHTML({ HTMLAttributes }) {
    const missing = Boolean((HTMLAttributes as { missing?: boolean }).missing);
    const attrs = { ...HTMLAttributes } as Record<string, unknown>;
    delete attrs.missing;
    return [
      "a",
      mergeAttributes(attrs, {
        class: missing ? "rich-wiki is-missing" : "rich-wiki",
        rel: "noopener",
        title: "點擊開啟",
      }),
      0,
    ];
  },
});

export function wikiLinkHtml(title: string, noteId?: string | null): string {
  const t = title.trim();
  if (!t) return "";
  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  if (noteId) {
    return `<a class="rich-wiki" data-wiki="${esc(t)}" href="/notes/${esc(noteId)}" title="點擊開啟">${esc(t)}</a>`;
  }
  return `<a class="rich-wiki is-missing" data-wiki="${esc(t)}" href="#" title="點擊開啟">${esc(t)}</a>`;
}
