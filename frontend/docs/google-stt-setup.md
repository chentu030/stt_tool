# Google Speech-to-Text（動態批次／經濟模式）

產品預設走 **V2 Dynamic Batch**（約 **$0.016 → $0.003／分鐘**），不走即時串流，避免帳單爆炸。

## 預設路徑：`POST /api/stt/google`

用於：

- 筆記「即時錄音」切段後辨識  
- 捕捉／日誌「快速錄音」

流程：音訊上傳 GCS → `BatchRecognize` + `DYNAMIC_BATCHING` → 回傳文字 → 刪暫存檔。

**取捨：** 出字比串流慢（數十秒級常見），但單價約為串流的 1/5。

### 環境變數

| 變數 | 說明 |
|------|------|
| `GCP_PROJECT` / `GOOGLE_CLOUD_PROJECT` | 必填（V2 recognizer） |
| `GOOGLE_STT_LOCATION` | 預設 `asia-southeast1` |
| `GOOGLE_STT_MODEL` | 預設 `chirp_2` |
| `GOOGLE_STT_MODE` | 預設 `batch` |
| `GOOGLE_STT_BATCH_TIMEOUT` | 等 batch 完成秒數，預設 `240` |
| `GOOGLE_STT_ALLOW_V1_FALLBACK` | 設 `1` 才允許退回較貴的 V1 sync |
| `GOOGLE_STT_ENABLE_STREAM` | 設 `1` 才開啟 WebSocket 串流（約 $0.016／分鐘） |

服務帳號需：`roles/speech.client`，並能讀寫 Storage（batch 暫存路徑 `stt-batch/`）。

### 健康檢查

`GET /api/stt/google/health`

## 串流（預設關閉）

`/api/stt/google/stream` 僅在 `GOOGLE_STT_ENABLE_STREAM=1` 時可用。平常請勿開啟。
