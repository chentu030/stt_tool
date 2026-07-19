"use client";

import { useEffect, useRef, useState, KeyboardEvent, DragEvent } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  Block,
  BlockType,
  SLASH_ITEMS,
  SlashItem,
  createBlock,
  markdownToBlocks,
  blocksToMarkdown,
  wrapSelection,
  DEFAULT_TABLE,
} from "@/lib/blocks";
import { suggestWikiTitles, NoteLite } from "@/lib/wiki";

type Props = {
  valueMd: string;
  onChangeMd: (md: string) => void;
  placeholder?: string;
  findOpen?: boolean;
  onFindOpenChange?: (open: boolean) => void;
  wikiNotes?: NoteLite[];
  onOpenWiki?: (title: string) => void;
};

function typeLabel(type: BlockType): string {
  switch (type) {
    case "heading1": return "H1";
    case "heading2": return "H2";
    case "heading3": return "H3";
    case "bullet": return "•";
    case "numbered": return "1.";
    case "todo": return "☐";
    case "quote": return "❝";
    case "callout": return "!";
    case "code": return "</>";
    case "toggle": return "▸";
    case "table": return "▦";
    case "divider": return "—";
    case "image": return "▣";
    default: return "¶";
  }
}

export default function BlockEditor({
  valueMd,
  onChangeMd,
  placeholder,
  findOpen,
  onFindOpenChange,
  wikiNotes = [],
  onOpenWiki,
}: Props) {
  const [blocks, setBlocks] = useState<Block[]>(() => markdownToBlocks(valueMd));
  const [focusId, setFocusId] = useState<string | null>(null);
  const [slash, setSlash] = useState<{ blockId: string; query: string; index: number } | null>(null);
  const [wiki, setWiki] = useState<{ blockId: string; query: string; index: number } | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [findQuery, setFindQuery] = useState("");
  const [replaceQuery, setReplaceQuery] = useState("");
  const [internalFind, setInternalFind] = useState(false);
  const skipSync = useRef(false);
  const inputRefs = useRef<Record<string, HTMLInputElement | HTMLTextAreaElement | null>>({});
  const selRef = useRef<{ id: string; start: number; end: number } | null>(null);

  const showFind = findOpen ?? internalFind;
  const setShowFind = (v: boolean) => {
    onFindOpenChange?.(v);
    if (findOpen === undefined) setInternalFind(v);
  };

  useEffect(() => {
    if (skipSync.current) {
      skipSync.current = false;
      return;
    }
    setBlocks(markdownToBlocks(valueMd));
  }, [valueMd]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent | globalThis.KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "f") {
        e.preventDefault();
        setShowFind(true);
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "b") {
        e.preventDefault();
        applyWrap("**");
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "i") {
        e.preventDefault();
        applyWrap("*");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blocks, focusId]);

  const focusBlock = (id: string, caretEnd = false) => {
    setFocusId(id);
    requestAnimationFrame(() => {
      const el = inputRefs.current[id];
      el?.focus();
      if (caretEnd && el) {
        const len = el.value.length;
        el.setSelectionRange(len, len);
      }
    });
  };

  const commit = (next: Block[]) => {
    setBlocks(next);
    skipSync.current = true;
    onChangeMd(blocksToMarkdown(next));
  };

  const updateBlock = (id: string, patch: Partial<Block>) => {
    commit(blocks.map((b) => (b.id === id ? { ...b, ...patch } : b)));
  };

  const insertAfter = (id: string, block?: Block) => {
    const i = blocks.findIndex((b) => b.id === id);
    if (i < 0) return;
    const nb = block ?? createBlock();
    commit([...blocks.slice(0, i + 1), nb, ...blocks.slice(i + 1)]);
    focusBlock(nb.id);
  };

  const removeBlock = (id: string) => {
    if (blocks.length <= 1) {
      commit([createBlock()]);
      return;
    }
    const i = blocks.findIndex((b) => b.id === id);
    const next = blocks.filter((b) => b.id !== id);
    commit(next);
    const prev = next[Math.max(0, i - 1)];
    if (prev) focusBlock(prev.id, true);
  };

  const applySlash = (blockId: string, item: SlashItem) => {
    const i = blocks.findIndex((x) => x.id === blockId);
    if (i < 0) return;
    const b = blocks[i];
    const text = b.text.replace(/\/[^\n]*$/, "").trimEnd();
    if (item.type === "divider") {
      const nb = createBlock();
      const next = [...blocks];
      next[i] = { ...b, type: "divider", text: "" };
      next.splice(i + 1, 0, nb);
      commit(next);
      focusBlock(nb.id);
    } else if (item.type === "image") {
      const url = window.prompt("圖片網址（https://…）", "https://");
      const nb = createBlock();
      const next = [...blocks];
      next[i] = { ...b, type: "image", text: "image", src: url || "", checked: undefined };
      next.splice(i + 1, 0, nb);
      commit(next);
      focusBlock(nb.id);
    } else if (item.type === "table") {
      const next = [...blocks];
      next[i] = { ...b, type: "table", text: DEFAULT_TABLE, src: undefined, checked: undefined };
      commit(next);
      focusBlock(blockId);
    } else if (item.type === "toggle") {
      const next = [...blocks];
      next[i] = { ...b, type: "toggle", text: "詳細內容\n", checked: true, src: undefined };
      commit(next);
      focusBlock(blockId);
    } else if (item.type === "code") {
      const next = [...blocks];
      next[i] = { ...b, type: "code", text: "", src: "", checked: undefined };
      commit(next);
      focusBlock(blockId);
    } else if (item.type === "callout") {
      const next = [...blocks];
      next[i] = { ...b, type: "callout", text: text || "", src: item.src || "info", checked: undefined };
      commit(next);
      focusBlock(blockId);
    } else {
      const next = [...blocks];
      next[i] = {
        ...b,
        type: item.type,
        text,
        checked: item.type === "todo" ? false : undefined,
        src: undefined,
      };
      commit(next);
      focusBlock(blockId);
    }
    setSlash(null);
  };

  const filteredSlash = (query: string): SlashItem[] => {
    const q = query.toLowerCase();
    if (!q) return SLASH_ITEMS;
    return SLASH_ITEMS.filter(
      (i) => i.label.toLowerCase().includes(q) || i.hint.toLowerCase().includes(q) || i.id.includes(q)
    );
  };

  const rememberSel = (id: string) => {
    const el = inputRefs.current[id];
    if (!el) return;
    selRef.current = { id, start: el.selectionStart ?? 0, end: el.selectionEnd ?? 0 };
  };

  const applyWrap = (marker: string) => {
    const sel = selRef.current;
    const id = sel?.id || focusId;
    if (!id) return;
    const block = blocks.find((b) => b.id === id);
    if (!block || block.type === "divider" || block.type === "image") return;
    const el = inputRefs.current[id];
    const start = sel?.id === id ? sel.start : el?.selectionStart ?? block.text.length;
    const end = sel?.id === id ? sel.end : el?.selectionEnd ?? block.text.length;
    const { text, caret } = wrapSelection(block.text, start, end, marker);
    updateBlock(id, { text });
    requestAnimationFrame(() => {
      const input = inputRefs.current[id];
      input?.focus();
      input?.setSelectionRange(caret, caret);
    });
  };

  const applyLink = () => {
    const url = window.prompt("連結網址", "https://");
    if (!url) return;
    const sel = selRef.current;
    const id = sel?.id || focusId;
    if (!id) return;
    const block = blocks.find((b) => b.id === id);
    if (!block || block.type === "divider" || block.type === "image") return;
    const el = inputRefs.current[id];
    const start = sel?.id === id ? sel.start : el?.selectionStart ?? block.text.length;
    const end = sel?.id === id ? sel.end : el?.selectionEnd ?? block.text.length;
    const label = block.text.slice(start, end) || "連結";
    const next =
      block.text.slice(0, start) + `[${label}](${url})` + block.text.slice(end);
    updateBlock(id, { text: next });
  };

  const onTextChange = (id: string, text: string) => {
    updateBlock(id, { text });
    const wikiMatch = text.match(/\[\[([^\]]*)$/);
    if (wikiMatch) {
      setWiki({ blockId: id, query: wikiMatch[1], index: 0 });
      setSlash(null);
      return;
    }
    setWiki((w) => (w?.blockId === id ? null : w));

    const m = text.match(/(?:^|\s)\/([^\s]*)$/);
    if (m) setSlash({ blockId: id, query: m[1], index: 0 });
    else setSlash((s) => (s?.blockId === id ? null : s));
  };

  const applyWiki = (blockId: string, title: string) => {
    const b = blocks.find((x) => x.id === blockId);
    if (!b) return;
    const nextText = b.text.replace(/\[\[[^\]]*$/, `[[${title}]]`);
    updateBlock(blockId, { text: nextText });
    setWiki(null);
    focusBlock(blockId, true);
  };

  const onKeyDown = (e: KeyboardEvent, block: Block) => {
    if (wiki && wiki.blockId === block.id) {
      const items = suggestWikiTitles(wikiNotes, wiki.query);
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setWiki({ ...wiki, index: (wiki.index + 1) % Math.max(items.length, 1) });
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setWiki({ ...wiki, index: (wiki.index - 1 + items.length) % Math.max(items.length, 1) });
        return;
      }
      if (e.key === "Enter" && items[wiki.index]) {
        e.preventDefault();
        applyWiki(block.id, items[wiki.index].title);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setWiki(null);
        return;
      }
    }

    if (slash && slash.blockId === block.id) {
      const items = filteredSlash(slash.query);
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSlash({ ...slash, index: (slash.index + 1) % Math.max(items.length, 1) });
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSlash({ ...slash, index: (slash.index - 1 + items.length) % Math.max(items.length, 1) });
        return;
      }
      if (e.key === "Enter" && items[slash.index]) {
        e.preventDefault();
        applySlash(block.id, items[slash.index]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setSlash(null);
        return;
      }
    }

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (block.type === "bullet" || block.type === "numbered" || block.type === "todo") {
        if (!block.text.trim()) {
          updateBlock(block.id, { type: "paragraph", text: "", checked: undefined });
          return;
        }
        insertAfter(block.id, createBlock({
          type: block.type,
          checked: block.type === "todo" ? false : undefined,
        }));
      } else {
        insertAfter(block.id);
      }
      return;
    }

    if (e.key === "Backspace" && block.text === "" && block.type !== "paragraph") {
      e.preventDefault();
      updateBlock(block.id, { type: "paragraph", checked: undefined, src: undefined });
      return;
    }

    if (e.key === "Backspace" && block.text === "") {
      e.preventDefault();
      removeBlock(block.id);
      return;
    }

    if (e.key === " ") {
      const t = block.text;
      if (t === "#" || t === "##" || t === "###" || t === "-" || t === "*" || t === ">" || t === "[]" || t === "[ ]") {
        e.preventDefault();
        const map: Record<string, Partial<Block>> = {
          "#": { type: "heading1", text: "" },
          "##": { type: "heading2", text: "" },
          "###": { type: "heading3", text: "" },
          "-": { type: "bullet", text: "" },
          "*": { type: "bullet", text: "" },
          ">": { type: "quote", text: "" },
          "[]": { type: "todo", text: "", checked: false },
          "[ ]": { type: "todo", text: "", checked: false },
        };
        updateBlock(block.id, map[t]);
      }
    }
  };

  const onDragStart = (e: DragEvent, id: string) => {
    setDragId(id);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", id);
  };

  const onDragOver = (e: DragEvent, id: string) => {
    e.preventDefault();
    if (id !== dragId) setOverId(id);
  };

  const onDrop = (e: DragEvent, targetId: string) => {
    e.preventDefault();
    const sourceId = dragId || e.dataTransfer.getData("text/plain");
    setDragId(null);
    setOverId(null);
    if (!sourceId || sourceId === targetId) return;
    const from = blocks.findIndex((b) => b.id === sourceId);
    const to = blocks.findIndex((b) => b.id === targetId);
    if (from < 0 || to < 0) return;
    const next = [...blocks];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    commit(next);
  };

  const replaceAll = () => {
    if (!findQuery) return;
    const next = blocks.map((b) => {
      if (b.type === "divider" || b.type === "image") return b;
      return { ...b, text: b.text.split(findQuery).join(replaceQuery) };
    });
    commit(next);
  };

  const toolBtn = (label: string, onClick: () => void, title?: string) => (
    <button
      type="button"
      className="btn btn-ghost btn-sm"
      title={title}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
    >
      {label}
    </button>
  );

  return (
    <div className="block-editor">
      <div className="block-toolbar">
        {toolBtn("B", () => applyWrap("**"), "粗體 ⌘B")}
        {toolBtn("I", () => applyWrap("*"), "斜體 ⌘I")}
        {toolBtn("連結", applyLink, "插入連結")}
        {toolBtn("[[", () => {
          const id = focusId || blocks[0]?.id;
          if (!id) return;
          const b = blocks.find((x) => x.id === id);
          if (!b) return;
          updateBlock(id, { text: `${b.text}[[` });
          setWiki({ blockId: id, query: "", index: 0 });
          focusBlock(id, true);
        }, "插入連結")}
        {toolBtn("找", () => setShowFind(!showFind), "尋找 ⌘F")}
        {toolBtn("圖", () => {
          const id = focusId || blocks[blocks.length - 1]?.id;
          if (!id) return;
          const url = window.prompt("圖片網址（https://…）", "https://");
          if (url === null) return;
          const img = createBlock({ type: "image", text: "image", src: url || "" });
          const nb = createBlock();
          const i = blocks.findIndex((b) => b.id === id);
          if (i < 0) return;
          const next = [...blocks];
          next.splice(i + 1, 0, img, nb);
          commit(next);
          focusBlock(nb.id);
        }, "插入圖片")}
      </div>

      <AnimatePresence>
        {showFind && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 8,
              padding: "0.55rem 0.4rem",
              background: "var(--bg-elevated)",
              border: "1px solid var(--border)",
              borderRadius: 8,
              marginBottom: 8,
            }}
          >
            <input
              className="input"
              style={{ flex: 1, minWidth: 120, padding: "0.45rem 0.7rem" }}
              placeholder="尋找…"
              value={findQuery}
              onChange={(e) => setFindQuery(e.target.value)}
              autoFocus
            />
            <input
              className="input"
              style={{ flex: 1, minWidth: 120, padding: "0.45rem 0.7rem" }}
              placeholder="取代為…"
              value={replaceQuery}
              onChange={(e) => setReplaceQuery(e.target.value)}
            />
            <button className="btn btn-sm btn-soft" type="button" onClick={replaceAll}>全部取代</button>
            <button className="btn btn-sm btn-ghost" type="button" onClick={() => setShowFind(false)}>關閉</button>
          </motion.div>
        )}
      </AnimatePresence>

      <div style={{ display: "flex", flexDirection: "column" }}>
        {blocks.map((block, i) => {
          const isSlash = slash?.blockId === block.id;
          const slashItems = isSlash ? filteredSlash(slash.query) : [];
          const isWiki = wiki?.blockId === block.id;
          const wikiItems = isWiki ? suggestWikiTitles(wikiNotes, wiki.query) : [];
          const hit = findQuery && block.text.toLowerCase().includes(findQuery.toLowerCase());
          const focused = focusId === block.id;

          return (
            <motion.div
              key={block.id}
              layout
              className={`block-row${focused ? " is-focus" : ""}`}
              onDragOver={(e) => onDragOver(e, block.id)}
              onDrop={(e) => onDrop(e, block.id)}
              style={{
                background: overId === block.id || hit ? "var(--accent-soft)" : undefined,
              }}
            >
              <div className="block-gutter">
                <button
                  type="button"
                  title="新增區塊"
                  onClick={() => insertAfter(block.id)}
                >
                  +
                </button>
                <button
                  type="button"
                  draggable
                  onDragStart={(e) => onDragStart(e, block.id)}
                  onDragEnd={() => { setDragId(null); setOverId(null); }}
                  title="拖曳排序"
                  aria-label="拖曳區塊"
                >
                  ⋮⋮
                </button>
              </div>

              <div className="block-content" style={{ position: "relative" }}>
                {block.type === "divider" ? (
                  <div
                    onClick={() => insertAfter(block.id)}
                    style={{ height: 1, background: "var(--border)", margin: "14px 0", cursor: "text" }}
                  />
                ) : block.type === "image" ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: "6px 0" }}>
                    {block.src ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={block.src}
                        alt={block.text || "image"}
                        style={{ maxWidth: "100%", borderRadius: 12, border: "1px solid var(--border)" }}
                      />
                    ) : (
                      <p style={{ color: "var(--text-muted)", fontSize: "0.85rem" }}>尚未設定圖片網址</p>
                    )}
                    <input
                      className="input"
                      style={{ padding: "0.45rem 0.7rem", fontSize: "0.85rem" }}
                      placeholder="https://…"
                      value={block.src || ""}
                      onChange={(e) => updateBlock(block.id, { src: e.target.value })}
                      onFocus={() => setFocusId(block.id)}
                    />
                    <input
                      className="input"
                      style={{ padding: "0.45rem 0.7rem", fontSize: "0.85rem" }}
                      placeholder="替代文字"
                      value={block.text}
                      onChange={(e) => updateBlock(block.id, { text: e.target.value })}
                    />
                  </div>
                ) : block.type === "code" ? (
                  <div style={{ width: "100%" }}>
                    <input
                      className="input"
                      style={{ padding: "0.3rem 0.55rem", fontSize: "0.75rem", marginBottom: 6, maxWidth: 140 }}
                      placeholder="language"
                      value={block.src || ""}
                      onChange={(e) => updateBlock(block.id, { src: e.target.value })}
                    />
                    <textarea
                      ref={(el) => { inputRefs.current[block.id] = el as unknown as HTMLInputElement; }}
                      className="input"
                      value={block.text}
                      onChange={(e) => onTextChange(block.id, e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && e.shiftKey) return;
                        if (e.key === "Enter") e.stopPropagation();
                      }}
                      onFocus={() => setFocusId(block.id)}
                      rows={Math.min(16, Math.max(3, block.text.split("\n").length + 1))}
                      style={{
                        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
                        fontSize: "0.88rem",
                        lineHeight: 1.5,
                        resize: "vertical",
                      }}
                    />
                  </div>
                ) : block.type === "table" ? (
                  <textarea
                    ref={(el) => { inputRefs.current[block.id] = el as unknown as HTMLInputElement; }}
                    className="input"
                    value={block.text}
                    onChange={(e) => updateBlock(block.id, { text: e.target.value })}
                    onFocus={() => setFocusId(block.id)}
                    rows={Math.min(12, Math.max(4, block.text.split("\n").length + 1))}
                    style={{ fontFamily: "ui-monospace, monospace", fontSize: "0.85rem", resize: "vertical" }}
                  />
                ) : block.type === "toggle" ? (
                  <div style={{ width: "100%" }}>
                    <button
                      type="button"
                      onClick={() => updateBlock(block.id, { checked: !block.checked })}
                      style={{
                        border: "none",
                        background: "transparent",
                        color: "var(--text-muted)",
                        cursor: "pointer",
                        marginRight: 6,
                      }}
                    >
                      {block.checked ? "▾" : "▸"}
                    </button>
                    <input
                      ref={(el) => { inputRefs.current[block.id] = el; }}
                      className="block-input"
                      value={block.text.split("\n")[0] || ""}
                      onChange={(e) => {
                        const rest = block.text.split("\n").slice(1).join("\n");
                        updateBlock(block.id, { text: rest ? `${e.target.value}\n${rest}` : e.target.value });
                      }}
                      onFocus={() => setFocusId(block.id)}
                      placeholder="Toggle 標題"
                      style={{
                        border: "none",
                        outline: "none",
                        background: "transparent",
                        color: "var(--text-main)",
                        fontWeight: 650,
                        fontSize: "0.98rem",
                        width: "calc(100% - 28px)",
                      }}
                    />
                    {block.checked && (
                      <textarea
                        className="input"
                        style={{ marginTop: 6, fontSize: "0.9rem" }}
                        value={block.text.split("\n").slice(1).join("\n")}
                        onChange={(e) => {
                          const title = block.text.split("\n")[0] || "詳細";
                          updateBlock(block.id, { text: `${title}\n${e.target.value}` });
                        }}
                        rows={3}
                        placeholder="摺疊內容…"
                      />
                    )}
                  </div>
                ) : block.type === "callout" ? (
                  <div
                    style={{
                      display: "flex",
                      gap: 10,
                      width: "100%",
                      padding: "0.65rem 0.75rem",
                      borderRadius: 10,
                      background: "var(--accent-soft)",
                      border: "1px solid var(--border)",
                    }}
                  >
                    <span style={{ fontSize: "1.1rem" }}>💡</span>
                    <input
                      ref={(el) => { inputRefs.current[block.id] = el; }}
                      className="block-input"
                      value={block.text}
                      placeholder="Callout 內容…"
                      onChange={(e) => onTextChange(block.id, e.target.value)}
                      onKeyDown={(e) => onKeyDown(e, block)}
                      onFocus={() => setFocusId(block.id)}
                      style={{
                        flex: 1,
                        border: "none",
                        outline: "none",
                        background: "transparent",
                        color: "var(--text-main)",
                        fontSize: "0.95rem",
                      }}
                    />
                  </div>
                ) : (
                  <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                    {block.type === "todo" && (
                      <input
                        type="checkbox"
                        checked={!!block.checked}
                        onChange={(e) => updateBlock(block.id, { checked: e.target.checked })}
                        style={{ marginTop: 10, accentColor: "var(--accent)" }}
                      />
                    )}
                    {block.type === "bullet" && (
                      <span style={{ marginTop: 8, color: "var(--text-muted)", width: 14 }}>•</span>
                    )}
                    {block.type === "numbered" && (
                      <span style={{ marginTop: 8, color: "var(--text-muted)", width: 18, fontSize: "0.9rem" }}>
                        {blocks.slice(0, i + 1).filter((b) => b.type === "numbered").length}.
                      </span>
                    )}
                    {block.type === "quote" && (
                      <span
                        style={{
                          width: 3,
                          alignSelf: "stretch",
                          background: "var(--accent)",
                          borderRadius: 2,
                          marginTop: 6,
                          marginBottom: 6,
                          flexShrink: 0,
                        }}
                      />
                    )}
                    <input
                      ref={(el) => { inputRefs.current[block.id] = el; }}
                      className="block-input"
                      value={block.text}
                      placeholder={i === 0 && !block.text ? (placeholder || "輸入文字，或按 / 插入區塊…") : ""}
                      onChange={(e) => onTextChange(block.id, e.target.value)}
                      onKeyDown={(e) => onKeyDown(e, block)}
                      onSelect={() => rememberSel(block.id)}
                      onMouseUp={() => rememberSel(block.id)}
                      onFocus={() => setFocusId(block.id)}
                      style={{
                        fontSize:
                          block.type === "heading1" ? "1.875rem"
                            : block.type === "heading2" ? "1.5rem"
                              : block.type === "heading3" ? "1.25rem"
                                : "1rem",
                        fontWeight: block.type.startsWith("heading") ? 700 : 400,
                        letterSpacing: block.type.startsWith("heading") ? "-0.03em" : undefined,
                        textDecoration: block.type === "todo" && block.checked ? "line-through" : "none",
                        opacity: block.type === "todo" && block.checked ? 0.55 : 1,
                        fontStyle: block.type === "quote" ? "italic" : "normal",
                      }}
                    />
                  </div>
                )}

                <AnimatePresence>
                  {isSlash && slashItems.length > 0 && (
                    <motion.div
                      className="slash-menu"
                      initial={{ opacity: 0, y: 6, scale: 0.98 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: 4, scale: 0.98 }}
                      transition={{ duration: 0.16 }}
                      style={{
                        position: "absolute",
                        left: 0,
                        top: "100%",
                        zIndex: 40,
                        minWidth: 260,
                        maxHeight: 300,
                        overflow: "auto",
                        background: "var(--bg-elevated)",
                        border: "1px solid var(--border)",
                        borderRadius: 12,
                        boxShadow: "var(--shadow)",
                        padding: 6,
                      }}
                    >
                      <p style={{ fontSize: "0.7rem", color: "var(--text-muted)", padding: "4px 8px", margin: 0 }}>
                        插入區塊
                      </p>
                      {slashItems.map((item, idx) => (
                        <button
                          key={item.id}
                          type="button"
                          onMouseDown={(e) => {
                            e.preventDefault();
                            applySlash(block.id, item);
                          }}
                          style={{
                            display: "flex",
                            width: "100%",
                            textAlign: "left",
                            gap: 10,
                            alignItems: "center",
                            border: "none",
                            borderRadius: 8,
                            padding: "8px 10px",
                            background: idx === slash.index ? "var(--accent-soft)" : "transparent",
                            color: "var(--text-main)",
                            cursor: "pointer",
                          }}
                        >
                          <span
                            style={{
                              width: 28,
                              height: 28,
                              borderRadius: 8,
                              background: "var(--bg-primary)",
                              border: "1px solid var(--border)",
                              display: "grid",
                              placeItems: "center",
                              fontSize: "0.75rem",
                              color: "var(--accent-2)",
                            }}
                          >
                            {typeLabel(item.type)}
                          </span>
                          <span>
                            <span style={{ display: "block", fontWeight: 600, fontSize: "0.9rem" }}>{item.label}</span>
                            <span style={{ display: "block", fontSize: "0.75rem", color: "var(--text-muted)" }}>{item.hint}</span>
                          </span>
                        </button>
                      ))}
                    </motion.div>
                  )}
                  {isWiki && (
                    <motion.div
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0 }}
                      style={{
                        position: "absolute",
                        left: 0,
                        top: "100%",
                        zIndex: 40,
                        minWidth: 240,
                        maxHeight: 240,
                        overflow: "auto",
                        background: "var(--bg-elevated)",
                        border: "1px solid var(--border)",
                        borderRadius: 12,
                        boxShadow: "var(--shadow)",
                        padding: 6,
                      }}
                    >
                      <p style={{ fontSize: "0.7rem", color: "var(--text-muted)", padding: "4px 8px", margin: 0 }}>
                        連結筆記 [[ ]]
                      </p>
                      {wikiItems.length === 0 ? (
                        <p style={{ fontSize: "0.8rem", color: "var(--text-muted)", padding: "8px" }}>
                          無符合標題 — 仍可手動完成 [[標題]]
                        </p>
                      ) : wikiItems.map((n, idx) => (
                        <button
                          key={n.id}
                          type="button"
                          onMouseDown={(e) => {
                            e.preventDefault();
                            applyWiki(block.id, n.title);
                          }}
                          style={{
                            display: "block",
                            width: "100%",
                            textAlign: "left",
                            border: "none",
                            borderRadius: 8,
                            padding: "8px 10px",
                            background: idx === wiki!.index ? "var(--accent-soft)" : "transparent",
                            color: "var(--text-main)",
                            cursor: "pointer",
                            fontWeight: 600,
                            fontSize: "0.9rem",
                          }}
                        >
                          [[{n.title}]]
                        </button>
                      ))}
                      {onOpenWiki && wikiItems[wiki!.index] && (
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          style={{ margin: 6 }}
                          onMouseDown={(e) => {
                            e.preventDefault();
                            onOpenWiki(wikiItems[wiki!.index].title);
                          }}
                        >
                          開啟選取筆記
                        </button>
                      )}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </motion.div>
          );
        })}
      </div>

      <button
        type="button"
        onClick={() => {
          const nb = createBlock();
          commit([...blocks, nb]);
          focusBlock(nb.id);
        }}
        style={{
          alignSelf: "flex-start",
          marginTop: 8,
          marginLeft: 44,
          border: "none",
          background: "transparent",
          color: "var(--text-muted)",
          fontSize: "0.85rem",
          cursor: "pointer",
          padding: "0.35rem 0",
          opacity: 0.55,
        }}
      >
        按 Enter 繼續，或點此新增區塊
      </button>
    </div>
  );
}
