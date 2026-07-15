# 語音轉錄 YouTube 擷取器（瀏覽器擴充功能）

在**使用者自己的電腦 / IP** 上擷取 YouTube 音訊，再送到語音轉錄網站轉錄。
等同「網頁版 TubeMate」：因為請求從使用者的住宅 IP 發出，可避開伺服器
（Cloud Run）被 YouTube 判定為機器人而封鎖的問題，且不需要代理伺服器。

## 運作方式

1. 使用者在轉錄網站貼上 YouTube 網址，按「雲端轉錄」。
2. 網站偵測到已安裝擴充，透過 `window.postMessage` 請擴充處理。
3. 擴充的 service worker 用 `ANDROID_VR` InnerTube 用戶端向 YouTube 取得
   **純音訊直連網址**（免簽章解密、免 PO token），並用使用者的 IP 下載。
4. 音檔以 base64 回傳給網頁，網頁把它當成一般上傳檔案，走既有的
   「上傳 → 排隊 → 轉錄」流程（自動有上傳進度與排隊顯示）。

## 安裝（載入未封裝擴充）

1. 開啟 Chrome / Edge → 網址列輸入 `chrome://extensions`（Edge 為 `edge://extensions`）。
2. 右上角打開「開發人員模式 / Developer mode」。
3. 點「載入未封裝項目 / Load unpacked」，選這個 `browser-extension` 資料夾。
4. 安裝完成後，重新整理轉錄網站分頁即可。

## 設定你的網站網域

擴充預設只在 `*.vercel.app` 與 `localhost` 生效。若你的網站用**自訂網域**，
請編輯 `manifest.json` 的 `content_scripts.matches`，加入你的網域，例如：

```json
"matches": [
  "https://your-domain.com/*",
  "https://*.vercel.app/*",
  "http://localhost/*",
  "http://localhost:*/*"
]
```

改完後回 `chrome://extensions` 按該擴充的「重新載入」。

## 已知限制（MVP）

- 目前針對**公開影片**。私人 / 會員 / 年齡限制影片仍請用網站內建的
  「上傳 cookies」＋伺服器下載路徑。
- 一次處理**單一影片**，尚未支援整個播放清單。
- YouTube 若更動 InnerTube 介面，可能需要小幅更新（屬正常維護）。
