"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { Editor } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import SelectionAiPanel, { type SelectionAiAction } from "@/components/SelectionAiPanel";

const EMOJIS = ["👍", "❤️", "😊", "🎉", "🔥", "✅", "❗", "💡", "👀", "🙏", "✨", "📌"];

type TurnItem = {
  id: string;
  label: string;
  icon: string;
  active: (ed: Editor) => boolean;
  run: (ed: Editor) => void;
};

function buildTurnItems(opts: {
  onCreateSubpage?: (title: string) => Promise<{ id: string; title: string } | null>;
}): TurnItem[] {
  const items: TurnItem[] = [
    {
      id: "p",
      label: "文字",
      icon: "title",
      active: (ed) =>
        ed.isActive("paragraph") &&
        !ed.isActive("bulletList") &&
        !ed.isActive("orderedList") &&
        !ed.isActive("taskList"),
      run: (ed) => ed.chain().focus().setParagraph().run(),
    },
    {
      id: "h1",
      label: "標題 1",
      icon: "format_h1",
      active: (ed) => ed.isActive("heading", { level: 1 }),
      run: (ed) => ed.chain().focus().toggleHeading({ level: 1 }).run(),
    },
    {
      id: "h2",
      label: "標題 2",
      icon: "format_h2",
      active: (ed) => ed.isActive("heading", { level: 2 }),
      run: (ed) => ed.chain().focus().toggleHeading({ level: 2 }).run(),
    },
    {
      id: "h3",
      label: "標題 3",
      icon: "format_h3",
      active: (ed) => ed.isActive("heading", { level: 3 }),
      run: (ed) => ed.chain().focus().toggleHeading({ level: 3 }).run(),
    },
    {
      id: "h4",
      label: "標題 4",
      icon: "format_h4",
      active: (ed) => ed.isActive("heading", { level: 4 }),
      run: (ed) => ed.chain().focus().toggleHeading({ level: 4 }).run(),
    },
  ];
  if (opts.onCreateSubpage) {
    items.push({
      id: "page",
      label: "頁面",
      icon: "note_add",
      active: () => false,
      run: (ed) => {
        void (async () => {
          const created = await opts.onCreateSubpage!("未命名子頁");
          if (!created) return;
          ed.chain().focus().insertContent(`[[${created.title}]] `).run();
        })();
      },
    });
  }
  items.push(
    {
      id: "bullet",
      label: "項目符號列表",
      icon: "format_list_bulleted",
      active: (ed) => ed.isActive("bulletList"),
      run: (ed) => ed.chain().focus().toggleBulletList().run(),
    },
    {
      id: "numbered",
      label: "有序列表",
      icon: "format_list_numbered",
      active: (ed) => ed.isActive("orderedList"),
      run: (ed) => ed.chain().focus().toggleOrderedList().run(),
    },
    {
      id: "todo",
      label: "待辦清單",
      icon: "check_box",
      active: (ed) => ed.isActive("taskList"),
      run: (ed) => ed.chain().focus().toggleTaskList().run(),
    },
    {
      id: "toggle",
      label: "摺疊列表",
      icon: "arrow_right",
      active: (ed) => ed.isActive("toggleBlock"),
      run: (ed) => ed.chain().focus().setToggleBlock("詳細內容").run(),
    },
    {
      id: "code",
      label: "程式碼",
      icon: "code",
      active: (ed) => ed.isActive("codeBlock"),
      run: (ed) => ed.chain().focus().toggleCodeBlock().run(),
    },
    {
      id: "quote",
      label: "引用",
      icon: "format_quote",
      active: (ed) => ed.isActive("blockquote"),
      run: (ed) => ed.chain().focus().toggleBlockquote().run(),
    },
    {
      id: "callout",
      label: "標註",
      icon: "info",
      active: (ed) => ed.isActive("callout"),
      run: (ed) => ed.chain().focus().setCallout("info").run(),
    },
    {
      id: "math",
      label: "方程式區塊",
      icon: "functions",
      active: (ed) => ed.isActive("mathBlock"),
      run: (ed) => ed.chain().focus().setMathBlock("E = mc^2").run(),
    },
    {
      id: "th1",
      label: "摺疊標題 1",
      icon: "keyboard_arrow_right",
      active: (ed) => ed.isActive("toggleHeading", { level: 1 }),
      run: (ed) => ed.chain().focus().setToggleHeading(1).run(),
    },
    {
      id: "th2",
      label: "摺疊標題 2",
      icon: "keyboard_arrow_right",
      active: (ed) => ed.isActive("toggleHeading", { level: 2 }),
      run: (ed) => ed.chain().focus().setToggleHeading(2).run(),
    },
    {
      id: "th3",
      label: "摺疊標題 3",
      icon: "keyboard_arrow_right",
      active: (ed) => ed.isActive("toggleHeading", { level: 3 }),
      run: (ed) => ed.chain().focus().setToggleHeading(3).run(),
    },
    {
      id: "th4",
      label: "摺疊標題 4",
      icon: "keyboard_arrow_right",
      active: (ed) => ed.isActive("toggleHeading", { level: 4 }),
      run: (ed) => ed.chain().focus().setToggleHeading(4).run(),
    },
    {
      id: "col2",
      label: "2 欄",
      icon: "view_column",
      active: (ed) => ed.isActive("columns"),
      run: (ed) => ed.chain().focus().setColumns(2).run(),
    },
    {
      id: "col3",
      label: "3 欄",
      icon: "view_column",
      active: () => false,
      run: (ed) => ed.chain().focus().setColumns(3).run(),
    }
  );
  return items;
}

function currentTurnLabel(ed: Editor, items: TurnItem[]): string {
  const hit = items.find((i) => i.active(ed));
  return hit?.label || "一般文字";
}

const TX_PRESETS = ["#111827", "#6b7280", "#b45309", "#c2410c", "#ca8a04", "#15803d", "#1d4ed8", "#7c3aed", "#db2777"];
const HL_PRESETS = ["#fef08a", "#bbf7d0", "#bae6fd", "#e9d5ff", "#fecaca", "#fed7aa"];

type Props = {
  editor: Editor;
  noteTitle?: string;
  noteBody?: string;
  aiContext?: string;
  onOpenThread?: (selectionText: string) => void;
  onCreateSubpage?: (title: string) => Promise<{ id: string; title: string } | null>;
  onSetLink: () => void;
  applyTextColor: (color?: string) => void;
  applyHighlight: (color?: string) => void;
  clearTextColor: () => void;
  txColor: string;
  hlColor: string;
  onSendToAside?: (selection: string, question?: string) => void;
  onDeepResearch?: (selection: string) => void;
  /** Controlled expand from parent (e.g. Alt+Shift+E) */
  aiOpen?: boolean;
  aiAutoAction?: SelectionAiAction;
  onAiOpenChange?: (open: boolean, opts?: { action?: SelectionAiAction }) => void;
};

function BubBtn({
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
      className={`sel-bub-btn${active ? " is-active" : ""}${accent ? " is-accent" : ""}`}
      title={title}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

export default function SelectionBubbleMenu({
  editor,
  noteTitle,
  noteBody,
  aiContext,
  onOpenThread,
  onCreateSubpage,
  onSetLink,
  applyTextColor,
  applyHighlight,
  clearTextColor,
  txColor,
  hlColor,
  onSendToAside,
  onDeepResearch,
  aiOpen: aiOpenProp,
  aiAutoAction,
  onAiOpenChange,
}: Props) {
  const [turnOpen, setTurnOpen] = useState(false);
  const [colorOpen, setColorOpen] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [aiOpenLocal, setAiOpenLocal] = useState(false);
  const [tick, setTick] = useState(0);
  const [turnPos, setTurnPos] = useState<{
    top: number;
    left: number;
    maxHeight: number;
  } | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const turnWrapRef = useRef<HTMLDivElement>(null);
  const turnPanelRef = useRef<HTMLDivElement>(null);
  const bubbleElRef = useRef<HTMLElement | null>(null);
  const turnItems = buildTurnItems({ onCreateSubpage });

  const aiOpen = aiOpenProp ?? aiOpenLocal;
  const setAiOpen = (open: boolean, opts?: { action?: SelectionAiAction }) => {
    if (onAiOpenChange) onAiOpenChange(open, opts);
    else setAiOpenLocal(open);
  };

  useEffect(() => {
    // Only selection/focus changes need toolbar active-state refresh.
    // Do NOT subscribe to every transaction — that re-renders this component
    // constantly and used to feed TipTap BubbleMenu an infinite update loop
    // (unstable appendTo/shouldShow/options → dispatch → render → …).
    const bump = () => setTick((t) => t + 1);
    editor.on("selectionUpdate", bump);
    editor.on("focus", bump);
    editor.on("blur", bump);
    return () => {
      editor.off("selectionUpdate", bump);
      editor.off("focus", bump);
      editor.off("blur", bump);
    };
  }, [editor]);

  useEffect(() => {
    if (!turnOpen && !colorOpen && !emojiOpen) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (wrapRef.current?.contains(t)) return;
      if (turnPanelRef.current?.contains(t)) return;
      setTurnOpen(false);
      setColorOpen(false);
      setEmojiOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [turnOpen, colorOpen, emojiOpen]);

  useEffect(() => {
    if (!turnOpen) {
      setTurnPos(null);
      return;
    }
    const place = () => {
      const host = turnWrapRef.current;
      if (!host) return;
      const r = host.getBoundingClientRect();
      const menuW = 240;
      const preferH = 320;
      const gap = 6;
      const pad = 8;
      const spaceAbove = r.top - pad;
      const spaceBelow = window.innerHeight - r.bottom - pad;
      // Bubble sits below the selection — prefer opening the turn list upward
      // so it doesn't cover more of the following text.
      const openBelow =
        spaceBelow >= Math.min(200, preferH) && spaceBelow > spaceAbove + 48;
      const maxHeight = Math.min(
        preferH,
        Math.max(140, (openBelow ? spaceBelow : spaceAbove) - gap)
      );
      const left = Math.min(
        Math.max(pad, r.left),
        Math.max(pad, window.innerWidth - menuW - pad)
      );
      let top = openBelow ? r.bottom + gap : r.top - maxHeight - gap;
      top = Math.max(pad, Math.min(top, window.innerHeight - maxHeight - pad));
      setTurnPos({ top, left, maxHeight });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [turnOpen]);

  void tick;

  // Stable callbacks are required: TipTap's BubbleMenu re-dispatches a
  // transaction whenever these props change identity, which freezes the UI.
  const appendTo = useCallback(() => document.body, []);

  const shouldShow = useCallback(
    ({
      editor: ed,
      view,
      from: a,
      to: b,
    }: {
      editor: Editor;
      view: { hasFocus: () => boolean };
      from: number;
      to: number;
    }) => {
      if (a === b) return false;
      if (ed.isActive("codeBlock") || ed.isActive("mathBlock")) return false;
      const menuEl = bubbleElRef.current;
      const isChildOfMenu = !!(menuEl && document.activeElement && menuEl.contains(document.activeElement));
      return view.hasFocus() || isChildOfMenu;
    },
    []
  );

  const floatingOptions = useMemo(
    () => ({
      placement: "bottom" as const,
      offset: 10,
      strategy: "fixed" as const,
      onShow: () => {
        if (bubbleElRef.current) bubbleElRef.current.dataset.open = "true";
      },
      onHide: () => {
        if (bubbleElRef.current) delete bubbleElRef.current.dataset.open;
      },
    }),
    []
  );

  const selectionText = () => {
    const { from, to } = editor.state.selection;
    return editor.state.doc.textBetween(from, to, "\n");
  };

  const { from, to } = editor.state.selection;
  const selText = editor.state.doc.textBetween(from, to, "\n");

  return (
    <BubbleMenu
      editor={editor}
      className="sel-bubble"
      appendTo={appendTo}
      ref={(el) => {
        bubbleElRef.current = el;
      }}
      shouldShow={shouldShow}
      options={floatingOptions}
      updateDelay={100}
    >
      <div className="sel-bubble-inner" ref={wrapRef}>
        <div className="sel-bubble-row">
          <div className="sel-bub-turn-wrap" ref={turnWrapRef}>
            <BubBtn
              title="轉換成"
              active={turnOpen}
              onClick={() => {
                setColorOpen(false);
                setEmojiOpen(false);
                setTurnOpen((v) => !v);
              }}
            >
              <span className="material-symbols-outlined sel-bub-ico">title</span>
              <span className="sel-bub-turn-label">{currentTurnLabel(editor, turnItems)}</span>
              <span className="sel-bub-caret">▾</span>
            </BubBtn>
            {turnOpen &&
              turnPos &&
              createPortal(
                <div
                  ref={turnPanelRef}
                  className="sel-bub-panel sel-bub-turn-panel sel-bub-turn-panel--fixed"
                  style={{
                    position: "fixed",
                    top: turnPos.top,
                    left: turnPos.left,
                    maxHeight: turnPos.maxHeight,
                    zIndex: 90,
                  }}
                >
                  <p className="sel-bub-panel-label">轉換成</p>
                  {turnItems.map((item) => {
                    const on = item.active(editor);
                    return (
                      <button
                        key={item.id}
                        type="button"
                        className={`sel-bub-turn-item${on ? " is-on" : ""}`}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => {
                          item.run(editor);
                          setTurnOpen(false);
                        }}
                      >
                        <span className="material-symbols-outlined">{item.icon}</span>
                        <span>{item.label}</span>
                        {on ? <span className="sel-bub-check">✓</span> : null}
                      </button>
                    );
                  })}
                </div>,
                document.body
              )}
          </div>

          <span className="sel-bub-sep" />

          <div className="sel-bub-color-wrap">
            <BubBtn
              title="文字／背景色"
              active={colorOpen || !!editor.getAttributes("textStyle").color || editor.isActive("highlight")}
              onClick={() => {
                setTurnOpen(false);
                setEmojiOpen(false);
                setColorOpen((v) => !v);
              }}
            >
              <span
                className="sel-bub-a"
                style={{ borderBottomColor: (editor.getAttributes("textStyle").color as string) || txColor }}
              >
                A
              </span>
            </BubBtn>
            {colorOpen && (
              <div className="sel-bub-panel sel-bub-color-panel">
                <p className="sel-bub-panel-label">文字顏色</p>
                <div className="sel-bub-swatches">
                  <button
                    type="button"
                    className="sel-bub-swatch sel-bub-swatch--clear"
                    title="預設"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => clearTextColor()}
                  />
                  {TX_PRESETS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      className="sel-bub-swatch"
                      style={{ background: c }}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => applyTextColor(c)}
                    />
                  ))}
                </div>
                <p className="sel-bub-panel-label">背景顏色</p>
                <div className="sel-bub-swatches">
                  <button
                    type="button"
                    className="sel-bub-swatch sel-bub-swatch--clear"
                    title="清除螢光"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => editor.chain().focus().unsetHighlight().run()}
                  />
                  {HL_PRESETS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      className="sel-bub-swatch"
                      style={{ background: c }}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => applyHighlight(c)}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>

          <BubBtn title="粗體" active={editor.isActive("bold")} onClick={() => editor.chain().focus().toggleBold().run()}>
            <strong>B</strong>
          </BubBtn>
          <BubBtn title="斜體" active={editor.isActive("italic")} onClick={() => editor.chain().focus().toggleItalic().run()}>
            <em>I</em>
          </BubBtn>
          <BubBtn title="底線" active={editor.isActive("underline")} onClick={() => editor.chain().focus().toggleUnderline().run()}>
            <u>U</u>
          </BubBtn>
          <BubBtn title="清除格式" onClick={() => editor.chain().focus().unsetAllMarks().run()}>
            <span className="sel-bub-clear">
              T<sub>x</sub>
            </span>
          </BubBtn>

          <span className="sel-bub-sep" />

          <BubBtn title="連結" active={editor.isActive("link")} onClick={onSetLink}>
            <span className="material-symbols-outlined sel-bub-ico">link</span>
          </BubBtn>
          <BubBtn title="刪除線" active={editor.isActive("strike")} onClick={() => editor.chain().focus().toggleStrike().run()}>
            <s>S</s>
          </BubBtn>
          <BubBtn title="行內程式碼" active={editor.isActive("code")} onClick={() => editor.chain().focus().toggleCode().run()}>
            {"</>"}
          </BubBtn>
          <BubBtn
            title="行內公式"
            onClick={() => {
              const { from: a, to: b } = editor.state.selection;
              const selected = editor.state.doc.textBetween(a, b, "");
              const latex = selected.trim() || "x^2";
              if (a !== b) editor.chain().focus().deleteSelection().run();
              editor.chain().focus().setMathInline(latex).run();
            }}
          >
            √x
          </BubBtn>

          <span className="sel-bub-sep" />

          {onOpenThread && (
            <BubBtn
              title="評論"
              onClick={() => {
                const t = selectionText();
                if (t.trim()) onOpenThread(t);
              }}
            >
              <span className="material-symbols-outlined sel-bub-ico">chat_bubble</span>
              <span className="sel-bub-txt">評論</span>
            </BubBtn>
          )}

          <div className="sel-bub-emoji-wrap">
            <BubBtn
              title="表情"
              active={emojiOpen}
              onClick={() => {
                setTurnOpen(false);
                setColorOpen(false);
                setEmojiOpen((v) => !v);
              }}
            >
              <span className="material-symbols-outlined sel-bub-ico">sentiment_satisfied</span>
            </BubBtn>
            {emojiOpen && (
              <div className="sel-bub-panel sel-bub-emoji-panel">
                {EMOJIS.map((em) => (
                  <button
                    key={em}
                    type="button"
                    className="sel-bub-emoji"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      editor.chain().focus().insertContent(em).run();
                      setEmojiOpen(false);
                    }}
                  >
                    {em}
                  </button>
                ))}
              </div>
            )}
          </div>

          <BubBtn
            title="詢問 AI（Alt+Shift+E）"
            accent
            active={aiOpen}
            onClick={() => {
              setTurnOpen(false);
              setColorOpen(false);
              setEmojiOpen(false);
              setAiOpen(!aiOpen);
            }}
          >
            <span className="material-symbols-outlined sel-bub-ico">auto_awesome</span>
          </BubBtn>
        </div>

        {aiOpen && (
          <SelectionAiPanel
            variant="inline"
            open
            editor={editor}
            noteTitle={noteTitle}
            noteBody={noteBody}
            aiContext={aiContext}
            selectionText={selText}
            from={from}
            to={to}
            autoAction={aiAutoAction}
            onClose={() => setAiOpen(false)}
            onSendToAside={onSendToAside}
            onDeepResearch={onDeepResearch}
          />
        )}
      </div>
      <span hidden data-hl={hlColor} />
    </BubbleMenu>
  );
}
