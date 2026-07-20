/** Firestore persistence for installed community packages */

import {
  collection,
  doc,
  deleteDoc,
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
      data.sourceKind === "github" || data.sourceKind === "file" || data.sourceKind === "catalog"
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
      data.sourceKind === "github" || data.sourceKind === "file" || data.sourceKind === "catalog"
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
}

export async function saveInstalledTemplate(uid: string, item: InstalledTemplate) {
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
