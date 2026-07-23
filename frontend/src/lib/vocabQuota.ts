/** Vocab free-tier quota (server + client shared constants). */

export const VOCAB_QUOTA_LIMITS = {
  words: 50,
  videos: 5,
  voice: 30,
} as const;

export type VocabQuotaKind = keyof typeof VOCAB_QUOTA_LIMITS;

export type VocabQuotaUsage = {
  words: number;
  videos: number;
  voice: number;
  updatedAt?: string;
};

export const VOCAB_UNLIMITED_EMAILS = new Set(["lcy101120@gmail.com"]);

export function isVocabUnlimitedEmail(email?: string | null): boolean {
  const e = (email || "").trim().toLowerCase();
  return Boolean(e && VOCAB_UNLIMITED_EMAILS.has(e));
}

export function emptyVocabQuota(): VocabQuotaUsage {
  return { words: 0, videos: 0, voice: 0 };
}

export function remainingQuota(usage: VocabQuotaUsage, kind: VocabQuotaKind): number {
  const used = Math.max(0, Number(usage[kind]) || 0);
  return Math.max(0, VOCAB_QUOTA_LIMITS[kind] - used);
}

export function canConsumeQuota(
  usage: VocabQuotaUsage,
  kind: VocabQuotaKind,
  amount: number,
  email?: string | null
): boolean {
  if (isVocabUnlimitedEmail(email)) return true;
  return remainingQuota(usage, kind) >= Math.max(1, amount);
}
