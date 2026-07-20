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

type Ctx = {
  extensions: InstalledExtension[];
  templates: InstalledTemplate[];
  enabledExtensions: InstalledExtension[];
  enabledTemplates: InstalledTemplate[];
  ready: boolean;
};

const CommunityCtx = createContext<Ctx | null>(null);

export function CommunityProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [extensions, setExtensions] = useState<InstalledExtension[]>([]);
  const [templates, setTemplates] = useState<InstalledTemplate[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!user) {
      setExtensions([]);
      setTemplates([]);
      setReady(true);
      return;
    }
    setReady(false);
    let n = 0;
    const mark = () => {
      n += 1;
      if (n >= 2) setReady(true);
    };
    const u1 = listenInstalledExtensions(
      user.uid,
      (list) => {
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
    const enabledExtensions = extensions.filter((e) => e.enabled);
    const enabledTemplates = templates.filter((t) => t.enabled);
    return { extensions, templates, enabledExtensions, enabledTemplates, ready };
  }, [extensions, templates, ready]);

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
