/** Firestore persistence for installed community packages */

import {
  collection,
  doc,
  deleteDoc,
  getDoc,
  onSnapshot,
  setDoc,
  type Unsubscribe,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import type {
  ExtensionManifest,
  InstalledExtension,
  InstalledTemplate,
  TemplateManifest,
} from "@/lib/community/types";

function extCol(uid: string) {
  return collection(db, "users", uid, "community_extensions");
}

function tplCol(uid: string) {
  return collection(db, "users", uid, "community_templates");
}

function metaDoc(uid: string) {
  return doc(db, "users", uid, "community_meta", "seed");
}

function wrapCommunityStoreError(err: unknown, action: string): Error {
  const code =
    err && typeof err === "object" && "code" in err
      ? String((err as { code?: string }).code || "")
      : "";
  const msg = err instanceof Error ? err.message : String(err);
  if (code === "permission-denied" || /insufficient permissions/i.test(msg)) {
    return new Error(
      `${action}失敗：Firestore 權限不足（請確認已登入，且伺服器規則已更新）`
    );
  }
  if (code === "unauthenticated" || /auth/i.test(code)) {
    return new Error(`${action}失敗：請先登入`);
  }
  return err instanceof Error ? err : new Error(msg || `${action}失敗`);
}

function parseExt(id: string, data: Record<string, unknown>): InstalledExtension | null {
  const manifest = data.manifest as ExtensionManifest | undefined;
  if (!manifest || manifest.kind !== "extension") return null;
  const settings =
    data.settings && typeof data.settings === "object" && !Array.isArray(data.settings)
      ? (data.settings as Record<string, string | boolean | number>)
      : undefined;
  return {
    id,
    manifest,
    enabled: data.enabled !== false,
    source: typeof data.source === "string" ? data.source : "",
    sourceKind:
      data.sourceKind === "github" ||
      data.sourceKind === "file" ||
      data.sourceKind === "catalog" ||
      data.sourceKind === "hosted"
        ? data.sourceKind
        : "catalog",
    installedAt: typeof data.installedAt === "number" ? data.installedAt : Date.now(),
    updatedAt: typeof data.updatedAt === "number" ? data.updatedAt : Date.now(),
    readme: typeof data.readme === "string" ? data.readme : undefined,
    settings,
  };
}

function parseTpl(id: string, data: Record<string, unknown>): InstalledTemplate | null {
  const manifest = data.manifest as TemplateManifest | undefined;
  if (!manifest || manifest.kind !== "template") return null;
  const files =
    data.files && typeof data.files === "object" && !Array.isArray(data.files)
      ? (data.files as Record<string, string>)
      : {};
  return {
    id,
    manifest,
    files,
    enabled: data.enabled !== false,
    source: typeof data.source === "string" ? data.source : "",
    sourceKind:
      data.sourceKind === "github" ||
      data.sourceKind === "file" ||
      data.sourceKind === "catalog" ||
      data.sourceKind === "hosted"
        ? data.sourceKind
        : "catalog",
    installedAt: typeof data.installedAt === "number" ? data.installedAt : Date.now(),
    updatedAt: typeof data.updatedAt === "number" ? data.updatedAt : Date.now(),
    readme: typeof data.readme === "string" ? data.readme : undefined,
  };
}

export function listenInstalledExtensions(
  uid: string,
  cb: (list: InstalledExtension[]) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  return onSnapshot(
    extCol(uid),
    (snap) => {
      const list: InstalledExtension[] = [];
      snap.forEach((d) => {
        const parsed = parseExt(d.id, d.data() as Record<string, unknown>);
        if (parsed) list.push(parsed);
      });
      list.sort((a, b) => (a.manifest.nav?.order ?? 100) - (b.manifest.nav?.order ?? 100));
      cb(list);
    },
    (err) => onError?.(err)
  );
}

export function listenInstalledTemplates(
  uid: string,
  cb: (list: InstalledTemplate[]) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  return onSnapshot(
    tplCol(uid),
    (snap) => {
      const list: InstalledTemplate[] = [];
      snap.forEach((d) => {
        const parsed = parseTpl(d.id, d.data() as Record<string, unknown>);
        if (parsed) list.push(parsed);
      });
      list.sort((a, b) => a.manifest.name.localeCompare(b.manifest.name, "zh-Hant"));
      cb(list);
    },
    (err) => onError?.(err)
  );
}

export async function saveInstalledExtension(uid: string, item: InstalledExtension) {
  try {
    await setDoc(doc(extCol(uid), item.id), {
      manifest: item.manifest,
      enabled: item.enabled,
      source: item.source,
      sourceKind: item.sourceKind,
      installedAt: item.installedAt,
      updatedAt: item.updatedAt,
      readme: item.readme || "",
      settings: item.settings || {},
    });
  } catch (err) {
    throw wrapCommunityStoreError(err, "安裝擴充功能");
  }
}

export async function saveInstalledTemplate(uid: string, item: InstalledTemplate) {
  try {
    await setDoc(doc(tplCol(uid), item.id), {
      manifest: item.manifest,
      files: item.files,
      enabled: item.enabled,
      source: item.source,
      sourceKind: item.sourceKind,
      installedAt: item.installedAt,
      updatedAt: item.updatedAt,
      readme: item.readme || "",
    });
  } catch (err) {
    throw wrapCommunityStoreError(err, "安裝模板");
  }
}

export async function setExtensionEnabled(uid: string, id: string, enabled: boolean) {
  await setDoc(doc(extCol(uid), id), { enabled, updatedAt: Date.now() }, { merge: true });
}

export async function setTemplateEnabled(uid: string, id: string, enabled: boolean) {
  await setDoc(doc(tplCol(uid), id), { enabled, updatedAt: Date.now() }, { merge: true });
}

export async function uninstallExtension(uid: string, id: string) {
  await deleteDoc(doc(extCol(uid), id));
}

export async function uninstallTemplate(uid: string, id: string) {
  await deleteDoc(doc(tplCol(uid), id));
}

export async function saveExtensionSettings(
  uid: string,
  id: string,
  settings: Record<string, string | boolean | number>
) {
  await setDoc(
    doc(extCol(uid), id),
    { settings, updatedAt: Date.now() },
    { merge: true }
  );
}

/** Package ids already auto-seeded for this user (so uninstall won't reinstall). */
export async function getSeededDefaultPackageIds(uid: string): Promise<string[]> {
  try {
    const snap = await getDoc(metaDoc(uid));
    if (!snap.exists()) return [];
    const raw = snap.data()?.defaultExtensionIds;
    return Array.isArray(raw) ? raw.map(String).filter(Boolean) : [];
  } catch {
    return [];
  }
}

export async function markSeededDefaultPackageIds(uid: string, ids: string[]) {
  const unique = [...new Set(ids.filter(Boolean))];
  await setDoc(
    metaDoc(uid),
    {
      defaultExtensionIds: unique,
      updatedAt: Date.now(),
    },
    { merge: true }
  );
}
