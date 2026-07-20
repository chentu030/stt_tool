/** Validate and normalize albireus.json manifests */

import { parsePermissions } from "@/lib/community/permissions";
import type {
  ChangelogEntry,
  CommunityManifest,
  ExtensionManifest,
  ExtensionSettingDef,
  TemplateManifest,
  TemplatePageDef,
} from "@/lib/community/types";

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function str(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v.trim() : fallback;
}

function requireHttps(url: string, field: string): string {
  const u = url.trim();
  if (!u) throw new Error(`${field} 不可為空`);
  let parsed: URL;
  try {
    parsed = new URL(u);
  } catch {
    throw new Error(`${field} 不是有效網址`);
  }
  if (parsed.protocol !== "https:") {
    throw new Error(`${field} 必須是 https://`);
  }
  return parsed.toString();
}

function optionalHttps(url: string, field: string): string | undefined {
  const u = url.trim();
  if (!u) return undefined;
  return requireHttps(u, field);
}

function slugId(raw: string): string {
  const id = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!id || id.length > 64) throw new Error("套件 id 無效（需 1–64 字元的 a-z0-9_-）");
  if (id.includes("albireus")) throw new Error("套件 id 不可包含 albireus");
  return id;
}

function parseHttpsList(raw: unknown, field: string): string[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  return raw
    .filter((u): u is string => typeof u === "string")
    .map((u) => requireHttps(u, field))
    .slice(0, 8);
}

function parseChangelog(raw: unknown): ChangelogEntry[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  return raw.slice(0, 20).map((item, i) => {
    const o = asRecord(item);
    if (!o) throw new Error(`changelog[${i}] 格式錯誤`);
    const version = str(o.version);
    const notes = str(o.notes);
    if (!version || !notes) throw new Error(`changelog[${i}] 需 version 與 notes`);
    return {
      version,
      date: str(o.date) || undefined,
      notes,
    };
  });
}

function parseSettings(raw: unknown): ExtensionSettingDef[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  return raw.slice(0, 20).map((item, i) => {
    const o = asRecord(item);
    if (!o) throw new Error(`settings[${i}] 格式錯誤`);
    const key = str(o.key);
    if (!/^[a-z][a-z0-9_]{0,31}$/i.test(key)) {
      throw new Error(`settings[${i}].key 無效`);
    }
    const type = str(o.type);
    if (type !== "string" && type !== "boolean" && type !== "number" && type !== "enum") {
      throw new Error(`settings[${i}].type 必須是 string|boolean|number|enum`);
    }
    const options =
      type === "enum" && Array.isArray(o.options)
        ? o.options.filter((x): x is string => typeof x === "string")
        : undefined;
    if (type === "enum" && (!options || options.length === 0)) {
      throw new Error(`settings[${i}] enum 需提供 options`);
    }
    return {
      key,
      label: str(o.label) || key,
      type,
      default: o.default as string | boolean | number | undefined,
      options,
      description: str(o.description) || undefined,
    };
  });
}

function parsePages(raw: unknown): TemplatePageDef[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error("模板至少需要一個 pages 項目");
  }
  return raw.map((p, i) => {
    const o = asRecord(p);
    if (!o) throw new Error(`pages[${i}] 格式錯誤`);
    const title = str(o.title) || `頁面 ${i + 1}`;
    const file = str(o.file);
    const body = typeof o.body === "string" ? o.body : undefined;
    if (!file && body === undefined) {
      throw new Error(`pages[${i}] 需提供 file 或 body`);
    }
    const tags = Array.isArray(o.tags)
      ? o.tags.filter((t): t is string => typeof t === "string").map((t) => t.trim()).filter(Boolean)
      : undefined;
    return {
      title,
      file: file || undefined,
      body,
      icon: str(o.icon) || undefined,
      tags,
      folder: str(o.folder) || undefined,
    };
  });
}

function listingExtras(o: Record<string, unknown>) {
  return {
    homepage: optionalHttps(str(o.homepage), "homepage"),
    repository: optionalHttps(str(o.repository), "repository"),
    changelogUrl: optionalHttps(str(o.changelogUrl), "changelogUrl"),
    changelog: parseChangelog(o.changelog),
    permissions: parsePermissions(o.permissions),
    license: str(o.license) || undefined,
  };
}

export function parseCommunityManifest(raw: unknown): CommunityManifest {
  const o = asRecord(raw);
  if (!o) throw new Error("manifest 必須是 JSON 物件");
  const schema = o.schema === 1 || o.schema === "1" ? 1 : null;
  if (schema !== 1) throw new Error("僅支援 schema: 1");
  const kind = str(o.kind);
  const id = slugId(str(o.id));
  const name = str(o.name) || id;
  const version = str(o.version) || "0.0.0";
  const description = str(o.description) || "";
  const author = str(o.author) || "未知作者";
  const authorUrl = str(o.authorUrl) || undefined;
  const icon = str(o.icon) || undefined;
  const cover = str(o.cover) || undefined;
  const category = str(o.category) || undefined;
  const screenshots = parseHttpsList(o.screenshots, "screenshots");
  const minAppVersion = str(o.minAppVersion) || undefined;
  const extras = listingExtras(o);

  if (kind === "extension") {
    const page = asRecord(o.pageType);
    if (!page) throw new Error("extension 需提供 pageType");
    const type = str(page.type);
    if (type !== "iframe") throw new Error("目前僅支援 pageType.type = iframe");
    const entry = requireHttps(str(page.entry), "pageType.entry");
    const nav = asRecord(o.nav);
    const settings = parseSettings(o.settings);
    const manifest: ExtensionManifest = {
      schema: 1,
      kind: "extension",
      id,
      name,
      version,
      description,
      author,
      authorUrl,
      icon: icon || "extension",
      cover,
      screenshots,
      category,
      minAppVersion,
      ...extras,
      settings,
      nav: nav
        ? {
            label: str(nav.label) || undefined,
            order: typeof nav.order === "number" ? nav.order : undefined,
          }
        : { label: name },
      pageType: {
        type: "iframe",
        entry,
        createLabel: str(page.createLabel) || `新${name}`,
      },
    };
    return manifest;
  }

  if (kind === "template") {
    const manifest: TemplateManifest = {
      schema: 1,
      kind: "template",
      id,
      name,
      version,
      description,
      author,
      authorUrl,
      icon: icon || "description",
      cover,
      screenshots,
      category,
      minAppVersion,
      ...extras,
      pages: parsePages(o.pages),
    };
    return manifest;
  }

  throw new Error("kind 必須是 extension 或 template");
}

export function parseManifestJsonText(text: string): CommunityManifest {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("albireus.json 不是有效 JSON");
  }
  return parseCommunityManifest(raw);
}
