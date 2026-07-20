/** Export / import installed community library (VS Code-style backup) */

import type { InstalledExtension, InstalledTemplate } from "@/lib/community/types";
import { installFromSource } from "@/lib/community/actions";
import { saveExtensionSettings, setExtensionEnabled, setTemplateEnabled } from "@/lib/community/store";

export type LibraryBackupV1 = {
  schema: 1;
  exportedAt: number;
  extensions: Array<{
    id: string;
    source: string;
    enabled: boolean;
    settings?: Record<string, string | boolean | number>;
  }>;
  templates: Array<{
    id: string;
    source: string;
    enabled: boolean;
  }>;
};

export function buildLibraryBackup(
  extensions: InstalledExtension[],
  templates: InstalledTemplate[]
): LibraryBackupV1 {
  return {
    schema: 1,
    exportedAt: Date.now(),
    extensions: extensions.map((e) => ({
      id: e.id,
      source: e.source,
      enabled: e.enabled,
      settings: e.settings,
    })),
    templates: templates.map((t) => ({
      id: t.id,
      source: t.source,
      enabled: t.enabled,
    })),
  };
}

export function downloadLibraryBackup(backup: LibraryBackupV1) {
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `albireus-community-library-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export function parseLibraryBackup(text: string): LibraryBackupV1 {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("備份檔不是有效 JSON");
  }
  const o = raw as LibraryBackupV1;
  if (!o || o.schema !== 1 || !Array.isArray(o.extensions) || !Array.isArray(o.templates)) {
    throw new Error("備份格式不正確（需 schema: 1）");
  }
  return o;
}

/** Reinstall packages from backup sources; restores enable + settings when possible. */
export async function restoreLibraryBackup(
  uid: string,
  backup: LibraryBackupV1,
  opts?: { skipExisting?: boolean; existingExtIds?: Set<string>; existingTplIds?: Set<string> }
): Promise<{ installed: number; skipped: number; failed: string[] }> {
  let installed = 0;
  let skipped = 0;
  const failed: string[] = [];
  const skipExisting = opts?.skipExisting !== false;
  const extIds = opts?.existingExtIds || new Set<string>();
  const tplIds = opts?.existingTplIds || new Set<string>();

  for (const item of backup.extensions) {
    if (!item.source) {
      failed.push(item.id || "(extension)");
      continue;
    }
    if (skipExisting && extIds.has(item.id)) {
      skipped += 1;
      continue;
    }
    try {
      const r = await installFromSource(uid, item.source);
      if (item.settings) await saveExtensionSettings(uid, r.id, item.settings);
      if (item.enabled === false) await setExtensionEnabled(uid, r.id, false);
      installed += 1;
    } catch {
      failed.push(item.id || item.source);
    }
  }
  for (const item of backup.templates) {
    if (!item.source) {
      failed.push(item.id || "(template)");
      continue;
    }
    if (skipExisting && tplIds.has(item.id)) {
      skipped += 1;
      continue;
    }
    try {
      const r = await installFromSource(uid, item.source);
      if (item.enabled === false) await setTemplateEnabled(uid, r.id, false);
      installed += 1;
    } catch {
      failed.push(item.id || item.source);
    }
  }
  return { installed, skipped, failed };
}
