/** Merge manifest defaults with saved extension settings */

import type { ExtensionManifest, ExtensionSettingDef } from "@/lib/community/types";

export function mergeExtensionSettings(
  manifest: ExtensionManifest,
  saved?: Record<string, string | boolean | number>
): Record<string, string | boolean | number> {
  const out: Record<string, string | boolean | number> = {};
  for (const def of manifest.settings || []) {
    if (def.default !== undefined) out[def.key] = def.default;
  }
  if (saved) {
    for (const [k, v] of Object.entries(saved)) {
      out[k] = v;
    }
  }
  return out;
}

export function buildExtensionFrameUrl(
  entry: string,
  noteId: string,
  settings: Record<string, string | boolean | number>
): string {
  const qs = new URLSearchParams();
  qs.set("note", noteId);
  qs.set("albireus", "1");
  qs.set("settings", JSON.stringify(settings));
  for (const [k, v] of Object.entries(settings)) {
    qs.set(`s_${k}`, String(v));
  }
  try {
    const u = new URL(entry);
    for (const [k, v] of qs.entries()) u.searchParams.set(k, v);
    return u.toString();
  } catch {
    const sep = entry.includes("?") ? "&" : "?";
    return `${entry}${sep}${qs.toString()}`;
  }
}

export function coerceSettingValue(
  def: ExtensionSettingDef,
  raw: string | boolean | number
): string | boolean | number {
  if (def.type === "boolean") {
    if (typeof raw === "boolean") return raw;
    if (typeof raw === "number") return raw === 1;
    return raw === "true" || raw === "1";
  }
  if (def.type === "number") {
    const n = typeof raw === "number" ? raw : Number(raw);
    return Number.isFinite(n) ? n : Number(def.default) || 0;
  }
  return String(raw);
}
