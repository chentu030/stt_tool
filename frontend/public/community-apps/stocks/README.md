# 台股／美股看盤（yahoo-stocks）

Albireus 社群擴充：以沙箱 iframe 嵌入的 Yahoo Finance 日 K 看盤工具。

## 功能

- 搜尋代號／名稱（台股、美股）
- 最新報價輪詢（預設約 20 秒；頁面隱藏時暫停）
- 約 720 根日 K（蠟燭）+ 成交量
- 均線 MA 5 / 10 / 20 / 60 / 120 / 240（可開關）
- 指標面板：KD、MACD、RSI、OBV（可開關）
- 拖曳平移、滾輪／捏合縮放時間軸

## 路徑

| 項目 | 路徑 |
| --- | --- |
| 靜態頁 | `/community-apps/stocks/index.html` |
| 圖表代理 | `GET /api/stocks/chart?symbol=2330.TW&range=2y&interval=1d` |
| 報價代理 | `GET /api/stocks/quote?symbol=2330.TW` |
| 搜尋代理 | `GET /api/stocks/search?q=2330` |

無需 API Key：後端以公開 Yahoo chart／search endpoint 代理，避開瀏覽器 CORS。

## 設定（Albireus）

- `default_symbol` — 預設代號（如 `2330.TW`）
- `refresh_seconds` — 報價刷新秒數
- `theme` — `auto` / `light` / `dark`

## 本地測試

```bash
cd frontend
npm run dev
```

1. 開 `http://localhost:3000/community-apps/stocks/index.html`
2. 或社群商店安裝 **builtin:yahoo-stocks** 後從側欄建立「看盤」頁
3. 確認 K 線、觀察清單報價與指標切換正常

## 授權

MIT · 行情資料來自 Yahoo Finance，僅供個人參考，不構成投資建議。
