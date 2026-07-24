"use client";

import { useEffect, useState } from "react";
import {
  WORKSPACE_SYSTEM_IDS,
  archiveWorkspacePropertyDef,
  createCustomWorkspaceDef,
  ensureWorkspacePropertyDefs,
  listenWorkspacePropertyDefs,
  upsertWorkspacePropertyDef,
  type WorkspacePropertyDef,
} from "@/lib/workspaceProperties";
import { askConfirm, askPrompt } from "@/lib/dialogs";
import { toast } from "@/lib/toast";
import type { DbPropType } from "@/lib/database";

type Props = { userId: string };

/** Settings section: manage workspace property catalog. */
export default function WorkspacePropertiesSettings({ userId }: Props) {
  const [defs, setDefs] = useState<WorkspacePropertyDef[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let unsub: (() => void) | undefined;
    void ensureWorkspacePropertyDefs(userId)
      .then(() => {
        unsub = listenWorkspacePropertyDefs(userId, setDefs);
      })
      .catch((e) => toast(e instanceof Error ? e.message : "無法載入工作區屬性"));
    return () => unsub?.();
  }, [userId]);

  const rename = async (def: WorkspacePropertyDef) => {
    const next = await askPrompt({
      title: "重新命名屬性",
      message: def.systemKey ? "系統屬性可改顯示名稱" : "屬性名稱",
      defaultValue: def.name,
    });
    if (next == null || !next.trim() || next.trim() === def.name) return;
    setBusy(true);
    try {
      await upsertWorkspacePropertyDef(userId, { ...def, name: next.trim() });
      toast("已更新名稱");
    } catch (e) {
      toast(e instanceof Error ? e.message : "更新失敗");
    } finally {
      setBusy(false);
    }
  };

  const addDef = async () => {
    const name = await askPrompt({
      title: "新增工作區屬性",
      message: "名稱",
      placeholder: "例如：客戶",
    });
    if (name == null || !name.trim()) return;
    const typeRaw = await askPrompt({
      title: "類型",
      message: "text / select / status / date / number / checkbox",
      defaultValue: "text",
    });
    if (typeRaw == null) return;
    const type = (typeRaw.trim() || "text") as DbPropType;
    setBusy(true);
    try {
      await upsertWorkspacePropertyDef(userId, createCustomWorkspaceDef(name.trim(), type));
      toast("已新增");
    } catch (e) {
      toast(e instanceof Error ? e.message : "新增失敗");
    } finally {
      setBusy(false);
    }
  };

  const archive = async (def: WorkspacePropertyDef) => {
    if ((WORKSPACE_SYSTEM_IDS as readonly string[]).includes(def.id)) {
      toast("系統屬性不可封存");
      return;
    }
    const ok = await askConfirm({
      title: "封存屬性",
      message: `封存「${def.name}」？既有筆記值會保留，新增時不再列出。`,
      confirmLabel: "封存",
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      await archiveWorkspacePropertyDef(userId, def.id);
      toast("已封存");
    } catch (e) {
      toast(e instanceof Error ? e.message : "封存失敗");
    } finally {
      setBusy(false);
    }
  };

  const active = defs.filter((d) => !d.archived);

  return (
    <div className="st-block">
      <p className="st-hint">
        類型、狀態、優先級、期限等定義一次，筆記、資料庫欄與看板共用同一套。
      </p>
      <ul className="st-ws-props-list">
        {active.map((d) => (
          <li key={d.id}>
            <div>
              <strong>{d.name}</strong>
              <span>
                {d.type}
                {d.systemKey ? " · 系統" : ""}
              </span>
            </div>
            <div className="st-ws-props-actions">
              <button type="button" disabled={busy} onClick={() => void rename(d)}>
                重新命名
              </button>
              {!(WORKSPACE_SYSTEM_IDS as readonly string[]).includes(d.id) ? (
                <button type="button" disabled={busy} onClick={() => void archive(d)}>
                  封存
                </button>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
      <button type="button" className="st-btn" disabled={busy} onClick={() => void addDef()}>
        + 新增工作區屬性
      </button>
    </div>
  );
}
