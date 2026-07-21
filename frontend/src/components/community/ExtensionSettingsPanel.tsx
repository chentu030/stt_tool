"use client";

import { useEffect, useMemo, useState } from "react";
import type { ExtensionManifest, ExtensionSettingDef, InstalledExtension } from "@/lib/community/types";
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

function groupSettings(defs: ExtensionSettingDef[]) {
  const order: string[] = [];
  const map = new Map<string, ExtensionSettingDef[]>();
  for (const def of defs) {
    const g = def.group?.trim() || "一般";
    if (!map.has(g)) {
      map.set(g, []);
      order.push(g);
    }
    map.get(g)!.push(def);
  }
  return order.map((name) => ({ name, defs: map.get(name)! }));
}

function SettingField({
  def,
  value,
  onChange,
}: {
  def: ExtensionSettingDef;
  value: string | boolean | number;
  onChange: (v: string | boolean | number) => void;
}) {
  const [reveal, setReveal] = useState(false);
  const inputType =
    def.secret && !reveal ? "password" : def.type === "number" ? "number" : "text";

  if (def.type === "boolean") {
    return (
      <label className="ext-setting-row ext-setting-row--toggle">
        <span className="ext-setting-copy">
          <strong>{def.label}</strong>
          {def.description ? <small>{def.description}</small> : null}
        </span>
        <button
          type="button"
          role="switch"
          className={`ext-setting-switch${value ? " is-on" : ""}`}
          aria-checked={Boolean(value)}
          onClick={() => onChange(!value)}
        >
          <span className="ext-setting-switch-knob" />
        </button>
      </label>
    );
  }

  return (
    <label className={`ext-setting-row${def.wide ? " is-wide" : ""}`}>
      <span className="ext-setting-copy">
        <strong>{def.label}</strong>
        {def.description ? <small>{def.description}</small> : null}
      </span>
      <span className="ext-setting-control">
        {def.type === "enum" && def.options ? (
          <select
            className="ext-setting-input"
            value={String(value ?? "")}
            onChange={(e) => onChange(e.target.value)}
          >
            {def.options.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        ) : (
          <>
            <input
              className="ext-setting-input"
              type={inputType}
              value={String(value ?? "")}
              autoComplete={def.secret ? "off" : undefined}
              spellCheck={false}
              onChange={(e) =>
                onChange(
                  def.type === "number"
                    ? e.target.value === ""
                      ? 0
                      : Number(e.target.value)
                    : e.target.value
                )
              }
            />
            {def.secret ? (
              <button
                type="button"
                className="ext-setting-reveal"
                onClick={() => setReveal((v) => !v)}
              >
                {reveal ? "隱藏" : "顯示"}
              </button>
            ) : null}
          </>
        )}
      </span>
    </label>
  );
}

export default function ExtensionSettingsPanel({ uid, ext }: Props) {
  const defs = ext.manifest.settings || [];
  const [draft, setDraft] = useState(() => mergeExtensionSettings(ext.manifest, ext.settings));
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const groups = useMemo(() => groupSettings(defs), [defs]);

  useEffect(() => {
    setDraft(mergeExtensionSettings(ext.manifest, ext.settings));
    setDirty(false);
  }, [ext.id, ext.settings, ext.manifest]);

  if (defs.length === 0) return null;

  const update = (key: string, value: string | boolean | number) => {
    setDraft((d) => ({ ...d, [key]: value }));
    setDirty(true);
  };

  const save = async () => {
    setBusy(true);
    try {
      const next: Record<string, string | boolean | number> = {};
      for (const def of defs) {
        next[def.key] = coerceSettingValue(def, draft[def.key] ?? def.default ?? "");
      }
      await saveExtensionSettings(uid, ext.id, next);
      setDirty(false);
      toast("設定已儲存");
    } catch (e) {
      toast(e instanceof Error ? e.message : "儲存失敗");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="ext-settings">
      <header className="ext-settings-head">
        <div>
          <h2>擴充設定</h2>
          <p>變更會套用到之後開啟的沙箱頁面（query／postMessage）。</p>
        </div>
        <button
          type="button"
          className="btn"
          disabled={busy || !dirty}
          onClick={() => void save()}
        >
          {busy ? "儲存中…" : dirty ? "儲存設定" : "已儲存"}
        </button>
      </header>

      <div className="ext-settings-groups">
        {groups.map((g) => (
          <div key={g.name} className="ext-settings-group">
            <h3>{g.name}</h3>
            <div className="ext-settings-fields">
              {g.defs.map((def) => (
                <SettingField
                  key={def.key}
                  def={def}
                  value={draft[def.key] ?? def.default ?? ""}
                  onChange={(v) => update(def.key, v)}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

export function hasExtensionSettings(manifest: ExtensionManifest) {
  return (manifest.settings || []).length > 0;
}
