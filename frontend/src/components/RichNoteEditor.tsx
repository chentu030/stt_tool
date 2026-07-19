"use client";

import { useEffect, useRef, useState, useCallback, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useEditor, EditorContent, Editor } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import Link from "@tiptap/extension-link";
import Image from "@tiptap/extension-image";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import Underline from "@tiptap/extension-underline";
import Highlight from "@tiptap/extension-highlight";
import Typography from "@tiptap/extension-typography";
import { markdownToHtml, htmlToMarkdown } from "@/lib/mdHtml";

type Props = {
  valueMd: string;
  onChangeMd: (md: string) => void;
  placeholder?: string;
  findOpen?: boolean;
  onFindOpenChange?: (open: boolean) => void;
  /** Mount formatting ribbon at page top (Word-style). */
  toolbarHost?: HTMLElement | null;
};

type SlashItem = {
  id: string;
  label: string;
  hint: string;
  run: (editor: Editor) => void;
};

const SLASH: SlashItem[] = [
  { id: "p", label: "文字", hint: "一般段落", run: (e) => e.chain().focus().setParagraph().run() },
  { id: "h1", label: "標題 1", hint: "大型標題", run: (e) => e.chain().focus().toggleHeading({ level: 1 }).run() },
  { id: "h2", label: "標題 2", hint: "中型標題", run: (e) => e.chain().focus().toggleHeading({ level: 2 }).run() },
  { id: "h3", label: "標題 3", hint: "小型標題", run: (e) => e.chain().focus().toggleHeading({ level: 3 }).run() },
  { id: "bullet", label: "項目清單", hint: "無序清單", run: (e) => e.chain().focus().toggleBulletList().run() },
  { id: "numbered", label: "編號清單", hint: "有序清單", run: (e) => e.chain().focus().toggleOrderedList().run() },
  { id: "todo", label: "待辦", hint: "可勾選", run: (e) => e.chain().focus().toggleTaskList().run() },
  { id: "quote", label: "引用", hint: "引用區塊", run: (e) => e.chain().focus().toggleBlockquote().run() },
  { id: "code", label: "程式碼", hint: "Code block", run: (e) => e.chain().focus().toggleCodeBlock().run() },
  { id: "hr", label: "分隔線", hint: "水平線", run: (e) => e.chain().focus().setHorizontalRule().run() },
  {
    id: "image",
    label: "圖片",
    hint: "以網址插入",
    run: (e) => {
      const url = window.prompt("圖片網址", "https://");
      if (url) e.chain().focus().setImage({ src: url }).run();
    },
  },
];

function filterSlash(q: string) {
  const s = q.toLowerCase();
  if (!s) return SLASH;
  return SLASH.filter((i) => i.label.includes(s) || i.hint.includes(s) || i.id.includes(s));
}

export default function RichNoteEditor({
  valueMd,
  onChangeMd,
  placeholder,
  findOpen,
  onFindOpenChange,
  toolbarHost,
}: Props) {
  const skip = useRef(false);
  const [slash, setSlash] = useState<{ query: string; index: number } | null>(null);
  const slashRef = useRef(slash);
  slashRef.current = slash;
  const applySlashRef = useRef<(item: SlashItem) => void>(() => {});
  const [findQ, setFindQ] = useState("");
  const [replaceQ, setReplaceQ] = useState("");
  const showFind = findOpen ?? false;
  const onChangeRef = useRef(onChangeMd);
  onChangeRef.current = onChangeMd;
  const [, setTick] = useState(0);

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
      }),
      Placeholder.configure({
        placeholder: placeholder || "輸入文字，或輸入 / 插入區塊…",
      }),
      Link.configure({
        openOnClick: false,
        autolink: true,
        HTMLAttributes: { class: "rich-link" },
      }),
      Image.configure({ HTMLAttributes: { class: "rich-image" } }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Underline,
      Highlight.configure({ multicolor: false }),
      Typography,
    ],
    content: markdownToHtml(valueMd),
    editorProps: {
      attributes: {
        class: "rich-prose",
      },
      handleKeyDown: (_view, event) => {
        const cur = slashRef.current;
        if (!cur) return false;
        const items = filterSlash(cur.query);
        if (event.key === "ArrowDown") {
          event.preventDefault();
          setSlash({ ...cur, index: (cur.index + 1) % Math.max(items.length, 1) });
          return true;
        }
        if (event.key === "ArrowUp") {
          event.preventDefault();
          setSlash({
            ...cur,
            index: (cur.index - 1 + items.length) % Math.max(items.length, 1),
          });
          return true;
        }
        if (event.key === "Enter" && items[cur.index]) {
          event.preventDefault();
          applySlashRef.current(items[cur.index]);
          return true;
        }
        if (event.key === "Escape") {
          event.preventDefault();
          setSlash(null);
          return true;
        }
        return false;
      },
    },
    onUpdate: ({ editor: ed }) => {
      const text = ed.state.doc.textBetween(
        Math.max(0, ed.state.selection.from - 40),
        ed.state.selection.from,
        "\n"
      );
      const m = text.match(/(?:^|\n)\/([^\s/]*)$/);
      if (m) setSlash({ query: m[1], index: 0 });
      else setSlash(null);

      skip.current = true;
      onChangeRef.current(htmlToMarkdown(ed.getHTML()));
    },
    onSelectionUpdate: () => setTick((t) => t + 1),
  });

  const applySlash = useCallback(
    (item: SlashItem) => {
      if (!editor) return;
      const { from } = editor.state.selection;
      const text = editor.state.doc.textBetween(Math.max(0, from - 40), from, "\n");
      const m = text.match(/(?:^|\n)(\/[^\s]*)$/);
      if (m) {
        const delFrom = from - m[1].length;
        editor.chain().focus().deleteRange({ from: delFrom, to: from }).run();
      }
      item.run(editor);
      setSlash(null);
    },
    [editor]
  );
  applySlashRef.current = applySlash;

  useEffect(() => {
    if (!editor) return;
    if (skip.current) {
      skip.current = false;
      return;
    }
    const next = markdownToHtml(valueMd);
    const cur = editor.getHTML();
    if (htmlToMarkdown(cur) !== (valueMd || "").trim()) {
      editor.commands.setContent(next, { emitUpdate: false });
    }
  }, [valueMd, editor]);

  const setLink = () => {
    if (!editor) return;
    const prev = editor.getAttributes("link").href as string | undefined;
    const url = window.prompt("連結網址", prev || "https://");
    if (url === null) return;
    if (url === "") editor.chain().focus().unsetLink().run();
    else editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
  };

  const replaceAll = () => {
    if (!editor || !findQ) return;
    const md = htmlToMarkdown(editor.getHTML()).split(findQ).join(replaceQ);
    editor.commands.setContent(markdownToHtml(md));
    skip.current = true;
    onChangeMd(md);
  };

  if (!editor) return <p style={{ color: "var(--text-muted)" }}>編輯器載入中…</p>;

  const slashItems = slash ? filterSlash(slash.query) : [];

  const ribbon = (
    <div className="doc-ribbon-inner">
      <div className="rich-toolbar rich-toolbar--ribbon">
        <ToolbarBtn active={editor.isActive("bold")} onClick={() => editor.chain().focus().toggleBold().run()} title="粗體">B</ToolbarBtn>
        <ToolbarBtn active={editor.isActive("italic")} onClick={() => editor.chain().focus().toggleItalic().run()} title="斜體"><em>I</em></ToolbarBtn>
        <ToolbarBtn active={editor.isActive("underline")} onClick={() => editor.chain().focus().toggleUnderline().run()} title="底線"><u>U</u></ToolbarBtn>
        <ToolbarBtn active={editor.isActive("strike")} onClick={() => editor.chain().focus().toggleStrike().run()} title="刪除線"><s>S</s></ToolbarBtn>
        <ToolbarBtn active={editor.isActive("highlight")} onClick={() => editor.chain().focus().toggleHighlight().run()} title="螢光筆">螢</ToolbarBtn>
        <span className="rich-toolbar-sep" />
        <ToolbarBtn active={editor.isActive("heading", { level: 1 })} onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}>H1</ToolbarBtn>
        <ToolbarBtn active={editor.isActive("heading", { level: 2 })} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}>H2</ToolbarBtn>
        <ToolbarBtn active={editor.isActive("heading", { level: 3 })} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}>H3</ToolbarBtn>
        <span className="rich-toolbar-sep" />
        <ToolbarBtn active={editor.isActive("bulletList")} onClick={() => editor.chain().focus().toggleBulletList().run()}>• 清單</ToolbarBtn>
        <ToolbarBtn active={editor.isActive("orderedList")} onClick={() => editor.chain().focus().toggleOrderedList().run()}>1. 編號</ToolbarBtn>
        <ToolbarBtn active={editor.isActive("taskList")} onClick={() => editor.chain().focus().toggleTaskList().run()}>☐ 待辦</ToolbarBtn>
        <ToolbarBtn active={editor.isActive("blockquote")} onClick={() => editor.chain().focus().toggleBlockquote().run()}>引用</ToolbarBtn>
        <ToolbarBtn active={editor.isActive("codeBlock")} onClick={() => editor.chain().focus().toggleCodeBlock().run()}>{"</>"}</ToolbarBtn>
        <ToolbarBtn onClick={setLink} active={editor.isActive("link")}>連結</ToolbarBtn>
        <ToolbarBtn
          onClick={() => {
            const url = window.prompt("圖片網址", "https://");
            if (url) editor.chain().focus().setImage({ src: url }).run();
          }}
        >
          圖片
        </ToolbarBtn>
        <ToolbarBtn onClick={() => onFindOpenChange?.(true)}>尋找</ToolbarBtn>
      </div>
      {showFind && (
        <div className="rich-find rich-find--ribbon">
          <input className="input" placeholder="尋找…" value={findQ} onChange={(e) => setFindQ(e.target.value)} autoFocus />
          <input className="input" placeholder="取代為…" value={replaceQ} onChange={(e) => setReplaceQ(e.target.value)} />
          <button type="button" className="btn btn-sm btn-soft" onClick={replaceAll}>全部取代</button>
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => onFindOpenChange?.(false)}>關閉</button>
        </div>
      )}
    </div>
  );

  return (
    <div className="rich-editor">
      {toolbarHost ? createPortal(ribbon, toolbarHost) : ribbon}

      <BubbleMenu editor={editor} className="rich-bubble">
        <ToolbarBtn active={editor.isActive("bold")} onClick={() => editor.chain().focus().toggleBold().run()}>B</ToolbarBtn>
        <ToolbarBtn active={editor.isActive("italic")} onClick={() => editor.chain().focus().toggleItalic().run()}><em>I</em></ToolbarBtn>
        <ToolbarBtn active={editor.isActive("underline")} onClick={() => editor.chain().focus().toggleUnderline().run()}><u>U</u></ToolbarBtn>
        <ToolbarBtn active={editor.isActive("highlight")} onClick={() => editor.chain().focus().toggleHighlight().run()}>螢</ToolbarBtn>
        <ToolbarBtn onClick={setLink}>連結</ToolbarBtn>
      </BubbleMenu>

      <div className="rich-canvas">
        <EditorContent editor={editor} />
        {slash && slashItems.length > 0 && (
          <div className="slash-menu rich-slash">
            <p className="rich-slash-label">插入區塊</p>
            {slashItems.map((item, idx) => (
              <button
                key={item.id}
                type="button"
                className={idx === slash.index ? "is-active" : ""}
                onMouseDown={(e) => {
                  e.preventDefault();
                  applySlash(item);
                }}
              >
                <strong>{item.label}</strong>
                <span>{item.hint}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ToolbarBtn({
  children,
  onClick,
  active,
  title,
}: {
  children: ReactNode;
  onClick: () => void;
  active?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      title={title}
      className={`rich-tool-btn${active ? " is-active" : ""}`}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
