/** Promise-based Cadence dialogs (replaces window.prompt / confirm). */

export type PromptDialogOptions = {
  title: string;
  message?: string;
  defaultValue?: string;
  placeholder?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Larger multiline input */
  multiline?: boolean;
};

export type ConfirmDialogOptions = {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
};

type DialogApi = {
  prompt: (opts: PromptDialogOptions) => Promise<string | null>;
  confirm: (opts: ConfirmDialogOptions) => Promise<boolean>;
};

let api: DialogApi | null = null;

export function registerDialogApi(next: DialogApi | null) {
  api = next;
}

function ensureApi(): DialogApi {
  if (!api) {
    throw new Error("DialogProvider 尚未掛載");
  }
  return api;
}

/** Ask for text. Returns trimmed string, or null if cancelled / empty after trim when required. */
export function askPrompt(
  titleOrOpts: string | PromptDialogOptions,
  defaultValue = ""
): Promise<string | null> {
  const opts: PromptDialogOptions =
    typeof titleOrOpts === "string"
      ? { title: titleOrOpts, defaultValue }
      : titleOrOpts;
  return ensureApi().prompt(opts);
}

/** Confirm action. Returns true if confirmed. */
export function askConfirm(
  titleOrOpts: string | ConfirmDialogOptions,
  message?: string
): Promise<boolean> {
  const opts: ConfirmDialogOptions =
    typeof titleOrOpts === "string"
      ? { title: titleOrOpts, message }
      : titleOrOpts;
  return ensureApi().confirm(opts);
}
