"use client";

import { useEffect, useId, useState } from "react";
import {
  deleteScheduleEvent,
  formatClock,
  snapMin,
  updateScheduleEvent,
  type ScheduleEvent,
} from "@/lib/scheduleEvents";
import { toast } from "@/lib/toast";

type Props = {
  uid: string;
  event: ScheduleEvent;
  onClose: () => void;
  onSaved?: () => void;
  onDeleted?: () => void;
};

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function splitMin(min: number) {
  const m = Math.max(0, Math.min(24 * 60 - 1, min));
  return { h: Math.floor(m / 60), m: m % 60 };
}

function parseHm(h: string, m: string) {
  const hh = Math.max(0, Math.min(23, Number(h) || 0));
  const mm = Math.max(0, Math.min(59, Number(m) || 0));
  return snapMin(hh * 60 + mm);
}

export default function ScheduleEventEditDialog({
  uid,
  event,
  onClose,
  onSaved,
  onDeleted,
}: Props) {
  const titleId = useId();
  const readonly = event.provider !== "local";
  const start0 = splitMin(event.startMin);
  const end0 = splitMin(event.endMin >= 24 * 60 ? 24 * 60 - 1 : event.endMin);
  const [title, setTitle] = useState(event.title);
  const [dateKey, setDateKey] = useState(event.dateKey);
  const [allDay, setAllDay] = useState(Boolean(event.allDay));
  const [startH, setStartH] = useState(String(start0.h));
  const [startM, setStartM] = useState(pad2(start0.m));
  const [endH, setEndH] = useState(String(end0.h));
  const [endM, setEndM] = useState(pad2(end0.m));
  const [conferenceUrl, setConferenceUrl] = useState(event.conferenceUrl || "");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const save = async () => {
    if (readonly || busy) return;
    setBusy(true);
    try {
      const url = conferenceUrl.trim();
      if (url && !/^https:\/\//i.test(url)) {
        toast("會議連結請用 https:// 開頭");
        return;
      }
      let startMin = 0;
      let endMin = 24 * 60;
      if (!allDay) {
        startMin = parseHm(startH, startM);
        endMin = parseHm(endH, endM);
        if (endMin <= startMin) endMin = Math.min(24 * 60, startMin + 30);
      }
      await updateScheduleEvent(uid, event.id, {
        title: title.trim() || "未命名",
        dateKey: dateKey.trim() || event.dateKey,
        allDay,
        startMin,
        endMin,
        conferenceUrl: url || undefined,
      });
      toast("已更新行程");
      onSaved?.();
      onClose();
    } catch (e) {
      toast(e instanceof Error ? e.message : "更新失敗");
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (readonly || busy) return;
    setBusy(true);
    try {
      await deleteScheduleEvent(uid, event.id);
      toast("已刪除行程");
      onDeleted?.();
      onClose();
    } catch (e) {
      toast(e instanceof Error ? e.message : "刪除失敗");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="jn-ev-dialog-backdrop" role="presentation" onClick={onClose}>
      <div
        className="jn-ev-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="jn-ev-dialog-head">
          <h3 id={titleId}>{readonly ? "行程詳情" : "編輯行程"}</h3>
          <button type="button" className="jn-icon-btn" onClick={onClose} aria-label="關閉">
            ×
          </button>
        </header>

        {readonly && (
          <p className="jn-muted" style={{ marginTop: 0 }}>
            Google 同步行程為唯讀。可改在日曆來源端修改。
          </p>
        )}

        <label className="jn-ev-field">
          <span>名稱</span>
          <input
            className="input"
            value={title}
            disabled={readonly || busy}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>

        <label className="jn-ev-field">
          <span>日期</span>
          <input
            className="input"
            type="date"
            value={dateKey}
            disabled={readonly || busy}
            onChange={(e) => setDateKey(e.target.value)}
          />
        </label>

        <label className="jn-ev-check">
          <input
            type="checkbox"
            checked={allDay}
            disabled={readonly || busy}
            onChange={(e) => setAllDay(e.target.checked)}
          />
          <span>全天</span>
        </label>

        {!allDay && (
          <div className="jn-ev-time-row">
            <label className="jn-ev-field">
              <span>開始</span>
              <div className="jn-ev-hm">
                <input
                  className="input"
                  inputMode="numeric"
                  value={startH}
                  disabled={readonly || busy}
                  onChange={(e) => setStartH(e.target.value.replace(/\D/g, "").slice(0, 2))}
                  aria-label="開始時"
                />
                <span>:</span>
                <input
                  className="input"
                  inputMode="numeric"
                  value={startM}
                  disabled={readonly || busy}
                  onChange={(e) => setStartM(e.target.value.replace(/\D/g, "").slice(0, 2))}
                  aria-label="開始分"
                />
              </div>
            </label>
            <label className="jn-ev-field">
              <span>結束</span>
              <div className="jn-ev-hm">
                <input
                  className="input"
                  inputMode="numeric"
                  value={endH}
                  disabled={readonly || busy}
                  onChange={(e) => setEndH(e.target.value.replace(/\D/g, "").slice(0, 2))}
                  aria-label="結束時"
                />
                <span>:</span>
                <input
                  className="input"
                  inputMode="numeric"
                  value={endM}
                  disabled={readonly || busy}
                  onChange={(e) => setEndM(e.target.value.replace(/\D/g, "").slice(0, 2))}
                  aria-label="結束分"
                />
              </div>
            </label>
          </div>
        )}

        <label className="jn-ev-field">
          <span>會議連結</span>
          <input
            className="input"
            placeholder="https://…"
            value={conferenceUrl}
            disabled={readonly || busy}
            onChange={(e) => setConferenceUrl(e.target.value)}
          />
        </label>

        <p className="jn-muted" style={{ fontSize: "0.72rem" }}>
          目前：{event.dateKey} ·{" "}
          {event.allDay ? "全天" : `${formatClock(event.startMin)}–${formatClock(event.endMin)}`}
          {event.provider === "google" ? " · Google" : ""}
        </p>

        <footer className="jn-ev-dialog-foot">
          {!readonly && (
            <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => void remove()}>
              刪除
            </button>
          )}
          <div className="jn-ev-dialog-foot-right">
            <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={onClose}>
              {readonly ? "關閉" : "取消"}
            </button>
            {!readonly && (
              <button type="button" className="btn btn-sm" disabled={busy} onClick={() => void save()}>
                儲存
              </button>
            )}
          </div>
        </footer>
      </div>
    </div>
  );
}
