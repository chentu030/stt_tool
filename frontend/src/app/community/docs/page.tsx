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
        若要用 AI 協助開發，請把{" "}
        <a href="/community/ai.md" target="_blank" rel="noreferrer">
          /community/ai.md
        </a>{" "}
        整份貼給 AI（含接線規格與配色 token）。
      </p>

      <section>
        <h2>給 AI 的完整指南</h2>
        <p>
          <a className="btn" href="/community/ai.md" target="_blank" rel="noreferrer">
            開啟 ai.md
          </a>
        </p>
        <p className="page-sub" style={{ marginTop: "0.65rem" }}>
          內容包含：架構限制、albireus.json、query / postMessage、權限、發佈流程，以及與主站融合的配色／字體／按鈕樣式。
        </p>
      </section>

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
          <li>
            <code>paid</code>（選填）：設為 <code>true</code> 即為收費套件；商店可用「免費／收費」篩選。一般使用者無法直接安裝／下載（購買流程尚未開放）
          </li>
        </ul>
      </section>

      <section>
        <h2>擴充頁面（extension）</h2>
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
  ],
  "permissions": ["iframe", "network", "settings", "storage"],
  "minAppVersion": "0.1.0",
  "homepage": "https://example.com",
  "repository": "https://github.com/you/repo",
  "license": "MIT",
  "changelog": [
    { "version": "1.0.0", "date": "2026-07-01", "notes": "初版發佈" }
  ]
}`}</pre>
        <p>
          <code>pageType.entry</code> 必須是 https。安裝後會出現在側欄「頁面」，建立的筆記以沙箱 iframe 開啟該網址（附帶{" "}
          <code>?note=</code>、<code>settings</code> JSON 與 <code>s_*</code> query）。也可監聽{" "}
          <code>postMessage</code> 事件 <code>albireus:settings</code>。
        </p>
        <p>
          若需讀寫使用者知識庫，請宣告 <code>notes_read</code> / <code>notes_write</code>，並透過{" "}
          <code>cadence.notes.get|list|update|create</code> postMessage RPC（見{" "}
          <a href="/community/ai.md" target="_blank" rel="noreferrer">
            ai.md §4.1
          </a>
          、輔助腳本 <code>/samples/notes-rpc-client.js</code>）。主程式不會執行遠端 <code>main.js</code>。
        </p>
        <p>
          <code>permissions</code> 會顯示在商店信任分數卡（未填會依類型推斷）。模板請宣告{" "}
          <code>notes_write</code>。<code>minAppVersion</code> 低於目前 App 版本時會拒絕安裝。
        </p>
      </section>

      <section>
        <h2>擴充頁面 vs 一般擴充功能</h2>
        <ul>
          <li>
            <strong>擴充頁面</strong>（社群 <code>kind: &quot;extension&quot;</code>）：完整工作區頁面，以沙箱 iframe
            載入你的 HTTPS 入口（可全螢幕或嵌在筆記中）。
          </li>
          <li>
            <strong>一般擴充功能</strong>：協助特定頁面操作、本身不是工作區頁面。目前由主程式內建（例如筆記「色票工具」吸取螢幕顏色），社群 manifest{" "}
            <strong>尚不支援</strong> <code>kind: &quot;tool&quot;</code>。細節見{" "}
            <a href="/community/ai.md" target="_blank" rel="noreferrer">
              ai.md §11
            </a>
            。
          </li>
        </ul>
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
