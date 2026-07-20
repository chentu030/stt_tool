/** Install resolved packages into the user library + apply templates */

import { createNote } from "@/lib/firebase";
import {
  saveInstalledExtension,
  saveInstalledTemplate,
} from "@/lib/community/store";
import { resolveBuiltinSource } from "@/lib/community/builtins";
import {
  resolvePackageFromJsonFile,
  resolvePackageFromSource,
  resolvePackageFromZip,
} from "@/lib/community/install";
import type {
  InstalledExtension,
  InstalledTemplate,
  ResolvedPackage,
} from "@/lib/community/types";

export async function resolveAnySource(source: string): Promise<ResolvedPackage> {
  const builtin = resolveBuiltinSource(source);
  if (builtin) return builtin;
  return resolvePackageFromSource(source, source.startsWith("builtin:") ? "catalog" : "github");
}

export async function installResolvedPackage(
  uid: string,
  pack: ResolvedPackage
): Promise<{ kind: "extension" | "template"; id: string }> {
  const now = Date.now();
  if (pack.manifest.kind === "extension") {
    const settings: Record<string, string | boolean | number> = {};
    for (const def of pack.manifest.settings || []) {
      if (def.default !== undefined) settings[def.key] = def.default;
    }
    const item: InstalledExtension = {
      id: pack.manifest.id,
      manifest: pack.manifest,
      enabled: true,
      source: pack.source,
      sourceKind: pack.sourceKind,
      installedAt: now,
      updatedAt: now,
      readme: pack.readme,
      settings: Object.keys(settings).length ? settings : undefined,
    };
    await saveInstalledExtension(uid, item);
    return { kind: "extension", id: item.id };
  }

  const files: Record<string, string> = { ...pack.files };
  for (const p of pack.manifest.pages) {
    if (p.body != null) {
      const key = p.file || `inline-${p.title}.md`;
      files[key] = p.body;
    }
  }
  const item: InstalledTemplate = {
    id: pack.manifest.id,
    manifest: pack.manifest,
    files,
    enabled: true,
    source: pack.source,
    sourceKind: pack.sourceKind,
    installedAt: now,
    updatedAt: now,
    readme: pack.readme,
  };
  await saveInstalledTemplate(uid, item);
  return { kind: "template", id: item.id };
}

export async function installFromSource(uid: string, source: string) {
  const pack = await resolveAnySource(source);
  return installResolvedPackage(uid, pack);
}

export async function installFromFile(uid: string, file: File) {
  const name = file.name.toLowerCase();
  if (name.endsWith(".zip")) {
    const buf = await file.arrayBuffer();
    const pack = await resolvePackageFromZip(buf, file.name);
    return installResolvedPackage(uid, pack);
  }
  if (name.endsWith(".json")) {
    const text = await file.text();
    const pack = await resolvePackageFromJsonFile(text, file.name);
    return installResolvedPackage(uid, pack);
  }
  throw new Error("請匯入 .zip 或 albireus.json");
}

/** Re-fetch package from source and upgrade if newer (or force). */
export async function updateInstalledPackage(
  uid: string,
  kind: "extension" | "template",
  id: string,
  current: InstalledExtension | InstalledTemplate,
  opts?: { force?: boolean }
): Promise<{ updated: boolean; version: string }> {
  const pack = await resolveAnySource(current.source);
  if (pack.manifest.id !== id && pack.manifest.kind !== kind) {
    // allow id match on kind
  }
  if (pack.manifest.kind !== kind) {
    throw new Error("來源套件類型與已安裝項目不符");
  }
  const { isNewerVersion } = await import("@/lib/community/semver");
  const remoteVer = pack.manifest.version;
  const localVer = current.manifest.version;
  if (!opts?.force && !isNewerVersion(remoteVer, localVer)) {
    return { updated: false, version: localVer };
  }
  const now = Date.now();
  if (pack.manifest.kind === "extension") {
    const prev = current as InstalledExtension;
    await saveInstalledExtension(uid, {
      id,
      manifest: pack.manifest,
      enabled: prev.enabled,
      source: pack.source || prev.source,
      sourceKind: pack.sourceKind,
      installedAt: prev.installedAt,
      updatedAt: now,
      readme: pack.readme,
      settings: prev.settings,
    });
  } else {
    const prev = current as InstalledTemplate;
    const files: Record<string, string> = { ...pack.files };
    for (const p of pack.manifest.pages) {
      if (p.body != null) {
        files[p.file || `inline-${p.title}.md`] = p.body;
      }
    }
    await saveInstalledTemplate(uid, {
      id,
      manifest: pack.manifest,
      files,
      enabled: prev.enabled,
      source: pack.source || prev.source,
      sourceKind: pack.sourceKind,
      installedAt: prev.installedAt,
      updatedAt: now,
      readme: pack.readme,
    });
  }
  return { updated: true, version: remoteVer };
}

/** Apply an installed template: create one note per page, return first note id */
export async function applyInstalledTemplate(
  uid: string,
  tpl: InstalledTemplate,
  opts?: { folder?: string }
): Promise<{ noteIds: string[]; firstId: string }> {
  const noteIds: string[] = [];
  for (const page of tpl.manifest.pages) {
    const key = page.file || `inline-${page.title}.md`;
    const body =
      (page.file && tpl.files[page.file]) ||
      tpl.files[key] ||
      page.body ||
      "";
    const id = await createNote(uid, page.title, body, undefined, page.tags || [], {
      folder: opts?.folder || page.folder || "",
      icon: page.icon || tpl.manifest.icon || "description",
      status: "backlog",
    });
    noteIds.push(id);
  }
  if (!noteIds.length) throw new Error("模板沒有可建立的頁面");
  return { noteIds, firstId: noteIds[0] };
}

export function previewTemplatePages(tpl: InstalledTemplate): { title: string; body: string; icon?: string }[] {
  return tpl.manifest.pages.map((page) => {
    const key = page.file || `inline-${page.title}.md`;
    const body =
      (page.file && tpl.files[page.file]) ||
      tpl.files[key] ||
      page.body ||
      "";
    return { title: page.title, body, icon: page.icon };
  });
}
