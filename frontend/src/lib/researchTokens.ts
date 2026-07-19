/** Shared query tokenization for note retrieval (CJK-aware). */

export function tokenizeQuery(query: string): string[] {
  const q = query.toLowerCase().trim();
  const parts = q
    .split(/[\s,，、/|；;。.！!？?（）()【】\[\]「」]+/)
    .filter((t) => t.length >= 2);
  const out = new Set<string>(parts);
  const cjk = q.replace(/[^\u4e00-\u9fff]/g, "");
  for (let i = 0; i < cjk.length - 1; i++) {
    out.add(cjk.slice(i, i + 2));
  }
  if (cjk.length >= 3) {
    for (let i = 0; i < cjk.length - 2; i += 2) {
      out.add(cjk.slice(i, i + 3));
    }
  }
  return Array.from(out).filter(Boolean).slice(0, 48);
}
