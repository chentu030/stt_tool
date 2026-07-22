# Google Speech-to-Text（即時轉錄／快速錄音）

即時段落與快速錄音走後端 `POST /api/stt/google`（同步辨識，單段建議 ≤ 55 秒）。

## 啟用

1. 在 GCP 專案啟用 **Cloud Speech-to-Text API**。
2. **Cloud Run**：服務帳號需有 `roles/speech.client`（或同等）；通常用 ADC 即可。
3. **本機**：設定 `GOOGLE_APPLICATION_CREDENTIALS` 指向服務帳號 JSON。
4. 後端依賴：`google-cloud-speech`（見 `backend/requirements.txt`）。

## 健康檢查

`GET /api/stt/google/health` — 確認套件是否安裝。

## 產品入口

- 捕捉頁 →「即時轉錄整理」→ 新建筆記並帶 `?live=1`
- 筆記工具列 →「即時轉錄」
- 捕捉頁／日誌 →「快速錄音」→ 筆記存於 `日誌/快速錄音`，並可寫入當日日誌
