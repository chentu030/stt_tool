"use client";

import { useEffect, useState } from "react";
import type { ExtensionManifest, InstalledExtension } from "@/lib/community/types";
import {
  coerceSettingValue,
  mergeExtensionSettings,
} from "@/lib/community/extensionSettings";
import { saveExtensionSettings } from "@/lib/community/store";
import { toast } from "@/lib/toast";

type Props = {
  uid: string;
  ext: InstalledExtension;
};

export default function ExtensionSettingsPanel({ uid, ext }: Props) {
  const defs = ext.manifest.settings || [];
  const [draft, setDraft] = useState(() => mergeExtensionSettings(ext.manifest, ext.settings));
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setDraft(mergeExtensionSettings(ext.manifest, ext.settings));
  }, [ext.id, ext.settings, ext.manifest]);

  if (defs.length === 0) return null;

  const update = (key: string, value: string | boolean | number) => {
    setDraft((d) => ({ ...d, [key]: value }));
  };

  const save = async () => {
    setBusy(true);
    try {
      const next: Record<string, string | boolean | number> = {};
      for (const def of defs) {
        next[def.key] = coerceSettingValue(def, draft[def.key] ?? def.default ?? "");
      }
      await saveExtensionSettings(uid, ext.id, next);
      toast("設定已儲存");
    } catch (e) {
      toast(e instanceof Error ? e.message : "儲存失敗");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="community-ext-settings">
      <h2>擴充設定</h2>
      <p className="page-sub">設定會以 query 與 postMessage 傳給沙箱頁面。</p>
      <div className="community-ext-settings-grid">
        {defs.map((def) => (
          <label key={def.key} className="community-ext-setting-field">
            <span>{def.label}</span>
            {def.description && <small>{def.description}</small>}
            {def.type === "boolean" ? (
              <input
                type="checkbox"
                checked={Boolean(draft[def.key])}
                onChange={(e) => update(def.key, e.target.checked)}
              />
            ) : def.type === "enum" && def.options ? (
              <select
                value={String(draft[def.key] ?? "")}
                onChange={(e) => update(def.key, e.target.value)}
              >
                {def.options.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            ) : def.type === "number" ? (
              <input
                type="number"
                value={String(draft[def.key] ?? "")}
                onChange={(e) => update(def.key, e.target.value === "" ? 0 : Number(e.target.value))}
              />
            ) : (
              <input
                type="text"
                value={String(draft[def.key] ?? "")}
                onChange={(e) => update(def.key, e.target.value)}
              />
            )}
          </label>
        ))}
      </div>
      <button type="button" className="btn" disabled={busy} onClick={() => void save()}>
        {busy ? "儲存中…" : "儲存設定"}
      </button>
    </section>
  );
}

export function hasExtensionSettings(manifest: ExtensionManifest) {
  return (manifest.settings || []).length > 0;
}
