/** Resolve community packages from GitHub URL, raw JSON, or zip */

import JSZip from "jszip";
import { parseManifestJsonText } from "@/lib/community/parseManifest";
import type { ResolvedPackage } from "@/lib/community/types";
import { ALBIREUS_MANIFEST } from "@/lib/community/types";

function normalizeGithubInput(raw: string): {
  owner: string;
  repo: string;
  ref?: string;
  path?: string;
} | null {
  const t = raw.trim().replace(/\/$/, "");
  if (!t) return null;

  // owner/repo or owner/repo@ref or owner/repo/tree/ref/path
  const short = t.match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)(?:@([^/\s]+))?$/);
  if (short && !t.includes("://")) {
    return { owner: short[1], repo: short[2], ref: short[3] };
  }

  try {
    const u = new URL(t.includes("://") ? t : `https://${t}`);
    if (!u.hostname.includes("github.com")) return null;
    const parts = u.pathname.split("/").filter(Boolean);
    if (parts.length < 2) return null;
    const owner = parts[0];
    const repo = parts[1].replace(/\.git$/, "");
    if (parts[2] === "tree" || parts[2] === "blob") {
      const ref = parts[3];
      const path = parts.slice(4).join("/");
      return { owner, repo, ref, path: path || undefined };
    }
    if (parts[2] === "releases" && parts[3] === "tag" && parts[4]) {
      return { owner, repo, ref: parts[4] };
    }
    return { owner, repo };
  } catch {
    return null;
  }
}

async function proxyFetch(url: string): Promise<{ ok: boolean; status: number; text: string; contentType: string }> {
  const res = await fetch(`/api/community/fetch?url=${encodeURIComponent(url)}`);
  const contentType = res.headers.get("content-type") || "";
  const text = await res.text();
  return { ok: res.ok, status: res.status, text, contentType };
}

async function tryFetchText(urls: string[]): Promise<{ url: string; text: string } | null> {
  for (const url of urls) {
    try {
      const r = await proxyFetch(url);
      if (r.ok && r.text.trim()) return { url, text: r.text };
    } catch {
      /* try next */
    }
  }
  return null;
}

export async function resolvePackageFromZip(
  buffer: ArrayBuffer,
  sourceLabel: string
): Promise<ResolvedPackage> {
  const zip = await JSZip.loadAsync(buffer);
  const names = Object.keys(zip.files);
  const topDirs = new Set(
    names.map((n) => n.split("/")[0]).filter((n) => n && names.some((x) => x.startsWith(`${n}/`)))
  );
  const strip =
    topDirs.size === 1 && !zip.file(ALBIREUS_MANIFEST) ? `${[...topDirs][0]}/` : "";

  const files: Record<string, string> = {};
  for (const name of names) {
    const entry = zip.files[name];
    if (!entry || entry.dir) continue;
    const rel = (strip && name.startsWith(strip) ? name.slice(strip.length) : name).replace(/\\/g, "/");
    if (!rel || rel.startsWith("__MACOSX")) continue;
    if (!/\.(json|md|markdown|txt|html|css|svg)$/i.test(rel)) continue;
    files[rel] = await entry.async("string");
  }

  const manifestText = files[ALBIREUS_MANIFEST] || files[`./${ALBIREUS_MANIFEST}`];
  if (!manifestText) throw new Error(`壓縮檔內找不到 ${ALBIREUS_MANIFEST}`);
  const manifest = parseManifestJsonText(manifestText);
  const readme =
    files["README.md"] || files["readme.md"] || files["Readme.md"] || undefined;

  return {
    manifest,
    files,
    readme,
    source: sourceLabel,
    sourceKind: "file",
  };
}

export async function resolvePackageFromJsonFile(
  text: string,
  sourceLabel: string
): Promise<ResolvedPackage> {
  const manifest = parseManifestJsonText(text);
  const files: Record<string, string> = { [ALBIREUS_MANIFEST]: text };
  if (manifest.kind === "template") {
    for (const p of manifest.pages) {
      if (p.body != null) {
        const key = p.file || `page-${p.title}.md`;
        files[key] = p.body;
      }
    }
  }
  return {
    manifest,
    files,
    source: sourceLabel,
    sourceKind: "file",
  };
}

/** Resolve from GitHub owner/repo, github URL, raw albireus.json URL, or catalog source string */
export async function resolvePackageFromSource(
  source: string,
  sourceKind: "github" | "catalog" | "file" = "github"
): Promise<ResolvedPackage> {
  const trimmed = source.trim();
  if (!trimmed) throw new Error("請輸入來源");

  // Direct JSON URL
  if (/^https:\/\//i.test(trimmed) && /\.json(\?|$)/i.test(trimmed)) {
    const r = await proxyFetch(trimmed);
    if (!r.ok) throw new Error(`無法下載 manifest（HTTP ${r.status}）`);
    const manifest = parseManifestJsonText(r.text);
    const files: Record<string, string> = { [ALBIREUS_MANIFEST]: r.text };
    if (manifest.kind === "template") {
      const base = trimmed.replace(/\/[^/]+$/, "/");
      for (const p of manifest.pages) {
        if (p.body != null) {
          files[p.file || `inline-${p.title}.md`] = p.body;
          continue;
        }
        if (!p.file) continue;
        const fileUrl = new URL(p.file, base).toString();
        const fr = await proxyFetch(fileUrl);
        if (fr.ok) files[p.file] = fr.text;
      }
      const readmeUrl = new URL("README.md", base).toString();
      const rr = await proxyFetch(readmeUrl);
      return {
        manifest,
        files,
        readme: rr.ok ? rr.text : undefined,
        source: trimmed,
        sourceKind: sourceKind === "catalog" ? "catalog" : "github",
      };
    }
    return {
      manifest,
      files,
      source: trimmed,
      sourceKind: sourceKind === "catalog" ? "catalog" : "github",
    };
  }

  // Zip URL
  if (/^https:\/\//i.test(trimmed) && /\.zip(\?|$)/i.test(trimmed)) {
    const res = await fetch(`/api/community/fetch?url=${encodeURIComponent(trimmed)}&binary=1`);
    if (!res.ok) throw new Error(`無法下載 zip（HTTP ${res.status}）`);
    const buf = await res.arrayBuffer();
    const pack = await resolvePackageFromZip(buf, trimmed);
    return { ...pack, sourceKind: sourceKind === "catalog" ? "catalog" : "github" };
  }

  const gh = normalizeGithubInput(trimmed);
  if (!gh) {
    // Try as raw path under a known host already handled; else fail
    throw new Error("無法解析來源。請使用 owner/repo、GitHub 網址，或 albireus.json／.zip 連結");
  }

  const refs = gh.ref ? [gh.ref, "main", "master"] : ["main", "master"];
  const uniqueRefs = [...new Set(refs)];
  const pathPrefix = gh.path ? `${gh.path.replace(/\/$/, "")}/` : "";

  // Prefer zipball for full template packs
  for (const ref of uniqueRefs) {
    const zipUrl = `https://codeload.github.com/${gh.owner}/${gh.repo}/zip/refs/heads/${ref}`;
    try {
      const res = await fetch(`/api/community/fetch?url=${encodeURIComponent(zipUrl)}&binary=1`);
      if (res.ok) {
        const buf = await res.arrayBuffer();
        if (buf.byteLength > 100) {
          const pack = await resolvePackageFromZip(
            buf,
            `${gh.owner}/${gh.repo}@${ref}`
          );
          return {
            ...pack,
            source: `${gh.owner}/${gh.repo}`,
            sourceKind: sourceKind === "catalog" ? "catalog" : "github",
          };
        }
      }
    } catch {
      /* try raw */
    }
  }

  const manifestUrls: string[] = [];
  for (const ref of uniqueRefs) {
    manifestUrls.push(
      `https://raw.githubusercontent.com/${gh.owner}/${gh.repo}/${ref}/${pathPrefix}${ALBIREUS_MANIFEST}`
    );
  }
  const hit = await tryFetchText(manifestUrls);
  if (!hit) {
    throw new Error(
      `在 ${gh.owner}/${gh.repo} 找不到 ${ALBIREUS_MANIFEST}（試過 ${uniqueRefs.join(", ")}）`
    );
  }

  const manifest = parseManifestJsonText(hit.text);
  const files: Record<string, string> = { [ALBIREUS_MANIFEST]: hit.text };
  const refUsed =
    uniqueRefs.find((ref) =>
      hit.url.includes(`/${gh.owner}/${gh.repo}/${ref}/`)
    ) || uniqueRefs[0];
  const rawBase = `https://raw.githubusercontent.com/${gh.owner}/${gh.repo}/${refUsed}/${pathPrefix}`;

  if (manifest.kind === "template") {
    for (const p of manifest.pages) {
      if (p.body != null) {
        files[p.file || `inline-${p.title}.md`] = p.body;
        continue;
      }
      if (!p.file) continue;
      const fr = await proxyFetch(`${rawBase}${p.file}`);
      if (fr.ok) files[p.file] = fr.text;
      else throw new Error(`無法下載模板檔 ${p.file}`);
    }
  }

  const readme = await tryFetchText([`${rawBase}README.md`, `${rawBase}readme.md`]);

  return {
    manifest,
    files,
    readme: readme?.text,
    source: `${gh.owner}/${gh.repo}`,
    sourceKind: sourceKind === "catalog" ? "catalog" : "github",
  };
}
