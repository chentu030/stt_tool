"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useAuth } from "@/components/AuthProvider";
import {
  listenInstalledExtensions,
  listenInstalledTemplates,
} from "@/lib/community/store";
import type { InstalledExtension, InstalledTemplate } from "@/lib/community/types";
import { isCommunitySafeMode } from "@/lib/community/libraryPrefs";
import { ensureDefaultExtensions } from "@/lib/community/actions";

type Ctx = {
  extensions: InstalledExtension[];
  templates: InstalledTemplate[];
  enabledExtensions: InstalledExtension[];
  enabledTemplates: InstalledTemplate[];
  ready: boolean;
  safeMode: boolean;
  refreshSafeMode: () => void;
};

const CommunityCtx = createContext<Ctx | null>(null);

export function CommunityProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [extensions, setExtensions] = useState<InstalledExtension[]>([]);
  const [templates, setTemplates] = useState<InstalledTemplate[]>([]);
  const [ready, setReady] = useState(false);
  const [safeMode, setSafeMode] = useState(false);

  const refreshSafeMode = () => setSafeMode(isCommunitySafeMode());

  useEffect(() => {
    refreshSafeMode();
  }, []);

  useEffect(() => {
    if (!user) {
      setExtensions([]);
      setTemplates([]);
      setReady(true);
      return;
    }
    setReady(false);
    let n = 0;
    let latestExt: InstalledExtension[] = [];
    let seededOnce = false;
    const mark = () => {
      n += 1;
      if (n < 2) return;
      setReady(true);
      if (seededOnce) return;
      seededOnce = true;
      void ensureDefaultExtensions(user.uid, latestExt).catch(() => {
        /* ignore seed failures; retry next login */
      });
    };
    const u1 = listenInstalledExtensions(
      user.uid,
      (list) => {
        latestExt = list;
        setExtensions(list);
        mark();
      },
      () => mark()
    );
    const u2 = listenInstalledTemplates(
      user.uid,
      (list) => {
        setTemplates(list);
        mark();
      },
      () => mark()
    );
    return () => {
      u1();
      u2();
    };
  }, [user]);

  const value = useMemo<Ctx>(() => {
    const enabledExtensions = safeMode
      ? []
      : extensions.filter((e) => e.enabled);
    const enabledTemplates = templates.filter((t) => t.enabled);
    return {
      extensions,
      templates,
      enabledExtensions,
      enabledTemplates,
      ready,
      safeMode,
      refreshSafeMode,
    };
  }, [extensions, templates, ready, safeMode]);

  return <CommunityCtx.Provider value={value}>{children}</CommunityCtx.Provider>;
}

export function useCommunity() {
  const ctx = useContext(CommunityCtx);
  if (!ctx) throw new Error("useCommunity requires CommunityProvider");
  return ctx;
}

export function useCommunityOptional() {
  return useContext(CommunityCtx);
}
