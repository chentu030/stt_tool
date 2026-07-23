/** Firestore REST helpers for vocab quota (user ID token). */

import { firebaseConfig } from "@/lib/firebasePublic";
import { emptyVocabQuota, type VocabQuotaUsage } from "@/lib/vocabQuota";

const PROJECT = firebaseConfig.projectId;

function docUrl(uid: string) {
  return `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents/users/${encodeURIComponent(uid)}/community_meta/vocab_quota`;
}

function fromFields(fields: Record<string, { integerValue?: string; stringValue?: string }> | undefined): VocabQuotaUsage {
  if (!fields) return emptyVocabQuota();
  return {
    words: Number(fields.words?.integerValue || 0),
    videos: Number(fields.videos?.integerValue || 0),
    voice: Number(fields.voice?.integerValue || 0),
    updatedAt: fields.updatedAt?.stringValue || undefined,
  };
}

export async function readVocabQuota(uid: string, idToken: string): Promise<VocabQuotaUsage> {
  const res = await fetch(docUrl(uid), {
    headers: { Authorization: `Bearer ${idToken}` },
    cache: "no-store",
  });
  if (res.status === 404) return emptyVocabQuota();
  if (!res.ok) throw new Error(`讀取配額失敗 (${res.status})`);
  const data = (await res.json()) as { fields?: Record<string, { integerValue?: string; stringValue?: string }> };
  return fromFields(data.fields);
}

export async function writeVocabQuota(
  uid: string,
  idToken: string,
  usage: VocabQuotaUsage
): Promise<VocabQuotaUsage> {
  const body = {
    fields: {
      words: { integerValue: String(Math.max(0, Math.floor(usage.words))) },
      videos: { integerValue: String(Math.max(0, Math.floor(usage.videos))) },
      voice: { integerValue: String(Math.max(0, Math.floor(usage.voice))) },
      updatedAt: { stringValue: new Date().toISOString() },
    },
  };
  const res = await fetch(docUrl(uid), {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${idToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`寫入配額失敗 (${res.status}) ${t.slice(0, 200)}`);
  }
  return { ...usage, updatedAt: new Date().toISOString() };
}
