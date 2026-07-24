"use client";

import PageLoading from "@/components/motion/PageLoading";

import { askConfirm, askPrompt } from "@/lib/dialogs";

import { useEffect, useRef, useState, useCallback, useLayoutEffect, useMemo, type ReactNode, type MutableRefObject, type RefObject } from "react";
import { createPortal } from "react-dom";
import { HexColorPicker } from "react-colorful";
import ColorEyedropperTools from "@/components/ColorEyedropperTools";
import { useEditor, EditorContent, Editor } from "@tiptap/react";
import { TextSelection } from "@tiptap/pm/state";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import Link from "@tiptap/extension-link";
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
import { markdownToHtml, htmlToMarkdown, healHighlightArtifacts, formatFileSize, clipboardHasLatex } from "@/lib/mdHtml";
import Collaboration from "@tiptap/extension-collaboration";
import CollaborationCaret from "@tiptap/extension-collaboration-caret";
import type { FirestoreYjsProvider } from "@/lib/noteCollab";
import {
  CollaborationRemoteBlockSel,
  publishLocalBlockSel,
} from "@/lib/collabRemoteBlockSel";
import type { Awareness } from "y-protocols/awareness";
import { generateAiImageFile } from "@/lib/aiImage";
import { NoteAudio, NoteVideo, NoteFile } from "@/lib/tiptapMedia";
import { NoteImage } from "@/lib/tiptapImage";
import { MathInline, MathBlock, NoteEmbed, fillEmptyNoteEmbed } from "@/lib/tiptapEmbed";
import { CadenceDatabase } from "@/lib/tiptapDatabase";
import { WikiLink, wikiLinkHtml } from "@/lib/tiptapWiki";
import {
  CadenceBoard,
  CadenceCanvas,
  CadenceGraph,
  CadenceWeb,
} from "@/lib/tiptapWorkspace";
import { createDatabase } from "@/lib/database";
import { createWorkspacePage, normalizeWebUrl } from "@/lib/workspacePages";
import {
  Callout,
  ToggleBlock,
  TocBlock,
  Bookmark,
  AppCard,
  TemplateBtn,
} from "@/lib/tiptapBlocks";
import { NOTE_TEMPLATES } from "@/lib/templates";
import { allNoteTemplates } from "@/lib/community/templateBridge";
import { useCommunityOptional } from "@/components/community/CommunityProvider";
import { CADENCE_AI_ACTIONS, AI_SLASH_ALIASES } from "@/lib/cadenceAiActions";
import { resolveEmbedUrl, isYoutubeUrl } from "@/lib/embedUrls";
import { uploadNoteMedia, detectMediaKind } from "@/lib/firebase";
import type { TranscribableMedia } from "@/lib/noteMediaIngest";
import MenuSelect from "@/components/MenuSelect";
import { moveTopLevelBlock, moveSiblingRange, topLevelBlockAt, draggableBlockAt, draggableBlockAtClientY, siblingBlockPos, siblingCount, paintBlockSelection, duplicateTopLevelBlock, deleteSiblingRange, copySiblingRange, selectSiblingRange, topLevelIndicesInMarquee, clientToHostLocal, dropIndexAtClientY, BlockSelectionHighlight } from "@/lib/moveBlock";
import { usePrefsOptional } from "@/components/PrefsProvider";
import { suggestWikiTitles, findNoteByTitle, type NoteLite } from "@/lib/wiki";
import { matchAtQuery, suggestAtMentions, type AtItem } from "@/lib/atMentions";
import { useAuth } from "@/components/AuthProvider";
import SelectionBubbleMenu from "@/components/SelectionBubbleMenu";
import type { SelectionAiAction } from "@/components/SelectionAiPanel";
import { Columns, Column, ToggleHeading } from "@/lib/tiptapLayout";
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
  /** Open / create a note from a wiki link (click on [[…]] / 子頁). Prefer noteId when known. */
  onOpenWikiNote?: (title: string, noteId?: string | null) => void | Promise<void>;
  /** Open Albireus AI aside / chat */
  onOpenAiAssistant?: (opts?: { selection?: string; question?: string; focusChat?: boolean }) => void;
  /** Launch deep research with selected text */
  onDeepResearchSelection?: (selection: string) => void;
  /** Run a named AI action (api action id) */
  onRunAiAction?: (apiAction: string, prompt?: string) => void;
  /** After inserting audio/video/YouTube — parent may offer transcription */
  onTranscribableMedia?: (
    media: TranscribableMedia,
    opts?: { forceChoice?: "transcribe" | "transcribe_summarize" }
  ) => void;
  /** Parent registers insert helper. Default = cursor; pass `{ at: "end" }` to append. */
  insertMdRef?: MutableRefObject<
    ((md: string, opts?: { at?: "cursor" | "end" }) => void) | null
  >;
  aiContext?: string;
  /** Read-only shared / preview mode */
  readOnly?: boolean;
  /** Open the block discussion panel for the current text selection */
  onOpenThread?: (selectionText: string) => void;
  /**
   * Realtime co-editing via Yjs. When set, TipTap syncs through `provider.doc`
   * and ignores remote whole-document `valueMd` resets.
   */
  collab?: {
    provider: FirestoreYjsProvider;
  };
};

type SlashItem = {
  id: string;
  label: string;
  hint: string;
  run: (editor: Editor, arg?: string) => void;
};

type SlashState = { query: string; arg: string; index: number };

/** Text after `/` up to cursor — command may include trailing args (Notion-style). */
const SLASH_TAIL_RE = /(?:^|\n)\/([^\n]*)$/;
const SLASH_LOOKBACK = 200;

const SLASH_ALIASES: Record<string, string[]> = {
  ...AI_SLASH_ALIASES,
  text: ["p"],
  paragraph: ["p"],
  h1: ["h1"],
  h2: ["h2"],
  h3: ["h3"],
  h4: ["h4"],
  "to-do": ["todo"],
  todo: ["todo"],
  number: ["numbered"],
  numbered: ["numbered"],
  equation: ["mathi", "math"],
  math: ["mathi", "math"],
  latex: ["mathi", "math"],
  inline: ["mathi"],
  // Prefer real table over AI table (AI_SLASH_ALIASES.table would steal /table)
  table: ["table", "ai-table"],
  grid: ["table"],
  divider: ["hr"],
  hr: ["hr"],
  sep: ["hr"],
  bookmark: ["bookmark", "web-embed"],
  web: ["web-embed", "web", "bookmark"],
  網頁: ["web-embed"],
  embed: ["web", "youtube", "drive"],
  database: ["database"],
  list: ["database"],
  gallery: ["database"],
  board: ["board-embed", "board"],
  看板: ["board-embed"],
  canvas: ["canvas-embed"],
  白板: ["canvas-embed"],
  graph: ["graph-embed", "graph"],
  圖譜: ["graph-embed"],
  calendar: ["journal", "calendar"],
  timeline: ["graph-embed"],
  sync: ["sync"],
  toc: ["toc"],
  link: ["link"],
  ai: ["ai"],
  template: ["template"],
  button: ["button", "template"],
  callout: ["callout"],
  toggle: ["toggle"],
  "toggle-h1": ["toggle-h1"],
  "toggle-h2": ["toggle-h2"],
  "toggle-h3": ["toggle-h3"],
  "toggle-h4": ["toggle-h4"],
  col2: ["col2"],
  col3: ["col3"],
  col4: ["col4"],
  col5: ["col5"],
  "2欄": ["col2"],
  "3欄": ["col3"],
  "4欄": ["col4"],
  "5欄": ["col5"],
  columns: ["col2", "col3", "col4", "col5"],
  page: ["page"],
  subpage: ["page"],
  child: ["page"],
  file: ["file"],
  upload: ["file", "image", "pdf", "video", "audio", "ppt"],
  youtube: ["youtube"],
  yt: ["youtube"],
  // Prefer insert image over create-photo when typing /image
  image: ["image", "imglink", "create-photo"],
  img: ["image"],
  photo: ["image", "create-photo"],
  pdf: ["pdf"],
  video: ["video"],
  audio: ["audio"],
  ppt: ["ppt"],
  drive: ["drive"],
  imglink: ["imglink"],
  turn: ["turn-p", "turn-h1", "turn-h2", "turn-h3", "turn-bullet", "turn-todo", "turn-quote", "turn-callout"],
  "turn into": ["turn-p", "turn-h1", "turn-h2", "turn-h3", "turn-bullet", "turn-todo", "turn-quote"],
};

function parseSlashTail(raw: string): { query: string; arg: string } {
  const t = raw.replace(/\u00a0/g, " ");
  const sp = t.search(/\s/);
  if (sp < 0) return { query: t, arg: "" };
  return { query: t.slice(0, sp), arg: t.slice(sp + 1).replace(/^\s+/, "") };
}

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

/** Prefer exact id / alias, then prefix — so `/page` + Enter hits 子頁面. */
function rankSlash(items: SlashItem[], q: string): SlashItem[] {
  const s = q.toLowerCase().trim();
  const filtered = filterSlash(items, s);
  if (!s) return filtered;
  const score = (i: SlashItem): number => {
    const id = i.id.toLowerCase();
    if (id === s) return 1000;
    const exactAlias = SLASH_ALIASES[s];
    if (exactAlias?.includes(i.id)) return 950;
    if (id.startsWith(s)) return 800;
    for (const [key, ids] of Object.entries(SLASH_ALIASES)) {
      if (key.startsWith(s) && ids.includes(i.id)) return 700;
    }
    if (i.label.toLowerCase().startsWith(s)) return 600;
    if (id.includes(s)) return 400;
    return 100;
  };
  return [...filtered].sort(
    (a, b) => score(b) - score(a) || a.label.localeCompare(b.label, "zh-Hant")
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
  onOpenWikiNote,
  onOpenAiAssistant,
  onDeepResearchSelection,
  onRunAiAction,
  onTranscribableMedia,
  insertMdRef,
  aiContext,
  readOnly = false,
  onOpenThread,
  collab,
}: Props) {
  const collabProvider = collab?.provider ?? null;
  const prefsCtx = usePrefsOptional();
  const { user, displayName } = useAuth();
  const community = useCommunityOptional();
  /** Prefer props; fall back to signed-in user (share / ACL editors). */
  const uploadUserId = userId || user?.uid || "";
  const uploadNoteId = noteId || "";
  const templateList = useMemo(
    () => allNoteTemplates(community?.enabledTemplates),
    [community?.enabledTemplates]
  );
  const wikiEnabled = prefsCtx?.prefs.wikiSuggest !== false;
  const slashEnabled = !readOnly && prefsCtx?.prefs.slashMenu !== false;
  const skip = useRef(false);
  const [slash, setSlash] = useState<SlashState | null>(null);
  const [wiki, setWiki] = useState<{ query: string; index: number } | null>(null);
  const [atMenu, setAtMenu] = useState<{ query: string; index: number } | null>(null);
  const slashRef = useRef(slash);
  slashRef.current = slash;
  const wikiRef = useRef(wiki);
  wikiRef.current = wiki;
  /** True while caret is inside an unfinished `[[…` so we can finalize on `]]`. */
  const wikiWasOpenRef = useRef(false);
  const finalizeWikiRef = useRef<(title: string) => void>(() => {});
  const atRef = useRef(atMenu);
  atRef.current = atMenu;
  const applySlashRef = useRef<(item: SlashItem, arg?: string) => void>(() => {});
  const applyWikiRef = useRef<(title: string) => void>(() => {});
  const applyAtRef = useRef<(item: AtItem) => void>(() => {});
  const wikiNotesRef = useRef(wikiNotes);
  wikiNotesRef.current = wikiNotes;
  const personNameRef = useRef("");
  personNameRef.current = displayName || user?.email?.split("@")[0] || "";
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
  const [selAi, setSelAi] = useState<{
    open: boolean;
    autoAction?: SelectionAiAction;
  }>({ open: false });
  const hlPanelRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const [menuPos, setMenuPos] = useState<{
    left: number;
    top: number;
    maxHeight: number;
  } | null>(null);
  const txPanelRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<Editor | null>(null);
  const readOnlyRef = useRef(readOnly);
  readOnlyRef.current = readOnly;
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
      const inHl =
        hlPanelRef.current?.contains(t) ||
        (t instanceof Element && !!t.closest("[data-color-picker-panel='hl']"));
      const inTx =
        txPanelRef.current?.contains(t) ||
        (t instanceof Element && !!t.closest("[data-color-picker-panel='tx']"));
      if (hlOpen && !inHl) setHlOpen(false);
      if (txOpen && !inTx) setTxOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [hlOpen, txOpen]);

  const applyHighlight = (color?: string) => {
    const ed = editorRef.current;
    if (!ed) return;
    const c = normalizeHex(color || hlColor) || hlColor;
    // Main toolbar click (no explicit color): toggle off when already this highlight.
    if (!color && ed.isActive("highlight")) {
      const cur = normalizeHex(String(ed.getAttributes("highlight").color || ""));
      if (!cur || cur === c) {
        ed.chain().focus().unsetHighlight().run();
        return;
      }
    }
    ed.chain().focus().setHighlight({ color: c }).run();
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

  const onTranscribableMediaRef = useRef(onTranscribableMedia);
  onTranscribableMediaRef.current = onTranscribableMedia;

  const insertUploaded = useCallback(async (file: File, pos?: number) => {
    if (!uploadUserId || !uploadNoteId) {
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
      const { url, name } = await uploadNoteMedia(uploadUserId, uploadNoteId, file, setUploadPct);
      const ed = editorRef.current;
      if (!ed) return;
      const kind = detectMediaKind(file);
      const lower = name.toLowerCase();

      if (kind === "image") {
        ed.chain().focus().setImage({ src: url, alt: name }).run();
        let imagePos: number | null = null;
        ed.state.doc.descendants((node, pos) => {
          if (imagePos != null) return false;
          if (node.type.name === "image" && node.attrs.src === url) {
            imagePos = pos;
            return false;
          }
          return true;
        });
        if (imagePos != null) ed.commands.setNodeSelection(imagePos);
      } else if (kind === "audio") {
        ed.chain().focus().setNoteAudio({ src: url, title: name }).run();
        onTranscribableMediaRef.current?.({ kind: "file", file, label: name });
      } else if (kind === "video") {
        ed.chain().focus().setNoteVideo({ src: url, title: name }).run();
        onTranscribableMediaRef.current?.({ kind: "file", file, label: name });
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
  }, [uploadUserId, uploadNoteId]);

  const createAiPhoto = useCallback(async () => {
    if (!uploadUserId || !uploadNoteId) {
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
      const { url } = await uploadNoteMedia(uploadUserId, uploadNoteId, file, setUploadPct);
      const alt = (caption || desc).trim().slice(0, 120);
      const ed = editorRef.current;
      if (!ed) throw new Error("編輯器尚未就緒");
      ed.chain().focus().setImage({ src: url, alt }).run();
      // Select the new image so wrap / resize chrome is immediately available.
      let imagePos: number | null = null;
      ed.state.doc.descendants((node, pos) => {
        if (imagePos != null) return false;
        if (node.type.name === "image" && node.attrs.src === url) {
          imagePos = pos;
          return false;
        }
        return true;
      });
      if (imagePos != null) {
        ed.commands.setNodeSelection(imagePos);
      }
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : "圖片生成失敗");
    } finally {
      setUploadPct(null);
    }
  }, [uploadUserId, uploadNoteId]);

  const createAiPhotoRef = useRef(createAiPhoto);
  createAiPhotoRef.current = createAiPhoto;

  const insertEmbedUrl = useCallback((url: string) => {
    const emb = resolveEmbedUrl(url);
    if (!emb) {
      setUploadError("無法辨識此連結");
      return false;
    }
    const ed = editorRef.current;
    if (!ed) return false;
    if (!fillEmptyNoteEmbed(ed, emb)) {
      ed.chain().focus().setNoteEmbed({
        src: emb.src,
        kind: emb.kind,
        title: emb.title,
        original: emb.original,
        frameable: emb.frameable,
      }).run();
    }
    if (emb.kind === "youtube") {
      onTranscribableMediaRef.current?.({
        kind: "youtube",
        youtubeUrl: emb.original,
        label: emb.title || "YouTube",
      });
    }
    return true;
  }, []);

  const insertEmptyEmbed = useCallback((kind: string, presetUrl?: string) => {
    const url = (presetUrl || "").trim();
    if (url) {
      insertEmbedUrl(url);
      return;
    }
    editorRef.current
      ?.chain()
      .focus()
      .setNoteEmbed({
        kind,
        title:
          kind === "youtube"
            ? "YouTube"
            : kind === "drive"
              ? "Google Drive"
              : "嵌入網頁",
        src: null,
        original: null,
      })
      .run();
  }, [insertEmbedUrl]);

  const onCreateSubpageRef = useRef(onCreateSubpage);
  onCreateSubpageRef.current = onCreateSubpage;
  const onOpenWikiNoteRef = useRef(onOpenWikiNote);
  onOpenWikiNoteRef.current = onOpenWikiNote;
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
      { id: "h4", label: "標題 4", hint: "/h4", run: (e) => e.chain().focus().toggleHeading({ level: 4 }).run() },
    ];
    if (onCreateSubpageRef.current) {
      items.push({
        id: "page",
        label: "子頁面",
        hint: "/page 或 /page 標題 ⏎",
        run: (e, arg) => {
          void (async () => {
            const create = onCreateSubpageRef.current;
            if (!create) return;
            const title = (arg || "").trim() || "未命名子頁";
            const created = await create(title);
            if (!created) return;
            e.chain()
              .focus()
              .insertContent(`${wikiLinkHtml(created.title, created.id)}\n`)
              .run();
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
      {
        id: "toggle-h1",
        label: "摺疊標題 1",
        hint: "/toggle-h1",
        run: (e) => e.chain().focus().setToggleHeading(1).run(),
      },
      {
        id: "toggle-h2",
        label: "摺疊標題 2",
        hint: "/toggle-h2",
        run: (e) => e.chain().focus().setToggleHeading(2).run(),
      },
      {
        id: "toggle-h3",
        label: "摺疊標題 3",
        hint: "/toggle-h3",
        run: (e) => e.chain().focus().setToggleHeading(3).run(),
      },
      {
        id: "toggle-h4",
        label: "摺疊標題 4",
        hint: "/toggle-h4",
        run: (e) => e.chain().focus().setToggleHeading(4).run(),
      },
      {
        id: "col2",
        label: "2 欄",
        hint: "/2欄 /col2",
        run: (e) => e.chain().focus().setColumns(2).run(),
      },
      {
        id: "col3",
        label: "3 欄",
        hint: "/3欄 /col3",
        run: (e) => e.chain().focus().setColumns(3).run(),
      },
      {
        id: "col4",
        label: "4 欄",
        hint: "/4欄 /col4",
        run: (e) => e.chain().focus().setColumns(4).run(),
      },
      {
        id: "col5",
        label: "5 欄",
        hint: "/5欄 /col5",
        run: (e) => e.chain().focus().setColumns(5).run(),
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
        id: "source-material",
        label: "素材",
        hint: "/素材 不計入字數與預設匯出",
        run: (e) => e.chain().focus().setCallout("source").run(),
      },
      {
        id: "table",
        label: "表格",
        hint: "/table 簡易表格（非資料庫）",
        run: (e) => e.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
      },
      {
        id: "mathi",
        label: "行內公式",
        hint: "$μ$ 或 /mathi 公式 ⏎",
        run: (e, arg) => {
          void (async () => {
            const { from, to } = e.state.selection;
            const selected = e.state.doc.textBetween(from, to, "");
            const f = (arg || "").trim() || (await askPrompt("行內 LaTeX（插在字與字之間）", selected || "\\mu"));
            if (f) {
              if (from !== to) e.chain().focus().deleteSelection().run();
              e.chain().focus().setMathInline(f).run();
            }
          })();
        },
      },
      {
        id: "math",
        label: "公式區塊",
        hint: "$$...$$ 或 /math 公式 ⏎",
        run: (e, arg) => {
          void (async () => {
            const f = (arg || "").trim() || (await askPrompt("區塊 LaTeX", "E = mc^2"));
            if (f) e.chain().focus().setMathBlock(f).run();
          })();
        },
      },
      app("library", "知識庫", "/library", "開啟知識庫"),
      app("journal", "日誌", "/journal", "開啟日誌頁"),
      app("graph", "圖譜", "/graph", "開啟關聯圖譜"),
      {
        id: "board-embed",
        label: "嵌入看板",
        hint: "/看板 建立並插入區塊",
        run: (e) => {
          void (async () => {
            if (!userId) {
              setUploadError("請先登入");
              return;
            }
            try {
              const { noteId } = await createWorkspacePage(userId, "board");
              // Resolve board id from the note we just created
              const { getNote } = await import("@/lib/firebase");
              const n = await getNote(noteId);
              const boardId = n?.app_link?.type === "board" ? n.app_link.id : "";
              if (boardId) e.chain().focus().setCadenceBoard({ boardId }).run();
            } catch (err) {
              setUploadError(err instanceof Error ? err.message : String(err));
            }
          })();
        },
      },
      {
        id: "canvas-embed",
        label: "嵌入白板",
        hint: "/白板 建立並插入區塊",
        run: (e) => {
          void (async () => {
            if (!userId) {
              setUploadError("請先登入");
              return;
            }
            try {
              const { noteId } = await createWorkspacePage(userId, "canvas");
              const { getNote } = await import("@/lib/firebase");
              const n = await getNote(noteId);
              const canvasId = n?.app_link?.type === "canvas" ? n.app_link.id : "";
              if (canvasId) e.chain().focus().setCadenceCanvas({ canvasId }).run();
            } catch (err) {
              setUploadError(err instanceof Error ? err.message : String(err));
            }
          })();
        },
      },
      {
        id: "graph-embed",
        label: "嵌入圖譜",
        hint: "/圖譜 建立並插入區塊",
        run: (e) => {
          void (async () => {
            if (!userId) {
              setUploadError("請先登入");
              return;
            }
            try {
              const { noteId } = await createWorkspacePage(userId, "graph");
              const { getNote } = await import("@/lib/firebase");
              const n = await getNote(noteId);
              const graphId = n?.app_link?.type === "graph" ? n.app_link.id : "";
              if (graphId) e.chain().focus().setCadenceGraph({ graphId }).run();
            } catch (err) {
              setUploadError(err instanceof Error ? err.message : String(err));
            }
          })();
        },
      },
      {
        id: "web-embed",
        label: "嵌入網頁（瀏覽列）",
        hint: "/網頁 · 筆記內輸入網址",
        run: (e, arg) => {
          const raw = (arg || "").trim();
          const url = raw ? normalizeWebUrl(raw) : "";
          let title = "網頁";
          if (url) {
            try {
              title = new URL(url).hostname.replace(/^www\./, "");
            } catch {
              title = url;
            }
          }
          e.chain().focus().setCadenceWeb({ url: url || "", title }).run();
        },
      },
      {
        id: "database",
        label: "資料庫",
        hint: "/database 或 /database 名稱 ⏎",
        run: (e, arg) => {
          void (async () => {
            if (!userId) {
              setUploadError("請先登入以建立資料庫");
              return;
            }
            try {
              let name = (arg || "").trim();
              if (!name) {
                const raw = await askPrompt("資料庫名稱", "任務清單");
                if (raw == null) return;
                name = raw.trim() || "未命名資料庫";
              }
              const { noteId } = await createWorkspacePage(userId, "database");
              const { getNote, updateNote } = await import("@/lib/firebase");
              const n = await getNote(noteId);
              if (n && name !== n.title) await updateNote(noteId, { title: name });
              const id = n?.app_link?.type === "database" ? n.app_link.id : "";
              if (id) {
                e.chain().focus().setCadenceDatabase({ databaseId: id, viewId: "v_table" }).run();
              } else {
                const fallback = await createDatabase(userId, name, "tasks");
                e.chain().focus().setCadenceDatabase({ databaseId: fallback, viewId: "v_table" }).run();
              }
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);
              setUploadError(
                /permission|insufficient|Missing/i.test(msg)
                  ? "沒有權限建立資料庫（請部署 Firestore rules）"
                  : msg
              );
            }
          })();
        },
      },
      { id: "image", label: "圖片", hint: "/image ⏎ 上傳圖片", run: () => imageRef.current?.click() },
      {
        id: "create-photo",
        label: "AI 生成圖片",
        hint: "/create-photo · gemini-3-pro-image",
        run: () => {
          void createAiPhotoRef.current();
        },
      },
      { id: "pdf", label: "PDF 預覽", hint: "/pdf ⏎ 上傳 PDF", run: () => pdfRef.current?.click() },
      {
        id: "bookmark",
        label: "網頁書籤",
        hint: "/bookmark · 筆記內輸入網址",
        run: (e, arg) => {
          const url = (arg || "").trim();
          let title = "書籤";
          if (url) {
            try {
              title = new URL(url).hostname.replace(/^www\./, "");
            } catch {
              title = url;
            }
          }
          e.chain().focus().setBookmark({ href: url, title }).run();
        },
      },
      { id: "video", label: "影片檔", hint: "/video ⏎ 上傳影片", run: () => videoRef.current?.click() },
      { id: "audio", label: "語音／音訊", hint: "/audio ⏎ 上傳音訊", run: () => audioRef.current?.click() },
      { id: "code", label: "程式碼", hint: "/code Code block", run: (e) => e.chain().focus().toggleCodeBlock().run() },
      { id: "file", label: "檔案", hint: "/file ⏎ 上傳任意檔案", run: () => fileRef.current?.click() },
      {
        id: "web",
        label: "嵌入網址",
        hint: "/embed · 筆記內輸入網址",
        run: (_e, arg) => insertEmptyEmbed("web", arg),
      },
      {
        id: "youtube",
        label: "YouTube",
        hint: "/youtube · 筆記內輸入連結",
        run: (_e, arg) => insertEmptyEmbed("youtube", arg),
      },
      {
        id: "drive",
        label: "Google Drive",
        hint: "/drive · 筆記內輸入連結",
        run: (_e, arg) => insertEmptyEmbed("drive", arg),
      },
      { id: "ppt", label: "PPT 預覽", hint: "/ppt ⏎ 上傳簡報", run: () => pptRef.current?.click() },
      {
        id: "imglink",
        label: "圖片網址",
        hint: "/imglink · 筆記內輸入網址",
        run: (e, arg) => {
          const url = (arg || "").trim();
          e.chain().focus().setImage({ src: url || "" }).run();
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
            setSelAi({ open: true });
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
            const choices = templateList
              .filter((t) => t.id !== "blank")
              .map((t) => `${t.id}=${t.label}`)
              .join("、");
            const id = await askPrompt(`範本 id（${choices}）`, "meeting");
            if (!id?.trim()) return;
            const t =
              templateList.find((x) => x.id === id.trim()) ||
              templateList.find((x) => x.id === "meeting")!;
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
        label: "同步區塊（預覽）",
        hint: "/sync · 目前僅插入 wiki 連結提示，尚未真同步",
        run: (e) => {
          void (async () => {
            const title = await askPrompt("來源筆記標題（之後會做成真同步）", "共享區塊");
            if (title == null) return;
            const t = title.trim() || "共享區塊";
            e.chain()
              .focus()
              .insertContent(
                markdownToHtml(
                  `> [!warning] 同步區塊尚在預覽：尚未與來源即時同步。請先用 [[${t}]] 連到來源筆記。`,
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
  }, [insertEmptyEmbed, templateList, userId]);

  const editor = useEditor({
    immediatelyRender: false,
    editable: !readOnly,
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3, 4] },
        codeBlock: false,
        // StarterKit 3.x ships link/underline — we add custom ones below
        link: false,
        underline: false,
        // Yjs provides undo when collaborating
        undoRedo: collabProvider ? false : { depth: 200 },
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
        HTMLAttributes: { class: "rich-link", title: "雙擊開啟連結" },
      }),
      WikiLink,
      NoteImage.configure({
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
      CadenceBoard,
      CadenceCanvas,
      CadenceGraph,
      CadenceWeb,
      Callout,
      ToggleBlock,
      ToggleHeading,
      Columns,
      Column,
      TocBlock,
      Bookmark,
      AppCard,
      TemplateBtn,
      BlockSelectionHighlight,
      ...(collabProvider
        ? [
            Collaboration.configure({
              document: collabProvider.doc,
              field: "default",
            }),
            CollaborationCaret.configure({
              provider: collabProvider,
              user: {
                name: collabProvider.user.name,
                color: collabProvider.user.color,
              },
              selectionRender: (user) => ({
                nodeName: "span",
                class: "collaboration-carets__selection",
                style: `background-color: ${user.color}55`,
                "data-user": user.name,
              }),
            }),
            CollaborationRemoteBlockSel.configure({
              awareness: collabProvider.awareness,
            }),
          ]
        : []),
    ],
    content: collabProvider
      ? undefined
      : markdownToHtml(valueMd, (t) => resolveWikiRef.current(t)),
    editorProps: {
      attributes: { class: "rich-prose" },
      handleDOMEvents: {
        // Inside a block: let ProseMirror do native text select (copy).
        // Outside / Alt: document-capture marquee owns the gesture.
        mousedown: (_view, event) => {
          if (readOnlyRef.current) return false;
          if (event.button !== 0) return false;
          if (event.detail >= 2) return false;
          const t = event.target as HTMLElement | null;
          if (t?.closest?.("input, textarea, select, button, .block-controls")) return false;
          // Alt = force block marquee (handled by capture listener).
          if (event.altKey) return true;
          return false;
        },
      },
      handleClick: (_view, _pos, event) => {
        const target = event.target as HTMLElement | null;
        const openHref = (href: string, externalPreferred: boolean) => {
          const h = href.trim();
          if (!h || h === "#" || /^javascript:/i.test(h)) return;
          if (h.startsWith("/") && !h.startsWith("//")) {
            window.location.href = h;
            return;
          }
          if (externalPreferred || /^https?:\/\//i.test(h) || h.startsWith("//") || h.startsWith("mailto:")) {
            window.open(h, "_blank", "noopener,noreferrer");
            return;
          }
          window.location.href = h;
        };

        const confirmAndOpen = (href: string, externalPreferred: boolean, label?: string) => {
          const h = href.trim();
          if (!h) return;
          const preview =
            label?.trim() && label.trim() !== h
              ? `${label.trim()}\n${h}`
              : h.length > 120
                ? `${h.slice(0, 117)}…`
                : h;
          void (async () => {
            const ok = await askConfirm({
              title: "前往連結？",
              message: preview,
              confirmLabel: "前往",
              cancelLabel: "取消",
            });
            if (ok) openHref(h, externalPreferred);
          })();
        };

        // Single click: never navigate (easy to mis-tap among dense links).
        // Double-click: ask before opening.
        const isDouble = event.detail >= 2;

        const app = target?.closest?.("a[data-note-app]") as HTMLAnchorElement | null;
        if (app) {
          event.preventDefault();
          const href = app.getAttribute("href");
          if (!href) return true;
          if (!isDouble) return false;
          confirmAndOpen(href, false, app.textContent || undefined);
          return true;
        }
        const el = target?.closest?.("a.rich-wiki") as HTMLAnchorElement | null;
        if (el) {
          event.preventDefault();
          const title = (el.getAttribute("data-wiki") || "").trim();
          const href = (el.getAttribute("href") || "").trim();
          const noteId =
            href.startsWith("/notes/")
              ? href.slice("/notes/".length).split(/[?#]/)[0].trim()
              : "";
          // ⌘/Ctrl+click → new tab when we have a real note URL
          if ((event.metaKey || event.ctrlKey) && noteId) {
            window.open(`/notes/${noteId}`, "_blank", "noopener,noreferrer");
            return true;
          }
          // Single click opens subpage / wiki links (no double-click or confirm).
          const open = onOpenWikiNoteRef.current;
          if (open && (title || noteId)) {
            void open(title || noteId, noteId || null);
            return true;
          }
          if (noteId) {
            window.location.href = `/notes/${noteId}`;
            return true;
          }
          if (title) {
            const id = resolveWikiRef.current(title);
            if (id) window.location.href = `/notes/${id}`;
          }
          return true;
        }
        // TipTap Link uses openOnClick: false so contenteditable won't follow <a> —
        // open URL / bookmark / file links ourselves (double-click + confirm).
        const link = target?.closest?.(
          "a.rich-link, a.rich-file, a.rich-bookmark-body, a[data-note-bookmark], a[href]:not([data-wiki]):not([data-note-app])"
        ) as HTMLAnchorElement | null;
        if (link) {
          const href = link.getAttribute("href");
          if (!href) return false;
          event.preventDefault();
          if (!isDouble) return false;
          confirmAndOpen(href, true, link.textContent || undefined);
          return true;
        }
        return false;
      },
      handlePaste: (_view, event) => {
        if (readOnlyRef.current) return true;
        const items = event.clipboardData?.items;
        const textRaw = event.clipboardData?.getData("text/plain") || "";
        const text = textRaw.trim();

        if (items) {
          for (const item of Array.from(items)) {
            if (
              item.type.startsWith("image/") ||
              item.type.startsWith("audio/") ||
              item.type.startsWith("video/")
            ) {
              const file = item.getAsFile();
              if (file) {
                event.preventDefault();
                void insertUploaded(file);
                return true;
              }
            }
          }
        }

        if (text && isYoutubeUrl(text)) {
          event.preventDefault();
          const emb = resolveEmbedUrl(text);
          if (emb) {
            const ed = editorRef.current;
            if (ed && !fillEmptyNoteEmbed(ed, emb)) {
              ed.chain().focus().setNoteEmbed({
                src: emb.src,
                kind: emb.kind,
                title: emb.title,
                original: emb.original,
                frameable: emb.frameable,
              }).run();
            }
            if (emb.kind === "youtube") {
              onTranscribableMediaRef.current?.({
                kind: "youtube",
                youtubeUrl: emb.original,
                label: emb.title || "YouTube",
              });
            }
            return true;
          }
        }

        // AI / markdown paste: turn $...$ / $$...$$ into KaTeX nodes
        if (textRaw && clipboardHasLatex(textRaw)) {
          event.preventDefault();
          const html = markdownToHtml(textRaw, (t) => resolveWikiRef.current(t));
          editorRef.current?.chain().focus().insertContent(html).run();
          return true;
        }
        return false;
      },
      handleDrop: (view, event) => {
        if (readOnlyRef.current) return true;
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
            setSlash({ query: "ai", arg: "", index: 0 });
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
        // Notion-style: Alt+Shift+E → edit selection with AI
        if (event.altKey && event.shiftKey && !mod && key === "e" && ed) {
          const { from, to } = ed.state.selection;
          const text = ed.state.doc.textBetween(from, to, "\n");
          if (text.trim()) {
            event.preventDefault();
            setSelAi({ open: true });
            return true;
          }
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
        const items = rankSlash(buildSlash(ed), cur.query);
        const active = Math.min(cur.index, Math.max(items.length - 1, 0));
        if (event.key === "ArrowDown") {
          event.preventDefault();
          setSlash({ ...cur, index: (active + 1) % Math.max(items.length, 1) });
          return true;
        }
        if (event.key === "ArrowUp") {
          event.preventDefault();
          setSlash({
            ...cur,
            index: (active - 1 + items.length) % Math.max(items.length, 1),
          });
          return true;
        }
        if (event.key === "Enter" && items[active]) {
          event.preventDefault();
          applySlashRef.current(items[active], cur.arg);
          return true;
        }
        if (event.key === "Tab" && items[active]) {
          event.preventDefault();
          applySlashRef.current(items[active], cur.arg);
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
        Math.max(0, ed.state.selection.from - SLASH_LOOKBACK),
        ed.state.selection.from,
        "\n"
      );
      const wikiMatch = wikiEnabled ? text.match(/\[\[([^\]]*)$/) : null;
      if (wikiMatch) {
        wikiWasOpenRef.current = true;
        setWiki({ query: wikiMatch[1], index: 0 });
        setSlash(null);
        setAtMenu(null);
      } else {
        const closed = wikiEnabled ? text.match(/\[\[([^\]|\n]+)\]\]$/) : null;
        if (wikiWasOpenRef.current && closed?.[1]?.trim()) {
          wikiWasOpenRef.current = false;
          const title = closed[1].trim();
          queueMicrotask(() => finalizeWikiRef.current(title));
        } else {
          wikiWasOpenRef.current = false;
        }
        setWiki(null);
        const atQ = wikiEnabled ? matchAtQuery(text) : null;
        if (atQ !== null) {
          setAtMenu({ query: atQ, index: 0 });
          setSlash(null);
        } else {
          setAtMenu(null);
          const m = slashEnabled ? text.match(SLASH_TAIL_RE) : null;
          if (m) {
            const { query, arg } = parseSlashTail(m[1]);
            setSlash((prev) => ({
              query,
              arg,
              index: prev && prev.query === query ? prev.index : 0,
            }));
          } else setSlash(null);
        }
      }
      skip.current = true;
      onChangeRef.current(htmlToMarkdown(ed.getHTML()));
    },
    onSelectionUpdate: () => setTick((t) => t + 1),
  });

  editorRef.current = editor;

  useEffect(() => {
    if (!editor) return;
    editor.storage.noteAudio.requestTranscribe = (media, opts) => {
      onTranscribableMediaRef.current?.(media, opts);
    };
    return () => {
      editor.storage.noteAudio.requestTranscribe = null;
    };
  }, [editor]);

  useEffect(() => {
    editor?.setEditable(!readOnly);
  }, [editor, readOnly]);

  useEffect(() => {
    if (!editor || (!slash && !wiki && !atMenu)) {
      setMenuPos(null);
      return;
    }

    const placeMenu = () => {
      try {
        const coords = editor.view.coordsAtPos(editor.state.selection.from);
        const menuW = 300;
        const preferH = 320;
        const gap = 8;
        const pad = 8;
        const left = Math.min(
          Math.max(pad, coords.left + 12),
          Math.max(pad, window.innerWidth - menuW - pad)
        );
        const spaceBelow = window.innerHeight - coords.bottom - gap - pad;
        const spaceAbove = coords.top - gap - pad;
        const openDown =
          spaceBelow >= Math.min(preferH, 160) || spaceBelow >= spaceAbove;
        const maxHeight = Math.min(
          preferH,
          Math.max(120, openDown ? spaceBelow : spaceAbove)
        );
        let top = openDown
          ? coords.bottom + gap
          : coords.top - maxHeight - gap;
        top = Math.max(pad, Math.min(top, window.innerHeight - maxHeight - pad));
        setMenuPos({ left, top, maxHeight });
      } catch {
        setMenuPos({ left: 28, top: 40, maxHeight: 280 });
      }
    };

    placeMenu();
    window.addEventListener("resize", placeMenu);
    const scrollParents: HTMLElement[] = [];
    let node: HTMLElement | null = editor.view.dom;
    while (node) {
      node.addEventListener("scroll", placeMenu, { passive: true });
      scrollParents.push(node);
      node = node.parentElement;
    }
    return () => {
      window.removeEventListener("resize", placeMenu);
      scrollParents.forEach((el) => el.removeEventListener("scroll", placeMenu));
    };
  }, [editor, slash, wiki, atMenu]);

  useEffect(() => {
    if (!insertMdRef) return;
    insertMdRef.current = (md: string, opts?: { at?: "cursor" | "end" }) => {
      const ed = editorRef.current;
      if (!ed) return;
      const html = markdownToHtml(md, (t) => resolveWikiRef.current(t));
      if (opts?.at === "end") {
        // Live STT / organize / audio: always append, ignore where the user clicked.
        const endPos = ed.state.doc.content.size;
        ed.chain().insertContentAt(endPos, html).run();
        return;
      }
      ed.chain().focus().insertContent(html).run();
    };
    return () => {
      insertMdRef.current = null;
    };
  }, [insertMdRef, editor]);

  const applySlash = useCallback(
    (item: SlashItem, arg?: string) => {
      if (!editor) return;
      const { from } = editor.state.selection;
      const text = editor.state.doc.textBetween(Math.max(0, from - SLASH_LOOKBACK), from, "\n");
      const m = text.match(SLASH_TAIL_RE);
      if (m) {
        // m[1] is text after `/`; delete `/` + args
        const len = 1 + m[1].length;
        editor.chain().focus().deleteRange({ from: from - len, to: from }).run();
      }
      const resolvedArg = (arg ?? slashRef.current?.arg ?? "").trim();
      item.run(editor, resolvedArg);
      setSlash(null);
    },
    [editor]
  );
  applySlashRef.current = applySlash;

  const finalizeWikiAtCursor = useCallback(
    (title: string) => {
      if (!editor) return;
      const t = title.trim();
      if (!t) return;
      const { from } = editor.state.selection;
      const look = editor.state.doc.textBetween(Math.max(0, from - 120), from, "\n");
      const closed = look.match(/\[\[([^\]|\n]+)\]\]$/);
      const open = look.match(/\[\[[^\]]*$/);
      const m = closed || open;
      if (!m) return;
      const rawLen = m[0].length;
      const replaceFrom = from - rawLen;
      const replaceTo = from;

      void (async () => {
        let noteId = resolveWikiRef.current(t);
        let finalTitle = t;
        if (!noteId && onCreateSubpageRef.current) {
          const created = await onCreateSubpageRef.current(t);
          if (created) {
            noteId = created.id;
            finalTitle = created.title;
          }
        }

        const html = `${wikiLinkHtml(finalTitle, noteId)}\u00a0`;
        editor
          .chain()
          .focus()
          .deleteRange({ from: replaceFrom, to: replaceTo })
          .insertContent(html)
          .run();
        setWiki(null);
      })();
    },
    [editor]
  );
  finalizeWikiRef.current = finalizeWikiAtCursor;

  const applyWiki = useCallback(
    (title: string) => {
      finalizeWikiAtCursor(title);
    },
    [finalizeWikiAtCursor]
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
    if (collabProvider) return;
    const rawMd = (valueMd || "").trim();
    const healedMd = healHighlightArtifacts(rawMd);
    const needsHeal = healedMd !== rawMd;
    // Visible "<mark …>" in the doc means TipTap has escaped highlight HTML as text.
    const leakedInEditor = /<\/?mark\b/i.test(editor.getText());
    // Never skip past a heal — otherwise corrupt bodies stay as raw HTML after refresh.
    if (skip.current && !needsHeal && !leakedInEditor) {
      skip.current = false;
      return;
    }
    skip.current = false;
    // Persist repair when body was saved as literal <mark> / &lt;mark&gt; text.
    if (needsHeal) {
      skip.current = true;
      onChangeRef.current(healedMd);
    }
    const next = markdownToHtml(healedMd, (t) => resolveWikiRef.current(t));
    if (needsHeal || leakedInEditor || htmlToMarkdown(editor.getHTML()) !== healedMd) {
      editor.commands.setContent(next, { emitUpdate: false });
      // If the editor still shows raw mark tags, force a serialize→heal→reload pass.
      if (/<\/?mark\b/i.test(editor.getText())) {
        const repaired = healHighlightArtifacts(htmlToMarkdown(editor.getHTML()));
        skip.current = true;
        onChangeRef.current(repaired);
        editor.commands.setContent(
          markdownToHtml(repaired, (t) => resolveWikiRef.current(t)),
          { emitUpdate: false }
        );
      }
    }
    // Intentionally omit wikiNotes: resolveWikiRef is a ref; listing all notes must not
    // re-setContent (that was wiping YouTube embeds after transcription finished).
  }, [valueMd, editor, collabProvider]);

  // Seed empty Y.Doc once from markdown (first collaborator / no prior state).
  useEffect(() => {
    if (!editor || !collabProvider?.needsSeed) return;
    const md = collabProvider.seedMarkdown || "";
    const html = markdownToHtml(md, (t) => resolveWikiRef.current(t));
    editor.commands.setContent(html || "<p></p>");
    collabProvider.markSeeded();
  }, [editor, collabProvider]);

  // Re-resolve embed src from original URL when loading markdown (src may equal original)
  useEffect(() => {
    if (!editor) return;
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name !== "noteEmbed") return;
      const original = node.attrs.original || node.attrs.src;
      if (!String(original || "").trim()) return;
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

  // When embed URL is filled in-note, offer YouTube transcription like paste/slash
  useEffect(() => {
    if (!editor) return;
    const onResolved = (ev: Event) => {
      const emb = (ev as CustomEvent<{ kind?: string; original?: string; title?: string }>).detail;
      if (!emb || emb.kind !== "youtube" || !emb.original) return;
      onTranscribableMediaRef.current?.({
        kind: "youtube",
        youtubeUrl: emb.original,
        label: emb.title || "YouTube",
      });
    };
    const root = editor.view.dom;
    root.addEventListener("cadence-embed-resolved", onResolved);
    return () => root.removeEventListener("cadence-embed-resolved", onResolved);
  }, [editor]);

  useEffect(() => {
    const onTpl = (ev: Event) => {
      const detail = (ev as CustomEvent<{ templateId?: string }>).detail;
      const t = templateList.find((x) => x.id === detail?.templateId);
      if (!t?.body || !editorRef.current) return;
      const html = markdownToHtml(t.body, (title) => resolveWikiRef.current(title));
      editorRef.current.chain().focus().insertContent(html).run();
    };
    window.addEventListener("cadence-insert-template", onTpl as EventListener);
    return () => window.removeEventListener("cadence-insert-template", onTpl as EventListener);
  }, []);

  useEffect(() => {
    const onMd = (ev: Event) => {
      const detail = (ev as CustomEvent<{ markdown?: string }>).detail;
      const md = detail?.markdown?.trim();
      if (!md || !editorRef.current) return;
      const html = markdownToHtml(md, (title) => resolveWikiRef.current(title));
      editorRef.current.chain().focus().insertContent(html).run();
    };
    window.addEventListener("cadence-insert-md", onMd as EventListener);
    return () => window.removeEventListener("cadence-insert-md", onMd as EventListener);
  }, []);

  const [linkBar, setLinkBar] = useState<string | null>(null);

  const setLink = () => {
    if (!editor) return;
    const prev = editor.getAttributes("link").href as string | undefined;
    setLinkBar(prev || "https://");
  };

  const applyLinkBar = (raw: string | null) => {
    if (!editor || raw === null) {
      setLinkBar(null);
      return;
    }
    const url = raw.trim();
    if (!url) editor.chain().focus().unsetLink().run();
    else editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
    setLinkBar(null);
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

  if (!editor) return <PageLoading fill={false} label="編輯器載入中…" />;

  const slashItems = slash ? rankSlash(buildSlash(editor), slash.query) : [];
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
        <ToolbarBtn
          disabled={!editor.can().undo()}
          onClick={() => editor.chain().focus().undo().run()}
          title="前一步 ⌘Z"
        >
          前一步
        </ToolbarBtn>
        <ToolbarBtn
          disabled={!editor.can().redo()}
          onClick={() => editor.chain().focus().redo().run()}
          title="後一步 ⌘⇧Z"
        >
          後一步
        </ToolbarBtn>
        <span className="rich-toolbar-sep" aria-hidden />
        <ToolbarBtn active={editor.isActive("bold")} onClick={() => editor.chain().focus().toggleBold().run()} title="粗體">B</ToolbarBtn>
        <ToolbarBtn active={editor.isActive("italic")} onClick={() => editor.chain().focus().toggleItalic().run()} title="斜體"><em>I</em></ToolbarBtn>
        <ToolbarBtn active={editor.isActive("underline")} onClick={() => editor.chain().focus().toggleUnderline().run()} title="底線"><u>U</u></ToolbarBtn>
        <ToolbarBtn active={editor.isActive("strike")} onClick={() => editor.chain().focus().toggleStrike().run()} title="刪除線"><s>S</s></ToolbarBtn>
        <MenuSelect
          variant="toolbar"
          size="sm"
          ariaLabel="字級"
          prefix="字"
          value={currentFontSize || "__default__"}
          options={[
            { value: "__default__", label: "預設" },
            ...FONT_SIZES.map((s) => ({ value: s, label: s.replace("px", "") })),
          ]}
          onChange={(v) => {
            if (v === "__default__") editor.chain().focus().unsetFontSize().run();
            else editor.chain().focus().setFontSize(v).run();
          }}
        />
        <MenuSelect
          variant="toolbar"
          size="sm"
          ariaLabel="對齊"
          prefix="齊"
          value={
            editor.isActive({ textAlign: "center" })
              ? "center"
              : editor.isActive({ textAlign: "right" })
                ? "right"
                : editor.isActive({ textAlign: "justify" })
                  ? "justify"
                  : "left"
          }
          options={[
            { value: "left", label: "靠左" },
            { value: "center", label: "置中" },
            { value: "right", label: "靠右" },
            { value: "justify", label: "兩端" },
          ]}
          onChange={(v) => {
            editor.chain().focus().setTextAlign(v).run();
          }}
        />
        <div className="hl-wrap" ref={hlPanelRef}>
          <ToolbarBtn
            active={editor.isActive("highlight") || hlOpen}
            onClick={() => {
              setTxOpen(false);
              applyHighlight();
            }}
            title="螢光筆（再點一次可取消）"
          >
            <span className="hl-swatch" style={{ background: hlColor }} />
            螢
          </ToolbarBtn>
          <button
            type="button"
            className={`rich-tool-btn hl-caret${hlOpen ? " is-active" : ""}`}
            title="選擇螢光筆顏色"
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
              panelId="hl"
              anchorRef={hlPanelRef}
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
              panelId="tx"
              anchorRef={txPanelRef}
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
        <MenuSelect
          variant="toolbar"
          size="sm"
          ariaLabel="行距"
          prefix="距"
          value={String(nearestLineHeight(prefsCtx?.prefs.editorLineHeight ?? 1.65))}
          options={LINE_HEIGHTS.map((v) => ({
            value: String(v),
            label: LINE_HEIGHT_LABELS[v] || v.toFixed(2),
          }))}
          onChange={(v) => {
            prefsCtx?.setPrefs({ editorLineHeight: Number(v) });
          }}
        />
        <span className="rich-toolbar-sep" />
        {editor.isActive("table") && (
          <>
            <ToolbarBtn title="左增欄" onClick={() => editor.chain().focus().addColumnBefore().run()}>◀欄</ToolbarBtn>
            <ToolbarBtn title="右增欄" onClick={() => editor.chain().focus().addColumnAfter().run()}>欄▶</ToolbarBtn>
            <ToolbarBtn title="上增列" onClick={() => editor.chain().focus().addRowBefore().run()}>▲列</ToolbarBtn>
            <ToolbarBtn title="下增列" onClick={() => editor.chain().focus().addRowAfter().run()}>列▼</ToolbarBtn>
            <ToolbarBtn title="刪欄" onClick={() => editor.chain().focus().deleteColumn().run()}>刪欄</ToolbarBtn>
            <ToolbarBtn title="刪列" onClick={() => editor.chain().focus().deleteRow().run()}>刪列</ToolbarBtn>
            <ToolbarBtn title="刪表" onClick={() => editor.chain().focus().deleteTable().run()}>刪表</ToolbarBtn>
            <span className="rich-toolbar-sep" />
          </>
        )}
        <ToolbarBtn onClick={setLink} active={editor.isActive("link")} title="選取文字後設連結">連結</ToolbarBtn>
        <ToolbarBtn onClick={() => onFindOpenChange?.(true)} title="尋找與取代（Ctrl+F）">尋找</ToolbarBtn>
      </div>
      {uploadPct !== null && (
        <div className="rich-upload-bar">
          <span>上傳中 {uploadPct}%</span>
          <div className="progress-track"><div className="progress-fill" style={{ width: `${uploadPct}%` }} /></div>
        </div>
      )}
      {uploadError && <p className="rich-upload-error">{uploadError}</p>}
      {linkBar !== null && (
        <div className="rich-link-inline-bar">
          <span className="rich-bookmark-label">連結</span>
          <input
            className="rich-embed-url-input"
            type="url"
            inputMode="url"
            spellCheck={false}
            placeholder="https://"
            value={linkBar}
            autoFocus
            onChange={(e) => setLinkBar(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                applyLinkBar(linkBar);
              }
              if (e.key === "Escape") {
                e.preventDefault();
                setLinkBar(null);
              }
            }}
            aria-label="連結網址"
          />
          <button type="button" className="btn btn-sm" onClick={() => applyLinkBar(linkBar)}>
            套用
          </button>
          <button
            type="button"
            className="btn btn-sm btn-soft"
            onClick={() => {
              editor.chain().focus().unsetLink().run();
              setLinkBar(null);
            }}
          >
            移除
          </button>
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => setLinkBar(null)}>
            取消
          </button>
        </div>
      )}
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
    <div className={`rich-editor${pageMode ? " rich-editor--page" : ""}${readOnly ? " rich-editor--readonly" : ""}`}>
      {!readOnly && hiddenInputs}
      {!readOnly && (toolbarHost ? createPortal(ribbon, toolbarHost) : ribbon)}

      {!readOnly && (
      <SelectionBubbleMenu
        editor={editor}
        noteTitle={noteTitle}
        noteBody={valueMd}
        aiContext={aiContext}
        onCreateSubpage={onCreateSubpage}
        onOpenThread={onOpenThread}
        applyTextColor={applyTextColor}
        applyHighlight={applyHighlight}
        clearTextColor={clearTextColor}
        txColor={txColor}
        hlColor={hlColor}
        aiOpen={selAi.open}
        aiAutoAction={selAi.autoAction}
        onAiOpenChange={(open, opts) =>
          setSelAi(open ? { open: true, autoAction: opts?.action } : { open: false })
        }
        onSendToAside={
          onOpenAiAssistant
            ? (selection, question) => {
                onOpenAiAssistant({ selection, question, focusChat: true });
              }
            : undefined
        }
        onDeepResearch={onDeepResearchSelection}
      />
      )}

      <div ref={canvasRef} className={`rich-canvas${pageMode ? " rich-canvas--page" : ""}`}>
        <div className={pageMode ? "rich-page-sheet" : "rich-canvas-inner"}>
          {!readOnly && (
            <BlockDragHandle editor={editor} awareness={collabProvider?.awareness ?? null} />
          )}
          <EditorContent editor={editor} />
        </div>
        {!readOnly && showEmptyTemplates && isEmptyDoc && onEmptyTemplate && (
          <div className="empty-templates">
            <p className="empty-templates-label">從範本開始</p>
            <div className="empty-templates-grid">
              {templateList
                .filter((t) => t.id !== "blank")
                .slice(0, 10)
                .map((t) => (
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
              <button
                key="blank"
                type="button"
                className="empty-template-btn"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => onEmptyTemplate("blank")}
              >
                空白
              </button>
            </div>
          </div>
        )}
        {wiki && (
          <div
            className="slash-menu rich-slash wiki-menu"
            style={
              menuPos
                ? {
                    position: "fixed",
                    left: menuPos.left,
                    top: menuPos.top,
                    maxHeight: menuPos.maxHeight,
                    zIndex: 80,
                  }
                : undefined
            }
          >
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
          <div
            className="slash-menu rich-slash at-menu"
            style={
              menuPos
                ? {
                    position: "fixed",
                    left: menuPos.left,
                    top: menuPos.top,
                    maxHeight: menuPos.maxHeight,
                    zIndex: 80,
                  }
                : undefined
            }
          >
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
          <div
            className="slash-menu rich-slash"
            style={
              menuPos
                ? {
                    position: "fixed",
                    left: menuPos.left,
                    top: menuPos.top,
                    maxHeight: menuPos.maxHeight,
                    zIndex: 80,
                  }
                : undefined
            }
          >
            <p className="rich-slash-label">插入區塊</p>
            {slashItems.map((item, idx) => (
              <button
                key={item.id}
                type="button"
                className={idx === Math.min(slash.index, slashItems.length - 1) ? "is-active" : ""}
                onMouseDown={(e) => {
                  e.preventDefault();
                  applySlash(item, slash.arg);
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
  disabled,
}: {
  children: ReactNode;
  onClick: () => void;
  active?: boolean;
  title?: string;
  accent?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
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

function BlockDragHandle({
  editor,
  awareness,
}: {
  editor: Editor;
  awareness?: Awareness | null;
}) {
  const [grip, setGrip] = useState<{
    top: number;
    left: number;
    from: number;
    to: number;
    index: number;
    parentFrom: number;
  } | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const [dropParent, setDropParent] = useState<number>(-1);
  /** Windows-style rubber-band selection rectangle (host-local coords). */
  const [marquee, setMarquee] = useState<{
    left: number;
    top: number;
    width: number;
    height: number;
  } | null>(null);
  /** Inclusive sibling-index selection within one parent. */
  const [blockSel, setBlockSel] = useState<{
    parentFrom: number;
    anchor: number;
    focus: number;
  } | null>(null);
  const dragRef = useRef<{
    parentFrom: number;
    start: number;
    end: number;
    origin: number;
    moved: boolean;
    startY: number;
    pointerType?: string;
  } | null>(null);
  const dropRef = useRef<number | null>(null);
  const gripHideTimerRef = useRef<number | null>(null);
  const marqueeActiveRef = useRef(false);
  /** After a click into a block, allow native text drag-select inside that block only. */
  const textEditArmedRef = useRef(false);
  const textEditBlockRef = useRef<HTMLElement | null>(null);
  const gripRef = useRef(grip);
  gripRef.current = grip;
  const blockSelRef = useRef(blockSel);
  blockSelRef.current = blockSel;

  const selRange = (sel: typeof blockSel) => {
    if (!sel) return null;
    return {
      parentFrom: sel.parentFrom,
      start: Math.min(sel.anchor, sel.focus),
      end: Math.max(sel.anchor, sel.focus),
    };
  };

  useEffect(() => {
    const range = selRange(blockSel);
    if (range) paintBlockSelection(editor, range.parentFrom, range.start, range.end);
    else paintBlockSelection(editor, -1, 1, 0); // clear
    return () => paintBlockSelection(editor, -1, 1, 0);
  }, [editor, blockSel, editor.state.doc]);

  // Publish multi-block 框選 to Yjs awareness so remote peers can paint it.
  useEffect(() => {
    if (!awareness) return;
    const range = selRange(blockSel);
    publishLocalBlockSel(
      awareness,
      range ? { parentFrom: range.parentFrom, start: range.start, end: range.end } : null
    );
    return () => publishLocalBlockSel(awareness, null);
  }, [awareness, blockSel]);

  // Keep ProseMirror selection aligned with painted blocks (once per blockSel change).
  useEffect(() => {
    const range = selRange(blockSel);
    if (!range || dragRef.current) return;
    selectSiblingRange(editor, range.parentFrom, range.start, range.end);
  }, [editor, blockSel]);

  // Notion-like: Delete / Backspace / Ctrl+C / Ctrl+X on multi-block selection
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && textEditArmedRef.current) {
        const canvas = editor.view.dom.closest(".rich-canvas");
        textEditBlockRef.current?.classList.remove("is-text-edit-armed");
        textEditArmedRef.current = false;
        textEditBlockRef.current = null;
        canvas?.classList.add("is-block-select-priority");
      }

      const sel = blockSelRef.current;
      if (!sel) return;
      const range = {
        parentFrom: sel.parentFrom,
        start: Math.min(sel.anchor, sel.focus),
        end: Math.max(sel.anchor, sel.focus),
      };

      const t = e.target as HTMLElement | null;
      if (t?.closest?.("input, textarea, select")) return;
      if (t?.isContentEditable && t !== editor.view.dom && !editor.view.dom.contains(t)) return;

      const mod = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();

      if (e.key === "Escape") {
        e.preventDefault();
        setBlockSel(null);
        return;
      }

      if (e.shiftKey && !mod && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
        e.preventDefault();
        e.stopPropagation();
        const n = siblingCount(editor, range.parentFrom);
        const nextFocus =
          e.key === "ArrowUp"
            ? Math.max(0, sel.focus - 1)
            : Math.min(n - 1, sel.focus + 1);
        setBlockSel({ ...sel, focus: nextFocus });
        return;
      }

      if ((e.key === "Backspace" || e.key === "Delete") && !mod && !e.altKey) {
        e.preventDefault();
        e.stopPropagation();
        deleteSiblingRange(editor, range.parentFrom, range.start, range.end);
        setBlockSel(null);
        return;
      }

      if (mod && !e.altKey && key === "c") {
        e.preventDefault();
        e.stopPropagation();
        // ClipboardEvent fires separately; keydown uses async clipboard API.
        copySiblingRange(editor, range.parentFrom, range.start, range.end);
        return;
      }

      if (mod && !e.altKey && key === "x") {
        e.preventDefault();
        e.stopPropagation();
        copySiblingRange(editor, range.parentFrom, range.start, range.end);
        deleteSiblingRange(editor, range.parentFrom, range.start, range.end);
        setBlockSel(null);
        return;
      }

      if (mod && !e.altKey && key === "a") {
        e.preventDefault();
        e.stopPropagation();
        const n = siblingCount(editor, range.parentFrom);
        if (n > 0) setBlockSel({ parentFrom: range.parentFrom, anchor: 0, focus: n - 1 });
        return;
      }
    };

    const onCopy = (e: ClipboardEvent) => {
      const sel = blockSelRef.current;
      if (!sel) return;
      const range = {
        parentFrom: sel.parentFrom,
        start: Math.min(sel.anchor, sel.focus),
        end: Math.max(sel.anchor, sel.focus),
      };
      copySiblingRange(editor, range.parentFrom, range.start, range.end, e);
    };
    const onCut = (e: ClipboardEvent) => {
      const sel = blockSelRef.current;
      if (!sel) return;
      const range = {
        parentFrom: sel.parentFrom,
        start: Math.min(sel.anchor, sel.focus),
        end: Math.max(sel.anchor, sel.focus),
      };
      copySiblingRange(editor, range.parentFrom, range.start, range.end, e);
      deleteSiblingRange(editor, range.parentFrom, range.start, range.end);
      setBlockSel(null);
    };

    document.addEventListener("keydown", onKey, true);
    document.addEventListener("copy", onCopy, true);
    document.addEventListener("cut", onCut, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("copy", onCopy, true);
      document.removeEventListener("cut", onCut, true);
    };
  }, [editor]);

  // Safety net: if a text selection somehow spans multiple top-level blocks,
  // convert it into a block multi-select (never leave a blue cross-block copy range).
  useEffect(() => {
    let converting = false;
    const onSel = () => {
      if (converting || marqueeActiveRef.current || dragRef.current) return;
      // Already in block multi-select mode — ignore caret placed by selectSiblingRange
      const bs = blockSelRef.current;
      if (bs && Math.min(bs.anchor, bs.focus) !== Math.max(bs.anchor, bs.focus)) return;
      const { from, to, empty } = editor.state.selection;
      if (empty || from === to) return;
      if (editor.state.selection.constructor.name === "NodeSelection") return;
      try {
        const $a = editor.state.doc.resolve(Math.min(from, to));
        const $b = editor.state.doc.resolve(Math.max(from, to));
        if ($a.depth < 1 || $b.depth < 1) return;
        let iA = $a.index(0);
        let iB = $b.index(0);
        if ($b.parentOffset === 0 && iB > iA && $b.pos === $b.before(1)) iB -= 1;
        if (iA === iB) return;
        converting = true;
        const start = Math.min(iA, iB);
        const end = Math.max(iA, iB);
        setBlockSel({ parentFrom: -1, anchor: start, focus: end });
        selectSiblingRange(editor, -1, start, end);
        textEditBlockRef.current?.classList.remove("is-text-edit-armed");
        textEditArmedRef.current = false;
        textEditBlockRef.current = null;
        editor.view.dom.closest(".rich-canvas")?.classList.add("is-block-select-priority");
      } catch {
        /* ignore */
      } finally {
        converting = false;
      }
    };
    editor.on("selectionUpdate", onSel);
    return () => {
      editor.off("selectionUpdate", onSel);
    };
  }, [editor]);

  useEffect(() => {
    const root = editor.view.dom;
    // Don't wipe multi-block selection when starting a marquee / gutter drag.
    const onDown = (e: MouseEvent) => {
      if (dragRef.current || marqueeActiveRef.current) return;
      const t = e.target as HTMLElement | null;
      if (t?.closest?.(".block-controls")) return;
      if (e.shiftKey || e.altKey) return;
      if (!blockSelRef.current) return;
      const rootRect = root.getBoundingClientRect();
      const contentPad = parseFloat(getComputedStyle(root).paddingLeft || "0") || 0;
      const gutterRight = rootRect.left + Math.max(contentPad, 44);
      if (e.clientX < gutterRight) return;
      // Defer so ProseMirror can place the caret first.
      queueMicrotask(() => {
        if (blockSelRef.current) setBlockSel(null);
      });
    };
    root.addEventListener("mousedown", onDown);
    return () => root.removeEventListener("mousedown", onDown);
  }, [editor]);

  useEffect(() => {
    const root = editor.view.dom;
    const canvas = root.closest(".rich-canvas") as HTMLElement | null;
    if (!canvas) return;
    // Far side margins sit on .doc-main-stack (page is max-width centered).
    // Prefer that shell so marquee can start from empty space beside the note.
    const shell =
      (root.closest(".doc-main-stack") as HTMLElement | null) ||
      (root.closest(".doc-page") as HTMLElement | null) ||
      (root.closest(".doc-editor-shell") as HTMLElement | null) ||
      (canvas.parentElement as HTMLElement | null) ||
      canvas;
    const pageEl = root.closest(".doc-page") as HTMLElement | null;

    const gutterWidth = () => {
      const pad = parseFloat(getComputedStyle(root).paddingLeft || "0") || 0;
      // When handles live in the left margin (pad≈0), still treat ~handle width as gutter.
      return Math.max(52, pad || 0);
    };

    const positionHost = () =>
      (root.closest(".rich-page-sheet") as HTMLElement | null) ||
      (root.closest(".rich-canvas-inner") as HTMLElement | null) ||
      canvas;

    const gripFromPos = (clientY: number, clientX?: number) => {
      const rootRect = root.getBoundingClientRect();
      const gutter = gutterWidth();
      const inGutter =
        clientX != null &&
        clientX >= rootRect.left - gutter &&
        clientX < rootRect.left + Math.max(8, parseFloat(getComputedStyle(root).paddingLeft || "0") || 0);
      const probeX = inGutter
        ? rootRect.left + Math.max(6, parseFloat(getComputedStyle(root).paddingLeft || "0") || 0) + 2
        : Math.max(clientX ?? rootRect.left + 8, rootRect.left + 8);
      const pos = editor.view.posAtCoords({ left: probeX, top: clientY });
      let block = pos ? draggableBlockAt(editor, pos.pos) : null;
      // Embeds/iframes often break posAtCoords — fall back to Y hit-test
      if (!block) block = draggableBlockAtClientY(editor, clientY);
      if (!block) return null;
      const dom = editor.view.nodeDOM(block.from);
      if (!(dom instanceof HTMLElement)) return null;
      const host = positionHost();
      const hostRect = host.getBoundingClientRect();
      const br = dom.getBoundingClientRect();
      const handleW = 46;
      const scrollTop = host === canvas ? canvas.scrollTop : host.scrollTop;
      // List/todo markers sit left of the <li> box — anchor to the list edge instead
      const node = editor.state.doc.nodeAt(block.from);
      const kind = node?.type.name || "";
      let anchorLeft = br.left;
      if (kind === "listItem" || kind === "taskItem") {
        const listEl = dom.closest("ul, ol");
        if (listEl) anchorLeft = listEl.getBoundingClientRect().left;
      }
      const left = anchorLeft - hostRect.left - handleW - 6;
      return {
        top: br.top - hostRect.top + scrollTop + Math.min(4, br.height / 2 - 12),
        left,
        from: block.from,
        to: block.to,
        index: block.index,
        parentFrom: block.parentFrom,
      };
    };

    let hideTimer: number | null = null;

    const cancelHideGrip = () => {
      if (hideTimer != null) {
        window.clearTimeout(hideTimer);
        hideTimer = null;
      }
      if (gripHideTimerRef.current != null) {
        window.clearTimeout(gripHideTimerRef.current);
        gripHideTimerRef.current = null;
      }
    };

    const scheduleHideGrip = () => {
      cancelHideGrip();
      hideTimer = window.setTimeout(() => {
        hideTimer = null;
        gripHideTimerRef.current = null;
        if (dragRef.current) return;
        setGrip(null);
      }, 450);
      gripHideTimerRef.current = hideTimer;
    };

    const onMove = (e: MouseEvent) => {
      if (dragRef.current) return;
      const t = e.target as HTMLElement | null;
      // Keep handle visible while the pointer is on it (or its hover bridge)
      if (t?.closest?.(".block-controls")) {
        cancelHideGrip();
        return;
      }

      try {
        const next = gripFromPos(e.clientY, e.clientX);
        if (next) {
          cancelHideGrip();
          setGrip((prev) => {
            if (
              prev &&
              prev.from === next.from &&
              prev.index === next.index &&
              prev.parentFrom === next.parentFrom &&
              Math.abs(prev.top - next.top) < 2 &&
              Math.abs(prev.left - next.left) < 2
            ) {
              return prev;
            }
            return next;
          });
          return;
        }

        // Dead zone between text and handle: keep current grip if still beside that block
        const prev = gripRef.current;
        if (prev) {
          const dom = editor.view.nodeDOM(prev.from);
          if (dom instanceof HTMLElement) {
            const br = dom.getBoundingClientRect();
            const corridorLeft = br.left - 64;
            const inCorridor =
              e.clientX >= corridorLeft - 4 &&
              e.clientX <= br.left + 16 &&
              e.clientY >= br.top - 14 &&
              e.clientY <= br.bottom + 14;
            if (inCorridor) {
              cancelHideGrip();
              return;
            }
          }
        }
        scheduleHideGrip();
      } catch {
        scheduleHideGrip();
      }
    };

    const onLeave = (e: MouseEvent) => {
      if (dragRef.current) return;
      const related = e.relatedTarget as HTMLElement | null;
      if (related?.closest?.(".block-controls")) {
        cancelHideGrip();
        return;
      }
      scheduleHideGrip();
    };

    /** 格子內選字；欄外左右空白／頁面 margin／Alt：框選整塊。 */
    const onMarqueeDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      if ((e as MouseEvent & { _blockMarquee?: boolean })._blockMarquee) return;
      if (dragRef.current || marqueeActiveRef.current) return;
      if (e.detail >= 2) return;

      const t = e.target as HTMLElement | null;
      if (!t) return;
      if (!shell.contains(t) && t !== shell) return;
      // Split view: don't steal gestures from the other pane.
      if (t.closest?.(".note-split-pane, .note-split-resizer, .note-split-rail")) return;
      if (t.closest?.(".block-controls, .empty-templates")) return;
      if (t.closest?.("input, textarea, select, button")) return;
      if (
        t.closest?.(
          ".doc-title, .doc-title-row, .doc-props, .doc-command, .doc-cover, .doc-icon, .note-page-log, .doc-banner-ingest, .doc-banner-error, .rich-toolbar, .hl-panel, .note-aside, .doc-chrome"
        )
      ) {
        return;
      }
      if (t.closest?.(".rich-embed-url-input") && !e.altKey) return;

      const rootRect = root.getBoundingClientRect();
      const canvasRect = canvas.getBoundingClientRect();
      const pageRect = pageEl?.getBoundingClientRect();
      const contentPad = parseFloat(getComputedStyle(root).paddingLeft || "0") || 0;
      const contentPadRight = parseFloat(getComputedStyle(root).paddingRight || "0") || 0;
      // Text starts after handle padding. Keep a caret band just before the first glyph
      // so "click before first char" places the cursor instead of selecting the block.
      const textLeft = rootRect.left + Math.max(contentPad, 8);
      const textRight = rootRect.right - Math.max(contentPadRight, 0);
      const caretBand = 18;
      const handleStripRight = Math.max(rootRect.left + 28, textLeft - caretBand);
      const bandTop = canvasRect.top - 24;
      const bandBottom = Math.max(canvasRect.bottom, pageRect?.bottom ?? canvasRect.bottom) + 8;
      const inEditorBand = e.clientY >= bandTop && e.clientY <= bandBottom;
      const inFarSideMargin =
        inEditorBand && (e.clientX < rootRect.left || e.clientX > textRight);
      const inHandleStrip =
        inEditorBand && e.clientX >= rootRect.left && e.clientX < handleStripRight;
      const inOutsideColumn = inFarSideMargin || inHandleStrip;
      const outsideProse = !t.closest?.(".ProseMirror");
      const onAtomChrome = !!t.closest?.(
        "[data-note-embed], .rich-embed, .rich-embed-bar, .rich-embed-frame, hr, img, video, .ProseMirror-selectednode"
      );

      let hitPos: number | null = null;
      try {
        hitPos = editor.view.posAtCoords({ left: e.clientX, top: e.clientY })?.pos ?? null;
      } catch {
        hitPos = null;
      }
      const inTextblock = (() => {
        if (hitPos == null) return false;
        try {
          const $p = editor.state.doc.resolve(hitPos);
          return $p.parent.inlineContent || $p.parent.isTextblock;
        } catch {
          return false;
        }
      })();

      // Prefer caret when the click lands in a text block outside the handle strip
      // (fixes line-start clicks being eaten by block selection).
      const preferCaret =
        !e.altKey &&
        !onAtomChrome &&
        !inHandleStrip &&
        !inFarSideMargin &&
        inTextblock &&
        !!t.closest?.(".ProseMirror");

      // Outside text column, empty page chrome, Alt, or atom chrome → block marquee.
      const forceMarquee =
        !preferCaret &&
        (e.altKey || inOutsideColumn || onAtomChrome || (outsideProse && inEditorBand));

      // Inside editable text/content: never preventDefault / setState here — that races the caret.
      if (!forceMarquee && (inTextblock || !!t.closest?.(".ProseMirror"))) {
        if (blockSelRef.current) {
          queueMicrotask(() => {
            if (blockSelRef.current) setBlockSel(null);
          });
        }
        return;
      }

      if (!forceMarquee) return;

      (e as MouseEvent & { _blockMarquee?: boolean })._blockMarquee = true;
      e.preventDefault();
      e.stopImmediatePropagation();

      const host = positionHost();
      const originX = e.clientX;
      const originY = e.clientY;
      /** Freeze in host content space — must not recompute from viewport after scroll. */
      const originLocal = clientToHostLocal(originX, originY, host);
      let mode: 'pending' | 'marquee' = 'pending';
      const prevUserSelect = document.body.style.userSelect;

      const disarmTextEdit = () => {
        textEditArmedRef.current = false;
        const prev = textEditBlockRef.current;
        if (prev) prev.classList.remove('is-text-edit-armed');
        textEditBlockRef.current = null;
        canvas.classList.add('is-block-select-priority');
      };

      const scrollParentOf = (el: HTMLElement): HTMLElement | null => {
        let n: HTMLElement | null = el;
        while (n && n !== document.body) {
          const st = getComputedStyle(n);
          const oy = st.overflowY;
          if ((oy === 'auto' || oy === 'scroll' || oy === 'overlay') && n.scrollHeight > n.clientHeight + 1) {
            return n;
          }
          n = n.parentElement;
        }
        return (document.scrollingElement as HTMLElement | null) || document.documentElement;
      };

      const autoScrollDuringMarquee = (cy: number) => {
        const scroller = scrollParentOf(host) || host;
        const hr = scroller.getBoundingClientRect();
        const edge = 56;
        let dy = 0;
        if (cy < hr.top + edge) dy = -Math.ceil(Math.min(36, (hr.top + edge - cy) * 0.55));
        else if (cy > hr.bottom - edge) dy = Math.ceil(Math.min(36, (cy - (hr.bottom - edge)) * 0.55));
        if (!dy) return;
        if (scroller === document.documentElement || scroller === document.body) {
          window.scrollBy(0, dy);
        } else {
          scroller.scrollTop += dy;
        }
      };

      const applyMarqueeBox = (cx: number, cy: number) => {
        const b = clientToHostLocal(cx, cy, host);
        const box = {
          left: Math.min(originLocal.x, b.x),
          top: Math.min(originLocal.y, b.y),
          right: Math.max(originLocal.x, b.x),
          bottom: Math.max(originLocal.y, b.y),
        };
        setMarquee({
          left: box.left,
          top: box.top,
          width: box.right - box.left,
          height: box.bottom - box.top,
        });
        // Host-local hit-test so blocks that scrolled off-screen stay selected.
        const hits = topLevelIndicesInMarquee(editor, box, host);
        if (!hits.length) {
          setBlockSel(null);
          return;
        }
        const start = Math.min(...hits);
        const end = Math.max(...hits);
        setBlockSel({ parentFrom: -1, anchor: start, focus: end });
        const mid = hits[Math.floor(hits.length / 2)] ?? start;
        const pos = siblingBlockPos(editor, -1, mid);
        if (pos) {
          const dom = editor.view.nodeDOM(pos.from);
          if (dom instanceof HTMLElement) {
            const br = dom.getBoundingClientRect();
            const local = clientToHostLocal(br.left, br.top, host);
            setGrip({
              top: local.y + Math.min(4, br.height / 2 - 12),
              left: local.x - 52,
              from: pos.from,
              to: pos.to,
              index: mid,
              parentFrom: -1,
            });
          }
        }
      };

      const startMarqueeMode = (cx: number, cy: number) => {
        mode = 'marquee';
        marqueeActiveRef.current = true;
        disarmTextEdit();
        canvas.classList.add('is-block-marquee');
        document.body.style.userSelect = 'none';
        try {
          window.getSelection()?.removeAllRanges();
        } catch {
          /* ignore */
        }
        applyMarqueeBox(cx, cy);
      };

      const onDragMove = (ev: MouseEvent) => {
        if (mode === 'pending') {
          if (Math.hypot(ev.clientX - originX, ev.clientY - originY) < 5) return;
          startMarqueeMode(ev.clientX, ev.clientY);
          return;
        }
        if (mode === 'marquee') {
          autoScrollDuringMarquee(ev.clientY);
          applyMarqueeBox(ev.clientX, ev.clientY);
        }
      };

      const onUp = () => {
        document.removeEventListener('mousemove', onDragMove, true);
        document.removeEventListener('mouseup', onUp, true);
        marqueeActiveRef.current = false;
        setMarquee(null);
        canvas.classList.remove('is-block-marquee');
        document.body.style.userSelect = prevUserSelect;

        if (mode !== "marquee") {
          if (inOutsideColumn || onAtomChrome) {
            const hit = gripFromPos(originY, Math.max(originX, rootRect.left + 8));
            if (hit) {
              const prev = blockSelRef.current;
              if (e.shiftKey && prev && prev.parentFrom === hit.parentFrom) {
                setBlockSel({
                  parentFrom: hit.parentFrom,
                  anchor: prev.anchor,
                  focus: hit.index,
                });
              } else {
                setBlockSel({
                  parentFrom: hit.parentFrom,
                  anchor: hit.index,
                  focus: hit.index,
                });
              }
              setGrip(hit);
              selectSiblingRange(editor, hit.parentFrom, hit.index, hit.index);
              editor.view.focus();
              disarmTextEdit();
            }
          }
          return;
        }

        const sel = blockSelRef.current;
        if (!sel) return;
        const a = Math.min(sel.anchor, sel.focus);
        const b = Math.max(sel.anchor, sel.focus);
        selectSiblingRange(editor, sel.parentFrom, a, b);
        editor.view.focus();
        disarmTextEdit();
      };

      document.addEventListener('mousemove', onDragMove, true);
      document.addEventListener('mouseup', onUp, true);
    };

    canvas.classList.add('is-block-select-priority');
    canvas.addEventListener('mousemove', onMove);
    canvas.addEventListener('mouseleave', onLeave);
    document.addEventListener('mousedown', onMarqueeDown, true);
    return () => {
      cancelHideGrip();
      canvas.classList.remove('is-block-select-priority');
      canvas.classList.remove('is-block-marquee');
      textEditBlockRef.current?.classList.remove('is-text-edit-armed');
      textEditArmedRef.current = false;
      textEditBlockRef.current = null;
      canvas.removeEventListener('mousemove', onMove);
      canvas.removeEventListener('mouseleave', onLeave);
      document.removeEventListener('mousedown', onMarqueeDown, true);
    };
  }, [editor]);

  const startDrag = (
    index: number,
    parentFrom: number,
    opts: { clientY: number; shiftKey?: boolean; pointerType?: string }
  ) => {
    const shift = Boolean(opts.shiftKey);
    const isTouch = opts.pointerType === "touch" || opts.pointerType === "pen";
    const prev = blockSelRef.current;
    let start: number;
    let end: number;
    let nextSel: { parentFrom: number; anchor: number; focus: number };

    if (shift && prev && prev.parentFrom === parentFrom) {
      nextSel = { parentFrom, anchor: prev.anchor, focus: index };
      start = Math.min(nextSel.anchor, nextSel.focus);
      end = Math.max(nextSel.anchor, nextSel.focus);
    } else if (prev && prev.parentFrom === parentFrom) {
      const r = selRange(prev)!;
      if (index >= r.start && index <= r.end) {
        nextSel = prev;
        start = r.start;
        end = r.end;
      } else {
        nextSel = { parentFrom, anchor: index, focus: index };
        start = end = index;
      }
    } else {
      nextSel = { parentFrom, anchor: index, focus: index };
      start = end = index;
    }

    setBlockSel(nextSel);
    setDropParent(parentFrom);
    dragRef.current = {
      parentFrom,
      start,
      end,
      origin: index,
      moved: false,
      startY: opts.clientY,
      pointerType: opts.pointerType || "mouse",
    };
    dropRef.current = start;
    setDropIndex(start);

    const canvasEl = editor.view.dom.closest(".rich-canvas") as HTMLElement | null;
    canvasEl?.classList.add("is-block-dragging");
    canvasEl?.classList.remove("is-block-drag-arming");
    const prevUserSelect = document.body.style.userSelect;
    document.body.style.userSelect = "none";
    const wasEditable = editor.isEditable;
    if (isTouch && wasEditable) {
      editor.setEditable(false);
    }
    try {
      editor.view.dom.blur();
      (document.activeElement as HTMLElement | null)?.blur?.();
      window.getSelection()?.removeAllRanges();
    } catch {
      /* ignore */
    }

    const onMove = (ev: PointerEvent) => {
      if (ev.pointerType !== "mouse") ev.preventDefault();
      const d = dragRef.current;
      if (!d) return;
      if (!d.moved && Math.abs(ev.clientY - d.startY) > 4) d.moved = true;
      try {
        // Use sibling DOM midpoints (not posAtCoords) so YouTube/embeds hit the real gap.
        let idx = dropIndexAtClientY(editor, d.parentFrom, ev.clientY);
        if (idx > d.start && idx <= d.end + 1) {
          dropRef.current = d.start;
          setDropIndex(d.start);
          return;
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
      canvasEl?.classList.remove("is-block-dragging");
      canvasEl?.classList.remove("is-block-drag-arming");
      document.body.style.userSelect = prevUserSelect;
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      document.removeEventListener("pointercancel", onUp);
      if (isTouch && wasEditable) {
        editor.setEditable(true);
      }
      if (!d) return;

      if (!d.moved) {
        const next = {
          parentFrom: d.parentFrom,
          anchor: shift && prev && prev.parentFrom === d.parentFrom ? prev.anchor : d.origin,
          focus: d.origin,
        };
        setBlockSel(next);
        // Keep multi-block ProseMirror selection so Delete / Ctrl+C work (don't collapse to caret).
        if (d.pointerType === "mouse") {
          const a = Math.min(next.anchor, next.focus);
          const b = Math.max(next.anchor, next.focus);
          selectSiblingRange(editor, next.parentFrom, a, b);
          editor.view.focus();
        }
        return;
      }

      if (target === null) return;
      const moved = moveSiblingRange(
        editor,
        d.parentFrom,
        d.start,
        d.end,
        Math.min(target, siblingCount(editor, d.parentFrom))
      );
      if (moved) {
        setBlockSel({
          parentFrom: moved.parentFrom,
          anchor: moved.start,
          focus: moved.end,
        });
      }
      setGrip(null);
    };

    document.addEventListener("pointermove", onMove, { passive: false });
    document.addEventListener("pointerup", onUp);
    document.addEventListener("pointercancel", onUp);
  };

  const startDragRef = useRef(startDrag);
  startDragRef.current = startDrag;

  // Mobile / touch: long-press a block to drag (tiny left grip is nearly untappable).
  useEffect(() => {
    const root = editor.view.dom;
    const canvas = root.closest(".rich-canvas") as HTMLElement | null;
    if (!canvas) return;

    const positionHost = () =>
      (root.closest(".rich-page-sheet") as HTMLElement | null) ||
      (root.closest(".rich-canvas-inner") as HTMLElement | null) ||
      canvas;

    const blockAtPoint = (clientY: number, clientX: number) => {
      try {
        const rootRect = root.getBoundingClientRect();
        const probeX = Math.max(clientX, rootRect.left + 8);
        const pos = editor.view.posAtCoords({ left: probeX, top: clientY });
        let block = pos ? draggableBlockAt(editor, pos.pos) : null;
        if (!block) block = draggableBlockAtClientY(editor, clientY);
        if (!block) return null;
        const dom = editor.view.nodeDOM(block.from);
        if (!(dom instanceof HTMLElement)) return null;
        const host = positionHost();
        const hostRect = host.getBoundingClientRect();
        const br = dom.getBoundingClientRect();
        const scrollTop = host === canvas ? canvas.scrollTop : host.scrollTop;
        return {
          top: br.top - hostRect.top + scrollTop + Math.min(4, br.height / 2 - 12),
          left: Math.max(4, br.left - hostRect.left - 8),
          from: block.from,
          to: block.to,
          index: block.index,
          parentFrom: block.parentFrom,
        };
      } catch {
        return null;
      }
    };

    let timer: number | null = null;
    let startX = 0;
    let startY = 0;
    let armed = false;

    const clearTimer = () => {
      if (timer != null) {
        window.clearTimeout(timer);
        timer = null;
      }
    };

    const onPointerDown = (e: PointerEvent) => {
      if (e.pointerType === "mouse") return;
      if (e.button !== 0) return;
      if (dragRef.current) return;
      const t = e.target as HTMLElement | null;
      if (t?.closest?.(".block-controls")) return;
      if (t?.closest?.("a,button,input,textarea,select,label,[contenteditable=false]")) return;
      startX = e.clientX;
      startY = e.clientY;
      const pointerType = e.pointerType;
      armed = false;
      clearTimer();
      canvas.classList.add("is-block-drag-arming");
      timer = window.setTimeout(() => {
        timer = null;
        const hit = blockAtPoint(startY, startX);
        if (!hit) {
          canvas.classList.remove("is-block-drag-arming");
          return;
        }
        armed = true;
        try {
          navigator.vibrate?.(10);
        } catch {
          /* ignore */
        }
        try {
          window.getSelection()?.removeAllRanges();
          editor.view.dom.blur();
          (document.activeElement as HTMLElement | null)?.blur?.();
        } catch {
          /* ignore */
        }
        setGrip(hit);
        startDragRef.current(hit.index, hit.parentFrom, {
          clientY: startY,
          pointerType,
        });
      }, 420);
    };

    const onPointerMove = (e: PointerEvent) => {
      if (e.pointerType === "mouse") return;
      if (!timer && !armed) return;
      if (
        timer != null &&
        (Math.abs(e.clientX - startX) > 12 || Math.abs(e.clientY - startY) > 12)
      ) {
        clearTimer();
        canvas.classList.remove("is-block-drag-arming");
        return;
      }
      if (timer != null || armed || dragRef.current) {
        e.preventDefault();
      }
    };

    const onPointerEnd = () => {
      clearTimer();
      armed = false;
      if (!dragRef.current) canvas.classList.remove("is-block-drag-arming");
    };

    root.addEventListener("pointerdown", onPointerDown);
    root.addEventListener("pointermove", onPointerMove, { passive: false });
    root.addEventListener("pointerup", onPointerEnd);
    root.addEventListener("pointercancel", onPointerEnd);
    // Suppress iOS callout / selection menu while long-pressing to drag
    const onCtx = (e: Event) => {
      if (dragRef.current || armed) e.preventDefault();
    };
    root.addEventListener("contextmenu", onCtx);
    return () => {
      clearTimer();
      root.removeEventListener("pointerdown", onPointerDown);
      root.removeEventListener("pointermove", onPointerMove);
      root.removeEventListener("pointerup", onPointerEnd);
      root.removeEventListener("pointercancel", onPointerEnd);
      root.removeEventListener("contextmenu", onCtx);
    };
  }, [editor]);

  const addBlockBelow = () => {
    if (!grip) return;
    const insertAt = grip.to;
    if (grip.parentFrom >= 0) {
      const parent = editor.state.doc.nodeAt(grip.parentFrom);
      const itemType = parent?.type.name === "taskList" ? "taskItem" : "listItem";
      const content =
        itemType === "taskItem"
          ? {
              type: "taskItem",
              attrs: { checked: false },
              content: [{ type: "paragraph" }],
            }
          : { type: "listItem", content: [{ type: "paragraph" }] };
      editor
        .chain()
        .focus()
        .insertContentAt(insertAt, content)
        .setTextSelection(insertAt + 2)
        .insertContent("/")
        .run();
    } else {
      editor
        .chain()
        .focus()
        .insertContentAt(insertAt, { type: "paragraph" })
        .setTextSelection(insertAt + 1)
        .insertContent("/")
        .run();
    }
    setGrip(null);
    setBlockSel(null);
  };

  const range = selRange(blockSel);
  const multiCount =
    range && grip && range.parentFrom === grip.parentFrom
      ? range.end - range.start + 1
      : 0;

  if (!grip && dropIndex === null && !marquee) return null;

  return (
    <>
      {marquee && (
        <div
          className="block-marquee"
          style={{
            left: marquee.left,
            top: marquee.top,
            width: marquee.width,
            height: marquee.height,
          }}
          aria-hidden
        />
      )}
      {grip && (
        <div
          className={`block-controls${dragRef.current ? " is-dragging" : ""}${
            range &&
            range.parentFrom === grip.parentFrom &&
            grip.index >= range.start &&
            grip.index <= range.end
              ? " is-selected"
              : ""
          }`}
          style={{ top: grip.top, left: grip.left }}
          onMouseDown={(e) => e.stopPropagation()}
          onMouseEnter={() => {
            // Keep grip while mouse travels onto the buttons
            if (gripHideTimerRef.current != null) {
              window.clearTimeout(gripHideTimerRef.current);
              gripHideTimerRef.current = null;
            }
            setGrip((prev) => prev ?? grip);
          }}
        >
          <button
            type="button"
            className="block-add-btn"
            title="在下方新增區塊"
            aria-label="在下方新增區塊"
            onMouseDown={(e) => e.preventDefault()}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              addBlockBelow();
            }}
          >
            +
          </button>
          <button
            type="button"
            className="block-drag-handle"
            title={
              multiCount > 1
                ? `拖動 ${multiCount} 個區塊 · Shift+點選可加選`
                : "拖動以移動 · 點一下選取 · 手機請長按段落拖動"
            }
            aria-label="拖曳移動段落"
            onMouseDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              startDrag(grip.index, grip.parentFrom, {
                clientY: e.clientY,
                shiftKey: e.shiftKey,
              });
            }}
            onPointerDown={(e) => {
              // Touch: allow the grip itself if somehow visible, but prefer long-press on block
              if (e.pointerType === "mouse") return;
              e.preventDefault();
              e.stopPropagation();
              startDrag(grip.index, grip.parentFrom, { clientY: e.clientY });
            }}
          >
            ⠿
          </button>
          {multiCount > 1 &&
            range &&
            range.parentFrom === grip.parentFrom &&
            grip.index >= range.start &&
            grip.index <= range.end && (
              <span className="block-sel-count" aria-hidden>
                {multiCount}
              </span>
            )}
        </div>
      )}
      {dropIndex !== null && (
        <BlockDropLine editor={editor} index={dropIndex} parentFrom={dropParent} />
      )}
    </>
  );
}

function BlockDropLine({
  editor,
  index,
  parentFrom,
}: {
  editor: Editor;
  index: number;
  parentFrom: number;
}) {
  const root = editor.view.dom;
  const canvas = root.closest(".rich-canvas") as HTMLElement | null;
  if (!canvas) return null;
  // Must match block-controls host — page sheet padding would otherwise push the line mid-block.
  const host =
    (root.closest(".rich-page-sheet") as HTMLElement | null) ||
    (root.closest(".rich-canvas-inner") as HTMLElement | null) ||
    canvas;
  const hostRect = host.getBoundingClientRect();
  const scrollTop = host === canvas ? canvas.scrollTop : host.scrollTop;
  const count = siblingCount(editor, parentFrom);
  if (count === 0) return null;

  let top = 0;
  if (index >= count) {
    const last = siblingBlockPos(editor, parentFrom, count - 1);
    if (!last) return null;
    const dom = editor.view.nodeDOM(last.from);
    if (!(dom instanceof HTMLElement)) return null;
    const br = dom.getBoundingClientRect();
    top = br.bottom - hostRect.top + scrollTop;
  } else {
    const at = siblingBlockPos(editor, parentFrom, index);
    if (!at) return null;
    const dom = editor.view.nodeDOM(at.from);
    if (!(dom instanceof HTMLElement)) return null;
    const br = dom.getBoundingClientRect();
    top = br.top - hostRect.top + scrollTop;
  }
  return <div className="block-drop-line" style={{ top }} />;
}

function ColorPickerPanel({
  panelId,
  anchorRef,
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
  panelId: string;
  anchorRef: RefObject<HTMLElement | null>;
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
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    const place = () => {
      const el = anchorRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const width = 248;
      let left = r.left;
      left = Math.max(8, Math.min(left, window.innerWidth - width - 8));
      let top = r.bottom + 6;
      if (top + 360 > window.innerHeight && r.top > 360) {
        top = Math.max(8, r.top - 420);
      }
      setPos({ top, left });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [anchorRef]);

  if (!pos || typeof document === "undefined") return null;

  return createPortal(
    <div
      className="hl-panel hl-panel--portal"
      data-color-picker-panel={panelId}
      style={{ position: "fixed", top: pos.top, left: pos.left, zIndex: 5000 }}
    >
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
      <div className="hl-section" onMouseDown={(e) => e.preventDefault()}>
        <p className="hl-section-label">色盤</p>
        <HexColorPicker
          color={normalized || presets[0]}
          onChange={onColorChange}
          className="hl-wheel"
        />
      </div>
      <div className="hl-section" onMouseDown={(e) => e.preventDefault()}>
        <p className="hl-section-label">吸取顏色</p>
        <ColorEyedropperTools color={normalized || color} onSample={onColorChange} />
      </div>
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
    </div>,
    document.body
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
