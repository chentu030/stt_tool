# 背單字（Albireus 擴充）

間隔重複（SRS）背單字工具，嵌在 Albireus 知識庫 iframe 頁面中使用。功能與原「快速背單字」對齊：AI 整理詞典、多模式複習、批次、閱讀、聽力。

## 開啟方式

1. 社群商店安裝 **背單字**（`builtin:vocab-srs`）
2. 側欄「頁面」→ 建立「新背單字頁」
3. 在擴充設定填入 **Gemini / Vertex API 金鑰**（`AQ.` 開頭），或於頁內「設定」填寫

本機預覽（開發伺服器啟動後）：

`/community-apps/vocab/index.html`

## 設定（query / postMessage）

Host 會帶 `?note=&settings=&s_*`；亦可 `postMessage({ type: "albireus:settings", settings })`。

| key | 說明 |
| --- | --- |
| `gemini_api_keys` | 金鑰（換行或逗號） |
| `model` | Gemini 模型 |
| `accent` | `us` / `uk` |
| `daily_goal` | 每日張數 |
| `listen_backend` | 聽力／詞典後端 |
| `theme` | `light` / `dark` / `auto` |

## 隱私

- **不**內建任何 API 金鑰；請自行填入。
- 金鑰與本機資料在 iframe 的 `localStorage`；雲端同步仍走原 Firebase（需 Google 登入）。

## 檔案

- `index.html` / `app.js` / `styles.css` / `db.js`
- `api/dict-fetch.js`、`api/keys.js`（參考用；靜態託管時詞典優先走聽力後端）
- `albireus.json` — 套件清單
