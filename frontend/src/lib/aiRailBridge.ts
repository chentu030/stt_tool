/** Bridge: selection / surface context → global AI rail. */

import type { AiAttachmentPayload } from "@/lib/aiAttachments";
import type { CanvasAiMediaRef } from "@/lib/canvasAiContext";

export type AiRailOpenDetail = {
  open?: boolean;
  toggle?: boolean;
  /** Prefill composer */
  prompt?: string;
  /** Extra context block for the next send */
  contextExtra?: string;
  /** Short label shown as a removable 脈絡 chip */
  contextLabel?: string;
  /** Selection text to pin into rail context */
  selectionText?: string;
  mediaRefs?: CanvasAiMediaRef[];
  /** Optional pre-encoded attachments (rare — prefer File via attachFiles) */
  attachments?: AiAttachmentPayload[];
  /** Soft seed for canvas: force using live selection in prompt */
  useCanvasSelection?: boolean;
};

export const AI_RAIL_EVENT = "cadence-ai-rail";
export const AI_RAIL_CONTEXT_EVENT = "cadence-ai-rail-context";

/** Open (or focus) the global AI rail, optionally with packed context. */
export function openGlobalAiRail(detail?: Omit<AiRailOpenDetail, "open" | "toggle">) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(AI_RAIL_EVENT, {
      detail: { open: true, ...(detail || {}) },
    })
  );
}

export function toggleGlobalAiRail() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(AI_RAIL_EVENT, { detail: { toggle: true } }));
}

/** Push extra context into an already-open rail without forcing layout mode. */
export function pushAiRailContext(detail: Omit<AiRailOpenDetail, "open" | "toggle">) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(AI_RAIL_CONTEXT_EVENT, { detail }));
}

/** Continue a selection-island conversation in the right rail. */
export function continueSelectionInAiRail(opts: {
  selectionText?: string;
  context?: string;
  title?: string;
  prompt?: string;
  mediaRefs?: CanvasAiMediaRef[];
  contextLabel?: string;
}) {
  const label =
    opts.contextLabel ||
    (opts.title ? `選取 · ${opts.title}` : opts.selectionText?.trim()
      ? `選取 · ${opts.selectionText.trim().slice(0, 24)}${opts.selectionText.trim().length > 24 ? "…" : ""}`
      : "目前選取");
  openGlobalAiRail({
    prompt: opts.prompt || "",
    selectionText: opts.selectionText,
    contextExtra: [
      opts.context?.trim() || "",
      opts.selectionText?.trim()
        ? `—— 目前選取 ——\n${opts.selectionText.trim().slice(0, 12000)}\n—— 結束 ——`
        : "",
    ]
      .filter(Boolean)
      .join("\n\n"),
    contextLabel: label,
    mediaRefs: opts.mediaRefs,
    useCanvasSelection: true,
  });
}
