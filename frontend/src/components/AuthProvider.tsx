"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { User, onAuthStateChanged, auth } from "@/lib/firebase";
import {
  ensureUserProfile,
  listenUserProfile,
  resolveDisplayName,
  resolvePhotoURL,
  resolveUsername,
  saveUserProfile,
  uploadAvatar,
  type SaveProfileInput,
  type UserProfile,
} from "@/lib/userProfile";

interface AuthCtx {
  user: User | null;
  loading: boolean;
  profile: UserProfile | null;
  profileLoading: boolean;
  /** Resolved display name (custom → Google → email local-part) */
  displayName: string;
  /** Custom @username (empty if unset) */
  username: string;
  /** Resolved avatar URL */
  photoURL: string;
  saveProfile: (input: SaveProfileInput) => Promise<UserProfile>;
  uploadAvatarFile: (file: File, onProgress?: (pct: number) => void) => Promise<{ url: string; path: string }>;
}

const AuthContext = createContext<AuthCtx>({
  user: null,
  loading: true,
  profile: null,
  profileLoading: false,
  displayName: "使用者",
  username: "",
  photoURL: "",
  saveProfile: async () => {
    throw new Error("未登入");
  },
  uploadAvatarFile: async () => {
    throw new Error("未登入");
  },
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
    });
    return unsub;
  }, []);

  useEffect(() => {
    if (!user) {
      setProfile(null);
      setProfileLoading(false);
      return;
    }
    let cancelled = false;
    setProfileLoading(true);
    void ensureUserProfile(user).catch((e) => console.warn("[ensureUserProfile]", e));
    const unsub = listenUserProfile(user.uid, (p) => {
      if (cancelled) return;
      setProfile(p);
      setProfileLoading(false);
    });
    return () => {
      cancelled = true;
      unsub();
    };
  }, [user]);

  const saveProfile = useCallback(
    async (input: SaveProfileInput) => {
      if (!user) throw new Error("未登入");
      const next = await saveUserProfile(user, input);
      setProfile(next);
      return next;
    },
    [user]
  );

  const uploadAvatarFile = useCallback(
    async (file: File, onProgress?: (pct: number) => void) => {
      if (!user) throw new Error("未登入");
      return uploadAvatar(user.uid, file, onProgress);
    },
    [user]
  );

  const displayName = useMemo(() => resolveDisplayName(profile, user), [profile, user]);
  const username = useMemo(() => resolveUsername(profile), [profile]);
  const photoURL = useMemo(() => resolvePhotoURL(profile, user), [profile, user]);

  const value = useMemo<AuthCtx>(
    () => ({
      user,
      loading,
      profile,
      profileLoading,
      displayName,
      username,
      photoURL,
      saveProfile,
      uploadAvatarFile,
    }),
    [
      user,
      loading,
      profile,
      profileLoading,
      displayName,
      username,
      photoURL,
      saveProfile,
      uploadAvatarFile,
    ]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
