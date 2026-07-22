/** Dev-period access gate: allowlist + waitlist applications. */

import {
  doc,
  getDoc,
  onSnapshot,
  setDoc,
  Timestamp,
  type Unsubscribe,
} from "firebase/firestore";
import type { User } from "firebase/auth";
import { db } from "@/lib/firebase";

/** Emails that can use the product during closed beta. */
export const ACCESS_ALLOWLIST = [
  "lcy101120@gmail.com",
  "lingyu1122@gmail.com",
  "ljc123@gmail.com",
] as const;

export type AccessStatus = "none" | "pending" | "approved" | "rejected";

export type AccessRequest = {
  uid: string;
  email: string;
  display_name: string;
  username: string;
  status: Exclude<AccessStatus, "none">;
  use_cases: string[];
  current_workflows: string[];
  frequencies: string[];
  referrals: string[];
  use_case_other: string;
  workflow_other: string;
  referral_other: string;
  wished_features: string;
  created_at: Date | null;
  updated_at: Date | null;
};

export type AccessApplicationInput = {
  displayName: string;
  username: string;
  useCases: string[];
  currentWorkflows: string[];
  frequencies: string[];
  referrals: string[];
  useCaseOther: string;
  workflowOther: string;
  referralOther: string;
  wishedFeatures: string;
};

export const USE_CASE_OPTIONS = [
  { id: "class", label: "上課／讀書筆記" },
  { id: "meeting", label: "會議／小組討論" },
  { id: "work", label: "工作紀錄／專案整理" },
  { id: "interview", label: "訪談／客戶通話" },
  { id: "self", label: "自學整理" },
  { id: "content", label: "內容創作" },
  { id: "other", label: "其他" },
] as const;

export const WORKFLOW_OPTIONS = [
  { id: "notion", label: "Notion／類似工具" },
  { id: "docs", label: "Google 文件／Word" },
  { id: "hand", label: "手寫或紙本" },
  { id: "stt", label: "錄音後再轉文字" },
  { id: "mix", label: "以上混用" },
  { id: "other", label: "其他" },
] as const;

export const FREQUENCY_OPTIONS = [
  { id: "daily", label: "幾乎每天" },
  { id: "few", label: "一週幾次" },
  { id: "weekly", label: "一週一次左右" },
  { id: "rare", label: "偶爾試試" },
] as const;

export const REFERRAL_OPTIONS = [
  { id: "threads", label: "Threads" },
  { id: "friend", label: "朋友介紹" },
  { id: "search", label: "搜尋到的" },
  { id: "other", label: "其他" },
] as const;

export function normalizeEmail(email: string | null | undefined): string {
  return (email || "").trim().toLowerCase();
}

export function isAllowlistedEmail(email: string | null | undefined): boolean {
  const e = normalizeEmail(email);
  return (ACCESS_ALLOWLIST as readonly string[]).includes(e);
}

export function isAccessBypassPath(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  return pathname.startsWith("/share/");
}

function asStringList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  const s = String(value || "").trim();
  if (!s) return [];
  return s.split(",").map((x) => x.trim()).filter(Boolean);
}

function requestFromData(uid: string, data: Record<string, unknown>): AccessRequest {
  const statusRaw = String(data.status || "pending");
  const status: AccessRequest["status"] =
    statusRaw === "approved" || statusRaw === "rejected" ? statusRaw : "pending";
  return {
    uid,
    email: String(data.email || ""),
    display_name: String(data.display_name || ""),
    username: String(data.username || ""),
    status,
    use_cases: asStringList(data.use_cases ?? data.use_case),
    current_workflows: asStringList(data.current_workflows ?? data.current_workflow),
    frequencies: asStringList(data.frequencies ?? data.frequency),
    referrals: asStringList(data.referrals ?? data.referral),
    use_case_other: String(data.use_case_other || ""),
    workflow_other: String(data.workflow_other || ""),
    referral_other: String(data.referral_other || ""),
    wished_features: String(data.wished_features || ""),
    created_at: (data.created_at as { toDate?: () => Date })?.toDate?.() || null,
    updated_at: (data.updated_at as { toDate?: () => Date })?.toDate?.() || null,
  };
}

export function listenAccessRequest(
  uid: string,
  cb: (req: AccessRequest | null) => void
): Unsubscribe {
  return onSnapshot(
    doc(db, "access_requests", uid),
    (snap) => {
      if (!snap.exists()) {
        cb(null);
        return;
      }
      cb(requestFromData(uid, snap.data() as Record<string, unknown>));
    },
    (err) => {
      // Permission / network errors must not leave the UI spinning forever.
      console.error("[listenAccessRequest]", err);
      cb(null);
    }
  );
}

/** One-shot fetch for faster first paint (optional; listener still used for updates). */
export async function fetchAccessRequest(uid: string): Promise<AccessRequest | null> {
  try {
    const snap = await getDoc(doc(db, "access_requests", uid));
    if (!snap.exists()) return null;
    return requestFromData(uid, snap.data() as Record<string, unknown>);
  } catch (err) {
    console.error("[fetchAccessRequest]", err);
    return null;
  }
}

/** Whitelist users get an approved marker so later allowlist edits still work via Firestore. */
export async function ensureAllowlistAccess(user: User): Promise<void> {
  if (!isAllowlistedEmail(user.email)) return;
  const ref = doc(db, "access_requests", user.uid);
  const snap = await getDoc(ref);
  if (snap.exists() && snap.data()?.status === "approved") return;
  const now = Timestamp.now();
  await setDoc(
    ref,
    {
      uid: user.uid,
      email: normalizeEmail(user.email),
      display_name: user.displayName || "",
      username: "",
      status: "approved",
      use_cases: [],
      current_workflows: [],
      frequencies: [],
      referrals: ["allowlist"],
      use_case_other: "",
      workflow_other: "",
      referral_other: "",
      wished_features: "",
      updated_at: now,
      ...(snap.exists() ? {} : { created_at: now }),
    },
    { merge: true }
  );
}

export async function submitAccessApplication(
  user: User,
  input: AccessApplicationInput
): Promise<void> {
  const ref = doc(db, "access_requests", user.uid);
  const prev = await getDoc(ref);
  if (prev.exists() && prev.data()?.status === "approved") return;
  if (prev.exists() && prev.data()?.status === "pending") {
    throw new Error("申請已送出，請稍候審核");
  }

  const now = Timestamp.now();
  await setDoc(ref, {
    uid: user.uid,
    email: normalizeEmail(user.email),
    display_name: input.displayName.trim(),
    username: input.username.trim().toLowerCase(),
    status: "pending",
    use_cases: input.useCases,
    current_workflows: input.currentWorkflows,
    frequencies: input.frequencies,
    referrals: input.referrals,
    use_case_other: input.useCaseOther.trim(),
    workflow_other: input.workflowOther.trim(),
    referral_other: input.referralOther.trim(),
    wished_features: input.wishedFeatures.trim(),
    created_at: now,
    updated_at: now,
  });
}

export function resolveAccess(
  user: User | null,
  request: AccessRequest | null
): AccessStatus {
  if (!user) return "none";
  if (isAllowlistedEmail(user.email)) return "approved";
  if (!request) return "none";
  return request.status;
}
