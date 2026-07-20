"use client";

import Link from "next/link";
import ScrambleText from "@/components/motion/ScrambleText";

export default function CommunityDocsPage() {
  return (
    <div className="community-page community-docs">
      <nav className="community-crumb">
        <Link href="/community">社群商店</Link>
        <span>/</span>
        <span>開發文件</span>
      </nav>
      <ScrambleText words="套件開發文件" as="h1" className="page-title font-display" />
      <p className="page-sub">
        Albireus 社群套件是宣告式 JSON（不在主程式執行遠端 JS）。擴充以沙箱 iframe 載入；模板為 Markdown 頁面包。
      </p>

      <section>
        <h2>albireus.json 必填欄位</h2>
        <ul>
          <li>
            <code>schema</code>：固定 <code>1</code>
          </li>
          <li>
            <code>kind</code>：<code>extension</code> 或 <code>template</code>
          </li>
          <li>
            <code>id</code>：小寫 a-z0-9_-（不可含 albireus）
          </li>
          <li>
            <code>name</code>、<code>version</code>（semver）、<code>description</code>、<code>author</code>
          </li>
        </ul>
      </section>

      <section>
        <h2>擴充功能（extension）</h2>
        <pre className="community-code">{`{
  "schema": 1,
  "kind": "extension",
  "id": "my-tool",
  "name": "我的工具",
  "version": "1.0.0",
  "description": "用一句話說明功用",
  "author": "你的名字",
  "icon": "extension",
  "category": "生產力",
  "screenshots": ["https://example.com/shot.png"],
  "nav": { "label": "工具", "order": 50 },
  "pageType": {
    "type": "iframe",
    "entry": "https://your-site.example/",
    "createLabel": "新工具頁"
  },
  "settings": [
    { "key": "theme", "label": "主題", "type": "enum", "options": ["light", "dark"], "default": "light" }
  ]
}`}</pre>
        <p>
          <code>pageType.entry</code> 必須是 https。安裝後會出現在側欄「頁面」，建立的筆記以沙箱 iframe 開啟該網址（附帶{" "}
          <code>?note=</code>、<code>settings</code> JSON 與 <code>s_*</code> query）。也可監聽{" "}
          <code>postMessage</code> 事件 <code>albireus:settings</code>。
        </p>
      </section>

      <section>
        <h2>模板（template）</h2>
        <pre className="community-code">{`{
  "schema": 1,
  "kind": "template",
  "id": "my-pack",
  "name": "我的模板包",
  "version": "1.0.0",
  "description": "多頁工作流",
  "author": "你的名字",
  "pages": [
    { "title": "第一頁", "file": "a.md", "folder": "專案", "tags": ["demo"] }
  ]
}`}</pre>
        <p>
          可將 <code>body</code> 直接寫在 JSON，或放在同目錄／zip 內的 <code>file</code>。建議附上{" "}
          <code>README.md</code>。
        </p>
      </section>

      <section>
        <h2>發佈方式</h2>
        <ol>
          <li>把套件放到 GitHub 倉庫根目錄（含 albireus.json）。</li>
          <li>在社群商店用「從 GitHub 安裝」測試。</li>
          <li>
            到 <Link href="/community/submit">驗證並發佈</Link> 檢查 JSON，通過後可提交 PR 到精選目錄。
          </li>
        </ol>
      </section>

      <p>
        <Link className="btn" href="/community/submit">
          前往驗證工具
        </Link>
      </p>
    </div>
  );
}
