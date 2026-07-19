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
} from "@/lib/blocks";

type Props = {
  valueMd: string;
  onChangeMd: (md: string) => void;
  placeholder?: string;
  findOpen?: boolean;
  onFindOpenChange?: (open: boolean) => void;
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
}: Props) {
  const [blocks, setBlocks] = useState<Block[]>(() => markdownToBlocks(valueMd));
  const [focusId, setFocusId] = useState<string | null>(null);
  const [slash, setSlash] = useState<{ blockId: string; query: string; index: number } | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [findQuery, setFindQuery] = useState("");
  const [replaceQuery, setReplaceQuery] = useState("");
  const [internalFind, setInternalFind] = useState(false);
  const skipSync = useRef(false);
  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({});
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
    const m = text.match(/(?:^|\s)\/([^\s]*)$/);
    if (m) setSlash({ blockId: id, query: m[1], index: 0 });
    else setSlash((s) => (s?.blockId === id ? null : s));
  };

  const onKeyDown = (e: KeyboardEvent, block: Block) => {
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
      style={{ minWidth: 34, padding: "0.35rem 0.55rem" }}
    >
      {label}
    </button>
  );

  return (
    <div className="block-editor" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div
        className="note-toolbar"
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 6,
          padding: "0.45rem 0.35rem",
          borderBottom: "1px solid var(--border)",
          position: "sticky",
          top: 0,
          zIndex: 5,
          background: "var(--bg-muted)",
        }}
      >
        {toolBtn("B", () => applyWrap("**"), "粗體 ⌘B")}
        {toolBtn("I", () => applyWrap("*"), "斜體 ⌘I")}
        {toolBtn("連結", applyLink, "插入連結")}
        {toolBtn("找", () => setShowFind(!showFind), "尋找 ⌘F")}
        {toolBtn("圖片", () => {
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
              borderRadius: 10,
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

      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        {blocks.map((block, i) => {
          const isSlash = slash?.blockId === block.id;
          const slashItems = isSlash ? filteredSlash(slash.query) : [];
          const hit = findQuery && block.text.toLowerCase().includes(findQuery.toLowerCase());

          return (
            <motion.div
              key={block.id}
              layout
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              className="block-row"
              onDragOver={(e) => onDragOver(e, block.id)}
              onDrop={(e) => onDrop(e, block.id)}
              style={{
                display: "grid",
                gridTemplateColumns: "28px 28px 1fr",
                gap: 4,
                alignItems: block.type === "divider" || block.type === "image" ? "center" : "flex-start",
                padding: "2px 0",
                borderRadius: 8,
                background: overId === block.id || hit
                  ? "var(--accent-soft)"
                  : "transparent",
                position: "relative",
              }}
            >
              <button
                type="button"
                draggable
                onDragStart={(e) => onDragStart(e, block.id)}
                onDragEnd={() => { setDragId(null); setOverId(null); }}
                title="拖曳排序"
                aria-label="拖曳區塊"
                style={{
                  cursor: "grab",
                  border: "none",
                  background: "transparent",
                  color: "var(--text-muted)",
                  opacity: 0.45,
                  fontSize: "0.85rem",
                  padding: "6px 0",
                  lineHeight: 1,
                }}
              >
                ⋮⋮
              </button>

              <div
                style={{
                  fontSize: "0.7rem",
                  color: "var(--text-muted)",
                  paddingTop: block.type.startsWith("heading") ? 10 : 8,
                  textAlign: "center",
                  opacity: 0.55,
                  userSelect: "none",
                }}
                title={block.type}
              >
                {typeLabel(block.type)}
              </div>

              <div style={{ minWidth: 0, position: "relative" }}>
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
                      placeholder={i === 0 && !block.text ? (placeholder || "輸入文字，或打 / 插入區塊…") : ""}
                      onChange={(e) => onTextChange(block.id, e.target.value)}
                      onKeyDown={(e) => onKeyDown(e, block)}
                      onSelect={() => rememberSel(block.id)}
                      onMouseUp={() => rememberSel(block.id)}
                      onFocus={() => setFocusId(block.id)}
                      style={{
                        flex: 1,
                        width: "100%",
                        border: "none",
                        outline: "none",
                        background: "transparent",
                        color: "var(--text-main)",
                        fontFamily: "inherit",
                        lineHeight: 1.55,
                        padding: "6px 0",
                        fontSize:
                          block.type === "heading1" ? "1.55rem"
                            : block.type === "heading2" ? "1.25rem"
                              : block.type === "heading3" ? "1.05rem"
                                : "0.98rem",
                        fontWeight: block.type.startsWith("heading") ? 700 : 400,
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
                </AnimatePresence>
              </div>
            </motion.div>
          );
        })}
      </div>

      <button
        type="button"
        className="btn btn-ghost"
        onClick={() => {
          const nb = createBlock();
          commit([...blocks, nb]);
          focusBlock(nb.id);
        }}
        style={{ alignSelf: "flex-start", marginTop: 4, fontSize: "0.85rem", opacity: 0.75 }}
      >
        + 新增區塊
      </button>
    </div>
  );
}
