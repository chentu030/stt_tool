"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import { loginWithGoogle } from "@/lib/firebase";
import { acceptInvite } from "@/lib/teamStore";

function JoinInner() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token") || "";
  const [status, setStatus] = useState<"idle" | "joining" | "done" | "error">("idle");
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!user || !token || status !== "idle") return;
    setStatus("joining");
    void acceptInvite(token, user.uid, user.displayName || undefined).then((res) => {
      if (res.ok) {
        setStatus("done");
        setMessage(`已加入「${res.teamName}」`);
        setTimeout(() => router.replace(`/team/${res.teamId}`), 900);
      } else {
        setStatus("error");
        setMessage(
          res.error === "expired"
            ? "邀請連結已過期"
            : res.error === "revoked"
              ? "邀請連結已被撤銷"
              : "找不到邀請連結"
        );
      }
    });
  }, [user, token, status, router]);

  if (loading) return <p style={{ color: "var(--text-muted)", padding: "2rem" }}>載入中…</p>;

  if (!token) {
    return (
      <div className="tm-page tm-guest">
        <h1 className="page-title font-display">加入團隊</h1>
        <p className="page-sub">缺少邀請連結參數。</p>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="tm-page tm-guest">
        <h1 className="page-title font-display">加入團隊</h1>
        <p className="page-sub">登入後即可接受邀請並加入團隊。</p>
        <button type="button" className="btn" onClick={() => loginWithGoogle()}>登入</button>
      </div>
    );
  }

  return (
    <div className="tm-page tm-guest">
      <h1 className="page-title font-display">加入團隊</h1>
      <p className="page-sub">
        {status === "joining" ? "正在處理邀請…" : message || "準備加入…"}
      </p>
    </div>
  );
}

export default function TeamJoinPage() {
  return (
    <Suspense fallback={<p style={{ color: "var(--text-muted)", padding: "2rem" }}>載入中…</p>}>
      <JoinInner />
    </Suspense>
  );
}
