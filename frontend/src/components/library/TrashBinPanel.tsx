"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/components/AuthProvider";
import {
  listenToTrashedNotes,
  restoreNote,
  purgeNote,
  type Note,
} from "@/lib/firebase";
import {
  listenTrashedCanvases,
  restoreCanvas,
  purgeCanvas,
  type CanvasMeta,
} from "@/lib/canvasCloud";
import { askConfirm } from "@/lib/dialogs";
import { toast } from "@/lib/toast";

/** Trash bin for soft-deleted notes + whiteboards. */
export default function TrashBinPanel({ variant = "panel" }: { variant?: "panel" | "settings" }) {
  const { user } = useAuth();
  const [notes, setNotes] = useState<Note[]>([]);
  const [canvases, setCanvases] = useState<CanvasMeta[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    if (!user) {
      setNotes([]);
      setCanvases([]);
      return;
    }
    const u1 = listenToTrashedNotes(user.uid, setNotes);
    const u2 = listenTrashedCanvases(user.uid, setCanvases);
    return () => {
      u1();
      u2();
    };
  }, [user]);

  if (!user) return null;

  const empty = notes.length === 0 && canvases.length === 0;

  const restoreN = async (id: string) => {
    setBusyId(id);
    try {
      await restoreNote(id);
      toast("已還原筆記");
    } catch (e) {
      toast(e instanceof Error ? e.message : "還原失敗");
    } finally {
      setBusyId(null);
    }
  };

  const purgeN = async (id: string, title: string) => {
    const ok = await askConfirm({
      title: "永久刪除筆記？",
      message: `「${title || "未命名"}」將無法復原。`,
      danger: true,
      confirmLabel: "永久刪除",
    });
    if (!ok) return;
    setBusyId(id);
    try {
      await purgeNote(id);
      toast("已永久刪除");
    } catch (e) {
      toast(e instanceof Error ? e.message : "刪除失敗");
    } finally {
      setBusyId(null);
    }
  };

  const restoreC = async (id: string) => {
    if (!user) return;
    setBusyId(id);
    try {
      await restoreCanvas(user.uid, id);
      toast("已還原白板");
    } catch (e) {
      toast(e instanceof Error ? e.message : "還原失敗");
    } finally {
      setBusyId(null);
    }
  };

  const purgeC = async (id: string, name: string) => {
    if (!user) return;
    const ok = await askConfirm({
      title: "永久刪除白板？",
      message: `「${name || "未命名白板"}」將無法復原。`,
      danger: true,
      confirmLabel: "永久刪除",
    });
    if (!ok) return;
    setBusyId(id);
    try {
      await purgeCanvas(user.uid, id);
      toast("已永久刪除");
    } catch (e) {
      toast(e instanceof Error ? e.message : "刪除失敗");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className={`trash-bin trash-bin--${variant}`}>
      <div className="trash-bin-head">
        <strong>垃圾桶</strong>
        <span className="trash-bin-meta">
          {empty ? "空的" : `${notes.length + canvases.length} 項`}
        </span>
      </div>
      {empty ? (
        <p className="trash-bin-empty">刪除的筆記與白板會出現在這裡，可還原或永久刪除。</p>
      ) : (
        <ul className="trash-bin-list">
          {notes.map((n) => (
            <li key={`n-${n.id}`} className="trash-bin-row">
              <div className="trash-bin-main">
                <span className="trash-bin-kind">筆記</span>
                <Link href={`/notes/${n.id}`} className="trash-bin-title">
                  {n.title || "未命名"}
                </Link>
                <span className="trash-bin-time">
                  {n.trashed_at?.toLocaleString("zh-TW") || ""}
                </span>
              </div>
              <div className="trash-bin-actions">
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  disabled={busyId === n.id}
                  onClick={() => void restoreN(n.id)}
                >
                  還原
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm is-danger"
                  disabled={busyId === n.id}
                  onClick={() => void purgeN(n.id, n.title)}
                >
                  永久刪除
                </button>
              </div>
            </li>
          ))}
          {canvases.map((c) => (
            <li key={`c-${c.id}`} className="trash-bin-row">
              <div className="trash-bin-main">
                <span className="trash-bin-kind">白板</span>
                <Link href={`/canvas/${c.id}`} className="trash-bin-title">
                  {c.name || "未命名白板"}
                </Link>
                <span className="trash-bin-time">
                  {c.trashed_at?.toLocaleString("zh-TW") || ""}
                </span>
              </div>
              <div className="trash-bin-actions">
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  disabled={busyId === c.id}
                  onClick={() => void restoreC(c.id)}
                >
                  還原
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm is-danger"
                  disabled={busyId === c.id}
                  onClick={() => void purgeC(c.id, c.name)}
                >
                  永久刪除
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
