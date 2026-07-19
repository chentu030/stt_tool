"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Editor } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import type { SelectionAiAction } from "@/components/SelectionAiPanel";

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
      active: (ed) => ed.isActive("paragraph") && !ed.isActive("bulletList") && !ed.isActive("orderedList") && !ed.isActive("taskList"),
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

const AI_SKILLS: { id: SelectionAiAction; label: string }[] = [
  { id: "improve", label: "提升寫作" },
  { id: "proofread", label: "校對" },
  { id: "explain", label: "解釋" },
  { id: "reformat", label: "重新格式化" },
];

const TX_PRESETS = ["#111827", "#6b7280", "#b45309", "#c2410c", "#ca8a04", "#15803d", "#1d4ed8", "#7c3aed", "#db2777"];
const HL_PRESETS = ["#fef08a", "#bbf7d0", "#bae6fd", "#e9d5ff", "#fecaca", "#fed7aa"];

type Props = {
  editor: Editor;
  onOpenAi: (opts?: { action?: SelectionAiAction }) => void;
  onOpenThread?: (selectionText: string) => void;
  onCreateSubpage?: (title: string) => Promise<{ id: string; title: string } | null>;
  onSetLink: () => void;
  applyTextColor: (color?: string) => void;
  applyHighlight: (color?: string) => void;
  clearTextColor: () => void;
  txColor: string;
  hlColor: string;
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
  onOpenAi,
  onOpenThread,
  onCreateSubpage,
  onSetLink,
  applyTextColor,
  applyHighlight,
  clearTextColor,
  txColor,
  hlColor,
}: Props) {
  const [turnOpen, setTurnOpen] = useState(false);
  const [colorOpen, setColorOpen] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [tick, setTick] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const turnItems = buildTurnItems({ onCreateSubpage });

  useEffect(() => {
    const bump = () => setTick((t) => t + 1);
    editor.on("selectionUpdate", bump);
    editor.on("transaction", bump);
    return () => {
      editor.off("selectionUpdate", bump);
      editor.off("transaction", bump);
    };
  }, [editor]);

  useEffect(() => {
    if (!turnOpen && !colorOpen && !emojiOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setTurnOpen(false);
        setColorOpen(false);
        setEmojiOpen(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [turnOpen, colorOpen, emojiOpen]);

  void tick;

  const selectionText = () => {
    const { from, to } = editor.state.selection;
    return editor.state.doc.textBetween(from, to, "\n");
  };

  return (
    <BubbleMenu
      editor={editor}
      className="sel-bubble"
      shouldShow={({ editor: ed, state }) => {
        const { from, to } = state.selection;
        return from !== to && !ed.isActive("codeBlock") && !ed.isActive("mathBlock");
      }}
      options={{ placement: "top", offset: 8 }}
    >
      <div className="sel-bubble-inner" ref={wrapRef}>
        <div className="sel-bubble-row">
          <div className="sel-bub-turn-wrap">
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
            {turnOpen && (
              <div className="sel-bub-panel sel-bub-turn-panel">
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
              </div>
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
              <span className="sel-bub-a" style={{ borderBottomColor: (editor.getAttributes("textStyle").color as string) || txColor }}>
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
            <span className="sel-bub-clear">T<sub>x</sub></span>
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
              const { from, to } = editor.state.selection;
              const selected = editor.state.doc.textBetween(from, to, "");
              const latex = selected.trim() || "x^2";
              if (from !== to) editor.chain().focus().deleteSelection().run();
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

          <BubBtn title="詢問 AI（Alt+Shift+E）" accent onClick={() => onOpenAi()}>
            <span className="material-symbols-outlined sel-bub-ico">auto_awesome</span>
          </BubBtn>
        </div>

        <div className="sel-bubble-skills">
          <span className="sel-bub-skills-label">技能</span>
          {AI_SKILLS.map((s) => (
            <button
              key={s.id}
              type="button"
              className="sel-bub-skill"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => onOpenAi({ action: s.id })}
            >
              {s.label}
            </button>
          ))}
        </div>

        <button
          type="button"
          className="sel-bubble-ai-footer"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onOpenAi()}
        >
          <span>透過 AI 編輯</span>
          <kbd>Alt+Shift+E</kbd>
        </button>
      </div>
      {/* keep hlColor referenced for future default swatch */}
      <span hidden data-hl={hlColor} />
    </BubbleMenu>
  );
}
