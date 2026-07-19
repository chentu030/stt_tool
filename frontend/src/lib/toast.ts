/** Imperative toast API (mirrors dialogs.ts) */

type ToastApi = {
  show: (message: string, ms?: number) => void;
};

let api: ToastApi | null = null;

export function registerToastApi(next: ToastApi | null) {
  api = next;
}

/** Show a short success/ack toast. No-op if provider not mounted. */
export function toast(message: string, ms = 2200) {
  if (!api) return;
  api.show(message, ms);
}
