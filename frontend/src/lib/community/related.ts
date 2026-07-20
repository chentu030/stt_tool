/** Related package recommendations from catalog tags / collections */

import type { CatalogEntry } from "@/lib/community/types";
import { getCatalog } from "@/lib/community/builtins";

export function relatedCatalogEntries(
  entry: CatalogEntry,
  opts?: { limit?: number }
): CatalogEntry[] {
  const limit = opts?.limit ?? 4;
  const catalog = getCatalog().filter((c) => !(c.id === entry.id && c.kind === entry.kind));
  const tagSet = new Set((entry.tags || []).map((t) => t.toLowerCase()));
  const colSet = new Set(entry.collectionIds || []);
  const scored = catalog.map((c) => {
    let score = 0;
    if (c.category && c.category === entry.category) score += 3;
    if (c.kind === entry.kind) score += 1;
    for (const t of c.tags || []) {
      if (tagSet.has(t.toLowerCase())) score += 2;
    }
    for (const id of c.collectionIds || []) {
      if (colSet.has(id)) score += 2;
    }
    if (c.featured) score += 0.5;
    score += (c.rating || 0) * 0.1;
    return { c, score };
  });
  return scored
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || (b.c.downloads || 0) - (a.c.downloads || 0))
    .slice(0, limit)
    .map((x) => x.c);
}

export function relatedByPackageId(id: string, kind?: string): CatalogEntry[] {
  const entry =
    getCatalog().find((c) => c.id === id && (!kind || c.kind === kind)) ||
    getCatalog().find((c) => c.id === id);
  if (!entry) return [];
  return relatedCatalogEntries(entry);
}
