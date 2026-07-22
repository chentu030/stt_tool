# 即時行情（收費擴充）

把你的台股即時行情 Web Dashboard 嵌進 Albireus 工作區。

## 為什麼不是直接打包 Python 專案？

Albireus 社群擴充只能宣告 `albireus.json`，以**沙箱 iframe** 載入 **HTTPS** 靜態／網頁入口。  
`即時行情` 本體是 FastAPI + SQLite + 券商 SDK 的即時服務，必須自己部署；此套件是殼層，負責讀取設定裡的 Dashboard 網址並嵌入。

## 設定

1. 在商店安裝「即時行情」（收費；需允許名單帳號，或之後購買）。
2. 開啟擴充設定，填入 `Dashboard HTTPS 網址`。
3. 若目前只有 `http://IP:8080`，請先用 Cloudflare Tunnel／nginx + TLS 等轉成 HTTPS，否則瀏覽器會擋混合內容。

## 打包上傳（對照你的桌面專案）

在 Dashboard 專案根目錄放一份 `albireus.json`（可複製本目錄檔案），入口可改成你的 HTTPS URL：

```json
"pageType": {
  "type": "iframe",
  "entry": "https://YOUR_HTTPS_DASHBOARD/",
  "createLabel": "新即時行情頁"
},
"paid": true
```

然後到社群商店「上傳並分享」勾選收費，上傳封面與 zip（或只填 https 入口）。
