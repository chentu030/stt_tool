/** Publish & load user community packages (Firestore + Storage). */

import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  setDoc,
  where,
  type Unsubscribe,
} from "firebase/firestore";
import { db, uploadFile } from "@/lib/firebase";
import { parseManifestJsonText } from "@/lib/community/parseManifest";
import { resolvePackageFromZip } from "@/lib/community/install";
import type {
  CatalogEntry,
  CommunityManifest,
  ExtensionManifest,
  PublishedPackage,
  ResolvedPackage,
  TemplateManifest,
} from "@/lib/community/types";

const COL = "community_packages";

function sanitizePackageId(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

function guessContentType(path: string): string {
  const p = path.toLowerCase();
  if (p.endsWith(".html") || p.endsWith(".htm")) return "text/html; charset=utf-8";
  if (p.endsWith(".css")) return "text/css; charset=utf-8";
  if (p.endsWith(".js") || p.endsWith(".mjs")) return "text/javascript; charset=utf-8";
  if (p.endsWith(".json")) return "application/json; charset=utf-8";
  if (p.endsWith(".svg")) return "image/svg+xml";
  if (p.endsWith(".png")) return "image/png";
  if (p.endsWith(".jpg") || p.endsWith(".jpeg")) return "image/jpeg";
  if (p.endsWith(".webp")) return "image/webp";
  if (p.endsWith(".gif")) return "image/gif";
  if (p.endsWith(".woff2")) return "font/woff2";
  if (p.endsWith(".woff")) return "font/woff";
  if (p.endsWith(".md")) return "text/markdown; charset=utf-8";
  return "application/octet-stream";
}

/** Rewrite relative URLs in HTML so assets resolve via Storage download URLs. */
export function rewriteHtmlAssetUrls(html: string, assetUrls: Record<string, string>, baseDir: string): string {
  const resolve = (rel: string) => {
    const clean = rel.trim().replace(/^['"]|['"]$/g, "");
    if (!clean || /^(https?:|data:|blob:|mailto:|#|\/\/)/i.test(clean)) return null;
    const joined = baseDir ? `${baseDir.replace(/\/$/, "")}/${clean}` : clean;
    const norm = joined.replace(/^\.\//, "").replace(/\/+/g, "/");
    const parts = norm.split("/");
    const stack: string[] = [];
    for (const part of parts) {
      if (!part || part === ".") continue;
      if (part === "..") stack.pop();
      else stack.push(part);
    }
    const key = stack.join("/");
    return assetUrls[key] || null;
  };

  return html.replace(
    /(\b(?:src|href)=)(["'])([^"']+)\2/gi,
    (full, attr: string, q: string, url: string) => {
      const abs = resolve(url);
      return abs ? `${attr}${q}${abs}${q}` : full;
    }
  );
}

export function rewriteCssAssetUrls(css: string, assetUrls: Record<string, string>, baseDir: string): string {
  return css.replace(/url\(\s*(['"]?)([^)'"]+)\1\s*\)/gi, (full, _q: string, url: string) => {
    const clean = url.trim();
    if (!clean || /^(https?:|data:|blob:|#|\/\/)/i.test(clean)) return full;
    const joined = baseDir ? `${baseDir.replace(/\/$/, "")}/${clean}` : clean;
    const norm = joined.replace(/^\.\//, "").replace(/\/+/g, "/");
    const abs = assetUrls[norm];
    return abs ? `url("${abs}")` : full;
  });
}

function parsePublished(id: string, data: Record<string, unknown>): PublishedPackage | null {
  if (!data || data.status === "removed") return null;
  const manifest = data.manifest as CommunityManifest | undefined;
  if (!manifest || (manifest.kind !== "extension" && manifest.kind !== "template")) return null;
  return {
    id,
    kind: manifest.kind,
    name: String(data.name || manifest.name || id),
    description: String(data.description || manifest.description || ""),
    author: String(data.author || manifest.author || ""),
    authorUid: String(data.authorUid || ""),
    authorPhoto: typeof data.authorPhoto === "string" ? data.authorPhoto : undefined,
    icon: typeof data.icon === "string" ? data.icon : manifest.icon,
    cover: typeof data.cover === "string" ? data.cover : manifest.cover,
    screenshots: Array.isArray(data.screenshots)
      ? data.screenshots.filter((x): x is string => typeof x === "string")
      : manifest.screenshots,
    category: typeof data.category === "string" ? data.category : manifest.category,
    tags: Array.isArray(data.tags) ? data.tags.filter((x): x is string => typeof x === "string") : undefined,
    version: String(data.version || manifest.version || "1.0.0"),
    status: data.status === "published" ? "published" : "removed",
    source: typeof data.source === "string" ? data.source : `hosted:${id}`,
    manifest,
    readmeMd: typeof data.readmeMd === "string" ? data.readmeMd : undefined,
    files:
      data.files && typeof data.files === "object" && !Array.isArray(data.files)
        ? (data.files as Record<string, string>)
        : undefined,
    assetUrls:
      data.assetUrls && typeof data.assetUrls === "object" && !Array.isArray(data.assetUrls)
        ? (data.assetUrls as Record<string, string>)
        : undefined,
    rating: typeof data.rating === "number" ? data.rating : undefined,
    downloads: typeof data.downloads === "number" ? data.downloads : undefined,
    paid: data.paid === true || (manifest as { paid?: boolean }).paid === true,
    createdAt: typeof data.createdAt === "number" ? data.createdAt : Date.now(),
    updatedAt: typeof data.updatedAt === "number" ? data.updatedAt : Date.now(),
  };
}

export function publishedToCatalogEntry(p: PublishedPackage): CatalogEntry {
  return {
    id: p.id,
    kind: p.kind,
    name: p.name,
    description: p.description,
    author: p.author,
    icon: p.icon,
    cover: p.cover,
    screenshots: p.screenshots,
    category: p.category,
    source: p.source || `hosted:${p.id}`,
    tags: p.tags,
    featured: false,
    rating: p.rating,
    downloads: p.downloads || 0,
    paid: Boolean(p.paid || p.manifest.paid),
  };
}

export async function getPublishedPackage(packageId: string): Promise<PublishedPackage | null> {
  const snap = await getDoc(doc(db, COL, packageId));
  if (!snap.exists()) return null;
  return parsePublished(snap.id, snap.data() as Record<string, unknown>);
}

export async function listPublishedPackages(): Promise<PublishedPackage[]> {
  const q = query(collection(db, COL), where("status", "==", "published"));
  const snap = await getDocs(q);
  const out: PublishedPackage[] = [];
  snap.forEach((d) => {
    const p = parsePublished(d.id, d.data() as Record<string, unknown>);
    if (p) out.push(p);
  });
  return out;
}

export function listenPublishedPackages(cb: (items: PublishedPackage[]) => void): Unsubscribe {
  const q = query(collection(db, COL), where("status", "==", "published"));
  return onSnapshot(
    q,
    (snap) => {
      const out: PublishedPackage[] = [];
      snap.forEach((d) => {
        const p = parsePublished(d.id, d.data() as Record<string, unknown>);
        if (p) out.push(p);
      });
      cb(out);
    },
    () => cb([])
  );
}

export function publishedToResolved(p: PublishedPackage): ResolvedPackage {
  const manifest = { ...p.manifest };
  if (manifest.kind === "extension" && p.assetUrls) {
    const entryPath = (manifest.pageType.entry || "index.html").replace(/^\//, "");
    const hosted =
      p.assetUrls[entryPath] ||
      p.assetUrls["index.html"] ||
      Object.entries(p.assetUrls).find(([k]) => k.endsWith(".html"))?.[1];
    if (hosted) {
      (manifest as ExtensionManifest).pageType = {
        ...manifest.pageType,
        entry: hosted,
      };
    }
  }
  return {
    manifest,
    files: p.files || {},
    readme: p.readmeMd,
    source: p.source || `hosted:${p.id}`,
    sourceKind: "hosted",
    paid: Boolean(p.paid || p.manifest.paid),
  };
}

export type PublishInput = {
  uid: string;
  authorName: string;
  authorPhoto?: string;
  manifest: CommunityManifest;
  readmeMd: string;
  coverFile?: File | null;
  screenshotFiles?: File[];
  /** Zip for extension static assets (or template pack) */
  zipFile?: File | null;
  /** Template page bodies when not from zip */
  templateFiles?: Record<string, string>;
  onProgress?: (msg: string) => void;
  tags?: string[];
  /** Mark as paid (install locked until billing) */
  paid?: boolean;
};

export async function publishCommunityPackage(input: PublishInput): Promise<PublishedPackage> {
  const id = sanitizePackageId(input.manifest.id);
  if (!id || id.length < 2) throw new Error("套件 id 太短或不合法");
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(id)) {
    throw new Error("套件 id 僅能使用小寫英文、數字、. _ -");
  }

  const existing = await getPublishedPackage(id);
  if (existing && existing.authorUid && existing.authorUid !== input.uid) {
    throw new Error(`套件 id「${id}」已被其他人使用`);
  }

  const base = `uploads/${input.uid}/community/${id}`;
  input.onProgress?.("上傳封面…");
  let cover = input.manifest.cover || "";
  if (input.coverFile) {
    cover = await uploadFile(`${base}/cover_${Date.now()}_${input.coverFile.name.slice(0, 40)}`, input.coverFile);
  }
  if (!cover) throw new Error("請上傳封面圖片");

  const screenshots: string[] = [...(input.manifest.screenshots || [])];
  if (input.screenshotFiles?.length) {
    input.onProgress?.("上傳截圖…");
    for (let i = 0; i < input.screenshotFiles.length; i++) {
      const f = input.screenshotFiles[i];
      const url = await uploadFile(`${base}/shot_${i}_${Date.now()}_${f.name.slice(0, 40)}`, f);
      screenshots.push(url);
    }
  }

  let files: Record<string, string> = { ...(input.templateFiles || {}) };
  let assetUrls: Record<string, string> = {};
  let manifest: CommunityManifest = {
    ...input.manifest,
    id,
    cover,
    screenshots: screenshots.slice(0, 8),
    author: input.authorName || input.manifest.author,
    paid: input.paid === true || input.manifest.paid === true,
  };

  if (input.zipFile) {
    input.onProgress?.("解析 zip…");
    const buf = await input.zipFile.arrayBuffer();
    const pack = await resolvePackageFromZip(buf, input.zipFile.name);
    // Prefer form manifest fields but keep zip pages/settings if form incomplete
    if (pack.manifest.kind === "template" && manifest.kind === "template") {
      const pages =
        (manifest as TemplateManifest).pages?.length > 0
          ? (manifest as TemplateManifest).pages
          : pack.manifest.pages;
      manifest = { ...manifest, ...pack.manifest, ...manifest, pages, id, cover, screenshots: screenshots.slice(0, 8) };
      files = { ...pack.files, ...files };
    } else if (pack.manifest.kind === "extension" && manifest.kind === "extension") {
      const zipExt = pack.manifest;
      manifest = {
        ...zipExt,
        ...manifest,
        id,
        cover,
        screenshots: screenshots.slice(0, 8),
        pageType: (manifest as ExtensionManifest).pageType?.entry
          ? (manifest as ExtensionManifest).pageType
          : zipExt.pageType,
      } as ExtensionManifest;
    }

    // Upload all zip entries as assets (text + binary)
    input.onProgress?.("上傳套件檔案…");
    const JSZip = (await import("jszip")).default;
    const zip = await JSZip.loadAsync(buf);
    let rootPrefix = "";
    const names = Object.keys(zip.files);
    const manifestPath = names.find((n) => /(^|\/)albireus\.json$/i.test(n));
    if (manifestPath && manifestPath.includes("/")) {
      rootPrefix = manifestPath.slice(0, manifestPath.lastIndexOf("/") + 1);
    }
    const rawTexts: Record<string, string> = {};
    for (const [name, entry] of Object.entries(zip.files)) {
      if (entry.dir) continue;
      let rel = name;
      if (rootPrefix && rel.startsWith(rootPrefix)) rel = rel.slice(rootPrefix.length);
      if (!rel || rel.startsWith("__MACOSX")) continue;
      const lower = rel.toLowerCase();
      if (lower === "albireus.json" || lower === "readme.md") continue;
      const bytes = await entry.async("uint8array");
      const type = guessContentType(rel);
      if (type.startsWith("text/") || type.includes("javascript") || type.includes("json") || type.includes("svg")) {
        rawTexts[rel] = await entry.async("string");
      }
      const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
      const blob = new Blob([ab], { type });
      const file = new File([blob], rel.split("/").pop() || "file", { type });
      const url = await uploadFile(`${base}/assets/${rel}`, file);
      assetUrls[rel] = url;
    }

    // Rewrite HTML/CSS then re-upload
    for (const [rel, text] of Object.entries(rawTexts)) {
      const dir = rel.includes("/") ? rel.slice(0, rel.lastIndexOf("/")) : "";
      let next = text;
      if (/\.html?$/i.test(rel)) next = rewriteHtmlAssetUrls(text, assetUrls, dir);
      else if (/\.css$/i.test(rel)) next = rewriteCssAssetUrls(text, assetUrls, dir);
      else continue;
      if (next === text) continue;
      const type = guessContentType(rel);
      const file = new File([next], rel.split("/").pop() || "file", { type });
      assetUrls[rel] = await uploadFile(`${base}/assets/${rel}`, file);
    }
  }

  if (manifest.kind === "extension") {
    const ext = manifest as ExtensionManifest;
    const entryRel = (ext.pageType?.entry || "index.html").replace(/^\//, "");
    // If entry is already https (external), keep it; else require uploaded asset
    if (!/^https:\/\//i.test(entryRel)) {
      if (!assetUrls[entryRel] && !assetUrls["index.html"]) {
        throw new Error("擴充 zip 需包含入口 HTML（pageType.entry 或 index.html）");
      }
      const url = assetUrls[entryRel] || assetUrls["index.html"];
      ext.pageType = { ...ext.pageType, type: "iframe", entry: url };
      manifest = ext;
    }
  }

  if (manifest.kind === "template") {
    const pages = (manifest as TemplateManifest).pages || [];
    if (!pages.length) throw new Error("模板至少需要一頁");
    for (const p of pages) {
      const key = p.file || `inline-${p.title}.md`;
      if (p.body != null) files[key] = p.body;
      if (!files[key] && !p.body) {
        // allow empty body
        files[key] = files[key] || "";
      }
    }
  }

  const now = Date.now();
  const docData: PublishedPackage = {
    id,
    kind: manifest.kind,
    name: manifest.name,
    description: manifest.description,
    author: input.authorName || manifest.author,
    authorUid: input.uid,
    authorPhoto: input.authorPhoto,
    icon: manifest.icon,
    cover,
    screenshots: screenshots.slice(0, 8),
    category: manifest.category,
    tags: (input.manifest as { tags?: string[] }).tags,
    version: manifest.version,
    status: "published",
    source: `hosted:${id}`,
    manifest,
    readmeMd: input.readmeMd || "",
    files: manifest.kind === "template" ? files : undefined,
    assetUrls: Object.keys(assetUrls).length ? assetUrls : undefined,
    rating: existing?.rating,
    downloads: existing?.downloads || 0,
    paid: input.paid === true || Boolean(manifest.paid),
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  };

  // tags on listing
  input.onProgress?.("寫入商店…");
  await setDoc(doc(db, COL, id), {
    ...docData,
    tags: input.tags || docData.tags || [],
  });

  return { ...docData, tags: input.tags || docData.tags || [] };
}

export async function unpublishCommunityPackage(uid: string, packageId: string): Promise<void> {
  const cur = await getPublishedPackage(packageId);
  if (!cur) throw new Error("找不到套件");
  if (cur.authorUid !== uid) throw new Error("只能下架自己的套件");
  await setDoc(
    doc(db, COL, packageId),
    { ...cur, status: "removed", updatedAt: Date.now() },
    { merge: true }
  );
}

/** Build manifest from submit form fields (before zip merge). */
export function buildDraftManifest(opts: {
  kind: "extension" | "template";
  id: string;
  name: string;
  version: string;
  description: string;
  author: string;
  category: string;
  icon: string;
  entry?: string;
  createLabel?: string;
  pages?: TemplateManifest["pages"];
  paid?: boolean;
}): CommunityManifest {
  const id = sanitizePackageId(opts.id);
  if (opts.kind === "extension") {
    return {
      schema: 1,
      kind: "extension",
      id,
      name: opts.name.trim() || "未命名擴充",
      version: opts.version.trim() || "1.0.0",
      description: opts.description.trim() || "（無描述）",
      author: opts.author.trim() || "匿名",
      icon: opts.icon || "extension",
      category: opts.category || "其他",
      minAppVersion: "0.1.0",
      paid: opts.paid === true,
      permissions: ["iframe", "network", "settings", "storage", "clipboard"],
      pageType: {
        type: "iframe",
        entry: (opts.entry || "index.html").trim() || "index.html",
        createLabel: opts.createLabel || "新擴充頁",
      },
    };
  }
  return {
    schema: 1,
    kind: "template",
    id,
    name: opts.name.trim() || "未命名模板",
    version: opts.version.trim() || "1.0.0",
    description: opts.description.trim() || "（無描述）",
    author: opts.author.trim() || "匿名",
    icon: opts.icon || "description",
    category: opts.category || "其他",
    minAppVersion: "0.1.0",
    paid: opts.paid === true,
    permissions: ["notes_write"],
    pages:
      opts.pages && opts.pages.length
        ? opts.pages
        : [{ title: "首頁", body: "# 新模板\n\n開始編輯…\n", file: "home.md" }],
  };
}

export { sanitizePackageId, parseManifestJsonText };

const DEFAULT_TEMPLATE_COVER =
  "https://images.unsplash.com/photo-1455390582262-044cdead277a?w=800&q=60";

/** Share the current note as a one-page community template. */
export async function publishNoteAsCommunityTemplate(opts: {
  uid: string;
  authorName: string;
  authorPhoto?: string;
  note: {
    title: string;
    body_md: string;
    icon?: string;
    cover?: string;
    tags?: string[];
  };
  /** Catalog display name (defaults to note title) */
  name?: string;
  description?: string;
  category?: string;
  paid?: boolean;
  onProgress?: (msg: string) => void;
}): Promise<PublishedPackage> {
  const title = (opts.name || opts.note.title || "未命名模板").trim() || "未命名模板";
  const slugBase = sanitizePackageId(
    `note-${opts.uid.slice(0, 6)}-${title}`.slice(0, 48)
  );
  const id = `${slugBase}-${Date.now().toString(36).slice(-4)}`;
  const file = "page.md";
  const body = (opts.note.body_md || "").trim() || `# ${title}\n\n`;
  const manifest = buildDraftManifest({
    kind: "template",
    id,
    name: title,
    version: "1.0.0",
    description:
      (opts.description || "").trim() ||
      `由筆記「${opts.note.title || title}」分享的社群模板`,
    author: opts.authorName || "匿名",
    category: opts.category || "筆記",
    icon: opts.note.icon || "description",
    pages: [
      {
        title,
        file,
        body,
        icon: opts.note.icon,
        tags: opts.note.tags,
      },
    ],
    paid: opts.paid,
  }) as TemplateManifest;

  manifest.cover = (opts.note.cover || "").trim() || DEFAULT_TEMPLATE_COVER;
  if (opts.note.tags?.length) {
    // tags live on CatalogEntry via publish input
  }

  return publishCommunityPackage({
    uid: opts.uid,
    authorName: opts.authorName,
    authorPhoto: opts.authorPhoto,
    manifest,
    readmeMd: `# ${title}\n\n由使用者從筆記頁面分享到社群商店。\n`,
    templateFiles: { [file]: body },
    tags: opts.note.tags || ["筆記分享"],
    paid: opts.paid,
    onProgress: opts.onProgress,
  });
}
