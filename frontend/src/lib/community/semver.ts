/** Semver helpers for community package updates */

export function parseSemver(raw: string): [number, number, number] {
  const m = String(raw || "0.0.0")
    .trim()
    .replace(/^v/i, "")
    .match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!m) return [0, 0, 0];
  return [Number(m[1]) || 0, Number(m[2]) || 0, Number(m[3]) || 0];
}

/** Returns positive if a > b */
export function compareSemver(a: string, b: string): number {
  const aa = parseSemver(a);
  const bb = parseSemver(b);
  for (let i = 0; i < 3; i++) {
    if (aa[i] !== bb[i]) return aa[i] - bb[i];
  }
  return 0;
}

export function isNewerVersion(remote: string, local: string): boolean {
  return compareSemver(remote, local) > 0;
}
