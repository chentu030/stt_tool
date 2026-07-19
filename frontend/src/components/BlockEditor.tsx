"use client";

import { useEffect, useRef, useState, KeyboardEvent, DragEvent } from "react";
import {
  Block,
  BlockType,
  SLASH_ITEMS,
  SlashItem,
  createBlock,
  markdownToBlocks,
  blocksToMarkdown,
} from "@/lib/blocks";

type Props = {
  valueMd: string;
  onChangeMd: (md: string) => void;
  placeholder?: string;
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
    default: return "¶";
  }
}

export default function BlockEditor({ valueMd, onChangeMd, placeholder }: Props) {
  const [blocks, setBlocks] = useState<Block[]>(() => markdownToBlocks(valueMd));
  const [focusId, setFocusId] = useState<string | null>(null);
  const [slash, setSlash] = useState<{ blockId: string; query: string; index: number } | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const skipSync = useRef(false);
  const inputRefs = useRef<Record<string, HTMLInputElement | HTMLTextAreaElement | null>>({});

  // External md → blocks (e.g. initial load)
  useEffect(() => {
    if (skipSync.current) {
      skipSync.current = false;
      return;
    }
    setBlocks(markdownToBlocks(valueMd));
  }, [valueMd]);

  const focusBlock = (id: string, caretEnd = false) => {
    setFocusId(id);
    requestAnimationFrame(() => {
      const el = inputRefs.current[id];
      el?.focus();
      if (caretEnd && el && "setSelectionRange" in el) {
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
    } else {
      const next = [...blocks];
      next[i] = {
        ...b,
        type: item.type,
        text,
        checked: item.type === "todo" ? false : undefined,
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

  const onTextChange = (id: string, text: string) => {
    updateBlock(id, { text });
    const m = text.match(/(?:^|\s)\/([^\s]*)$/);
    if (m) {
      setSlash({ blockId: id, query: m[1], index: 0 });
    } else {
      setSlash((s) => (s?.blockId === id ? null : s));
    }
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
      updateBlock(block.id, { type: "paragraph", checked: undefined });
      return;
    }

    if (e.key === "Backspace" && block.text === "") {
      e.preventDefault();
      removeBlock(block.id);
      return;
    }

    // Markdown shortcuts at line start
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

  return (
    <div className="block-editor" style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      {blocks.map((block, i) => {
        const isSlash = slash?.blockId === block.id;
        const slashItems = isSlash ? filteredSlash(slash.query) : [];

        return (
          <div
            key={block.id}
            className="block-row"
            onDragOver={(e) => onDragOver(e, block.id)}
            onDrop={(e) => onDrop(e, block.id)}
            style={{
              display: "grid",
              gridTemplateColumns: "28px 28px 1fr",
              gap: 4,
              alignItems: block.type === "divider" ? "center" : "flex-start",
              padding: "2px 0",
              borderRadius: 8,
              background: overId === block.id ? "var(--accent-soft)" : "transparent",
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
                  style={{
                    height: 1,
                    background: "var(--border)",
                    margin: "14px 0",
                    cursor: "text",
                  }}
                />
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
                    onFocus={() => setFocusId(block.id)}
                    style={{
                      flex: 1,
                      width: "100%",
                      border: "none",
                      outline: "none",
                      background: "transparent",
                      color: "var(--text)",
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

              {isSlash && slashItems.length > 0 && (
                <div
                  className="slash-menu"
                  style={{
                    position: "absolute",
                    left: 0,
                    top: "100%",
                    zIndex: 40,
                    minWidth: 240,
                    maxHeight: 280,
                    overflow: "auto",
                    background: "var(--surface)",
                    border: "1px solid var(--border)",
                    borderRadius: 12,
                    boxShadow: "0 12px 40px rgba(0,0,0,0.18)",
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
                        color: "var(--text)",
                        cursor: "pointer",
                      }}
                    >
                      <span
                        style={{
                          width: 28,
                          height: 28,
                          borderRadius: 8,
                          background: "var(--bg)",
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
                </div>
              )}
            </div>
          </div>
        );
      })}

      <button
        type="button"
        className="btn btn-ghost"
        onClick={() => {
          const nb = createBlock();
          commit([...blocks, nb]);
          setFocusId(nb.id);
          requestAnimationFrame(() => inputRefs.current[nb.id]?.focus());
        }}
        style={{ alignSelf: "flex-start", marginTop: 8, fontSize: "0.85rem", opacity: 0.7 }}
      >
        + 新增區塊
      </button>
    </div>
  );
}
