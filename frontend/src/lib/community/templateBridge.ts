/** Merge built-in + installed community templates for pickers */

import { NOTE_TEMPLATES, type NoteTemplate } from "@/lib/templates";
import type { InstalledTemplate } from "@/lib/community/types";

export function communityTemplatesAsNoteTemplates(
  installed: InstalledTemplate[]
): NoteTemplate[] {
  return installed
    .filter((t) => t.enabled)
    .map((t) => {
      const first = t.manifest.pages[0];
      const key = first?.file || `inline-${first?.title || "page"}.md`;
      const body =
        (first?.file && t.files[first.file]) ||
        t.files[key] ||
        first?.body ||
        "";
      return {
        id: `community:${t.id}`,
        label: t.manifest.name,
        hint: t.manifest.description || "社群模板",
        title: first?.title || t.manifest.name,
        body,
        tags: first?.tags || [],
      };
    });
}

export function allNoteTemplates(installed?: InstalledTemplate[]): NoteTemplate[] {
  return [...NOTE_TEMPLATES, ...communityTemplatesAsNoteTemplates(installed || [])];
}
