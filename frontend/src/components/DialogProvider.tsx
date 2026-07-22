"use client";

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ClipboardEvent,
  type FormEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import {
  registerDialogApi,
  type ChoiceDialogOptions,
  type ChoiceOption,
  type ChoiceResult,
  type ConfirmDialogOptions,
  type ConflictChoice,
  type ConflictDialogOptions,
  type ConflictSide,
  type PromptDialogOptions,
} from "@/lib/dialogs";

type PromptState = PromptDialogOptions & {
  resolve: (value: string | null) => void;
};

type ConfirmState = ConfirmDialogOptions & {
  resolve: (value: boolean) => void;
};

type ChoiceState = ChoiceDialogOptions<string> & {
  resolve: (value: ChoiceResult<string> | null) => void;
};

type ConflictState = ConflictDialogOptions & {
  resolve: (value: ConflictChoice | null) => void;
};

function formatConflictTime(ms?: number | Date | null): string {
  if (ms == null) return "未知時間";
  const d = typeof ms === "number" ? new Date(ms) : ms;
  if (Number.isNaN(d.getTime())) return "未知時間";
  return d.toLocaleString("zh-TW", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function DialogProvider({ children }: { children: ReactNode }) {
  const [promptState, setPromptState] = useState<PromptState | null>(null);
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);
  const [choiceState, setChoiceState] = useState<ChoiceState | null>(null);
  const [conflictState, setConflictState] = useState<ConflictState | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const prompt = useCallback((opts: PromptDialogOptions) => {
    return new Promise<string | null>((resolve) => {
      setConfirmState(null);
      setChoiceState((prev) => {
        prev?.resolve(null);
        return null;
      });
      setConflictState((prev) => {
        prev?.resolve(null);
        return null;
      });
      setPromptState({ ...opts, resolve });
    });
  }, []);

  const confirm = useCallback((opts: ConfirmDialogOptions) => {
    return new Promise<boolean>((resolve) => {
      setPromptState(null);
      setChoiceState((prev) => {
        prev?.resolve(null);
        return null;
      });
      setConflictState((prev) => {
        prev?.resolve(null);
        return null;
      });
      setConfirmState({ ...opts, resolve });
    });
  }, []);

  const choice = useCallback(<T extends string>(opts: ChoiceDialogOptions<T>) => {
    return new Promise<ChoiceResult<T> | null>((resolve) => {
      setPromptState(null);
      setConfirmState(null);
      setConflictState((prev) => {
        prev?.resolve(null);
        return null;
      });
      setChoiceState((prev) => {
        prev?.resolve(null);
        return {
          ...opts,
          resolve: (v) => resolve(v as ChoiceResult<T> | null),
        };
      });
    });
  }, []);

  const conflict = useCallback((opts: ConflictDialogOptions) => {
    return new Promise<ConflictChoice | null>((resolve) => {
      setPromptState(null);
      setConfirmState(null);
      setChoiceState((prev) => {
        prev?.resolve(null);
        return null;
      });
      setConflictState((prev) => {
        prev?.resolve(null);
        return { ...opts, resolve };
      });
    });
  }, []);

  useEffect(() => {
    registerDialogApi({ prompt, confirm, choice, conflict });
    return () => registerDialogApi(null);
  }, [prompt, confirm, choice, conflict]);

  return (
    <>
      {children}
      {mounted &&
        promptState &&
        createPortal(
          <PromptModal
            state={promptState}
            onClose={(value) => {
              promptState.resolve(value);
              setPromptState(null);
            }}
          />,
          document.body
        )}
      {mounted &&
        confirmState &&
        createPortal(
          <ConfirmModal
            state={confirmState}
            onClose={(value) => {
              confirmState.resolve(value);
              setConfirmState(null);
            }}
          />,
          document.body
        )}
      {mounted &&
        choiceState &&
        createPortal(
          <ChoiceModal
            state={choiceState}
            onClose={(value) => {
              choiceState.resolve(value);
              setChoiceState(null);
            }}
          />,
          document.body
        )}
      {mounted &&
        conflictState &&
        createPortal(
          <ConflictModal
            state={conflictState}
            onClose={(value) => {
              conflictState.resolve(value);
              setConflictState(null);
            }}
          />,
          document.body
        )}
    </>
  );
}

function PromptModal({
  state,
  onClose,
}: {
  state: PromptState;
  onClose: (value: string | null) => void;
}) {
  const [value, setValue] = useState(state.defaultValue ?? "");
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);
  const titleId = useId();

  useEffect(() => {
    const t = window.setTimeout(() => {
      const el = inputRef.current;
      if (!el) return;
      el.focus({ preventScroll: true });
      // Prefer caret at end so paste appends / replaces selection cleanly
      try {
        const len = el.value.length;
        el.setSelectionRange(0, len);
      } catch {
        el.select();
      }
    }, 30);
    return () => window.clearTimeout(t);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose(null);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    onClose(value);
  };

  const onPaste = (e: ClipboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    // Keep paste inside the dialog field; stop page-level Ctrl+V handlers (canvas etc.)
    e.stopPropagation();
    const text = e.clipboardData.getData("text/plain");
    if (!text) return;
    // If default is a bare scheme and the whole field is selected, replace with pasted URL
    const el = e.currentTarget;
    const start = el.selectionStart ?? 0;
    const end = el.selectionEnd ?? 0;
    const allSelected = start === 0 && end === el.value.length;
    const bareScheme = /^https?:\/\/?$/i.test(el.value.trim());
    if (allSelected || bareScheme) {
      e.preventDefault();
      const next = text.trim();
      setValue(next);
      requestAnimationFrame(() => {
        try {
          el.setSelectionRange(next.length, next.length);
        } catch {
          /* ignore */
        }
      });
    }
  };

  return (
    <div
      className="cadence-dialog-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose(null);
      }}
    >
      <div
        className="cadence-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2 id={titleId} className="cadence-dialog-title">
          {state.title}
        </h2>
        {state.message && <p className="cadence-dialog-msg">{state.message}</p>}
        <form className="cadence-dialog-form" onSubmit={submit}>
          {state.multiline ? (
            <textarea
              ref={inputRef as RefObject<HTMLTextAreaElement>}
              className="input cadence-dialog-input"
              rows={4}
              value={value}
              placeholder={state.placeholder}
              autoComplete="off"
              spellCheck={false}
              onChange={(e) => setValue(e.target.value)}
              onPaste={onPaste}
            />
          ) : (
            <input
              ref={inputRef as RefObject<HTMLInputElement>}
              className="input cadence-dialog-input"
              type="text"
              inputMode="url"
              value={value}
              placeholder={state.placeholder}
              autoComplete="off"
              spellCheck={false}
              onChange={(e) => setValue(e.target.value)}
              onPaste={onPaste}
            />
          )}
          <div className="cadence-dialog-actions">
            <button type="button" className="btn btn-ghost" onClick={() => onClose(null)}>
              {state.cancelLabel || "取消"}
            </button>
            <button type="submit" className="btn">
              {state.confirmLabel || "確定"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function ConfirmModal({
  state,
  onClose,
}: {
  state: ConfirmState;
  onClose: (value: boolean) => void;
}) {
  const confirmRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();

  useEffect(() => {
    const t = window.setTimeout(() => confirmRef.current?.focus(), 20);
    return () => window.clearTimeout(t);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="cadence-dialog-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose(false);
      }}
    >
      <div
        className="cadence-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <h2 id={titleId} className="cadence-dialog-title">
          {state.title}
        </h2>
        {state.message && <p className="cadence-dialog-msg">{state.message}</p>}
        <div className="cadence-dialog-actions">
          <button type="button" className="btn btn-ghost" onClick={() => onClose(false)}>
            {state.cancelLabel || "取消"}
          </button>
          <button
            ref={confirmRef}
            type="button"
            className={`btn${state.danger ? " btn-danger" : ""}`}
            onClick={() => onClose(true)}
          >
            {state.confirmLabel || "確定"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ChoiceModal({
  state,
  onClose,
}: {
  state: ChoiceState;
  onClose: (value: ChoiceResult<string> | null) => void;
}) {
  const firstRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const [remember, setRemember] = useState(false);

  useEffect(() => {
    const t = window.setTimeout(() => firstRef.current?.focus(), 20);
    return () => window.clearTimeout(t);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="cadence-dialog-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose(null);
      }}
    >
      <div
        className="cadence-dialog cadence-dialog--choice"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <h2 id={titleId} className="cadence-dialog-title">
          {state.title}
        </h2>
        {state.message && <p className="cadence-dialog-msg">{state.message}</p>}
        <div className="cadence-dialog-choices">
          {state.options.map((opt: ChoiceOption, i) => (
            <button
              key={opt.id}
              ref={i === 0 ? firstRef : undefined}
              type="button"
              className={`cadence-dialog-choice${opt.primary ? " is-primary" : ""}`}
              onClick={() => onClose({ choice: opt.id, remember })}
            >
              <strong>{opt.label}</strong>
              {opt.description && <span>{opt.description}</span>}
            </button>
          ))}
        </div>
        {state.rememberLabel && (
          <label className="cadence-dialog-remember">
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
            />
            <span>{state.rememberLabel}</span>
          </label>
        )}
        <div className="cadence-dialog-actions">
          <button type="button" className="btn btn-ghost" onClick={() => onClose(null)}>
            {state.cancelLabel || "取消"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ConflictSideCard({ side }: { side: ConflictSide }) {
  return (
    <div className="cadence-conflict-side">
      <div className="cadence-conflict-side-head">
        <strong>{side.label}</strong>
        <em>{formatConflictTime(side.updatedAt)}</em>
      </div>
      {side.title ? <p className="cadence-conflict-title">{side.title}</p> : null}
      <pre className="cadence-conflict-preview">{side.preview || "（空白）"}</pre>
    </div>
  );
}

function ConflictModal({
  state,
  onClose,
}: {
  state: ConflictState;
  onClose: (value: ConflictChoice | null) => void;
}) {
  const localRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();

  useEffect(() => {
    const t = window.setTimeout(() => localRef.current?.focus(), 20);
    return () => window.clearTimeout(t);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="cadence-dialog-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose(null);
      }}
    >
      <div
        className="cadence-dialog cadence-dialog--conflict"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <h2 id={titleId} className="cadence-dialog-title">
          {state.title || "內容衝突"}
        </h2>
        {state.message && <p className="cadence-dialog-msg">{state.message}</p>}
        <div className="cadence-conflict-grid">
          <ConflictSideCard side={state.local} />
          <ConflictSideCard side={state.remote} />
        </div>
        <div className="cadence-dialog-actions cadence-conflict-actions">
          <button type="button" className="btn btn-ghost" onClick={() => onClose(null)}>
            {state.cancelLabel || "稍後決定"}
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => onClose("remote")}>
            {state.keepRemoteLabel || "使用雲端版本"}
          </button>
          <button
            ref={localRef}
            type="button"
            className="btn"
            onClick={() => onClose("local")}
          >
            {state.keepLocalLabel || "使用我的版本"}
          </button>
        </div>
      </div>
    </div>
  );
}
