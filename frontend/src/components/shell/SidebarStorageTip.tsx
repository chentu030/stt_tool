"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import StorageManagerDialog from "@/components/shell/StorageManagerDialog";
import {
  formatBytes,
  listenStorageQuota,
  storageUsageRatio,
  USER_STORAGE_LIMIT_BYTES,
  type StorageQuota,
} from "@/lib/storageQuota";

const STORAGE_TIP =
  "測試階段請自行備份重要資料；不要把重要檔案只放在這裡。遇到問題可寫信 support@albireus.com。";

export default function SidebarStorageTip({ collapsed = false }: { collapsed?: boolean }) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
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
    <>
      <button
        type="button"
        className={`sidebar-storage-tip${warn ? " is-warn" : ""}${full ? " is-full" : ""}`}
        onClick={() => setOpen(true)}
        title="查看並管理上傳檔案"
        aria-label="查看並管理儲存空間"
      >
        <div className="sidebar-storage-tip-head">
          <span className="sidebar-storage-tip-title">
            <strong>儲存空間</strong>
            <span
              className="sidebar-storage-info"
              tabIndex={0}
              aria-label={STORAGE_TIP}
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => e.stopPropagation()}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden>
                <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
                <path
                  d="M12 10.5v5.5"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
                <circle cx="12" cy="7.25" r="1.1" fill="currentColor" />
              </svg>
              <span className="sidebar-storage-info-pop" role="tooltip">
                {STORAGE_TIP}
              </span>
            </span>
          </span>
          <span>
            {formatBytes(quota.usedBytes)} / {formatBytes(quota.limitBytes)}
          </span>
        </div>
        <div className="sidebar-storage-bar" aria-hidden>
          <i style={{ width: `${Math.max(2, Math.round(ratio * 100))}%` }} />
        </div>
      </button>
      <StorageManagerDialog uid={user.uid} open={open} onClose={() => setOpen(false)} />
    </>
  );
}
