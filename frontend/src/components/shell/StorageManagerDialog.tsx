"use client";

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { askConfirm } from "@/lib/dialogs";
import { toast } from "@/lib/toast";
import {
  deleteUserUploadFile,
  formatBytes,
  listUserUploadFiles,
  syncStorageQuotaFromFiles,
  USER_STORAGE_LIMIT_BYTES,
  type UserStorageFile,
} from "@/lib/storageQuota";

type Props = {
  uid: string;
  open: boolean;
  onClose: () => void;
};

export default function StorageManagerDialog({ uid, open, onClose }: Props) {
  const [mounted, setMounted] = useState(false);
  const [files, setFiles] = useState<UserStorageFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [deletingPath, setDeletingPath] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    setMounted(true);
  }, []);

  const load = useCallback(async () => {
    if (!uid) return;
    setLoading(true);
    setError("");
    try {
      const listed = await listUserUploadFiles(uid);
      setFiles(listed);
      await syncStorageQuotaFromFiles(uid, listed);
    } catch (e) {
      setError(e instanceof Error ? e.message : "無法讀取檔案清單");
    } finally {
      setLoading(false);
    }
  }, [uid]);

  useEffect(() => {
    if (!open) return;
    void load();
  }, [open, load]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open || !mounted) return null;

  const listedBytes = files.reduce((sum, f) => sum + f.size, 0);

  const removeOne = async (file: UserStorageFile) => {
    if (deletingPath) return;
    const ok = await askConfirm({
      title: "刪除此檔案？",
      message: `${file.name}（${formatBytes(file.size)}）刪除後無法復原，相關筆記或任務裡的連結可能失效。`,
      confirmLabel: "刪除",
      cancelLabel: "取消",
      danger: true,
    });
    if (!ok) return;
    setDeletingPath(file.path);
    try {
      await deleteUserUploadFile(uid, file.path, file.size);
      setFiles((prev) => prev.filter((f) => f.path !== file.path));
      toast(`已刪除 ${file.name}`);
    } catch (e) {
      toast(e instanceof Error ? e.message : "刪除失敗");
    } finally {
      setDeletingPath(null);
    }
  };

  return createPortal(
    <div
      className="cadence-dialog-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="cadence-dialog storage-manager-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="storage-manager-title"
      >
        <h2 id="storage-manager-title" className="cadence-dialog-title">
          儲存空間
        </h2>
        <p className="cadence-dialog-msg">
          已用 {formatBytes(listedBytes)} / {formatBytes(USER_STORAGE_LIMIT_BYTES)}
          {files.length > 0 ? ` · ${files.length} 個檔案` : ""}
        </p>

        {loading ? (
          <p className="storage-manager-empty">讀取中…</p>
        ) : error ? (
          <p className="storage-manager-empty storage-manager-error">{error}</p>
        ) : files.length === 0 ? (
          <p className="storage-manager-empty">目前沒有上傳檔案。</p>
        ) : (
          <ul className="storage-manager-list">
            {files.map((f) => (
              <li key={f.path} className="storage-manager-row">
                <div className="storage-manager-meta">
                  <strong className="storage-manager-name" title={f.path}>
                    {f.name}
                  </strong>
                  <span className="storage-manager-sub">
                    {f.category}
                    <span aria-hidden> · </span>
                    {formatBytes(f.size)}
                  </span>
                </div>
                <button
                  type="button"
                  className="btn btn-sm btn-ghost storage-manager-del"
                  disabled={deletingPath === f.path}
                  onClick={() => void removeOne(f)}
                >
                  {deletingPath === f.path ? "刪除中…" : "刪除"}
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="cadence-dialog-actions">
          <button type="button" className="btn btn-ghost btn-sm" disabled={loading} onClick={() => void load()}>
            重新整理
          </button>
          <button type="button" className="btn btn-sm" onClick={onClose}>
            關閉
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
