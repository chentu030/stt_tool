# Google Speech-to-Text（即時串流／快速錄音）

## 即時轉錄（StreamingRecognize）

會議／課堂「即時轉錄」走後端 **WebSocket** ` /api/stt/google/stream`：

1. 瀏覽器以 **PCM s16le / 16 kHz / mono** 持續送音訊  
2. 後端以 **Speech-to-Text V2**（預設 `chirp_2` @ `asia-southeast1`）做雙向串流  
3. 回傳 **interim**（暫定、會跳動修正）與 **final**（停頓後鎖定）  
4. 若 V2 不可用，自動退回 **V1** `latest_long`（interim 較穩）  
5. 串流約 **5 分鐘**上限：前端每 **4 分鐘**自動續接  
6. 音檔仍用 `MediaRecorder` 另存；「段落結束」附加音檔到筆記

計費（約）：V2 標準即時／Chirp **$0.016／分鐘**（另有每月免費額度，以 GCP 帳單為準）。

### 環境變數（後端）

| 變數 | 說明 |
|------|------|
| `GCP_PROJECT` / `GOOGLE_CLOUD_PROJECT` | 專案 ID（V2 recognizer 需要） |
| `GOOGLE_STT_LOCATION` | 預設 `asia-southeast1` |
| `GOOGLE_STT_MODEL` | 預設 `chirp_2` |
| ADC / `GOOGLE_APPLICATION_CREDENTIALS` | Cloud Run 服務帳號或本機金鑰 |

啟用 **Cloud Speech-to-Text API**，服務帳號需 `roles/speech.client`。

### 健康檢查

`GET /api/stt/google/health`

## 快速錄音（短片同步辨識）

`POST /api/stt/google` — 短音訊同步 Recognize（日誌／快速想法），與串流路徑分開。
