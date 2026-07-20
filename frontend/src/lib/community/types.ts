/** Community store: extension + template package schemas */

export const ALBIREUS_MANIFEST = "albireus.json";

/** App version used for minAppVersion checks (keep in sync with frontend package.json). */
export const ALBIREUS_APP_VERSION = "0.1.0";

export type CommunityPackageKind = "extension" | "template";

/** Declared capabilities — shown before install (Chrome/Obsidian-style transparency). */
export type PackagePermission =
  | "network"
  | "iframe"
  | "clipboard"
  | "storage"
  | "notes_write"
  | "settings";

export type ChangelogEntry = {
  version: string;
  date?: string;
  notes: string;
};

export type ExtensionPageType = {
  type: "iframe";
  /** HTTPS entry URL for sandboxed iframe */
  entry: string;
  createLabel?: string;
};

export type ExtensionSettingDef = {
  key: string;
  label: string;
  type: "string" | "boolean" | "number" | "enum";
  default?: string | boolean | number;
  options?: string[];
  description?: string;
};

type ListingFields = {
  homepage?: string;
  repository?: string;
  changelogUrl?: string;
  changelog?: ChangelogEntry[];
  permissions?: PackagePermission[];
  license?: string;
};

export type ExtensionManifest = ListingFields & {
  schema: 1;
  kind: "extension";
  id: string;
  name: string;
  version: string;
  description: string;
  author: string;
  authorUrl?: string;
  icon?: string;
  cover?: string;
  screenshots?: string[];
  category?: string;
  minAppVersion?: string;
  nav?: { label?: string; order?: number };
  pageType: ExtensionPageType;
  settings?: ExtensionSettingDef[];
};

export type TemplatePageDef = {
  title: string;
  file?: string;
  body?: string;
  icon?: string;
  tags?: string[];
  folder?: string;
};

export type TemplateManifest = ListingFields & {
  schema: 1;
  kind: "template";
  id: string;
  name: string;
  version: string;
  description: string;
  author: string;
  authorUrl?: string;
  icon?: string;
  cover?: string;
  screenshots?: string[];
  category?: string;
  minAppVersion?: string;
  pages: TemplatePageDef[];
};

export type CommunityManifest = ExtensionManifest | TemplateManifest;

export type CatalogEntry = {
  id: string;
  kind: CommunityPackageKind;
  name: string;
  description: string;
  author: string;
  icon?: string;
  cover?: string;
  screenshots?: string[];
  category?: string;
  /** GitHub owner/repo or https URL to albireus.json / zip */
  source: string;
  tags?: string[];
  featured?: boolean;
  /** Static seed rating 1–5 for catalog display */
  rating?: number;
  downloads?: number;
  collectionIds?: string[];
};

export type StoreCollection = {
  id: string;
  name: string;
  description: string;
  packageIds: string[];
};

export type InstalledExtension = {
  id: string;
  manifest: ExtensionManifest;
  enabled: boolean;
  source: string;
  sourceKind: "github" | "file" | "catalog";
  installedAt: number;
  updatedAt: number;
  readme?: string;
  settings?: Record<string, string | boolean | number>;
};

export type InstalledTemplate = {
  id: string;
  manifest: TemplateManifest;
  files: Record<string, string>;
  enabled: boolean;
  source: string;
  sourceKind: "github" | "file" | "catalog";
  installedAt: number;
  updatedAt: number;
  readme?: string;
};

export type ResolvedPackage = {
  manifest: CommunityManifest;
  files: Record<string, string>;
  readme?: string;
  source: string;
  sourceKind: "github" | "file" | "catalog";
};

export type PackageRating = {
  packageId: string;
  stars: number;
  comment?: string;
  updatedAt: number;
};

export type PackageReport = {
  packageId: string;
  reason: string;
  detail?: string;
  updatedAt: number;
};
