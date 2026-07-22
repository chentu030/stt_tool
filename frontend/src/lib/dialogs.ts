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

export type ChoiceOption<T extends string = string> = {
  id: T;
  label: string;
  description?: string;
  primary?: boolean;
};

export type ChoiceDialogOptions<T extends string = string> = {
  title: string;
  message?: string;
  options: ChoiceOption<T>[];
  cancelLabel?: string;
  /** Optional "remember this choice" checkbox */
  rememberLabel?: string;
};

export type ChoiceResult<T extends string = string> = {
  choice: T;
  remember: boolean;
};

export type ConflictSide = {
  label: string;
  updatedAt?: number | Date | null;
  title?: string;
  preview: string;
};

export type ConflictDialogOptions = {
  title?: string;
  message?: string;
  local: ConflictSide;
  remote: ConflictSide;
  keepLocalLabel?: string;
  keepRemoteLabel?: string;
  cancelLabel?: string;
};

export type ConflictChoice = "local" | "remote";

type DialogApi = {
  prompt: (opts: PromptDialogOptions) => Promise<string | null>;
  confirm: (opts: ConfirmDialogOptions) => Promise<boolean>;
  choice: <T extends string>(opts: ChoiceDialogOptions<T>) => Promise<ChoiceResult<T> | null>;
  conflict: (opts: ConflictDialogOptions) => Promise<ConflictChoice | null>;
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

/** Pick one option. Returns { choice, remember }, or null if cancelled. */
export function askChoice<T extends string>(
  opts: ChoiceDialogOptions<T>
): Promise<ChoiceResult<T> | null> {
  return ensureApi().choice(opts);
}

/** Offline / multi-device conflict: preview both sides, pick local or remote. */
export function askConflict(opts: ConflictDialogOptions): Promise<ConflictChoice | null> {
  return ensureApi().conflict(opts);
}
