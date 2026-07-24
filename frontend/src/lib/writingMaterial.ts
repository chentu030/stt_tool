/**
 * Body vs「素材」marking for Cadence notes.
 * Regions: callout tone `source` (`> [!source] …`) or fence `:::source` … `:::`.
 * Whole note: props.is_source_material === true
 */

export const SOURCE_CALLOUT_TONE = "source";
export const SOURCE_MATERIAL_PROP = "is_source_material";
export const SOURCE_FENCE_RE =
  /:::source(?:\s+[^\n]*)?\n([\s\S]*?):::/gi;
export const SOURCE_CALLOUT_BLOCK_RE =
  /^>\s*\[!(?:source|素材)\][^\n]*(?:\n>\s?[^\n]*)*/gim;

/** True when the entire note is marked as 素材. */
export function noteIsSourceMaterial(props?: Record<string, unknown> | null): boolean {
  const v = props?.[SOURCE_MATERIAL_PROP];
  return v === true || v === "true" || v === 1;
}

/** Strip 素材 regions (and optionally treat whole note as empty for body stats). */
export function stripSourceMaterial(
  md: string,
  opts?: { wholeNoteIsSource?: boolean }
): string {
  if (opts?.wholeNoteIsSource) return "";
  let s = md || "";
  s = s.replace(SOURCE_FENCE_RE, "\n");
  s = s.replace(SOURCE_CALLOUT_BLOCK_RE, "\n");
  // TipTap multi-line callout may serialize as consecutive > lines after first
  s = s.replace(/^>\s*\[!(?:source|素材)\]\s*/gim, "");
  return s.replace(/\n{3,}/g, "\n\n").trim();
}

/** Markdown kept for export when includeSource is false. */
export function bodyForExport(
  md: string,
  opts?: { includeSource?: boolean; wholeNoteIsSource?: boolean }
): string {
  if (opts?.includeSource) {
    if (opts.wholeNoteIsSource) return md || "";
    return md || "";
  }
  if (opts?.wholeNoteIsSource) return "";
  return stripSourceMaterial(md);
}

/** Label used in UI. */
export const SOURCE_LABEL = "素材";
