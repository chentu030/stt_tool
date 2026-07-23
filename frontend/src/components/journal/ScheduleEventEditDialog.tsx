"use client";

import { useEffect, useId, useMemo, useState } from "react";
import {
  createScheduleEvent,
  deleteScheduleEventScoped,
  formatClock,
  recurrenceLabel,
  snapMin,
  updateScheduleEventScoped,
  type ScheduleEvent,
  type ScheduleEventInput,
  type ScheduleRecurrence,
  type ScheduleRecurrenceFreq,
  type SeriesDeleteScope,
  type SeriesEditScope,
} from "@/lib/scheduleEvents";
import { askChoice, askConfirm } from "@/lib/dialogs";
import { toast } from "@/lib/toast";
import { requestScheduleNotificationPermission } from "@/lib/scheduleReminders";
import { shiftDateKey } from "@/lib/journalMeta";
import CadenceDateField from "@/components/CadenceDateField";
import MenuSelect from "@/components/MenuSelect";

type CreateInitial = {
  dateKey: string;
  title?: string;
  allDay?: boolean;
  startMin?: number;
  endMin?: number;
};

type Props = {
  uid: string;
  /** Edit existing; omit / null with `createInitial` for create mode. */
  event?: ScheduleEvent | null;
  createInitial?: CreateInitial;
  onClose: () => void;
  onSaved?: (id: string) => void;
  onDeleted?: () => void;
};

const REMIND_OPTIONS = [
  { value: "", label: "不提醒" },
  { value: "0", label: "開始時" },
  { value: "5", label: "5 分鐘前" },
  { value: "15", label: "15 分鐘前" },
  { value: "30", label: "30 分鐘前" },
  { value: "60", label: "1 小時前" },
  { value: "1440", label: "1 天前" },
] as const;

const FREQ_OPTIONS: { value: ScheduleRecurrenceFreq; label: string }[] = [
  { value: "daily", label: "每天" },
  { value: "weekly", label: "每週" },
  { value: "monthly", label: "每月" },
];

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
  createInitial,
  onClose,
  onSaved,
  onDeleted,
}: Props) {
  const titleId = useId();
  const isCreate = !event;
  const readonly = Boolean(event && event.provider !== "local");

  const seed = useMemo(() => {
    if (event) return event;
    const startMin = createInitial?.startMin ?? 9 * 60;
    const endMin = createInitial?.endMin ?? startMin + 60;
    return {
      id: "",
      dateKey: createInitial?.dateKey || "",
      startMin,
      endMin,
      allDay: Boolean(createInitial?.allDay),
      title: createInitial?.title || "",
      conferenceUrl: "",
      description: "",
      provider: "local" as const,
      remindMinutesBefore: null as number | null,
      recurrence: null as ScheduleRecurrence | null,
    };
  }, [event, createInitial]);

  const start0 = splitMin(seed.startMin);
  const end0 = splitMin(seed.endMin >= 24 * 60 ? 24 * 60 - 1 : seed.endMin);

  const [title, setTitle] = useState(seed.title);
  const [dateKey, setDateKey] = useState(seed.dateKey);
  const [allDay, setAllDay] = useState(Boolean(seed.allDay));
  const [startH, setStartH] = useState(String(start0.h));
  const [startM, setStartM] = useState(pad2(start0.m));
  const [endH, setEndH] = useState(String(end0.h));
  const [endM, setEndM] = useState(pad2(end0.m));
  const [conferenceUrl, setConferenceUrl] = useState(seed.conferenceUrl || "");
  const [description, setDescription] = useState(seed.description || "");
  const [repeatOn, setRepeatOn] = useState(Boolean(seed.recurrence));
  const [freq, setFreq] = useState<ScheduleRecurrenceFreq>(seed.recurrence?.freq || "weekly");
  const [interval, setInterval] = useState(String(seed.recurrence?.interval || 1));
  const [endType, setEndType] = useState<"count" | "until">(
    seed.recurrence?.endType === "until" ? "until" : "count"
  );
  const [count, setCount] = useState(String(seed.recurrence?.count || 8));
  const [untilDateKey, setUntilDateKey] = useState(
    seed.recurrence?.untilDateKey || shiftDateKey(seed.dateKey || dateKey, 28)
  );
  const [remind, setRemind] = useState(
    seed.remindMinutesBefore == null ? "" : String(seed.remindMinutesBefore)
  );
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const buildRecurrence = (): ScheduleRecurrence | null => {
    if (!repeatOn) return null;
    const iv = Math.max(1, Number(interval) || 1);
    if (endType === "until") {
      return {
        freq,
        interval: iv,
        endType: "until",
        untilDateKey: untilDateKey || shiftDateKey(dateKey, 28),
      };
    }
    return {
      freq,
      interval: iv,
      endType: "count",
      count: Math.max(2, Math.min(100, Number(count) || 2)),
    };
  };

  const buildInput = (): ScheduleEventInput => {
    let startMin = 0;
    let endMin = 24 * 60;
    if (!allDay) {
      startMin = parseHm(startH, startM);
      endMin = parseHm(endH, endM);
      if (endMin <= startMin) endMin = Math.min(24 * 60, startMin + 30);
    }
    const url = conferenceUrl.trim();
    return {
      dateKey: dateKey.trim() || seed.dateKey,
      title: title.trim() || (allDay ? "重要事項" : "未命名"),
      allDay,
      startMin,
      endMin,
      conferenceUrl: url || undefined,
      description: description.trim() || null,
      recurrence: buildRecurrence(),
      remindMinutesBefore: remind === "" ? null : Number(remind),
      provider: "local",
    };
  };

  const save = async () => {
    if (readonly || busy) return;
    setBusy(true);
    try {
      const url = conferenceUrl.trim();
      if (url && !/^https:\/\//i.test(url)) {
        toast("會議連結請用 https:// 開頭");
        return;
      }
      if (remind !== "") {
        const ok = await requestScheduleNotificationPermission();
        if (!ok) {
          // Keep saving; drop reminder if permission denied.
        }
      }
      const input = buildInput();
      if (remind !== "" && typeof Notification !== "undefined" && Notification.permission !== "granted") {
        input.remindMinutesBefore = null;
      }

      if (isCreate || !event) {
        const id = await createScheduleEvent(uid, input);
        toast(input.recurrence ? "已建立重複行程" : "已新增行程");
        onSaved?.(id);
        onClose();
        return;
      }

      let scope: SeriesEditScope = "one";
      if (event.seriesId) {
        const choice = await askChoice<"one" | "all">({
          title: "套用變更範圍",
          message: "這是重複行程，要改哪裡？",
          options: [
            { id: "one", label: "僅此一次", description: "只改這一筆" },
            {
              id: "all",
              label: "整個系列",
              description: "標題、時間、提醒一併更新（日期各自保留）",
              primary: true,
            },
          ],
        });
        if (!choice) return;
        scope = choice.choice;
      }

      const id = await updateScheduleEventScoped(uid, event, input, scope);
      toast("已更新行程");
      onSaved?.(id);
      onClose();
    } catch (e) {
      toast(e instanceof Error ? e.message : "儲存失敗");
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (readonly || busy || !event) return;
    setBusy(true);
    try {
      let scope: SeriesDeleteScope = "one";
      if (event.seriesId) {
        const choice = await askChoice<"one" | "following" | "all">({
          title: "刪除重複行程",
          message: "要刪除哪些？",
          options: [
            { id: "one", label: "僅此一次" },
            {
              id: "following",
              label: "此筆及之後",
              description: "含今天之後的重複",
            },
            {
              id: "all",
              label: "整個系列",
              description: "刪除所有重複",
              primary: true,
            },
          ],
        });
        if (!choice) return;
        scope = choice.choice;
      } else {
        const ok = await askConfirm({
          title: "刪除行程？",
          message: event.title,
          danger: true,
          confirmLabel: "刪除",
        });
        if (!ok) return;
      }
      await deleteScheduleEventScoped(uid, event, scope);
      toast("已刪除");
      onDeleted?.();
      onClose();
    } catch (e) {
      toast(e instanceof Error ? e.message : "刪除失敗");
    } finally {
      setBusy(false);
    }
  };

  const onRemindChange = async (v: string) => {
    setRemind(v);
    if (v !== "") await requestScheduleNotificationPermission();
  };

  const recPreview = buildRecurrence();

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
          <h3 id={titleId}>
            {readonly ? "行程詳情" : isCreate ? (allDay ? "新增重要事項" : "新增行程") : "編輯行程"}
          </h3>
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
            placeholder={allDay ? "例如：交報告、家人聚餐…" : "行程名稱"}
            onChange={(e) => setTitle(e.target.value)}
            autoFocus
          />
        </label>

        <label className="jn-ev-field">
          <span>日期</span>
          <CadenceDateField
            value={dateKey}
            ariaLabel="行程日期"
            placeholder="選擇日期"
            disabled={readonly || busy}
            onChange={(next) => {
              if (next) setDateKey(next);
            }}
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

        {!readonly && (
          <>
            <label className="jn-ev-check">
              <input
                type="checkbox"
                checked={repeatOn}
                disabled={busy}
                onChange={(e) => setRepeatOn(e.target.checked)}
              />
              <span>重複</span>
            </label>

            {repeatOn && (
              <div className="jn-ev-repeat">
                <div className="jn-ev-time-row">
                  <div className="jn-ev-field">
                    <span>頻率</span>
                    <MenuSelect
                      variant="soft"
                      ariaLabel="重複頻率"
                      value={freq}
                      options={FREQ_OPTIONS}
                      disabled={busy}
                      onChange={setFreq}
                    />
                  </div>
                  <label className="jn-ev-field">
                    <span>間隔</span>
                    <input
                      className="input"
                      inputMode="numeric"
                      value={interval}
                      disabled={busy}
                      onChange={(e) =>
                        setInterval(e.target.value.replace(/\D/g, "").slice(0, 2) || "1")
                      }
                    />
                  </label>
                </div>
                <div className="jn-ev-repeat-end">
                  <label className="jn-ev-check">
                    <input
                      type="radio"
                      name="rec-end"
                      checked={endType === "count"}
                      disabled={busy}
                      onChange={() => setEndType("count")}
                    />
                    <span>重複</span>
                    <input
                      className="input jn-ev-inline-num"
                      inputMode="numeric"
                      value={count}
                      disabled={busy || endType !== "count"}
                      onChange={(e) =>
                        setCount(e.target.value.replace(/\D/g, "").slice(0, 3) || "2")
                      }
                    />
                    <span>次</span>
                  </label>
                  <label className="jn-ev-check jn-ev-until">
                    <input
                      type="radio"
                      name="rec-end"
                      checked={endType === "until"}
                      disabled={busy}
                      onChange={() => setEndType("until")}
                    />
                    <span>直到</span>
                    <CadenceDateField
                      value={untilDateKey}
                      ariaLabel="重複結束日"
                      placeholder="結束日期"
                      disabled={busy || endType !== "until"}
                      onChange={(next) => {
                        if (next) setUntilDateKey(next);
                      }}
                    />
                  </label>
                </div>
                <p className="jn-muted" style={{ margin: 0, fontSize: "0.7rem" }}>
                  {recurrenceLabel(recPreview)}
                </p>
              </div>
            )}

            <div className="jn-ev-field">
              <span>提醒</span>
              <MenuSelect
                variant="soft"
                ariaLabel="提醒"
                value={remind}
                options={[...REMIND_OPTIONS]}
                disabled={busy}
                onChange={(v) => void onRemindChange(v)}
              />
            </div>
            {remind !== "" && (
              <p className="jn-muted" style={{ margin: 0, fontSize: "0.7rem" }}>
                提醒需允許瀏覽器通知；分頁開啟時會準時提醒。
              </p>
            )}
          </>
        )}

        <label className="jn-ev-field">
          <span>備註</span>
          <textarea
            className="input jn-ev-note"
            rows={3}
            placeholder="地點、準備事項、補充說明…"
            value={description}
            disabled={readonly || busy}
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>

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

        {event && (
          <p className="jn-muted" style={{ fontSize: "0.72rem" }}>
            目前：{event.dateKey} ·{" "}
            {event.allDay ? "全天" : `${formatClock(event.startMin)}–${formatClock(event.endMin)}`}
            {event.seriesId ? " · 重複系列" : ""}
            {event.provider === "google" ? " · Google" : ""}
          </p>
        )}

        <footer className="jn-ev-dialog-foot">
          {!readonly && !isCreate && (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={busy}
              onClick={() => void remove()}
            >
              刪除
            </button>
          )}
          <div className="jn-ev-dialog-foot-right">
            <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={onClose}>
              {readonly ? "關閉" : "取消"}
            </button>
            {!readonly && (
              <button type="button" className="btn btn-sm" disabled={busy} onClick={() => void save()}>
                {isCreate ? "確定" : "儲存"}
              </button>
            )}
          </div>
        </footer>
      </div>
    </div>
  );
}
