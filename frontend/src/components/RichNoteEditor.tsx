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
import { TextStyle } from "@tiptap/extension-text-style";
import { Color } from "@tiptap/extension-color";
import Typography from "@tiptap/extension-typography";
import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import { common, createLowlight } from "lowlight";
import { markdownToHtml, htmlToMarkdown, formatFileSize } from "@/lib/mdHtml";
import { NoteAudio, NoteVideo, NoteFile } from "@/lib/tiptapMedia";
import { MathInline, MathBlock, NoteEmbed } from "@/lib/tiptapEmbed";
import { resolveEmbedUrl, promptInsertUrl } from "@/lib/embedUrls";
import { uploadNoteMedia, detectMediaKind } from "@/lib/firebase";

const lowlight = createLowlight(common);

type Props = {
  valueMd: string;
  onChangeMd: (md: string) => void;
  placeholder?: string;
  findOpen?: boolean;
  onFindOpenChange?: (open: boolean) => void;
  toolbarHost?: HTMLElement | null;
  userId?: string;
  noteId?: string;
};

type SlashItem = {
  id: string;
  label: string;
  hint: string;
  run: (editor: Editor) => void;
};

function filterSlash(items: SlashItem[], q: string) {
  const s = q.toLowerCase();
  if (!s) return items;
  return items.filter((i) => i.label.includes(s) || i.hint.includes(s) || i.id.includes(s));
}

export default function RichNoteEditor({
  valueMd,
  onChangeMd,
  placeholder,
  findOpen,
  onFindOpenChange,
  toolbarHost,
  userId,
  noteId,
}: Props) {
  const skip = useRef(false);
  const [slash, setSlash] = useState<{ query: string; index: number } | null>(null);
  const slashRef = useRef(slash);
  slashRef.current = slash;
  const applySlashRef = useRef<(item: SlashItem) => void>(() => {});
  const [findQ, setFindQ] = useState("");
  const [replaceQ, setReplaceQ] = useState("");
  const [uploadPct, setUploadPct] = useState<number | null>(null);
  const [uploadError, setUploadError] = useState("");
  const [hlOpen, setHlOpen] = useState(false);
  const [txOpen, setTxOpen] = useState(false);
  const [hlColor, setHlColor] = useState(() => loadStoredColor("cadence_hl_color", "#fde047"));
  const [txColor, setTxColor] = useState(() => loadStoredColor("cadence_tx_color", "#dc2626"));
  const [hlCustoms, setHlCustoms] = useState<string[]>(() => loadCustomColors("cadence_hl_customs", HL_PRESETS));
  const [txCustoms, setTxCustoms] = useState<string[]>(() => loadCustomColors("cadence_tx_customs", TX_PRESETS));
  const hlPanelRef = useRef<HTMLDivElement>(null);
  const txPanelRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<Editor | null>(null);
  const showFind = findOpen ?? false;
  const onChangeRef = useRef(onChangeMd);
  onChangeRef.current = onChangeMd;
  const [, setTick] = useState(0);

  useEffect(() => {
    try {
      localStorage.setItem("cadence_hl_color", hlColor);
    } catch {
      /* ignore */
    }
  }, [hlColor]);

  useEffect(() => {
    try {
      localStorage.setItem("cadence_tx_color", txColor);
    } catch {
      /* ignore */
    }
  }, [txColor]);

  useEffect(() => {
    try {
      localStorage.setItem("cadence_hl_customs", JSON.stringify(hlCustoms));
    } catch {
      /* ignore */
    }
  }, [hlCustoms]);

  useEffect(() => {
    try {
      localStorage.setItem("cadence_tx_customs", JSON.stringify(txCustoms));
    } catch {
      /* ignore */
    }
  }, [txCustoms]);

  useEffect(() => {
    if (!hlOpen && !txOpen) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (hlOpen && hlPanelRef.current && !hlPanelRef.current.contains(t)) setHlOpen(false);
      if (txOpen && txPanelRef.current && !txPanelRef.current.contains(t)) setTxOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [hlOpen, txOpen]);

  const applyHighlight = (color?: string) => {
    const ed = editorRef.current;
    if (!ed) return;
    const c = color || hlColor;
    if (ed.isActive("highlight") && !color) {
      const cur = ed.getAttributes("highlight").color as string | undefined;
      if (!cur || cur === c) {
        ed.chain().focus().unsetHighlight().run();
        return;
      }
    }
    ed.chain().focus().toggleHighlight({ color: c }).run();
  };

  const setHighlightColor = (color: string) => {
    const next = normalizeHex(color);
    if (!next) return;
    setHlColor(next);
    const ed = editorRef.current;
    if (!ed || ed.state.selection.empty) return;
    ed.chain().focus().setHighlight({ color: next }).run();
  };

  const applyTextColor = (color?: string) => {
    const ed = editorRef.current;
    if (!ed) return;
    const c = color || txColor;
    const cur = ed.getAttributes("textStyle").color as string | undefined;
    if (cur && normalizeHex(cur) === normalizeHex(c) && !color) {
      ed.chain().focus().unsetColor().run();
      return;
    }
    ed.chain().focus().setColor(c).run();
  };

  const setTextColor = (color: string) => {
    const next = normalizeHex(color);
    if (!next) return;
    setTxColor(next);
    const ed = editorRef.current;
    if (!ed || ed.state.selection.empty) return;
    ed.chain().focus().setColor(next).run();
  };

  const clearTextColor = () => {
    const ed = editorRef.current;
    if (!ed) return;
    ed.chain().focus().unsetColor().run();
  };

  const addHlCustom = () => {
    const next = normalizeHex(hlColor);
    if (!next || HL_PRESETS.includes(next) || hlCustoms.includes(next)) return;
    setHlCustoms((prev) => [next, ...prev].slice(0, 16));
  };

  const addTxCustom = () => {
    const next = normalizeHex(txColor);
    if (!next || TX_PRESETS.includes(next) || txCustoms.includes(next)) return;
    setTxCustoms((prev) => [next, ...prev].slice(0, 16));
  };

  const imageRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const audioRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLInputElement>(null);
  const pdfRef = useRef<HTMLInputElement>(null);
  const pptRef = useRef<HTMLInputElement>(null);

  const insertUploaded = useCallback(async (file: File) => {
    if (!userId || !noteId) {
      setUploadError("無法上傳：缺少登入或筆記編號");
      return;
    }
    const MAX = 80 * 1024 * 1024;
    if (file.size > MAX) {
      setUploadError("檔案超過 80MB");
      return;
    }
    setUploadError("");
    setUploadPct(0);
    try {
      const { url, name } = await uploadNoteMedia(userId, noteId, file, setUploadPct);
      const ed = editorRef.current;
      if (!ed) return;
      const kind = detectMediaKind(file);
      const lower = name.toLowerCase();

      if (kind === "image") {
        ed.chain().focus().setImage({ src: url, alt: name }).run();
      } else if (kind === "audio") {
        ed.chain().focus().setNoteAudio({ src: url, title: name }).run();
      } else if (kind === "video") {
        ed.chain().focus().setNoteVideo({ src: url, title: name }).run();
      } else if (lower.endsWith(".pdf")) {
        const emb = resolveEmbedUrl(url, name);
        if (emb) {
          ed.chain().focus().setNoteEmbed({
            src: emb.src,
            kind: "pdf",
            title: name,
            original: url,
          }).run();
        }
      } else if (/\.(ppt|pptx)$/i.test(lower)) {
        const emb = resolveEmbedUrl(url, name);
        if (emb) {
          ed.chain().focus().setNoteEmbed({
            src: emb.src,
            kind: "ppt",
            title: name,
            original: url,
          }).run();
        }
      } else {
        ed.chain().focus().setNoteFile({
          href: url,
          name,
          size: formatFileSize(file.size),
        }).run();
      }
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : "上傳失敗");
    } finally {
      setUploadPct(null);
    }
  }, [userId, noteId]);

  const insertEmbedFromPrompt = useCallback((hint: string) => {
    const url = promptInsertUrl(hint);
    if (!url) return;
    const emb = resolveEmbedUrl(url);
    if (!emb) {
      setUploadError("無法辨識此連結");
      return;
    }
    editorRef.current?.chain().focus().setNoteEmbed({
      src: emb.src,
      kind: emb.kind,
      title: emb.title,
      original: emb.original,
    }).run();
  }, []);

  const buildSlash = useCallback((editor: Editor): SlashItem[] => [
    { id: "p", label: "文字", hint: "一般段落", run: (e) => e.chain().focus().setParagraph().run() },
    { id: "h1", label: "標題 1", hint: "大型標題", run: (e) => e.chain().focus().toggleHeading({ level: 1 }).run() },
    { id: "h2", label: "標題 2", hint: "中型標題", run: (e) => e.chain().focus().toggleHeading({ level: 2 }).run() },
    { id: "h3", label: "標題 3", hint: "小型標題", run: (e) => e.chain().focus().toggleHeading({ level: 3 }).run() },
    { id: "bullet", label: "項目清單", hint: "無序清單", run: (e) => e.chain().focus().toggleBulletList().run() },
    { id: "numbered", label: "編號清單", hint: "有序清單", run: (e) => e.chain().focus().toggleOrderedList().run() },
    { id: "todo", label: "待辦", hint: "可勾選", run: (e) => e.chain().focus().toggleTaskList().run() },
    { id: "quote", label: "引用", hint: "引用區塊", run: (e) => e.chain().focus().toggleBlockquote().run() },
    { id: "code", label: "程式碼", hint: "Code block", run: (e) => e.chain().focus().toggleCodeBlock().run() },
    {
      id: "math",
      label: "LaTeX 公式",
      hint: "區塊公式 $$",
      run: (e) => {
        const f = window.prompt("LaTeX 公式", "E = mc^2");
        if (f) e.chain().focus().setMathBlock(f).run();
      },
    },
    {
      id: "mathi",
      label: "行內公式",
      hint: "$...$",
      run: (e) => {
        const f = window.prompt("行內 LaTeX", "x^2");
        if (f) e.chain().focus().setMathInline(f).run();
      },
    },
    { id: "hr", label: "分隔線", hint: "水平線", run: (e) => e.chain().focus().setHorizontalRule().run() },
    { id: "image", label: "圖片", hint: "上傳圖片", run: () => imageRef.current?.click() },
    { id: "file", label: "檔案", hint: "上傳任意檔案", run: () => fileRef.current?.click() },
    { id: "audio", label: "語音／音訊", hint: "上傳音訊", run: () => audioRef.current?.click() },
    { id: "video", label: "影片檔", hint: "上傳影片", run: () => videoRef.current?.click() },
    { id: "pdf", label: "PDF 預覽", hint: "上傳或之後貼連結", run: () => pdfRef.current?.click() },
    { id: "ppt", label: "PPT 預覽", hint: "上傳簡報檔", run: () => pptRef.current?.click() },
    {
      id: "youtube",
      label: "YouTube",
      hint: "貼上影片連結",
      run: () => insertEmbedFromPrompt("YouTube 連結"),
    },
    {
      id: "drive",
      label: "Google Drive",
      hint: "貼上分享連結",
      run: () => insertEmbedFromPrompt("Google Drive / Docs 分享連結"),
    },
    {
      id: "web",
      label: "網站",
      hint: "嵌入網頁",
      run: () => insertEmbedFromPrompt("網站網址（部分網站可能拒絕嵌入）"),
    },
    {
      id: "imglink",
      label: "圖片網址",
      run: (e) => {
        const url = window.prompt("圖片網址", "https://");
        if (url) e.chain().focus().setImage({ src: url }).run();
      },
      hint: "用 URL 插入",
    },
  ], [insertEmbedFromPrompt]);

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        codeBlock: false,
      }),
      CodeBlockLowlight.configure({
        lowlight,
        defaultLanguage: "plaintext",
      }),
      Placeholder.configure({
        placeholder: placeholder || "輸入文字，或輸入 / 插入區塊…",
      }),
      Link.configure({
        openOnClick: false,
        autolink: true,
        HTMLAttributes: { class: "rich-link" },
      }),
      Image.configure({
        allowBase64: false,
        HTMLAttributes: { class: "rich-image" },
      }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Underline,
      TextStyle,
      Color,
      Highlight.configure({ multicolor: true }),
      Typography,
      NoteAudio,
      NoteVideo,
      NoteFile,
      MathInline,
      MathBlock,
      NoteEmbed,
    ],
    content: markdownToHtml(valueMd),
    editorProps: {
      attributes: { class: "rich-prose" },
      handlePaste: (_view, event) => {
        const items = event.clipboardData?.items;
        if (!items) return false;
        for (const item of Array.from(items)) {
          if (item.type.startsWith("image/")) {
            const file = item.getAsFile();
            if (file) {
              event.preventDefault();
              void insertUploaded(file);
              return true;
            }
          }
        }
        return false;
      },
      handleDrop: (_view, event) => {
        const files = event.dataTransfer?.files;
        if (!files?.length) return false;
        event.preventDefault();
        Array.from(files).forEach((f) => { void insertUploaded(f); });
        return true;
      },
      handleKeyDown: (_view, event) => {
        const cur = slashRef.current;
        if (!cur || !editorRef.current) return false;
        const items = filterSlash(buildSlash(editorRef.current), cur.query);
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

  editorRef.current = editor;

  const applySlash = useCallback(
    (item: SlashItem) => {
      if (!editor) return;
      const { from } = editor.state.selection;
      const text = editor.state.doc.textBetween(Math.max(0, from - 40), from, "\n");
      const m = text.match(/(?:^|\n)(\/[^\s]*)$/);
      if (m) {
        editor.chain().focus().deleteRange({ from: from - m[1].length, to: from }).run();
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
    if (htmlToMarkdown(editor.getHTML()) !== (valueMd || "").trim()) {
      editor.commands.setContent(next, { emitUpdate: false });
    }
  }, [valueMd, editor]);

  // Re-resolve embed src from original URL when loading markdown (src may equal original)
  useEffect(() => {
    if (!editor) return;
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name !== "noteEmbed") return;
      const original = node.attrs.original || node.attrs.src;
      const emb = resolveEmbedUrl(original || "", node.attrs.title || "");
      if (emb && emb.src !== node.attrs.src) {
        editor.commands.command(({ tr }) => {
          tr.setNodeMarkup(pos, undefined, {
            ...node.attrs,
            src: emb.src,
            kind: emb.kind,
            title: node.attrs.title || emb.title,
            original: emb.original,
          });
          return true;
        });
      }
    });
  }, [editor, valueMd]);

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

  const onPick = (files: FileList | null) => {
    if (!files?.length) return;
    Array.from(files).forEach((f) => { void insertUploaded(f); });
  };

  if (!editor) return <p style={{ color: "var(--text-muted)" }}>編輯器載入中…</p>;

  const slashItems = slash ? filterSlash(buildSlash(editor), slash.query) : [];

  const hiddenInputs = (
    <>
      <input ref={imageRef} type="file" accept="image/*" hidden multiple onChange={(e) => { onPick(e.target.files); e.target.value = ""; }} />
      <input ref={fileRef} type="file" hidden multiple onChange={(e) => { onPick(e.target.files); e.target.value = ""; }} />
      <input ref={audioRef} type="file" accept="audio/*" hidden multiple onChange={(e) => { onPick(e.target.files); e.target.value = ""; }} />
      <input ref={videoRef} type="file" accept="video/*" hidden multiple onChange={(e) => { onPick(e.target.files); e.target.value = ""; }} />
      <input ref={pdfRef} type="file" accept="application/pdf,.pdf" hidden multiple onChange={(e) => { onPick(e.target.files); e.target.value = ""; }} />
      <input ref={pptRef} type="file" accept=".ppt,.pptx,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation" hidden multiple onChange={(e) => { onPick(e.target.files); e.target.value = ""; }} />
    </>
  );

  const ribbon = (
    <div className="doc-ribbon-inner">
      <div className="rich-toolbar rich-toolbar--ribbon">
        <ToolbarBtn active={editor.isActive("bold")} onClick={() => editor.chain().focus().toggleBold().run()} title="粗體">B</ToolbarBtn>
        <ToolbarBtn active={editor.isActive("italic")} onClick={() => editor.chain().focus().toggleItalic().run()} title="斜體"><em>I</em></ToolbarBtn>
        <ToolbarBtn active={editor.isActive("underline")} onClick={() => editor.chain().focus().toggleUnderline().run()} title="底線"><u>U</u></ToolbarBtn>
        <ToolbarBtn active={editor.isActive("strike")} onClick={() => editor.chain().focus().toggleStrike().run()} title="刪除線"><s>S</s></ToolbarBtn>
        <div className="hl-wrap" ref={hlPanelRef}>
          <ToolbarBtn
            active={editor.isActive("highlight")}
            onClick={() => applyHighlight()}
            title="螢光筆"
          >
            <span className="hl-swatch" style={{ background: hlColor }} />
            螢
          </ToolbarBtn>
          <button
            type="button"
            className={`rich-tool-btn hl-caret${hlOpen ? " is-active" : ""}`}
            title="螢光筆顏色"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              setTxOpen(false);
              setHlOpen((v) => !v);
            }}
          >
            ▾
          </button>
          {hlOpen && (
            <ColorPickerPanel
              color={hlColor}
              presets={HL_PRESETS}
              customs={hlCustoms}
              onColorChange={setHighlightColor}
              onColorDraft={setHlColor}
              onPick={(c) => {
                setHighlightColor(c);
                applyHighlight(c);
              }}
              onAddCustom={addHlCustom}
              onRemoveCustom={(c) => setHlCustoms((prev) => prev.filter((x) => x !== c))}
              onApply={() => {
                applyHighlight(hlColor);
                setHlOpen(false);
              }}
            />
          )}
        </div>
        <div className="hl-wrap" ref={txPanelRef}>
          <ToolbarBtn
            active={!!editor.getAttributes("textStyle").color}
            onClick={() => applyTextColor()}
            title="文字顏色"
          >
            <span className="tx-swatch-wrap">
              A
              <span className="tx-swatch" style={{ background: txColor }} />
            </span>
          </ToolbarBtn>
          <button
            type="button"
            className={`rich-tool-btn hl-caret${txOpen ? " is-active" : ""}`}
            title="文字顏色"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              setHlOpen(false);
              setTxOpen((v) => !v);
            }}
          >
            ▾
          </button>
          {txOpen && (
            <ColorPickerPanel
              color={txColor}
              presets={TX_PRESETS}
              customs={txCustoms}
              onColorChange={setTextColor}
              onColorDraft={setTxColor}
              onPick={(c) => {
                setTextColor(c);
                applyTextColor(c);
              }}
              onAddCustom={addTxCustom}
              onRemoveCustom={(c) => setTxCustoms((prev) => prev.filter((x) => x !== c))}
              onApply={() => {
                applyTextColor(txColor);
                setTxOpen(false);
              }}
              onClear={() => {
                clearTextColor();
                setTxOpen(false);
              }}
              clearLabel="清除顏色"
            />
          )}
        </div>
        <span className="rich-toolbar-sep" />
        <ToolbarBtn active={editor.isActive("heading", { level: 1 })} onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}>H1</ToolbarBtn>
        <ToolbarBtn active={editor.isActive("heading", { level: 2 })} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}>H2</ToolbarBtn>
        <ToolbarBtn active={editor.isActive("heading", { level: 3 })} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}>H3</ToolbarBtn>
        <span className="rich-toolbar-sep" />
        <ToolbarBtn active={editor.isActive("bulletList")} onClick={() => editor.chain().focus().toggleBulletList().run()}>• 清單</ToolbarBtn>
        <ToolbarBtn active={editor.isActive("orderedList")} onClick={() => editor.chain().focus().toggleOrderedList().run()}>1. 編號</ToolbarBtn>
        <ToolbarBtn active={editor.isActive("taskList")} onClick={() => editor.chain().focus().toggleTaskList().run()}>☐ 待辦</ToolbarBtn>
        <ToolbarBtn active={editor.isActive("blockquote")} onClick={() => editor.chain().focus().toggleBlockquote().run()}>引用</ToolbarBtn>
        <ToolbarBtn active={editor.isActive("codeBlock")} onClick={() => editor.chain().focus().toggleCodeBlock().run()} title="程式碼">{"</>"}</ToolbarBtn>
        <ToolbarBtn
          onClick={() => {
            const f = window.prompt("LaTeX 公式", "E = mc^2");
            if (f) editor.chain().focus().setMathBlock(f).run();
          }}
          title="LaTeX"
        >
          ∑
        </ToolbarBtn>
        <ToolbarBtn onClick={setLink} active={editor.isActive("link")}>連結</ToolbarBtn>
        <span className="rich-toolbar-sep" />
        <ToolbarBtn onClick={() => imageRef.current?.click()} title="上傳圖片">圖片</ToolbarBtn>
        <ToolbarBtn onClick={() => fileRef.current?.click()} title="上傳檔案">檔案</ToolbarBtn>
        <ToolbarBtn onClick={() => audioRef.current?.click()} title="上傳音訊">語音</ToolbarBtn>
        <ToolbarBtn onClick={() => videoRef.current?.click()} title="上傳影片">影片</ToolbarBtn>
        <ToolbarBtn onClick={() => pdfRef.current?.click()} title="PDF 預覽">PDF</ToolbarBtn>
        <ToolbarBtn onClick={() => pptRef.current?.click()} title="PPT 預覽">PPT</ToolbarBtn>
        <ToolbarBtn onClick={() => insertEmbedFromPrompt("YouTube 連結")} title="YouTube">YT</ToolbarBtn>
        <ToolbarBtn onClick={() => insertEmbedFromPrompt("Google Drive 分享連結")} title="Drive">Drive</ToolbarBtn>
        <ToolbarBtn onClick={() => insertEmbedFromPrompt("網站網址")} title="嵌入網站">網站</ToolbarBtn>
        <ToolbarBtn onClick={() => onFindOpenChange?.(true)}>尋找</ToolbarBtn>
      </div>
      {uploadPct !== null && (
        <div className="rich-upload-bar">
          <span>上傳中 {uploadPct}%</span>
          <div className="progress-track"><div className="progress-fill" style={{ width: `${uploadPct}%` }} /></div>
        </div>
      )}
      {uploadError && <p className="rich-upload-error">{uploadError}</p>}
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
      {hiddenInputs}
      {toolbarHost ? createPortal(ribbon, toolbarHost) : ribbon}

      <BubbleMenu editor={editor} className="rich-bubble">
        <ToolbarBtn active={editor.isActive("bold")} onClick={() => editor.chain().focus().toggleBold().run()}>B</ToolbarBtn>
        <ToolbarBtn active={editor.isActive("italic")} onClick={() => editor.chain().focus().toggleItalic().run()}><em>I</em></ToolbarBtn>
        <ToolbarBtn active={editor.isActive("code")} onClick={() => editor.chain().focus().toggleCode().run()}>{"<>"}</ToolbarBtn>
        <ToolbarBtn
          active={editor.isActive("highlight")}
          onClick={() => applyHighlight()}
          title="螢光筆"
        >
          <span className="hl-swatch" style={{ background: hlColor }} />
          螢
        </ToolbarBtn>
        <ToolbarBtn
          onClick={() => {
            const f = window.prompt("行內 LaTeX", "x^2");
            if (f) editor.chain().focus().setMathInline(f).run();
          }}
        >
          ∑
        </ToolbarBtn>
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

function ColorPickerPanel({
  color,
  presets,
  customs,
  onColorChange,
  onColorDraft,
  onPick,
  onAddCustom,
  onRemoveCustom,
  onApply,
  onClear,
  clearLabel,
}: {
  color: string;
  presets: string[];
  customs: string[];
  onColorChange: (c: string) => void;
  onColorDraft: (c: string) => void;
  onPick: (c: string) => void;
  onAddCustom: () => void;
  onRemoveCustom: (c: string) => void;
  onApply: () => void;
  onClear?: () => void;
  clearLabel?: string;
}) {
  const rgb = hexToRgb(color);
  const normalized = normalizeHex(color);
  const canAdd =
    !!normalized && !presets.includes(normalized) && !customs.includes(normalized);

  return (
    <div className="hl-panel">
      <div className="hl-section">
        <p className="hl-section-label">預設</p>
        <div className="hl-presets">
          {presets.map((c) => (
            <button
              key={c}
              type="button"
              className={`hl-preset${normalized === c ? " is-on" : ""}`}
              style={{ background: c }}
              title={c}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => onPick(c)}
            />
          ))}
        </div>
      </div>
      <div className="hl-section">
        <div className="hl-section-head">
          <p className="hl-section-label">我的顏色</p>
          <button
            type="button"
            className="hl-add-btn"
            disabled={!canAdd}
            title={canAdd ? "把目前顏色加入常用" : "已在色盤中"}
            onMouseDown={(e) => e.preventDefault()}
            onClick={onAddCustom}
          >
            + 新增
          </button>
        </div>
        {customs.length === 0 ? (
          <p className="hl-empty">用下方色盤調色後按「+ 新增」</p>
        ) : (
          <div className="hl-presets hl-presets--custom">
            {customs.map((c) => (
              <div key={c} className="hl-custom-slot">
                <button
                  type="button"
                  className={`hl-preset${normalized === c ? " is-on" : ""}`}
                  style={{ background: c }}
                  title={c}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => onPick(c)}
                />
                <button
                  type="button"
                  className="hl-remove"
                  title="移除"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => onRemoveCustom(c)}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
      <label className="hl-row">
        <span>色盤</span>
        <input
          type="color"
          value={normalized || presets[0]}
          onChange={(e) => onColorChange(e.target.value)}
        />
      </label>
      <div className="hl-rgb">
        {(["r", "g", "b"] as const).map((ch) => (
          <label key={ch}>
            <span>{ch.toUpperCase()}</span>
            <input
              type="number"
              min={0}
              max={255}
              value={rgb[ch]}
              onChange={(e) => {
                const n = Math.min(255, Math.max(0, Number(e.target.value) || 0));
                const next = { ...rgb, [ch]: n };
                onColorChange(rgbToHex(next.r, next.g, next.b));
              }}
            />
          </label>
        ))}
      </div>
      <div className="hl-hex-row">
        <span>HEX</span>
        <input
          className="input"
          value={color}
          onChange={(e) => {
            const v = e.target.value.trim();
            onColorDraft(v);
            if (normalizeHex(v)) onColorChange(v);
          }}
        />
        <button
          type="button"
          className="btn btn-sm btn-soft"
          onMouseDown={(e) => e.preventDefault()}
          onClick={onApply}
        >
          套用
        </button>
      </div>
      {onClear && (
        <button
          type="button"
          className="btn btn-sm btn-ghost hl-clear"
          onMouseDown={(e) => e.preventDefault()}
          onClick={onClear}
        >
          {clearLabel || "清除"}
        </button>
      )}
    </div>
  );
}

const HL_PRESETS = [
  "#fde047",
  "#86efac",
  "#7dd3fc",
  "#f9a8d4",
  "#fdba74",
  "#c4b5fd",
  "#fca5a5",
  "#e2e8f0",
];

const TX_PRESETS = [
  "#0f172a",
  "#dc2626",
  "#ea580c",
  "#ca8a04",
  "#16a34a",
  "#0891b2",
  "#2563eb",
  "#7c3aed",
];

function loadStoredColor(key: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  try {
    return normalizeHex(localStorage.getItem(key) || "") || fallback;
  } catch {
    return fallback;
  }
}

function loadCustomColors(key: string, presets: string[]): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((x) => (typeof x === "string" ? normalizeHex(x) : null))
      .filter((x): x is string => !!x)
      .filter((c, i, arr) => arr.indexOf(c) === i && !presets.includes(c))
      .slice(0, 16);
  } catch {
    return [];
  }
}

function normalizeHex(c: string): string | null {
  const s = c.trim();
  if (/^#[0-9a-f]{6}$/i.test(s)) return s.toLowerCase();
  if (/^#[0-9a-f]{3}$/i.test(s)) {
    const r = s[1];
    const g = s[2];
    const b = s[3];
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }
  if (/^[0-9a-f]{6}$/i.test(s)) return `#${s.toLowerCase()}`;
  return null;
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const n = normalizeHex(hex) || "#fde047";
  return {
    r: parseInt(n.slice(1, 3), 16),
    g: parseInt(n.slice(3, 5), 16),
    b: parseInt(n.slice(5, 7), 16),
  };
}

function rgbToHex(r: number, g: number, b: number): string {
  const h = (n: number) => Math.min(255, Math.max(0, n | 0)).toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`;
}
