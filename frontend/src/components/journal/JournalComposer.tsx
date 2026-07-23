"use client";

import { useEffect, useLayoutEffect, useImperativeHandle, forwardRef, useRef, useState } from "react";
import {
  journalTagIdFromLabel,
  nextJournalTagColor,
  promptForDate,
  type JournalTagDef,
  type JournalTemplateDef,
} from "@/lib/journalMeta";
import AiMarkdown from "@/components/AiMarkdown";
import { usePrefsOptional } from "@/components/PrefsProvider";
import { askConfirm, askPrompt } from "@/lib/dialogs";
import { toast } from "@/lib/toast";

export type JournalComposerHandle = {
  save: () => void;
  isDirty: () => boolean;
};

type Props = {
  dateKey: string;
  initialText?: string;
  /** Selected tag ids for this entry. */
  tags?: string[];
  busy?: boolean;
  onSave: (payload: {
    text: string;
    tags: string[];
    appendTemplate?: string;
    silent?: boolean;
  }) => void;
  onOpenFull: () => void;
  onDirtyChange?: (dirty: boolean) => void;
};

function sameIds(a: string[] = [], b: string[] = []) {
  if (a.length !== b.length) return false;
  const sb = new Set(b);
  return a.every((x) => sb.has(x));
}

const JournalComposer = forwardRef<JournalComposerHandle, Props>(function JournalComposer(
  {
    dateKey,
    initialText = "",
    tags: initialTags = [],
    busy,
    onSave,
    onOpenFull,
    onDirtyChange,
  },
  ref
) {
  const prefsCtx = usePrefsOptional();
  const tagDefs = prefsCtx?.prefs.journalTags || [];
  const templates = prefsCtx?.prefs.journalTemplates || [];

  const [text, setText] = useState(initialText);
  const [selected, setSelected] = useState<string[]>(initialTags);
  // Empty day → start writing immediately (capture-first UX).
  const [mode, setMode] = useState<"preview" | "edit">(
    () => (initialText.trim() ? "preview" : "edit")
  );
  const [metaOpen, setMetaOpen] = useState(() => Boolean(initialText.trim() || initialTags.length));
  const [syncHint, setSyncHint] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const seedRef = useRef({ text: initialText, tags: initialTags });
  const prompt = promptForDate(dateKey);
  const focusedEmptyEdit = useRef(false);
  const autosaveGen = useRef(0);

  const enterEdit = () => {
    setMode("edit");
    // Avoid scrolling the whole mobile page down to the rail.
    requestAnimationFrame(() => {
      textareaRef.current?.focus({ preventScroll: true });
    });
  };

  useEffect(() => {
    if (mode !== "edit" || text.trim() || focusedEmptyEdit.current) return;
    focusedEmptyEdit.current = true;
    requestAnimationFrame(() => {
      textareaRef.current?.focus({ preventScroll: true });
    });
  }, [mode, text]);

  const dirty = text !== initialText || !sameIds(selected, initialTags);

  // Notes load async after mount — adopt the new seed if the user hasn't edited yet.
  useLayoutEffect(() => {
    const prev = seedRef.current;
    const untouched = text === prev.text && sameIds(selected, prev.tags);
    seedRef.current = { text: initialText, tags: initialTags };
    if (!untouched) return;
    if (text === initialText && sameIds(selected, initialTags)) return;
    setText(initialText);
    setSelected(initialTags);
  }, [initialText, initialTags, text, selected]);

  useEffect(() => {
    if (text.trim() || selected.length) setMetaOpen(true);
  }, [text, selected]);

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  // Light autosave while editing
  useEffect(() => {
    if (!dirty || busy || mode !== "edit") return;
    const gen = ++autosaveGen.current;
    setSyncHint("即將自動儲存…");
    const t = window.setTimeout(() => {
      if (gen !== autosaveGen.current) return;
      setSyncHint("儲存中…");
      onSave({ text, tags: selected, silent: true });
    }, 1800);
    return () => window.clearTimeout(t);
  }, [text, selected, dirty, busy, mode, onSave]);

  useEffect(() => {
    if (!dirty) setSyncHint((h) => (h ? "已同步" : ""));
  }, [dirty]);

  useImperativeHandle(
    ref,
    () => ({
      save: () => onSave({ text, tags: selected }),
      isDirty: () => dirty,
    }),
    [text, selected, dirty, onSave]
  );

  const toggleTag = (id: string) => {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const addTagDef = async () => {
    if (!prefsCtx) return;
    const label = await askPrompt({
      title: "新增當日標記名稱",
      placeholder: "例如：專注、外出、會議",
      defaultValue: "",
    });
    if (!label) return;
    const existing = prefsCtx.prefs.journalTags || [];
    if (existing.some((t) => t.label === label)) {
      toast("已有同名標記");
      return;
    }
    const next: JournalTagDef = {
      id: journalTagIdFromLabel(label, existing),
      label,
      color: nextJournalTagColor(existing),
    };
    prefsCtx.setPrefs({ journalTags: [...existing, next] });
    setSelected((prev) => [...prev, next.id]);
    toast("已新增當日標記");
  };

  const removeTagDef = async (tag: JournalTagDef) => {
    if (!prefsCtx) return;
    if (
      !(await askConfirm({
        title: `刪除當日標記「${tag.label}」？`,
        message: "之後不會再出現在清單；已寫入日誌的紀錄仍保留。",
        danger: true,
        confirmLabel: "刪除",
      }))
    ) {
      return;
    }
    prefsCtx.setPrefs({
      journalTags: (prefsCtx.prefs.journalTags || []).filter((t) => t.id !== tag.id),
    });
    setSelected((prev) => prev.filter((id) => id !== tag.id));
    toast("已刪除當日標記");
  };

  const addTemplateFromDraft = async () => {
    if (!prefsCtx) return;
    const body = text.trim();
    if (!body) {
      toast("請先在下方輸入內容，再添加為模板");
      setMode("edit");
      return;
    }
    const label = await askPrompt({
      title: "為模板命名",
      placeholder: "例如：週報、會議後、晨間反思",
      defaultValue: "",
    });
    if (!label?.trim()) return;
    const name = label.trim();
    const existing = prefsCtx.prefs.journalTemplates || [];
    if (existing.some((t) => t.label === name)) {
      toast("已有同名模板");
      return;
    }
    const next: JournalTemplateDef = {
      id: journalTagIdFromLabel(
        name,
        existing.map((t) => ({ id: t.id, label: t.label, color: "" }))
      ),
      label: name,
      body: body.endsWith("\n") ? body : `${body}\n`,
    };
    prefsCtx.setPrefs({ journalTemplates: [...existing, next] });
    toast(`已添加模板「${name}」`);
  };

  const removeTemplate = async (tpl: JournalTemplateDef) => {
    if (!prefsCtx) return;
    if (
      !(await askConfirm({
        title: `刪除模板「${tpl.label}」？`,
        message: "可之後再新增。",
        danger: true,
        confirmLabel: "刪除",
      }))
    ) {
      return;
    }
    prefsCtx.setPrefs({
      journalTemplates: (prefsCtx.prefs.journalTemplates || []).filter((t) => t.id !== tpl.id),
    });
    toast("已刪除模板");
  };

  return (
    <div className="jn-composer">
      <div className="jn-composer-top">
        <div>
          <h2 className="font-display">{dateKey}</h2>
          <p className="jn-prompt">今日提問：{prompt}</p>
        </div>
        <div className="jn-composer-top-actions">
          {syncHint ? <span className="jn-sync-hint">{syncHint}</span> : null}
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => {
              if (mode === "preview") enterEdit();
              else setMode("preview");
            }}
            title={mode === "preview" ? "編輯 Markdown 原文" : "預覽 Markdown / LaTeX"}
          >
            {mode === "preview" ? "編輯原文" : "預覽"}
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onOpenFull}>
            完整編輯
          </button>
        </div>
      </div>

      {!metaOpen && !text.trim() && selected.length === 0 ? (
        <button
          type="button"
          className="jn-meta-fold"
          onClick={() => setMetaOpen(true)}
        >
          顯示當日標記與模板
        </button>
      ) : (
        <>
      <div className="jn-mood-row">
        <span>當日標記</span>
        <div className="jn-moods">
          {tagDefs.map((x) => {
            const on = selected.includes(x.id);
            return (
              <span key={x.id} className={`jn-tag-wrap${on ? " is-on" : ""}`}>
                <button
                  type="button"
                  className={`jn-mood${on ? " is-on" : ""}`}
                  style={{ ["--mood" as string]: x.color }}
                  onClick={() => toggleTag(x.id)}
                >
                  {x.label}
                </button>
                <button
                  type="button"
                  className="jn-tag-x"
                  title={`刪除當日標記「${x.label}」`}
                  aria-label={`刪除 ${x.label}`}
                  onClick={(ev) => {
                    ev.preventDefault();
                    ev.stopPropagation();
                    void removeTagDef(x);
                  }}
                >
                  ×
                </button>
              </span>
            );
          })}
          <button type="button" className="jn-mood jn-mood-add" onClick={() => void addTagDef()}>
            + 標記
          </button>
        </div>
      </div>

      <div className="jn-checkins">
        <div className="jn-checkins-main">
          {templates.map((t) => (
            <span key={t.id} className="jn-chip-wrap">
              <button
                type="button"
                className="jn-chip"
                disabled={busy}
                onClick={() => onSave({ text, tags: selected, appendTemplate: t.body })}
              >
                + {t.label}
              </button>
              <button
                type="button"
                className="jn-chip-x"
                title={`刪除模板「${t.label}」`}
                aria-label={`刪除模板 ${t.label}`}
                onClick={(ev) => {
                  ev.preventDefault();
                  ev.stopPropagation();
                  void removeTemplate(t);
                }}
              >
                ×
              </button>
            </span>
          ))}
          <button
            type="button"
            className="jn-chip"
            onClick={() => {
              setMode("edit");
              setMetaOpen(true);
              setText((prev) => `${prev.trim()}${prev.trim() ? "\n\n" : ""}## 提問回應\n${prompt}\n\n`);
            }}
          >
            插入今日提問
          </button>
        </div>
        <button
          type="button"
          className="jn-chip jn-chip-add jn-chip-save-tpl"
          title="把目前輸入框內容存成模板"
          onClick={() => void addTemplateFromDraft()}
        >
          添加為模板
        </button>
      </div>
        </>
      )}

      {mode === "preview" ? (
        <button
          type="button"
          className="jn-preview"
          onClick={enterEdit}
          title="點擊編輯原文"
        >
          {text.trim() ? (
            <AiMarkdown text={text} className="jn-preview-md" />
          ) : (
            <p className="jn-preview-empty">還沒有內容 · 直接開始寫，或用語音捕捉</p>
          )}
        </button>
      ) : (
        <textarea
          ref={textareaRef}
          className="input jn-textarea"
          rows={10}
          placeholder="寫下今天的節奏、卡住的地方、或一句話就好…（支援 Markdown / LaTeX）"
          value={text}
          onChange={(ev) => setText(ev.target.value)}
          onKeyDown={(ev) => {
            if ((ev.metaKey || ev.ctrlKey) && ev.key.toLowerCase() === "s") {
              ev.preventDefault();
              onSave({ text, tags: selected });
            }
          }}
          onBlur={() => {
            if (text.trim()) setMode("preview");
          }}
        />
      )}

      <div className="jn-composer-actions">
        <button
          type="button"
          className="btn"
          disabled={busy || (!text.trim() && selected.length === 0)}
          title="儲存 ⌘S"
          onClick={() => onSave({ text, tags: selected })}
        >
          {busy ? "儲存中…" : dirty ? "儲存這天 *" : "儲存這天"}
        </button>
      </div>
    </div>
  );
});

export default JournalComposer;
