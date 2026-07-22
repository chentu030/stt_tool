"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  collection,
  getDocs,
  Timestamp,
  updateDoc,
  doc,
} from "firebase/firestore";
import PageLoading from "@/components/motion/PageLoading";
import ScrambleText from "@/components/motion/ScrambleText";
import { useAuth } from "@/components/AuthProvider";
import { db, loginWithGoogle } from "@/lib/firebase";
import {
  isAllowlistedEmail,
  type AccessRequest,
} from "@/lib/accessGate";
import {
  accessApprovedSubject,
  accessApprovedText,
} from "@/lib/accessApprovedEmail";
import { toast } from "@/lib/toast";

function parseRequest(uid: string, data: Record<string, unknown>): AccessRequest {
  const statusRaw = String(data.status || "pending");
  const status =
    statusRaw === "approved" || statusRaw === "rejected" ? statusRaw : "pending";
  const asList = (v: unknown) =>
    Array.isArray(v) ? v.map(String).filter(Boolean) : [];
  return {
    uid,
    email: String(data.email || ""),
    display_name: String(data.display_name || ""),
    username: String(data.username || ""),
    status,
    use_cases: asList(data.use_cases ?? data.use_case),
    current_workflows: asList(data.current_workflows ?? data.current_workflow),
    frequencies: asList(data.frequencies ?? data.frequency),
    referrals: asList(data.referrals ?? data.referral),
    use_case_other: String(data.use_case_other || ""),
    workflow_other: String(data.workflow_other || ""),
    referral_other: String(data.referral_other || ""),
    wished_features: String(data.wished_features || ""),
    created_at: (data.created_at as { toDate?: () => Date })?.toDate?.() || null,
    updated_at: (data.updated_at as { toDate?: () => Date })?.toDate?.() || null,
  };
}

export default function AdminAccessPage() {
  const { user, loading } = useAuth();
  const allowed = isAllowlistedEmail(user?.email);
  const [rows, setRows] = useState<AccessRequest[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  const pending = useMemo(() => rows.filter((r) => r.status === "pending"), [rows]);
  const others = useMemo(() => rows.filter((r) => r.status !== "pending"), [rows]);

  const load = async () => {
    const snap = await getDocs(collection(db, "access_requests"));
    const list: AccessRequest[] = [];
    snap.forEach((d) => list.push(parseRequest(d.id, d.data() as Record<string, unknown>)));
    list.sort((a, b) => (b.created_at?.getTime() || 0) - (a.created_at?.getTime() || 0));
    setRows(list);
    setReady(true);
  };

  useEffect(() => {
    if (!user || !allowed) {
      setReady(true);
      return;
    }
    void load().catch((e) => {
      toast(e instanceof Error ? e.message : "載入失敗");
      setReady(true);
    });
  }, [user, allowed]);

  const notify = async (row: AccessRequest) => {
    if (!user) return;
    const token = await user.getIdToken();
    const res = await fetch("/api/access/notify-approved", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        toEmail: row.email,
        displayName: row.display_name || row.username,
      }),
    });
    const data = (await res.json().catch(() => ({}))) as {
      error?: string;
      hint?: string;
      preview?: { text?: string };
    };
    if (!res.ok) {
      if (res.status === 503 && data.preview?.text) {
        try {
          await navigator.clipboard.writeText(data.preview.text);
          toast("尚未設定 RESEND_API_KEY：已複製信件內容，可手動貼到信箱寄出");
        } catch {
          toast(data.error || "尚未設定寄信金鑰");
        }
        return;
      }
      throw new Error(data.error || "寄信失敗");
    }
    toast(`已寄出核准信到 ${row.email}`);
  };

  const approve = async (row: AccessRequest, sendMail: boolean) => {
    setBusyId(row.uid);
    try {
      await updateDoc(doc(db, "access_requests", row.uid), {
        status: "approved",
        updated_at: Timestamp.now(),
        approved_at: Timestamp.now(),
      });
      if (sendMail) await notify(row);
      else toast("已核准（未寄信）");
      await load();
    } catch (e) {
      toast(e instanceof Error ? e.message : "核准失敗");
    } finally {
      setBusyId(null);
    }
  };

  const reject = async (row: AccessRequest) => {
    setBusyId(row.uid);
    try {
      await updateDoc(doc(db, "access_requests", row.uid), {
        status: "rejected",
        updated_at: Timestamp.now(),
      });
      toast("已拒絕");
      await load();
    } catch (e) {
      toast(e instanceof Error ? e.message : "操作失敗");
    } finally {
      setBusyId(null);
    }
  };

  const copyDraft = async (row: AccessRequest) => {
    const text = accessApprovedText(row.display_name || row.username);
    try {
      await navigator.clipboard.writeText(text);
      toast("已複製核准信草稿");
    } catch {
      toast(accessApprovedSubject());
    }
  };

  if (loading || !ready) return <PageLoading />;

  if (!user) {
    return (
      <div className="community-page">
        <p className="page-sub">請先登入。</p>
        <button type="button" className="btn" onClick={() => void loginWithGoogle()}>
          登入
        </button>
      </div>
    );
  }

  if (!allowed) {
    return (
      <div className="community-page">
        <p className="page-sub">此頁僅供開發者帳號使用。</p>
        <Link className="btn" href="/">
          返回
        </Link>
      </div>
    );
  }

  return (
    <div className="community-page admin-access-page">
      <nav className="community-crumb">
        <Link href="/settings">設定</Link>
        <span>/</span>
        <span>註冊問卷</span>
      </nav>
      <ScrambleText words="註冊問卷" as="h1" className="page-title font-display" />
      <p className="page-sub">
        新用戶完成問卷後會自動開通。此頁可查看回覆；若仍有舊的待審核紀錄，也可在此手動處理。
      </p>

      <section className="admin-access-section">
        <h2>待處理（舊審核佇列 · {pending.length}）</h2>
        {pending.length === 0 ? (
          <p className="community-empty">沒有待處理項目。</p>
        ) : (
          <ul className="admin-access-list">
            {pending.map((row) => (
              <li key={row.uid}>
                <div>
                  <strong>{row.display_name || row.username || "（未填名稱）"}</strong>
                  <span>{row.email}</span>
                  {row.wished_features ? <p>{row.wished_features}</p> : null}
                </div>
                <div className="admin-access-actions">
                  <button
                    type="button"
                    className="btn"
                    disabled={busyId === row.uid}
                    onClick={() => void approve(row, true)}
                  >
                    核准並寄信
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    disabled={busyId === row.uid}
                    onClick={() => void approve(row, false)}
                  >
                    只核准
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => void copyDraft(row)}
                  >
                    複製信件
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    disabled={busyId === row.uid}
                    onClick={() => void reject(row)}
                  >
                    拒絕
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="admin-access-section">
        <h2>其他（{others.length}）</h2>
        <ul className="admin-access-list">
          {others.slice(0, 40).map((row) => (
            <li key={row.uid}>
              <div>
                <strong>
                  {row.display_name || row.username} · {row.status}
                </strong>
                <span>{row.email}</span>
              </div>
              <div className="admin-access-actions">
                {row.status === "approved" ? (
                  <>
                    <button
                      type="button"
                      className="btn btn-ghost"
                      disabled={busyId === row.uid}
                      onClick={() =>
                        void (async () => {
                          setBusyId(row.uid);
                          try {
                            await notify(row);
                          } catch (e) {
                            toast(e instanceof Error ? e.message : "寄信失敗");
                          } finally {
                            setBusyId(null);
                          }
                        })()
                      }
                    >
                      重寄核准信
                    </button>
                    <button type="button" className="btn btn-ghost" onClick={() => void copyDraft(row)}>
                      複製信件
                    </button>
                  </>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
