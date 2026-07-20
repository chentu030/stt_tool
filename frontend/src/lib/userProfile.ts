/** Cloud user profile: display name, username, avatar. */

import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  runTransaction,
  setDoc,
  Timestamp,
  updateDoc,
  type Unsubscribe,
} from "firebase/firestore";
import { updateProfile, type User } from "firebase/auth";
import { db, uploadFile } from "@/lib/firebase";

export type UserProfile = {
  uid: string;
  display_name: string;
  username: string;
  photo_url: string;
  photo_path: string;
  updated_at: Date | null;
};

const USERNAME_RE = /^[a-z][a-z0-9_]{2,19}$/;
const RESERVED = new Set([
  "admin",
  "albireus",
  "api",
  "app",
  "auth",
  "help",
  "me",
  "null",
  "root",
  "settings",
  "support",
  "system",
  "user",
  "username",
]);

export function normalizeUsername(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, "_");
}

export function validateUsername(raw: string): string | null {
  const u = normalizeUsername(raw);
  if (!u) return "請輸入用戶名稱";
  if (!USERNAME_RE.test(u)) {
    return "用戶名稱需 3–20 字，以小寫字母開頭，僅限 a-z、0-9、底線";
  }
  if (RESERVED.has(u)) return "此用戶名稱無法使用";
  return null;
}

export function validateDisplayName(raw: string): string | null {
  const n = raw.trim();
  if (!n) return "請輸入顯示名稱";
  if (n.length > 40) return "顯示名稱最多 40 字";
  return null;
}

export function authFallbackName(user: User | null | undefined): string {
  if (!user) return "使用者";
  return user.displayName || user.email?.split("@")[0] || "使用者";
}

export function resolveDisplayName(
  profile: UserProfile | null | undefined,
  user: User | null | undefined
): string {
  const fromProfile = profile?.display_name?.trim();
  if (fromProfile) return fromProfile;
  return authFallbackName(user);
}

export function resolvePhotoURL(
  profile: UserProfile | null | undefined,
  user: User | null | undefined
): string {
  return profile?.photo_url || user?.photoURL || "";
}

export function resolveUsername(profile: UserProfile | null | undefined): string {
  return profile?.username || "";
}

function profileFromData(uid: string, data: Record<string, unknown> | undefined): UserProfile {
  return {
    uid,
    display_name: String(data?.display_name || ""),
    username: String(data?.username || ""),
    photo_url: String(data?.photo_url || ""),
    photo_path: String(data?.photo_path || ""),
    updated_at: (data?.updated_at as { toDate?: () => Date })?.toDate?.() || null,
  };
}

export function listenUserProfile(uid: string, cb: (p: UserProfile | null) => void): Unsubscribe {
  return onSnapshot(
    doc(db, "users", uid),
    (snap) => {
      if (!snap.exists()) {
        cb(null);
        return;
      }
      cb(profileFromData(uid, snap.data() as Record<string, unknown>));
    },
    (err) => {
      console.error("[listenUserProfile]", err);
      cb(null);
    }
  );
}

/** Seed a profile doc from Google Auth on first visit (no overwrite of custom fields). */
export async function ensureUserProfile(user: User): Promise<void> {
  const ref = doc(db, "users", user.uid);
  const snap = await getDoc(ref);
  if (snap.exists()) return;
  const display = authFallbackName(user);
  await setDoc(ref, {
    display_name: display,
    username: "",
    photo_url: user.photoURL || "",
    photo_path: "",
    email: user.email || "",
    created_at: Timestamp.now(),
    updated_at: Timestamp.now(),
  });
}

export async function uploadAvatar(
  uid: string,
  file: File,
  onProgress?: (pct: number) => void
): Promise<{ url: string; path: string }> {
  if (!file.type.startsWith("image/")) {
    throw new Error("請選擇圖片檔");
  }
  if (file.size > 2 * 1024 * 1024) {
    throw new Error("頭像需小於 2MB");
  }
  const ext = (file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
  const path = `uploads/${uid}/profile/avatar_${Date.now()}.${ext}`;
  const url = await uploadFile(path, file, onProgress);
  return { url, path };
}

export type SaveProfileInput = {
  displayName: string;
  username: string;
  photoURL?: string;
  photoPath?: string;
};

/**
 * Save profile + claim username uniquely via usernames/{name}.
 * Also mirrors displayName/photoURL onto Firebase Auth when possible.
 */
export async function saveUserProfile(user: User, input: SaveProfileInput): Promise<UserProfile> {
  const displayErr = validateDisplayName(input.displayName);
  if (displayErr) throw new Error(displayErr);

  const display_name = input.displayName.trim();
  const usernameRaw = input.username.trim();
  let username = "";
  if (usernameRaw) {
    const uErr = validateUsername(usernameRaw);
    if (uErr) throw new Error(uErr);
    username = normalizeUsername(usernameRaw);
  }

  const profileRef = doc(db, "users", user.uid);
  const prevSnap = await getDoc(profileRef);
  const prev = prevSnap.exists()
    ? profileFromData(user.uid, prevSnap.data() as Record<string, unknown>)
    : null;
  const oldUsername = prev?.username || "";

  const photo_url = input.photoURL !== undefined ? input.photoURL : prev?.photo_url || user.photoURL || "";
  const photo_path = input.photoPath !== undefined ? input.photoPath : prev?.photo_path || "";

  await runTransaction(db, async (tx) => {
    // Firestore requires all reads before any writes.
    const claimRef = username && username !== oldUsername ? doc(db, "usernames", username) : null;
    const oldRef = oldUsername && oldUsername !== username ? doc(db, "usernames", oldUsername) : null;

    const claimSnap = claimRef ? await tx.get(claimRef) : null;
    const oldSnap = oldRef ? await tx.get(oldRef) : null;

    if (claimSnap?.exists() && claimSnap.data()?.uid !== user.uid) {
      throw new Error("此用戶名稱已被使用");
    }

    if (claimRef) {
      tx.set(claimRef, { uid: user.uid, updated_at: Timestamp.now() });
    }
    if (oldRef && oldSnap?.exists() && oldSnap.data()?.uid === user.uid) {
      tx.delete(oldRef);
    }

    const payload = {
      display_name,
      username,
      photo_url,
      photo_path,
      email: user.email || "",
      updated_at: Timestamp.now(),
      ...(prevSnap.exists() ? {} : { created_at: Timestamp.now() }),
    };
    tx.set(profileRef, payload, { merge: true });
  });

  try {
    await updateProfile(user, {
      displayName: display_name,
      photoURL: photo_url || null,
    });
  } catch (e) {
    console.warn("[saveUserProfile] Auth updateProfile failed", e);
  }

  await syncProfileToTeams(user.uid, display_name, photo_url).catch((e) => {
    console.warn("[saveUserProfile] team sync failed", e);
  });

  return {
    uid: user.uid,
    display_name,
    username,
    photo_url,
    photo_path,
    updated_at: new Date(),
  };
}

async function syncProfileToTeams(uid: string, displayName: string, photoURL: string) {
  const teamsSnap = await getDocs(collection(db, "users", uid, "teams"));
  await Promise.all(
    teamsSnap.docs.map(async (t) => {
      const memberRef = doc(db, "teams", t.id, "members", uid);
      try {
        await updateDoc(memberRef, {
          display_name: displayName,
          photo_url: photoURL || "",
        });
      } catch {
        /* may lack permission on some teams — ignore */
      }
    })
  );
}

export async function clearUsernameClaim(uid: string, username: string) {
  if (!username) return;
  const ref = doc(db, "usernames", username);
  const snap = await getDoc(ref);
  if (snap.exists() && snap.data()?.uid === uid) {
    await deleteDoc(ref);
  }
}
