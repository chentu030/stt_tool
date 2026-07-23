# 背單字（Albireus 擴充）

間隔重複（SRS）背單字工具，嵌在 Albireus 知識庫 iframe 頁面中使用。

## 開啟方式

1. 社群商店安裝 **背單字**（`builtin:vocab-srs`）
2. 側欄「頁面」→ 建立「新背單字頁」
3. 預設使用平台免費點數（Vertex 環境變數）；用完後可在設定填 **自備 Gemini API 金鑰**

本機預覽（開發伺服器啟動後）：

`/community-apps/vocab/index.html`

## 設定（query / postMessage）

Host 會帶 `?note=&settings=&s_*`；亦可 `postMessage({ type: "albireus:settings", settings })`。
登入態由 `postMessage({ type: "albireus:auth", token, email, … })` 注入。

| key | 說明 |
| --- | --- |
| `gemini_api_keys` | 選填自備 Google AI Studio 金鑰（通常 `AIza` 開頭） |
| `model` | Gemini 模型 |
| `accent` | `us` / `uk` |
| `daily_goal` | 每日張數 |
| `theme` | `light` / `dark` / `auto` |

聽力後端網址由 Vercel `NEXT_PUBLIC_VOCAB_LISTEN_BACKEND` 或 `NEXT_PUBLIC_API_BASE` 注入，**不再**出現在使用者設定。

## 點數與通道

- 免費：整理 50 字／5 段影片／30 次 AI 語音；`lcy101120@gmail.com` 不限
- 無自備金鑰：AI／TTS → Vertex（`VERTEX_API_KEYS`）；聽力檔案 → Whisper Cloud Run
- 有自備金鑰：AI／TTS → `generativelanguage`；聽力檔案 → Google STT；不扣平台點數

## 隱私

- 平台金鑰只在伺服端環境變數
- 自備金鑰只存瀏覽器 localStorage，不會寫入倉庫
