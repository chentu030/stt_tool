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
import { meetsMinAppVersion } from "@/lib/community/semver";
import type {
  InstalledExtension,
  InstalledTemplate,
  ResolvedPackage,
} from "@/lib/community/types";
import { ALBIREUS_APP_VERSION } from "@/lib/community/types";
import { isCommunitySafeMode } from "@/lib/community/libraryPrefs";
import { effectivePermissions } from "@/lib/community/permissions";
import { assertCanInstallPaid, isPaidListing } from "@/lib/community/communityPaid";
import { getCatalog } from "@/lib/community/builtins";

export async function resolveAnySource(source: string): Promise<ResolvedPackage> {
  const builtin = resolveBuiltinSource(source);
  if (builtin) {
    const cat = getCatalog().find((c) => c.source === source || c.id === builtin.manifest.id);
    return {
      ...builtin,
      paid: isPaidListing({
        paid: cat?.paid,
        manifestPaid: builtin.manifest.paid,
      }),
    };
  }
  if (source.startsWith("hosted:")) {
    const id = source.slice("hosted:".length).trim();
    const { getPublishedPackage, publishedToResolved } = await import("@/lib/community/publish");
    const pub = await getPublishedPackage(id);
    if (!pub || pub.status !== "published") throw new Error("找不到已上架的套件");
    return publishedToResolved(pub);
  }
  return resolvePackageFromSource(source, source.startsWith("builtin:") ? "catalog" : "github");
}

function assertMinAppVersion(pack: ResolvedPackage) {
  const min = pack.manifest.minAppVersion;
  if (!meetsMinAppVersion(ALBIREUS_APP_VERSION, min)) {
    throw new Error(
      `此套件需要 Albireus ≥ ${min}（目前 ${ALBIREUS_APP_VERSION}）`
    );
  }
}

function assertSafeModeAllows(pack: ResolvedPackage) {
  if (!isCommunitySafeMode()) return;
  const perms = effectivePermissions(pack.manifest);
  if (pack.manifest.kind === "extension" || perms.includes("notes_write") || perms.includes("network")) {
    throw new Error("目前為安全模式：請先在社群商店關閉安全模式後再安裝");
  }
}

function packIsPaid(pack: ResolvedPackage): boolean {
  return isPaidListing({ paid: pack.paid, manifestPaid: pack.manifest.paid });
}

export type InstallOpts = { email?: string | null };

export async function installResolvedPackage(
  uid: string,
  pack: ResolvedPackage,
  opts?: InstallOpts
): Promise<{ kind: "extension" | "template"; id: string }> {
  assertMinAppVersion(pack);
  assertSafeModeAllows(pack);
  assertCanInstallPaid(opts?.email, packIsPaid(pack));
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

export async function installFromSource(uid: string, source: string, opts?: InstallOpts) {
  const pack = await resolveAnySource(source);
  return installResolvedPackage(uid, pack, opts);
}

export async function installFromFile(uid: string, file: File, opts?: InstallOpts) {
  const name = file.name.toLowerCase();
  if (name.endsWith(".zip")) {
    const buf = await file.arrayBuffer();
    const pack = await resolvePackageFromZip(buf, file.name);
    return installResolvedPackage(uid, pack, opts);
  }
  if (name.endsWith(".json")) {
    const text = await file.text();
    const pack = await resolvePackageFromJsonFile(text, file.name);
    return installResolvedPackage(uid, {
      ...pack,
      paid: isPaidListing({ paid: pack.paid, manifestPaid: pack.manifest.paid }),
    }, opts);
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
  assertMinAppVersion(pack);
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

export async function updateInstalledPackageWithNotes(
  uid: string,
  kind: "extension" | "template",
  id: string,
  current: InstalledExtension | InstalledTemplate,
  opts?: { force?: boolean }
): Promise<{ updated: boolean; version: string; notes?: string }> {
  const pack = await resolveAnySource(current.source);
  const result = await updateInstalledPackage(uid, kind, id, current, opts);
  if (!result.updated) return result;
  return {
    ...result,
    notes: changelogNotesForVersion(pack, result.version),
  };
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

export function previewTemplatePages(tpl: InstalledTemplate | ResolvedPackage): {
  title: string;
  body: string;
  icon?: string;
  folder?: string;
}[] {
  if (tpl.manifest.kind !== "template") return [];
  const files = "files" in tpl ? tpl.files : {};
  return tpl.manifest.pages.map((page) => {
    const key = page.file || `inline-${page.title}.md`;
    const body =
      (page.file && files[page.file]) || files[key] || page.body || "";
    return { title: page.title, body, icon: page.icon, folder: page.folder };
  });
}

/** Install every package in a curated collection (skips already-installed ids). */
export async function installCollectionSources(
  uid: string,
  sources: string[],
  installedIds: Set<string>,
  opts?: InstallOpts
): Promise<{ ok: number; skipped: number; failed: string[] }> {
  let ok = 0;
  let skipped = 0;
  const failed: string[] = [];
  for (const source of sources) {
    try {
      const pack = await resolveAnySource(source);
      if (installedIds.has(pack.manifest.id)) {
        skipped += 1;
        continue;
      }
      await installResolvedPackage(uid, pack, opts);
      installedIds.add(pack.manifest.id);
      ok += 1;
    } catch (e) {
      failed.push(e instanceof Error ? e.message : source);
    }
  }
  return { ok, skipped, failed };
}

/** Notes for a newly updated version, if changelog lists it. */
export function changelogNotesForVersion(
  pack: ResolvedPackage,
  version: string
): string | undefined {
  const hit = (pack.manifest.changelog || []).find((c) => c.version === version);
  return hit?.notes;
}

