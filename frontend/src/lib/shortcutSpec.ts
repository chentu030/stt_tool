/** Keyboard shortcut helpers — specs like `mod+shift+h`. */

const MOD_KEYS = new Set(["mod", "ctrl", "control", "meta", "cmd", "command", "alt", "option", "shift"]);

export const DEFAULT_LIVE_HIDE_DOCK_SHORTCUT = "mod+shift+h";

export function sanitizeShortcutSpec(raw: unknown, fallback = DEFAULT_LIVE_HIDE_DOCK_SHORTCUT): string {
  const s = String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");
  if (!s) return fallback;
  const parts = s.split("+").filter(Boolean);
  if (!parts.length) return fallback;
  const key = parts.find((p) => !MOD_KEYS.has(p));
  if (!key || key.length > 24) return fallback;
  const out: string[] = [];
  if (parts.some((p) => p === "mod" || p === "ctrl" || p === "control" || p === "meta" || p === "cmd" || p === "command")) {
    out.push("mod");
  }
  if (parts.some((p) => p === "alt" || p === "option")) out.push("alt");
  if (parts.some((p) => p === "shift")) out.push("shift");
  out.push(key);
  return out.join("+");
}

export function formatShortcutLabel(spec: string): string {
  return sanitizeShortcutSpec(spec)
    .split("+")
    .map((p) => {
      if (p === "mod") return "⌘/Ctrl";
      if (p === "shift") return "Shift";
      if (p === "alt") return "Alt";
      if (p === "escape") return "Esc";
      if (p === "enter") return "Enter";
      if (p === " ") return "Space";
      return p.length === 1 ? p.toUpperCase() : p;
    })
    .join(" + ");
}

export function shortcutFromEvent(e: KeyboardEvent): string | null {
  if (e.isComposing) return null;
  const raw = e.key;
  if (!raw || ["Control", "Meta", "Shift", "Alt", "Dead"].includes(raw)) return null;
  const parts: string[] = [];
  if (e.metaKey || e.ctrlKey) parts.push("mod");
  if (e.altKey) parts.push("alt");
  if (e.shiftKey) parts.push("shift");
  const key = raw.length === 1 ? raw.toLowerCase() : raw.toLowerCase();
  // Require at least one modifier so bare letters aren't captured by accident.
  if (!parts.length) return null;
  parts.push(key);
  return sanitizeShortcutSpec(parts.join("+"));
}

export function eventMatchesShortcut(e: KeyboardEvent, spec: string): boolean {
  if (e.isComposing) return false;
  const parts = new Set(sanitizeShortcutSpec(spec).split("+"));
  const wantMod = parts.has("mod");
  const wantAlt = parts.has("alt");
  const wantShift = parts.has("shift");
  const key = [...parts].find((p) => !MOD_KEYS.has(p));
  if (!key) return false;

  if (wantMod !== (e.metaKey || e.ctrlKey)) return false;
  if (wantAlt !== e.altKey) return false;
  if (wantShift !== e.shiftKey) return false;

  const pressed = e.key.length === 1 ? e.key.toLowerCase() : e.key.toLowerCase();
  if (pressed === key) return true;
  if (key.length === 1 && e.code === `Key${key.toUpperCase()}`) return true;
  if (key === "." && (e.key === "." || e.code === "Period")) return true;
  if (key === "\\" && (e.key === "\\" || e.code === "Backslash")) return true;
  return false;
}
