"use client";

import { useState } from "react";
import Link from "next/link";
import ScrambleText from "@/components/motion/ScrambleText";
import { parseManifestJsonText } from "@/lib/community/parseManifest";
import type { CommunityManifest } from "@/lib/community/types";
import { toast } from "@/lib/toast";

export default function CommunitySubmitPage() {
  const [text, setText] = useState("");
  const [result, setResult] = useState<CommunityManifest | null>(null);
  const [error, setError] = useState("");

  const validate = () => {
    setError("");
    setResult(null);
    try {
      const m = parseManifestJsonText(text);
      setResult(m);
      toast("驗證通過");
    } catch (e) {
      setError(e instanceof Error ? e.message : "驗證失敗");
    }
  };

  const download = () => {
    if (!result) return;
    const blob = new Blob([JSON.stringify(result, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "albireus.json";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="community-page">
      <nav className="community-crumb">
        <Link href="/community">社群商店</Link>
        <span>/</span>
        <span>驗證並發佈</span>
      </nav>
      <ScrambleText words="驗證套件" as="h1" className="page-title font-display" />
      <p className="page-sub">
        貼上 albireus.json，通過驗證後下載正規化檔案，再放到 GitHub 或以「匯入檔案」安裝。
      </p>

      <textarea
        className="community-submit-ta"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder='{ "schema": 1, "kind": "template", ... }'
        spellCheck={false}
        rows={16}
      />
      <div className="community-card-actions">
        <button type="button" className="btn" onClick={validate}>
          驗證
        </button>
        <button type="button" className="btn btn-ghost" disabled={!result} onClick={download}>
          下載正規化 JSON
        </button>
        <Link className="btn btn-ghost" href="/community/docs">
          開發文件
        </Link>
      </div>
      {error && <p className="community-empty" style={{ color: "var(--danger)" }}>{error}</p>}
      {result && (
        <div className="community-submit-ok">
          <h2>通過</h2>
          <ul>
            <li>
              類型：{result.kind === "extension" ? "擴充功能" : "模板"}
            </li>
            <li>
              id：<code>{result.id}</code>
            </li>
            <li>
              名稱：{result.name} · v{result.version}
            </li>
          </ul>
          <ol>
            <li>將 albireus.json 放到公開 GitHub 倉庫根目錄。</li>
            <li>在商店用「從 GitHub 安裝」自測。</li>
            <li>若要進入精選目錄，請開 issue／PR 附上倉庫網址與截圖。</li>
          </ol>
        </div>
      )}
    </div>
  );
}
