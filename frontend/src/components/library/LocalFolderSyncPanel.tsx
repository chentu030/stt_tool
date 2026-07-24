"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "@/lib/toast";
import { askConfirm } from "@/lib/dialogs";
import type { Note } from "@/lib/firebase";
import {
  formatBridgeTime,
  getBridgeCapability,
  getLinkedFolderMeta,
  linkLocalFolder,
  pullFromLocalFolder,
  pushToLocalFolder,
  unlinkLocalFolder,
  type LocalFolderLinkMeta,
} from "@/lib/localFolderBridge";

type Props = {
  uid: string;
  notes: Note[];
  /** Compact row for settings; default is panel for knowledge base */
  variant?: "panel" | "settings";
  /** Limit push to these note ids (e.g. library selection) */
  selectedNoteIds?: string[];
};

export default function LocalFolderSyncPanel({
  uid,
  notes,
  variant = "panel",
  selectedNoteIds,
}: Props) {
  const cap = getBridgeCapability();
  const [meta, setMeta] = useState<LocalFolderLinkMeta | null>(null);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const m = await getLinkedFolderMeta(uid);
      setMeta(m);
    } catch {
      setMeta(null);
    } finally {
      setReady(true);
    }
  }, [uid]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const onLink = async () => {
    if (!cap.supported) {
      toast(cap.reason || "不支援本機資料夾");
      return;
    }
    setBusy(true);
    try {
      const m = await linkLocalFolder(uid);
      setMeta(m);
      toast(`已連結本機資料夾「${m.folderName}」`);
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      toast(e instanceof Error ? e.message : "連結失敗");
    } finally {
      setBusy(false);
    }
  };

  const onUnlink = async () => {
    const ok = await askConfirm({
      title: "解除本機資料夾",
      message: "僅解除瀏覽器連結，不會刪除本機或雲端筆記。",
      confirmLabel: "解除",
    });
    if (!ok) return;
    setBusy(true);
    try {
      await unlinkLocalFolder(uid);
      setMeta(null);
      toast("已解除本機資料夾連結");
    } catch (e) {
      toast(e instanceof Error ? e.message : "解除失敗");
    } finally {
      setBusy(false);
    }
  };

  const onPull = async () => {
    setBusy(true);
    try {
      const r = await pullFromLocalFolder(uid, notes);
      await refresh();
      const skip = r.skipped.length ? `，略過 ${r.skipped.length}` : "";
      const att = r.attachments ? `、附件 ${r.attachments}` : "";
      toast(`知識庫同步：新增 ${r.created}、更新 ${r.updated}${att}${skip}`);
    } catch (e) {
      toast(e instanceof Error ? e.message : "拉入失敗");
    } finally {
      setBusy(false);
    }
  };

  const onPush = async () => {
    setBusy(true);
    try {
      const ids =
        selectedNoteIds && selectedNoteIds.length
          ? selectedNoteIds
          : undefined;
      const r = await pushToLocalFolder(uid, notes, { noteIds: ids });
      await refresh();
      const scope = ids ? `選取 ${ids.length} 篇` : "全部筆記";
      const skip = r.skipped.length ? `，略過 ${r.skipped.length}` : "";
      const att = r.attachments ? `、附件 ${r.attachments}` : "";
      toast(`已匯出到本機（${scope}）：${r.written} 篇${att}${skip}`);
    } catch (e) {
      toast(e instanceof Error ? e.message : "匯出失敗");
    } finally {
      setBusy(false);
    }
  };

  if (!ready) return null;

  const linked = Boolean(meta);
  const statusLine = !cap.supported
    ? cap.reason
    : linked
      ? `已連結「${meta!.folderName}」· 拉入 ${formatBridgeTime(meta!.lastPullAt)} · 匯出 ${formatBridgeTime(meta!.lastPushAt)}`
      : "尚未連結本機資料夾";

  if (variant === "settings") {
    return (
      <div className="lfs-settings">
        <p className="lfs-status">{statusLine}</p>
        <div className="lfs-actions">
          {!linked ? (
            <button
              type="button"
              className="btn btn-sm"
              disabled={busy || !cap.supported}
              onClick={() => void onLink()}
            >
              連結本機資料夾
            </button>
          ) : (
            <>
              <button
                type="button"
                className="btn btn-sm"
                disabled={busy}
                onClick={() => void onPull()}
              >
                從本機拉入
              </button>
              <button
                type="button"
                className="btn btn-sm"
                disabled={busy}
                onClick={() => void onPush()}
              >
                匯出到本機
              </button>
              <button
                type="button"
                className="btn btn-sm btn-ghost"
                disabled={busy}
                onClick={() => void onUnlink()}
              >
                解除連結
              </button>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <aside className="lfs-panel" aria-label="本機資料夾同步">
      <div className="lfs-panel-head">
        <strong>本機資料夾</strong>
        <span className="lfs-panel-hint">知識庫同步</span>
      </div>
      <p className="lfs-status">{statusLine}</p>
      <div className="lfs-actions">
        {!linked ? (
          <button
            type="button"
            className="btn btn-sm"
            disabled={busy || !cap.supported}
            onClick={() => void onLink()}
          >
            {busy ? "處理中…" : "連結本機資料夾"}
          </button>
        ) : (
          <>
            <button
              type="button"
              className="btn btn-sm"
              disabled={busy}
              title="以本機 Markdown 更新／新增雲端筆記"
              onClick={() => void onPull()}
            >
              從本機拉入
            </button>
            <button
              type="button"
              className="btn btn-sm"
              disabled={busy}
              title={
                selectedNoteIds?.length
                  ? `匯出選取的 ${selectedNoteIds.length} 篇`
                  : "將雲端筆記寫入本機（含 cadence_id）"
              }
              onClick={() => void onPush()}
            >
              {selectedNoteIds?.length
                ? `匯出選取（${selectedNoteIds.length}）`
                : "匯出到本機"}
            </button>
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              disabled={busy}
              onClick={() => void onLink()}
              title="改選其他資料夾"
            >
              重新連結
            </button>
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              disabled={busy}
              onClick={() => void onUnlink()}
            >
              解除
            </button>
          </>
        )}
      </div>
    </aside>
  );
}
