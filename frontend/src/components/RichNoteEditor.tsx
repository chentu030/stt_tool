"use client";

import { askPrompt } from "@/lib/dialogs";

import { useEffect, useRef, useState, useCallback, type ReactNode, type MutableRefObject } from "react";
import { createPortal } from "react-dom";
import { useEditor, EditorContent, Editor } from "@tiptap/react";
import { TextSelection } from "@tiptap/pm/state";
import { BubbleMenu } from "@tiptap/react/menus";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import Link from "@tiptap/extension-link";
import Image from "@tiptap/extension-image";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import Underline from "@tiptap/extension-underline";
import Highlight from "@tiptap/extension-highlight";
import { TextStyle, FontSize } from "@tiptap/extension-text-style";
import { Color } from "@tiptap/extension-color";
import TextAlign from "@tiptap/extension-text-align";
import { TableKit } from "@tiptap/extension-table";
import Typography from "@tiptap/extension-typography";
import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import { common, createLowlight } from "lowlight";
import { markdownToHtml, htmlToMarkdown, formatFileSize } from "@/lib/mdHtml";
import { generateAiImageFile } from "@/lib/aiImage";
import { NoteAudio, NoteVideo, NoteFile } from "@/lib/tiptapMedia";
import { MathInline, MathBlock, NoteEmbed } from "@/lib/tiptapEmbed";
import { CadenceDatabase } from "@/lib/tiptapDatabase";
import { createDatabase } from "@/lib/database";
import {
  Callout,
  ToggleBlock,
  TocBlock,
  Bookmark,
  AppCard,
  TemplateBtn,
} from "@/lib/tiptapBlocks";
import { NOTE_TEMPLATES } from "@/lib/templates";
import { CADENCE_AI_ACTIONS, AI_SLASH_ALIASES } from "@/lib/cadenceAiActions";
import { resolveEmbedUrl, promptInsertUrl } from "@/lib/embedUrls";
import { uploadNoteMedia, detectMediaKind } from "@/lib/firebase";
import { moveTopLevelBlock, moveBlockToIndex, topLevelBlockAt, duplicateTopLevelBlock } from "@/lib/moveBlock";
import { usePrefsOptional } from "@/components/PrefsProvider";
import { suggestWikiTitles, findNoteByTitle, type NoteLite } from "@/lib/wiki";
import { matchAtQuery, suggestAtMentions, type AtItem } from "@/lib/atMentions";
import { useAuth } from "@/components/AuthProvider";
import SelectionAiPanel from "@/components/SelectionAiPanel";
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
  wikiNotes?: NoteLite[];
  onEmptyTemplate?: (templateId: string) => void;
  showEmptyTemplates?: boolean;
  pageMode?: boolean;
  noteTitle?: string;
  /** Create a nested page under the current note; return created title for wiki link */
  onCreateSubpage?: (title: string) => Promise<{ id: string; title: string } | null>;
  /** Open Cadence AI aside / chat */
  onOpenAiAssistant?: (opts?: { selection?: string; question?: string; focusChat?: boolean }) => void;
  /** Run a named AI action (api action id) */
  onRunAiAction?: (apiAction: string, prompt?: string) => void;
  /** Parent registers insert-at-cursor */
  insertMdRef?: MutableRefObject<((md: string) => void) | null>;
  aiContext?: string;
  /** Read-only shared / preview mode */
  readOnly?: boolean;
  /** Open the block discussion panel for the current text selection */
  onOpenThread?: (selectionText: string) => void;
};

type SlashItem = {
  id: string;
  label: string;
  hint: string;
  run: (editor: Editor) => void;
};

const SLASH_ALIASES: Record<string, string[]> = {
  text: ["p"],
  paragraph: ["p"],
  h1: ["h1"],
  h2: ["h2"],
  h3: ["h3"],
  "to-do": ["todo"],
  todo: ["todo"],
  number: ["numbered"],
  numbered: ["numbered"],
  divider: ["hr"],
  hr: ["hr"],
  equation: ["math", "mathi"],
  math: ["math", "mathi"],
  bookmark: ["bookmark", "web"],
  web: ["web", "bookmark"],
  embed: ["web", "youtube", "drive"],
  database: ["database", "library"],
  list: ["list", "library"],
  gallery: ["gallery", "library"],
  board: ["board"],
  calendar: ["calendar", "journal"],
  timeline: ["timeline", "graph"],
  sync: ["sync"],
  toc: ["toc"],
  link: ["link"],
  ai: ["ai"],
  template: ["template"],
  button: ["button", "template"],
  callout: ["callout"],
  toggle: ["toggle"],
  page: ["page"],
  turn: ["turn-p", "turn-h1", "turn-h2", "turn-h3", "turn-bullet", "turn-todo", "turn-quote", "turn-callout"],
  "turn into": ["turn-p", "turn-h1", "turn-h2", "turn-h3", "turn-bullet", "turn-todo", "turn-quote"],
  ...AI_SLASH_ALIASES,
};

function filterSlash(items: SlashItem[], q: string) {
  const s = q.toLowerCase().trim();
  if (!s) return items;
  const aliasIds = new Set<string>();
  for (const [key, ids] of Object.entries(SLASH_ALIASES)) {
    if (key.startsWith(s) || s.startsWith(key)) ids.forEach((id) => aliasIds.add(id));
  }
  return items.filter(
    (i) =>
      aliasIds.has(i.id) ||
      i.label.toLowerCase().includes(s) ||
      i.hint.toLowerCase().includes(s) ||
      i.id.toLowerCase().includes(s) ||
      i.id.toLowerCase().startsWith(s)
  );
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
  wikiNotes = [],
  onEmptyTemplate,
  showEmptyTemplates,
  pageMode = false,
  noteTitle = "",
  onCreateSubpage,
  onOpenAiAssistant,
  onRunAiAction,
  insertMdRef,
  aiContext,
  readOnly = false,
  onOpenThread,
}: Props) {
  const prefsCtx = usePrefsOptional();
  const { user } = useAuth();
  const wikiEnabled = prefsCtx?.prefs.wikiSuggest !== false;
  const slashEnabled = prefsCtx?.prefs.slashMenu !== false;
  const skip = useRef(false);
  const [slash, setSlash] = useState<{ query: string; index: number } | null>(null);
  const [wiki, setWiki] = useState<{ query: string; index: number } | null>(null);
  const [atMenu, setAtMenu] = useState<{ query: string; index: number } | null>(null);
  const slashRef = useRef(slash);
  slashRef.current = slash;
  const wikiRef = useRef(wiki);
  wikiRef.current = wiki;
  const atRef = useRef(atMenu);
  atRef.current = atMenu;
  const applySlashRef = useRef<(item: SlashItem) => void>(() => {});
  const applyWikiRef = useRef<(title: string) => void>(() => {});
  const applyAtRef = useRef<(item: AtItem) => void>(() => {});
  const wikiNotesRef = useRef(wikiNotes);
  wikiNotesRef.current = wikiNotes;
  const personNameRef = useRef("");
  personNameRef.current = user?.displayName || user?.email?.split("@")[0] || "";
  const personEmailRef = useRef("");
  personEmailRef.current = user?.email || "";
  const resolveWikiRef = useRef<(title: string) => string | null>(() => null);
  resolveWikiRef.current = (title: string) => {
    const hit = findNoteByTitle(wikiNotesRef.current, title);
    return hit?.id || null;
  };
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
  const [selAi, setSelAi] = useState<{ from: number; to: number; text: string } | null>(null);
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

  const insertUploaded = useCallback(async (file: File, pos?: number) => {
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
    if (pos != null) {
      editorRef.current?.chain().setTextSelection(pos).run();
    }
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
            frameable: emb.frameable,
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
            frameable: emb.frameable,
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

  const createAiPhoto = useCallback(async () => {
    if (!userId || !noteId) {
      setUploadError("請先開啟已儲存的筆記再生成圖片");
      return;
    }
    const desc = await askPrompt({
      title: "描述要生成的圖片",
      message: "可用中文描述畫面內容與風格",
      defaultValue: "溫暖的書房裡，桌上有一杯咖啡與打開的筆記本，柔和自然光",
      multiline: true,
    });
    if (desc == null || !desc.trim()) return;
    const ratio =
      (await askPrompt({
        title: "畫面比例",
        message: "可選 1:1 / 16:9 / 9:16 / 4:3 / 3:4，留空則為 1:1",
        defaultValue: "1:1",
      })) || "1:1";
    setUploadError("");
    setUploadPct(5);
    try {
      const { file, caption } = await generateAiImageFile({
        prompt: desc.trim(),
        aspectRatio: ratio.trim() || "1:1",
      });
      setUploadPct(40);
      const { url } = await uploadNoteMedia(userId, noteId, file, setUploadPct);
      const alt = (caption || desc).trim().slice(0, 120);
      editorRef.current?.chain().focus().setImage({ src: url, alt }).run();
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : "圖片生成失敗");
    } finally {
      setUploadPct(null);
    }
  }, [userId, noteId]);

  const createAiPhotoRef = useRef(createAiPhoto);
  createAiPhotoRef.current = createAiPhoto;

  const insertEmbedFromPrompt = useCallback((hint: string) => {
    void (async () => {
      const url = await promptInsertUrl(hint);
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
        frameable: emb.frameable,
      }).run();
    })();
  }, []);

  const onCreateSubpageRef = useRef(onCreateSubpage);
  onCreateSubpageRef.current = onCreateSubpage;
  const onOpenAiRef = useRef(onOpenAiAssistant);
  onOpenAiRef.current = onOpenAiAssistant;
  const onRunAiRef = useRef(onRunAiAction);
  onRunAiRef.current = onRunAiAction;

  const buildSlash = useCallback((editor: Editor): SlashItem[] => {
    const app = (kind: string, title: string, href: string, hint: string): SlashItem => ({
      id: kind,
      label: title,
      hint,
      run: (e) =>
        e.chain().focus().setAppCard({ href, kind, title, hint }).run(),
    });

    const items: SlashItem[] = [
      { id: "p", label: "文字", hint: "/text 一般段落", run: (e) => e.chain().focus().setParagraph().run() },
      { id: "h1", label: "標題 1", hint: "/h1 大型標題", run: (e) => e.chain().focus().toggleHeading({ level: 1 }).run() },
      { id: "h2", label: "標題 2", hint: "/h2 中型標題", run: (e) => e.chain().focus().toggleHeading({ level: 2 }).run() },
      { id: "h3", label: "標題 3", hint: "/h3 小型標題", run: (e) => e.chain().focus().toggleHeading({ level: 3 }).run() },
    ];
    if (onCreateSubpageRef.current) {
      items.push({
        id: "page",
        label: "子頁面",
        hint: "/page 新增巢狀筆記",
        run: (e) => {
          void (async () => {
            const create = onCreateSubpageRef.current;
            if (!create) return;
            const name = await askPrompt("子頁面標題", "未命名子頁");
            if (name == null) return;
            const title = name.trim() || "未命名子頁";
            const created = await create(title);
            if (!created) return;
            e.chain().focus().insertContent(`[[${created.title}]]\n`).run();
          })();
        },
      });
    }
    items.push(
      { id: "todo", label: "待辦", hint: "/todo 可勾選", run: (e) => e.chain().focus().toggleTaskList().run() },
      { id: "bullet", label: "項目清單", hint: "/bullet 無序清單", run: (e) => e.chain().focus().toggleBulletList().run() },
      { id: "numbered", label: "編號清單", hint: "/number 有序清單", run: (e) => e.chain().focus().toggleOrderedList().run() },
      {
        id: "toggle",
        label: "折疊清單",
        hint: "/toggle 可收合",
        run: (e) => e.chain().focus().setToggleBlock("詳細內容").run(),
      },
      { id: "hr", label: "分隔線", hint: "/divider 水平線", run: (e) => e.chain().focus().setHorizontalRule().run() },
      { id: "quote", label: "引用", hint: "/quote 引用區塊", run: (e) => e.chain().focus().toggleBlockquote().run() },
      {
        id: "callout",
        label: "醒目提示",
        hint: "/callout 重點框",
        run: (e) => e.chain().focus().setCallout("info").run(),
      },
      {
        id: "table",
        label: "表格",
        hint: "/table 內嵌表格",
        run: (e) => e.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
      },
      app("board", "看板", "/board", "/board Kanban"),
      app("calendar", "行事曆／日誌", "/journal", "/calendar 日誌"),
      app("list", "清單檢視", "/library", "/list 知識庫清單"),
      app("gallery", "畫廊", "/library", "/gallery 知識庫"),
      app("timeline", "時間軸／圖譜", "/graph", "/timeline 圖譜"),
      {
        id: "database",
        label: "資料庫",
        hint: "/database 插入 Notion 式表格",
        run: (e) => {
          void (async () => {
            if (!userId) {
              setUploadError("請先登入以建立資料庫");
              return;
            }
            const name =
              (await askPrompt("資料庫名稱", "任務清單"))?.trim() || "未命名資料庫";
            const id = await createDatabase(userId, name, "tasks");
            e.chain().focus().setCadenceDatabase({ databaseId: id, viewId: "v_table" }).run();
          })();
        },
      },
      app("library", "知識庫", "/library", "筆記庫"),
      app("journal", "日誌", "/journal", "日記與行事曆"),
      app("graph", "圖譜", "/graph", "關聯圖譜"),
      { id: "image", label: "圖片", hint: "/image 上傳圖片", run: () => imageRef.current?.click() },
      {
        id: "create-photo",
        label: "AI 生成圖片",
        hint: "/create-photo · gemini-3-pro-image",
        run: () => {
          void createAiPhotoRef.current();
        },
      },
      { id: "pdf", label: "PDF 預覽", hint: "/pdf 上傳 PDF", run: () => pdfRef.current?.click() },
      {
        id: "bookmark",
        label: "網頁書籤",
        hint: "/bookmark 書籤卡片",
        run: (e) => {
          void (async () => {
            const url = await askPrompt("書籤網址", "https://");
            if (!url?.trim()) return;
            let title = url.trim();
            try {
              title = new URL(url.trim()).hostname;
            } catch {
              /* keep */
            }
            const custom = await askPrompt("書籤標題", title);
            e.chain()
              .focus()
              .setBookmark({ href: url.trim(), title: (custom || title).trim() })
              .run();
          })();
        },
      },
      { id: "video", label: "影片檔", hint: "/video 上傳影片", run: () => videoRef.current?.click() },
      { id: "audio", label: "語音／音訊", hint: "/audio 上傳音訊", run: () => audioRef.current?.click() },
      { id: "code", label: "程式碼", hint: "/code Code block", run: (e) => e.chain().focus().toggleCodeBlock().run() },
      { id: "file", label: "檔案", hint: "/file 上傳任意檔案", run: () => fileRef.current?.click() },
      {
        id: "web",
        label: "嵌入網頁",
        hint: "/embed /web 外部頁面",
        run: () => insertEmbedFromPrompt("網站網址（部分網站可能拒絕嵌入）"),
      },
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
      { id: "ppt", label: "PPT 預覽", hint: "上傳簡報檔", run: () => pptRef.current?.click() },
      {
        id: "imglink",
        label: "圖片網址",
        hint: "用 URL 插入",
        run: (e) => {
          void (async () => {
            const url = await askPrompt("圖片網址", "https://");
            if (url) e.chain().focus().setImage({ src: url }).run();
          })();
        },
      },
      {
        id: "ai",
        label: "詢問 AI",
        hint: "/ai 開啟助手",
        run: (e) => {
          const { from, to } = e.state.selection;
          const text = from !== to ? e.state.doc.textBetween(from, to, "\n") : "";
          if (text.trim()) {
            setSelAi({ from, to, text });
          }
          onOpenAiRef.current?.({ selection: text.trim() || undefined, focusChat: !text.trim() });
        },
      },
      ...CADENCE_AI_ACTIONS.filter((a) => a.id !== "ask").map(
        (a): SlashItem => ({
          id: `ai-${a.id}`,
          label: `AI · ${a.label}`,
          hint: a.hint,
          run: (e) => {
            void (async () => {
              if (a.insertMode === "chat") {
                onOpenAiRef.current?.({ focusChat: true });
                return;
              }
              if (a.id === "write-anything") {
                const p = await askPrompt("要 AI 寫什麼？", "寫一段開場白");
                if (p == null) return;
                onRunAiRef.current?.(a.apiAction, p);
                return;
              }
              onRunAiRef.current?.(a.apiAction, a.prompt);
              void e;
            })();
          },
        })
      ),
      {
        id: "template",
        label: "樣板按鈕",
        hint: "/template 一鍵插入範本",
        run: (e) => {
          void (async () => {
            const choices = NOTE_TEMPLATES.filter((t) => t.id !== "blank")
              .map((t) => `${t.id}=${t.label}`)
              .join("、");
            const id = await askPrompt(`範本 id（${choices}）`, "meeting");
            if (!id?.trim()) return;
            const t = NOTE_TEMPLATES.find((x) => x.id === id.trim()) || NOTE_TEMPLATES.find((x) => x.id === "meeting")!;
            e.chain()
              .focus()
              .setTemplateBtn({ templateId: t.id, label: `插入「${t.label}」` })
              .run();
          })();
        },
      },
      {
        id: "button",
        label: "操作按鈕",
        hint: "/button 自動化樣板鈕",
        run: (e) =>
          e.chain()
            .focus()
            .setTemplateBtn({ templateId: "meeting", label: "一鍵建立會議紀錄" })
            .run(),
      },
      {
        id: "sync",
        label: "同步區塊",
        hint: "/sync 以連結同步內容",
        run: (e) => {
          void (async () => {
            const title = await askPrompt("同步來源筆記標題（wiki）", "共享區塊");
            if (title == null) return;
            const t = title.trim() || "共享區塊";
            e.chain()
              .focus()
              .insertContent(
                markdownToHtml(
                  `> [!tip] 同步：請在來源筆記編輯內容，並在此用 [[${t}]] 連結。`,
                  (title) => resolveWikiRef.current(title)
                )
              )
              .run();
          })();
        },
      },
      {
        id: "toc",
        label: "目錄",
        hint: "/toc 自動目錄",
        run: (e) => e.chain().focus().setTocBlock().run(),
      },
      {
        id: "link",
        label: "頁面連結",
        hint: "/link [[筆記]]",
        run: (e) => {
          void (async () => {
            const title = await askPrompt("筆記標題", "");
            if (!title?.trim()) return;
            e.chain().focus().insertContent(`[[${title.trim()}]]`).run();
          })();
        },
      },
      {
        id: "math",
        label: "數學公式",
        hint: "/equation 區塊 $$",
        run: (e) => {
          void (async () => {
            const f = await askPrompt("LaTeX 公式", "E = mc^2");
            if (f) e.chain().focus().setMathBlock(f).run();
          })();
        },
      },
      {
        id: "mathi",
        label: "行內公式",
        hint: "$...$",
        run: (e) => {
          void (async () => {
            const f = await askPrompt("行內 LaTeX", "x^2");
            if (f) e.chain().focus().setMathInline(f).run();
          })();
        },
      },
      {
        id: "turn-p",
        label: "轉成文字",
        hint: "/turn into 段落",
        run: (e) => e.chain().focus().setParagraph().run(),
      },
      {
        id: "turn-h1",
        label: "轉成標題 1",
        hint: "/turn into H1",
        run: (e) => e.chain().focus().setHeading({ level: 1 }).run(),
      },
      {
        id: "turn-h2",
        label: "轉成標題 2",
        hint: "/turn into H2",
        run: (e) => e.chain().focus().setHeading({ level: 2 }).run(),
      },
      {
        id: "turn-h3",
        label: "轉成標題 3",
        hint: "/turn into H3",
        run: (e) => e.chain().focus().setHeading({ level: 3 }).run(),
      },
      {
        id: "turn-bullet",
        label: "轉成項目清單",
        hint: "/turn into bullet",
        run: (e) => e.chain().focus().toggleBulletList().run(),
      },
      {
        id: "turn-todo",
        label: "轉成待辦",
        hint: "/turn into todo",
        run: (e) => e.chain().focus().toggleTaskList().run(),
      },
      {
        id: "turn-quote",
        label: "轉成引用",
        hint: "/turn into quote",
        run: (e) => e.chain().focus().toggleBlockquote().run(),
      },
      {
        id: "turn-callout",
        label: "轉成醒目提示",
        hint: "/turn into callout",
        run: (e) => {
          const text = e.state.doc.textBetween(e.state.selection.from, e.state.selection.to, "\n").trim()
            || e.state.doc.textBetween(
              e.state.selection.$from.start(),
              e.state.selection.$from.end(),
              "\n"
            ).trim()
            || "提示";
          e.chain()
            .focus()
            .insertContent({
              type: "callout",
              attrs: { tone: "info" },
              content: [{ type: "paragraph", content: [{ type: "text", text }] }],
            })
            .run();
        },
      }
    );
    return items;
  }, [insertEmbedFromPrompt]);

  const editor = useEditor({
    immediatelyRender: false,
    editable: !readOnly,
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        codeBlock: false,
        undoRedo: { depth: 200 },
      }),
      CodeBlockLowlight.configure({
        lowlight,
        defaultLanguage: "plaintext",
      }),
      Placeholder.configure({
        placeholder: placeholder || "輸入文字，或用 / 插入區塊、@ 提及頁面或日期…",
      }),
      Link.extend({
        parseHTML() {
          return [
            {
              tag: "a[href]:not([data-wiki]):not([data-note-file]):not([data-note-bookmark]):not([data-note-app])",
            },
          ];
        },
      }).configure({
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
      FontSize,
      Color,
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      TableKit.configure({
        table: { resizable: true, HTMLAttributes: { class: "rich-table" } },
      }),
      Highlight.configure({ multicolor: true }),
      Typography,
      NoteAudio,
      NoteVideo,
      NoteFile,
      MathInline,
      MathBlock,
      NoteEmbed,
      CadenceDatabase,
      Callout,
      ToggleBlock,
      TocBlock,
      Bookmark,
      AppCard,
      TemplateBtn,
    ],
    content: markdownToHtml(valueMd, (t) => resolveWikiRef.current(t)),
    editorProps: {
      attributes: { class: "rich-prose" },
      handleClick: (_view, _pos, event) => {
        const target = event.target as HTMLElement | null;
        const app = target?.closest?.("a[data-note-app]") as HTMLAnchorElement | null;
        if (app) {
          event.preventDefault();
          const href = app.getAttribute("href");
          if (href) window.location.href = href;
          return true;
        }
        const el = target?.closest?.("a.rich-wiki") as HTMLAnchorElement | null;
        if (!el) return false;
        event.preventDefault();
        const href = el.getAttribute("href");
        if (href && href.startsWith("/notes/")) {
          window.location.href = href;
          return true;
        }
        const title = el.getAttribute("data-wiki");
        if (title) {
          const id = resolveWikiRef.current(title);
          if (id) window.location.href = `/notes/${id}`;
        }
        return true;
      },
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
      handleDrop: (view, event) => {
        const files = event.dataTransfer?.files;
        if (!files?.length) return false;
        event.preventDefault();
        const coords = { left: event.clientX, top: event.clientY };
        const hit = view.posAtCoords(coords);
        if (hit) {
          const tr = view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(hit.pos)));
          view.dispatch(tr);
        }
        Array.from(files).forEach((f) => { void insertUploaded(f, hit?.pos); });
        return true;
      },
      handleKeyDown: (_view, event) => {
        const ed = editorRef.current;
        const mod = event.metaKey || event.ctrlKey;
        const key = event.key.toLowerCase();

        // Empty paragraph + Space → open AI slash menu (Notion-style blank invoke)
        if (event.key === " " && !mod && !event.altKey && ed) {
          const { $from } = ed.state.selection;
          const parent = $from.parent;
          if (
            parent.type.name === "paragraph" &&
            parent.content.size === 0 &&
            slashEnabled
          ) {
            event.preventDefault();
            ed.chain().focus().insertContent("/ai").run();
            setSlash({ query: "ai", index: 0 });
            setWiki(null);
            setAtMenu(null);
            return true;
          }
        }

        // Undo / Redo (explicit — ensure Ctrl+Z always works in the note editor)
        if (mod && !event.altKey && key === "z" && !event.shiftKey && ed) {
          event.preventDefault();
          ed.commands.undo();
          return true;
        }
        if (mod && !event.altKey && ((key === "z" && event.shiftKey) || key === "y") && ed) {
          event.preventDefault();
          ed.commands.redo();
          return true;
        }
        // Duplicate block — Notion-style Ctrl/Cmd+D
        if (mod && !event.shiftKey && !event.altKey && key === "d" && ed) {
          event.preventDefault();
          duplicateTopLevelBlock(ed);
          return true;
        }
        // Move block — Ctrl/Cmd+Shift+↑↓ (also Alt+↑↓)
        if (ed && event.shiftKey && mod && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
          event.preventDefault();
          moveTopLevelBlock(ed, event.key === "ArrowUp" ? -1 : 1);
          return true;
        }
        if ((event.altKey || (event.metaKey && !event.ctrlKey)) && !event.shiftKey && !event.ctrlKey) {
          if (event.key === "ArrowUp" && ed) {
            event.preventDefault();
            moveTopLevelBlock(ed, -1);
            return true;
          }
          if (event.key === "ArrowDown" && ed) {
            event.preventDefault();
            moveTopLevelBlock(ed, 1);
            return true;
          }
        }

        const at = atRef.current;
        if (at && ed) {
          const items = suggestAtMentions({
            query: at.query,
            notes: wikiNotesRef.current,
            personName: personNameRef.current,
            personEmail: personEmailRef.current,
          });
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setAtMenu({ ...at, index: (at.index + 1) % Math.max(items.length, 1) });
            return true;
          }
          if (event.key === "ArrowUp") {
            event.preventDefault();
            setAtMenu({
              ...at,
              index: (at.index - 1 + Math.max(items.length, 1)) % Math.max(items.length, 1),
            });
            return true;
          }
          if (event.key === "Enter" && items[at.index]) {
            event.preventDefault();
            applyAtRef.current(items[at.index]);
            return true;
          }
          if (event.key === "Escape") {
            event.preventDefault();
            setAtMenu(null);
            return true;
          }
        }

        const w = wikiRef.current;
        if (w && ed) {
          const items = suggestWikiTitles(wikiNotesRef.current, w.query);
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setWiki({ ...w, index: (w.index + 1) % Math.max(items.length, 1) });
            return true;
          }
          if (event.key === "ArrowUp") {
            event.preventDefault();
            setWiki({
              ...w,
              index: (w.index - 1 + Math.max(items.length, 1)) % Math.max(items.length, 1),
            });
            return true;
          }
          if (event.key === "Enter") {
            event.preventDefault();
            const title = items[w.index]?.title || w.query.trim();
            if (title) applyWikiRef.current(title);
            return true;
          }
          if (event.key === "Escape") {
            event.preventDefault();
            setWiki(null);
            return true;
          }
        }
        const cur = slashRef.current;
        if (!cur || !ed) return false;
        const items = filterSlash(buildSlash(ed), cur.query);
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
        Math.max(0, ed.state.selection.from - 60),
        ed.state.selection.from,
        "\n"
      );
      const wikiMatch = wikiEnabled ? text.match(/\[\[([^\]]*)$/) : null;
      if (wikiMatch) {
        setWiki({ query: wikiMatch[1], index: 0 });
        setSlash(null);
        setAtMenu(null);
      } else {
        setWiki(null);
        const atQ = wikiEnabled ? matchAtQuery(text) : null;
        if (atQ !== null) {
          setAtMenu({ query: atQ, index: 0 });
          setSlash(null);
        } else {
          setAtMenu(null);
          const m = slashEnabled ? text.match(/(?:^|\n)\/([^\s/]*)$/) : null;
          if (m) setSlash({ query: m[1], index: 0 });
          else setSlash(null);
        }
      }
      skip.current = true;
      onChangeRef.current(htmlToMarkdown(ed.getHTML()));
    },
    onSelectionUpdate: () => setTick((t) => t + 1),
  });

  editorRef.current = editor;

  useEffect(() => {
    editor?.setEditable(!readOnly);
  }, [editor, readOnly]);

  useEffect(() => {
    if (!insertMdRef) return;
    insertMdRef.current = (md: string) => {
      const ed = editorRef.current;
      if (!ed) return;
      const html = markdownToHtml(md, (t) => resolveWikiRef.current(t));
      ed.chain().focus().insertContent(html).run();
    };
    return () => {
      insertMdRef.current = null;
    };
  }, [insertMdRef, editor]);

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

  const applyWiki = useCallback(
    (title: string) => {
      if (!editor) return;
      const { from } = editor.state.selection;
      const text = editor.state.doc.textBetween(Math.max(0, from - 60), from, "\n");
      const m = text.match(/\[\[[^\]]*$/);
      if (m) {
        editor
          .chain()
          .focus()
          .deleteRange({ from: from - m[0].length, to: from })
          .insertContent(`[[${title}]]`)
          .run();
      }
      setWiki(null);
    },
    [editor]
  );
  applyWikiRef.current = applyWiki;

  const applyAt = useCallback(
    (item: AtItem) => {
      if (!editor) return;
      const { from } = editor.state.selection;
      const text = editor.state.doc.textBetween(Math.max(0, from - 80), from, "\n");
      const m = text.match(/@[^\s@]*$/);
      if (m) {
        editor
          .chain()
          .focus()
          .deleteRange({ from: from - m[0].length, to: from })
          .insertContent(item.insert)
          .run();
      } else {
        editor.chain().focus().insertContent(item.insert).run();
      }
      setAtMenu(null);
    },
    [editor]
  );
  applyAtRef.current = applyAt;

  useEffect(() => {
    if (!editor) return;
    if (skip.current) {
      skip.current = false;
      return;
    }
    const next = markdownToHtml(valueMd, (t) => resolveWikiRef.current(t));
    if (htmlToMarkdown(editor.getHTML()) !== (valueMd || "").trim()) {
      editor.commands.setContent(next, { emitUpdate: false });
    }
  }, [valueMd, editor, wikiNotes]);

  // Re-resolve embed src from original URL when loading markdown (src may equal original)
  useEffect(() => {
    if (!editor) return;
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name !== "noteEmbed") return;
      const original = node.attrs.original || node.attrs.src;
      const emb = resolveEmbedUrl(original || "", node.attrs.title || "");
      if (!emb) return;
      const nextFrameable = emb.frameable;
      const curFrameable = node.attrs.frameable !== false && node.attrs.frameable !== "0";
      if (
        emb.src !== node.attrs.src ||
        emb.kind !== node.attrs.kind ||
        nextFrameable !== curFrameable
      ) {
        editor.commands.command(({ tr }) => {
          tr.setNodeMarkup(pos, undefined, {
            ...node.attrs,
            src: emb.src,
            kind: emb.kind,
            title: node.attrs.title || emb.title,
            original: emb.original,
            frameable: emb.frameable,
          });
          return true;
        });
      }
    });
  }, [editor, valueMd]);

  useEffect(() => {
    const onTpl = (ev: Event) => {
      const detail = (ev as CustomEvent<{ templateId?: string }>).detail;
      const t = NOTE_TEMPLATES.find((x) => x.id === detail?.templateId);
      if (!t?.body || !editorRef.current) return;
      const html = markdownToHtml(t.body, (title) => resolveWikiRef.current(title));
      editorRef.current.chain().focus().insertContent(html).run();
    };
    window.addEventListener("cadence-insert-template", onTpl as EventListener);
    return () => window.removeEventListener("cadence-insert-template", onTpl as EventListener);
  }, []);

  const setLink = () => {
    if (!editor) return;
    void (async () => {
      const prev = editor.getAttributes("link").href as string | undefined;
      const url = await askPrompt("連結網址", prev || "https://");
      if (url === null) return;
      if (url === "") editor.chain().focus().unsetLink().run();
      else editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
    })();
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
  const wikiItems = wiki ? suggestWikiTitles(wikiNotes, wiki.query) : [];
  const atItems = atMenu
    ? suggestAtMentions({
        query: atMenu.query,
        notes: wikiNotes,
        personName: personNameRef.current,
        personEmail: personEmailRef.current,
      })
    : [];
  const isEmptyDoc = !(valueMd || "").trim();

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

  const FONT_SIZES = ["14px", "16px", "18px", "20px", "24px", "28px", "32px"];
  const currentFontSize =
    (editor.getAttributes("textStyle").fontSize as string | undefined) || "";

  const ribbon = (
    <div className="doc-ribbon-inner">
      <div className="rich-toolbar rich-toolbar--ribbon">
        <ToolbarBtn active={editor.isActive("bold")} onClick={() => editor.chain().focus().toggleBold().run()} title="粗體">B</ToolbarBtn>
        <ToolbarBtn active={editor.isActive("italic")} onClick={() => editor.chain().focus().toggleItalic().run()} title="斜體"><em>I</em></ToolbarBtn>
        <ToolbarBtn active={editor.isActive("underline")} onClick={() => editor.chain().focus().toggleUnderline().run()} title="底線"><u>U</u></ToolbarBtn>
        <ToolbarBtn active={editor.isActive("strike")} onClick={() => editor.chain().focus().toggleStrike().run()} title="刪除線"><s>S</s></ToolbarBtn>
        <label className="rich-lh" title="字級">
          <span>字</span>
          <select
            value={currentFontSize}
            onChange={(e) => {
              const v = e.target.value;
              if (!v) editor.chain().focus().unsetFontSize().run();
              else editor.chain().focus().setFontSize(v).run();
            }}
          >
            <option value="">預設</option>
            {FONT_SIZES.map((s) => (
              <option key={s} value={s}>{s.replace("px", "")}</option>
            ))}
          </select>
        </label>
        <ToolbarBtn
          title="靠左"
          active={editor.isActive({ textAlign: "left" })}
          onClick={() => editor.chain().focus().setTextAlign("left").run()}
        >
          左
        </ToolbarBtn>
        <ToolbarBtn
          title="置中"
          active={editor.isActive({ textAlign: "center" })}
          onClick={() => editor.chain().focus().setTextAlign("center").run()}
        >
          中
        </ToolbarBtn>
        <ToolbarBtn
          title="靠右"
          active={editor.isActive({ textAlign: "right" })}
          onClick={() => editor.chain().focus().setTextAlign("right").run()}
        >
          右
        </ToolbarBtn>
        <ToolbarBtn
          title="兩端對齊"
          active={editor.isActive({ textAlign: "justify" })}
          onClick={() => editor.chain().focus().setTextAlign("justify").run()}
        >
          齊
        </ToolbarBtn>
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
        <ToolbarBtn
          title="上移段落（Alt↑）"
          onClick={() => moveTopLevelBlock(editor, -1)}
        >
          ↑
        </ToolbarBtn>
        <ToolbarBtn
          title="下移段落（Alt↓）"
          onClick={() => moveTopLevelBlock(editor, 1)}
        >
          ↓
        </ToolbarBtn>
        <label className="rich-lh" title="行距">
          <span>行距</span>
          <select
            value={String(
              nearestLineHeight(prefsCtx?.prefs.editorLineHeight ?? 1.65)
            )}
            onChange={(e) => {
              const editorLineHeight = Number(e.target.value);
              prefsCtx?.setPrefs({ editorLineHeight });
            }}
          >
            {LINE_HEIGHTS.map((v) => (
              <option key={v} value={String(v)}>
                {LINE_HEIGHT_LABELS[v] || v.toFixed(2)}
              </option>
            ))}
          </select>
        </label>
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
          title="插入表格"
          onClick={() =>
            editor
              .chain()
              .focus()
              .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
              .run()
          }
        >
          表
        </ToolbarBtn>
        {editor.isActive("table") && (
          <>
            <ToolbarBtn title="左增欄" onClick={() => editor.chain().focus().addColumnBefore().run()}>◀欄</ToolbarBtn>
            <ToolbarBtn title="右增欄" onClick={() => editor.chain().focus().addColumnAfter().run()}>欄▶</ToolbarBtn>
            <ToolbarBtn title="上增列" onClick={() => editor.chain().focus().addRowBefore().run()}>▲列</ToolbarBtn>
            <ToolbarBtn title="下增列" onClick={() => editor.chain().focus().addRowAfter().run()}>列▼</ToolbarBtn>
            <ToolbarBtn title="刪欄" onClick={() => editor.chain().focus().deleteColumn().run()}>刪欄</ToolbarBtn>
            <ToolbarBtn title="刪列" onClick={() => editor.chain().focus().deleteRow().run()}>刪列</ToolbarBtn>
            <ToolbarBtn title="刪表" onClick={() => editor.chain().focus().deleteTable().run()}>刪表</ToolbarBtn>
          </>
        )}
        <ToolbarBtn
          onClick={() => {
            void (async () => {
              const f = await askPrompt("LaTeX 公式", "E = mc^2");
              if (f) editor.chain().focus().setMathBlock(f).run();
            })();
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
    <div className={`rich-editor${pageMode ? " rich-editor--page" : ""}`}>
      {hiddenInputs}
      {toolbarHost ? createPortal(ribbon, toolbarHost) : ribbon}

      <BubbleMenu
        editor={editor}
        className="rich-bubble"
        shouldShow={({ editor: ed, state }) => {
          const { from, to } = state.selection;
          return from !== to && !ed.isActive("codeBlock");
        }}
      >
        <ToolbarBtn
          title="詢問 AI"
          accent
          onClick={() => {
            const { from, to } = editor.state.selection;
            const text = editor.state.doc.textBetween(from, to, "\n");
            if (!text.trim()) return;
            setSelAi({ from, to, text });
          }}
        >
          AI
        </ToolbarBtn>
        <ToolbarBtn active={editor.isActive("bold")} onClick={() => editor.chain().focus().toggleBold().run()}>B</ToolbarBtn>
        <ToolbarBtn active={editor.isActive("italic")} onClick={() => editor.chain().focus().toggleItalic().run()}><em>I</em></ToolbarBtn>
        <ToolbarBtn active={editor.isActive("code")} onClick={() => editor.chain().focus().toggleCode().run()}>{"<>"}</ToolbarBtn>
        <ToolbarBtn
          title="置中"
          active={editor.isActive({ textAlign: "center" })}
          onClick={() => editor.chain().focus().setTextAlign("center").run()}
        >
          中
        </ToolbarBtn>
        <ToolbarBtn
          active={editor.isActive("highlight")}
          onClick={() => applyHighlight()}
          title="螢光筆"
        >
          <span className="hl-swatch" style={{ background: hlColor }} />
          螢
        </ToolbarBtn>
        <ToolbarBtn
          title="上移段落"
          onClick={() => moveTopLevelBlock(editor, -1)}
        >
          ↑
        </ToolbarBtn>
        <ToolbarBtn
          title="下移段落"
          onClick={() => moveTopLevelBlock(editor, 1)}
        >
          ↓
        </ToolbarBtn>
        <ToolbarBtn
          onClick={() => {
            void (async () => {
              const f = await askPrompt("行內 LaTeX", "x^2");
              if (f) editor.chain().focus().setMathInline(f).run();
            })();
          }}
        >
          ∑
        </ToolbarBtn>
        <ToolbarBtn onClick={setLink}>連結</ToolbarBtn>
        {onOpenThread && (
          <ToolbarBtn
            title="開啟討論串"
            onClick={() => {
              const { from, to } = editor.state.selection;
              const text = editor.state.doc.textBetween(from, to, "\n");
              if (!text.trim()) return;
              onOpenThread(text);
            }}
          >
            討論
          </ToolbarBtn>
        )}
      </BubbleMenu>

      {selAi && (
        <SelectionAiPanel
          open
          editor={editor}
          noteTitle={noteTitle}
          noteBody={valueMd}
          aiContext={aiContext}
          selectionText={selAi.text}
          from={selAi.from}
          to={selAi.to}
          onClose={() => setSelAi(null)}
          onSendToAside={
            onOpenAiAssistant
              ? (selection, question) => {
                  onOpenAiAssistant({ selection, question, focusChat: true });
                }
              : undefined
          }
        />
      )}

      <div className={`rich-canvas${pageMode ? " rich-canvas--page" : ""}`}>
        <div className={pageMode ? "rich-page-sheet" : undefined}>
          <BlockDragHandle editor={editor} />
          <EditorContent editor={editor} />
        </div>
        {showEmptyTemplates && isEmptyDoc && onEmptyTemplate && (
          <div className="empty-templates">
            <p className="empty-templates-label">從範本開始</p>
            <div className="empty-templates-grid">
              {[
                { id: "blank", label: "空白" },
                { id: "meeting", label: "會議" },
                { id: "lecture", label: "課堂" },
                { id: "interview", label: "訪談" },
                { id: "daily", label: "日誌" },
                { id: "ppt", label: "簡報大綱" },
              ].map((t) => (
                <button
                  key={t.id}
                  type="button"
                  className="empty-template-btn"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => onEmptyTemplate(t.id)}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>
        )}
        {wiki && (
          <div className="slash-menu rich-slash wiki-menu">
            <p className="rich-slash-label">連結筆記</p>
            {wikiItems.length === 0 ? (
              <button
                type="button"
                className="is-active"
                onMouseDown={(e) => {
                  e.preventDefault();
                  applyWiki(wiki.query.trim() || "未命名");
                }}
              >
                <strong>{`[[${wiki.query.trim() || "…"}]]`}</strong>
                <span>插入標題</span>
              </button>
            ) : (
              wikiItems.map((n, idx) => (
                <button
                  key={n.id}
                  type="button"
                  className={idx === wiki.index ? "is-active" : ""}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    applyWiki(n.title);
                  }}
                >
                  <strong>{n.title}</strong>
                  <span>開啟筆記</span>
                </button>
              ))
            )}
          </div>
        )}
        {atMenu && atItems.length > 0 && !wiki && (
          <div className="slash-menu rich-slash at-menu">
            <p className="rich-slash-label">提及 @</p>
            {atItems.map((item, idx) => (
              <button
                key={item.id}
                type="button"
                className={idx === atMenu.index ? "is-active" : ""}
                onMouseDown={(e) => {
                  e.preventDefault();
                  applyAt(item);
                }}
              >
                <strong>{item.label}</strong>
                <span>{item.hint}</span>
              </button>
            ))}
          </div>
        )}
        {slash && slashItems.length > 0 && !wiki && !atMenu && (
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
  accent,
}: {
  children: ReactNode;
  onClick: () => void;
  active?: boolean;
  title?: string;
  accent?: boolean;
}) {
  return (
    <button
      type="button"
      title={title}
      className={`rich-tool-btn${active ? " is-active" : ""}${accent ? " is-ai" : ""}`}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

const LINE_HEIGHTS = [1.35, 1.5, 1.65, 1.85, 2.1] as const;
const LINE_HEIGHT_LABELS: Record<number, string> = {
  1.35: "緊湊",
  1.5: "偏緊",
  1.65: "標準",
  1.85: "寬鬆",
  2.1: "更寬",
};

function nearestLineHeight(v: number): number {
  return LINE_HEIGHTS.reduce((best, cur) =>
    Math.abs(cur - v) < Math.abs(best - v) ? cur : best
  );
}

function BlockDragHandle({ editor }: { editor: Editor }) {
  const [grip, setGrip] = useState<{ top: number; from: number; index: number } | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const dragRef = useRef<{ from: number; index: number } | null>(null);
  const dropRef = useRef<number | null>(null);

  useEffect(() => {
    const root = editor.view.dom;
    const canvas = root.closest(".rich-canvas") as HTMLElement | null;
    if (!canvas) return;

    const onMove = (e: MouseEvent) => {
      if (dragRef.current) return;
      try {
        const pos = editor.view.posAtCoords({ left: Math.max(e.clientX, root.getBoundingClientRect().left + 8), top: e.clientY });
        if (!pos) {
          setGrip(null);
          return;
        }
        const block = topLevelBlockAt(editor, pos.pos);
        if (!block) {
          setGrip(null);
          return;
        }
        const dom = editor.view.nodeDOM(block.from);
        if (!(dom instanceof HTMLElement)) {
          setGrip(null);
          return;
        }
        const rect = canvas.getBoundingClientRect();
        const br = dom.getBoundingClientRect();
        setGrip({
          top: br.top - rect.top + canvas.scrollTop,
          from: block.from,
          index: block.index,
        });
      } catch {
        setGrip(null);
      }
    };

    const onLeave = (e: MouseEvent) => {
      if (dragRef.current) return;
      if ((e.relatedTarget as HTMLElement | null)?.closest?.(".block-drag-handle")) return;
      setGrip(null);
    };

    canvas.addEventListener("mousemove", onMove);
    canvas.addEventListener("mouseleave", onLeave);
    return () => {
      canvas.removeEventListener("mousemove", onMove);
      canvas.removeEventListener("mouseleave", onLeave);
    };
  }, [editor]);

  const startDrag = (from: number, index: number) => {
    dragRef.current = { from, index };
    dropRef.current = index;
    setDropIndex(index);

    const onMove = (e: MouseEvent) => {
      if (!dragRef.current) return;
      try {
        const pos = editor.view.posAtCoords({ left: e.clientX, top: e.clientY });
        if (!pos) return;
        const block = topLevelBlockAt(editor, pos.pos);
        if (!block) return;
        let idx = block.index;
        const dom = editor.view.nodeDOM(block.from);
        if (dom instanceof HTMLElement) {
          const br = dom.getBoundingClientRect();
          if (e.clientY > br.top + br.height / 2) idx = block.index + 1;
        }
        dropRef.current = idx;
        setDropIndex(idx);
      } catch {
        /* ignore */
      }
    };

    const onUp = () => {
      const d = dragRef.current;
      const target = dropRef.current;
      dragRef.current = null;
      dropRef.current = null;
      setDropIndex(null);
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      if (d && target !== null) {
        // Re-resolve fromPos after any edits — use current index if possible
        const still = topLevelBlockAt(editor, d.from + 1) || topLevelBlockAt(editor, d.from);
        const fromPos = still && still.index === d.index ? still.from : d.from;
        moveBlockToIndex(editor, fromPos, Math.min(target, editor.state.doc.childCount));
      }
      setGrip(null);
    };

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };

  if (!grip && dropIndex === null) return null;

  return (
    <>
      {grip && (
        <button
          type="button"
          className={`block-drag-handle${dragRef.current ? " is-dragging" : ""}`}
          style={{ top: grip.top }}
          title="拖曳移動段落"
          aria-label="拖曳移動段落"
          onMouseDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
            startDrag(grip.from, grip.index);
          }}
        >
          ⋮⋮
        </button>
      )}
      {dropIndex !== null && <BlockDropLine editor={editor} index={dropIndex} />}
    </>
  );
}

function BlockDropLine({ editor, index }: { editor: Editor; index: number }) {
  const canvas = editor.view.dom.closest(".rich-canvas") as HTMLElement | null;
  if (!canvas) return null;
  const rect = canvas.getBoundingClientRect();
  let top = 0;
  if (editor.state.doc.childCount === 0) return null;
  if (index >= editor.state.doc.childCount) {
    let pos = 0;
    for (let i = 0; i < editor.state.doc.childCount - 1; i++) {
      pos += editor.state.doc.child(i).nodeSize;
    }
    const dom = editor.view.nodeDOM(pos);
    if (!(dom instanceof HTMLElement)) return null;
    const br = dom.getBoundingClientRect();
    top = br.bottom - rect.top + canvas.scrollTop;
  } else {
    let pos = 0;
    for (let i = 0; i < index; i++) pos += editor.state.doc.child(i).nodeSize;
    const dom = editor.view.nodeDOM(pos);
    if (!(dom instanceof HTMLElement)) return null;
    const br = dom.getBoundingClientRect();
    top = br.top - rect.top + canvas.scrollTop;
  }
  return <div className="block-drop-line" style={{ top }} />;
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
