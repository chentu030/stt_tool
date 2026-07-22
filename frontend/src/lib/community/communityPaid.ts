/** Paid community packages: lock install/download until billing exists. */

/** Emails that can install/download every paid extension, utility, and template. */
export const PAID_BYPASS_EMAILS = ["lcy101120@gmail.com"] as const;

export function normalizeEmail(email: string | null | undefined): string {
  return (email || "").trim().toLowerCase();
}

export function canBypassPaidLocks(email: string | null | undefined): boolean {
  const e = normalizeEmail(email);
  if (!e) return false;
  return (PAID_BYPASS_EMAILS as readonly string[]).includes(e);
}

export function isPaidListing(flags: {
  paid?: boolean | null;
  manifestPaid?: boolean | null;
}): boolean {
  return Boolean(flags.paid || flags.manifestPaid);
}

export function assertCanInstallPaid(
  email: string | null | undefined,
  paid: boolean | undefined | null,
  label = "此為收費套件"
): void {
  if (!paid) return;
  if (canBypassPaidLocks(email)) return;
  throw new Error(`${label}：目前尚未開放購買，無法直接安裝／下載`);
}
