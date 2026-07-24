/** Permission labels + trust scorecard helpers */

import type { CommunityManifest, PackagePermission } from "@/lib/community/types";

export const PERMISSION_META: Record<
  PackagePermission,
  { label: string; risk: "low" | "medium" | "high"; hint: string }
> = {
  network: {
    label: "網路連線",
    risk: "medium",
    hint: "可向外部伺服器發送請求（iframe 內）",
  },
  iframe: {
    label: "嵌入網頁",
    risk: "medium",
    hint: "以沙箱 iframe 載入第三方 https 頁面",
  },
  clipboard: {
    label: "剪貼簿",
    risk: "low",
    hint: "可讀寫剪貼簿（需瀏覽器授權）",
  },
  storage: {
    label: "本機設定",
    risk: "low",
    hint: "可儲存擴充設定於你的帳號",
  },
  notes_read: {
    label: "讀取知識庫",
    risk: "high",
    hint: "可透過擴充 RPC 讀取你的筆記內容",
  },
  notes_write: {
    label: "寫入知識庫",
    risk: "high",
    hint: "可建立、修改筆記或附加媒體（模板套用或擴充 RPC）",
  },
  settings: {
    label: "自訂設定",
    risk: "low",
    hint: "提供可調整的選項面板",
  },
};

const ALLOWED: PackagePermission[] = [
  "network",
  "iframe",
  "clipboard",
  "storage",
  "notes_read",
  "notes_write",
  "settings",
];

export function parsePermissions(raw: unknown): PackagePermission[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  const out: PackagePermission[] = [];
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const p = item.trim() as PackagePermission;
    if (ALLOWED.includes(p) && !out.includes(p)) out.push(p);
  }
  return out.length ? out.slice(0, 12) : undefined;
}

/** Infer permissions when author omitted them (transparent defaults). */
export function effectivePermissions(manifest: CommunityManifest): PackagePermission[] {
  if (manifest.permissions?.length) return manifest.permissions;
  if (manifest.kind === "extension") {
    const list: PackagePermission[] = ["iframe", "network"];
    if (manifest.settings?.length) list.push("settings", "storage");
    return list;
  }
  return ["notes_write"];
}

export function trustScore(manifest: CommunityManifest): {
  level: "trusted" | "caution" | "review";
  label: string;
  summary: string;
} {
  const perms = effectivePermissions(manifest);
  const high = perms.filter((p) => PERMISSION_META[p].risk === "high").length;
  const medium = perms.filter((p) => PERMISSION_META[p].risk === "medium").length;
  const sandboxed = manifest.kind === "extension"; // iframe only, no remote JS eval
  if (sandboxed && high === 0 && medium <= 2) {
    return {
      level: "trusted",
      label: "沙箱執行",
      summary: "擴充以沙箱 iframe 載入，主程式不執行遠端腳本。",
    };
  }
  if (manifest.kind === "template") {
    return {
      level: "caution",
      label: "會寫入筆記",
      summary: "模板會在你的知識庫建立新頁面，請先預覽內容。",
    };
  }
  if (high > 0) {
    return {
      level: "review",
      label: "請先檢視權限",
      summary: "此套件宣告較高權限，安裝前請確認作者與說明。",
    };
  }
  return {
    level: "caution",
    label: "需網路存取",
    summary: "套件可連線外部網站，請確認入口網址可信。",
  };
}
