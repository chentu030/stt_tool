"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import {
  formatBytes,
  listenStorageQuota,
  storageUsageRatio,
  USER_STORAGE_LIMIT_BYTES,
  type StorageQuota,
} from "@/lib/storageQuota";

export default function SidebarStorageTip({ collapsed = false }: { collapsed?: boolean }) {
  const { user } = useAuth();
  const [quota, setQuota] = useState<StorageQuota>({
    usedBytes: 0,
    limitBytes: USER_STORAGE_LIMIT_BYTES,
    updatedAt: 0,
  });

  useEffect(() => {
    if (!user) {
      setQuota({ usedBytes: 0, limitBytes: USER_STORAGE_LIMIT_BYTES, updatedAt: 0 });
      return;
    }
    return listenStorageQuota(user.uid, setQuota);
  }, [user]);

  if (collapsed || !user) return null;

  const ratio = storageUsageRatio(quota.usedBytes, quota.limitBytes);
  const warn = ratio >= 0.8;
  const full = ratio >= 0.95;

  return (
    <div className={`sidebar-storage-tip${warn ? " is-warn" : ""}${full ? " is-full" : ""}`}>
      <div className="sidebar-storage-tip-head">
        <strong>儲存空間</strong>
        <span>
          {formatBytes(quota.usedBytes)} / {formatBytes(quota.limitBytes)}
        </span>
      </div>
      <div className="sidebar-storage-bar" aria-hidden>
        <i style={{ width: `${Math.max(2, Math.round(ratio * 100))}%` }} />
      </div>
      <p className="sidebar-storage-tip-note">
        測試階段請自行備份重要資料；不要把重要檔案只放在這裡。遇到問題可寫信
        support@albireus.com。
      </p>
    </div>
  );
}
