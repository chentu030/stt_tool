// ─────────────────────────────────────────────────────────────
// Service worker v0.4.2 — extract via chrome.scripting.executeScript
// in MAIN world (bypasses YouTube CSP that blocks inline <script> injection).
// ─────────────────────────────────────────────────────────────

const LOG = "[stt-ext]";
const FB_BUCKET = "stt-tool-f6e6d.firebasestorage.app";

function parseVideoId(input) {
  try {
    const u = new URL(input);
    const host = u.hostname.replace(/^www\./, "");
    if (host === "youtu.be") return u.pathname.slice(1).split("/")[0] || null;
    if (u.searchParams.get("v")) return u.searchParams.get("v");
    const parts = u.pathname.split("/").filter(Boolean);
    const i = parts.findIndex((p) => ["shorts", "embed", "v", "live"].includes(p));
    if (i >= 0 && parts[i + 1]) return parts[i + 1];
  } catch (_) {}
  if (/^[a-zA-Z0-9_-]{11}$/.test(input)) return input;
  return null;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function extFromMime(mime) {
  if (mime.includes("mp4") || mime.includes("m4a")) return "m4a";
  if (mime.includes("webm") || mime.includes("opus")) return "webm";
  return "audio";
}

function safeName(title, videoId, mime) {
  const base = String(title || videoId).replace(/[\\/:*?"<>|]/g, "_").slice(0, 120);
  return `${base}.${extFromMime(mime || "")}`;
}

function emitProgress(reqId, stage, pct) {
  if (!reqId) return;
  chrome.runtime.sendMessage({ type: "PROGRESS", reqId, stage, pct }).catch(() => {});
}

function waitTabComplete(tabId, timeoutMs = 25000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(onUpd);
      reject(new Error("YouTube 分頁載入逾時"));
    }, timeoutMs);
    function onUpd(id, info) {
      if (id !== tabId) return;
      if (info.status === "complete") {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(onUpd);
        resolve();
      }
    }
    chrome.tabs.onUpdated.addListener(onUpd);
    chrome.tabs.get(tabId, (tab) => {
      if (chrome.runtime.lastError) return;
      if (tab.status === "complete") {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(onUpd);
        resolve();
      }
    });
  });
}

// Runs inside the YouTube page MAIN world (must be self-contained — no closures).
async function extractAudioInPage(videoId) {
  const waitYtcfg = async () => {
    for (let i = 0; i < 40; i++) {
      if (typeof ytcfg !== "undefined" && ytcfg.get && ytcfg.get("VISITOR_DATA")) return;
      await new Promise((r) => setTimeout(r, 250));
    }
    throw new Error("YouTube 頁面尚未就緒（ytcfg 載入逾時）");
  };

  await waitYtcfg();

  const cfg = (k) => ytcfg.get(k);
  const visitorData = cfg("VISITOR_DATA");
  const apiKey = cfg("INNERTUBE_API_KEY");
  const AUDIO_ITAGS = [140, 251, 250, 249, 139, 18];

  const clients = [
    {
      name: "ANDROID_VR",
      client: {
        clientName: "ANDROID_VR",
        clientVersion: "1.60.19",
        deviceMake: "Oculus",
        deviceModel: "Quest 3",
        osName: "Android",
        osVersion: "12L",
        androidSdkVersion: 32,
        hl: "zh-TW",
        gl: "TW",
      },
    },
    {
      name: "TVHTML5",
      client: {
        clientName: "TVHTML5",
        clientVersion: cfg("INNERTUBE_CLIENT_VERSION") || "7.20250120.19.00",
        hl: "zh-TW",
        gl: "TW",
      },
    },
    {
      name: "ANDROID",
      client: {
        clientName: "ANDROID",
        clientVersion: "19.44.38",
        androidSdkVersion: 34,
        osName: "Android",
        osVersion: "14",
        hl: "zh-TW",
        gl: "TW",
      },
    },
  ];

  const errors = [];
  let picked = null;
  let title = videoId;

  for (const { name, client } of clients) {
    try {
      if (visitorData) client.visitorData = visitorData;
      const body = {
        context: { client, user: { lockedSafetyMode: false }, request: { useSsl: true } },
        videoId,
        contentCheckOk: true,
        racyCheckOk: true,
      };
      const ep = apiKey
        ? "/youtubei/v1/player?key=" + encodeURIComponent(apiKey) + "&prettyPrint=false"
        : "/youtubei/v1/player?prettyPrint=false";

      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 12000);
      let r;
      try {
        r = await fetch(ep, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: ctrl.signal,
        });
      } finally {
        clearTimeout(timer);
      }

      if (!r.ok) {
        errors.push(name + ": HTTP " + r.status);
        continue;
      }
      const player = await r.json();
      const status = player && player.playabilityStatus && player.playabilityStatus.status;
      if (status !== "OK") {
        const reason = (player && player.playabilityStatus && player.playabilityStatus.reason) || "";
        errors.push(name + ": " + status + " " + reason);
        continue;
      }
      title = (player.videoDetails && player.videoDetails.title) || title;

      const fmts = ((player.streamingData && player.streamingData.adaptiveFormats) || []).filter(
        (f) => f.mimeType && f.mimeType.indexOf("audio/") === 0 && f.url
      );
      fmts.sort((a, b) => {
        const ia = AUDIO_ITAGS.indexOf(a.itag);
        const ib = AUDIO_ITAGS.indexOf(b.itag);
        return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib) || (b.bitrate || 0) - (a.bitrate || 0);
      });
      if (fmts[0]) {
        picked = fmts[0];
        break;
      }
      const combined = ((player.streamingData && player.streamingData.formats) || []).find(
        (f) => f.url && f.itag === 18
      );
      if (combined) {
        picked = combined;
        break;
      }
      errors.push(name + ": 無直連音訊");
    } catch (e) {
      errors.push(name + ": " + (e && e.message ? e.message : String(e)));
    }
  }

  if (!picked) {
    throw new Error("找不到可下載的音訊（" + errors.join(" / ") + "）");
  }

  return {
    ok: true,
    audioUrl: picked.url,
    mime: (picked.mimeType || "audio/mp4").split(";")[0],
    title,
  };
}

async function extractViaYouTubeTab(videoId, reqId) {
  emitProgress(reqId, "parsing", 5);
  console.log(LOG, "open background YouTube tab…");
  const tab = await chrome.tabs.create({
    url: `https://www.youtube.com/watch?v=${videoId}`,
    active: false,
  });
  try {
    await waitTabComplete(tab.id);
    emitProgress(reqId, "parsing", 15);
    await sleep(800);
    emitProgress(reqId, "parsing", 20);
    console.log(LOG, "executeScript MAIN world…");

    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: "MAIN",
      func: extractAudioInPage,
      args: [videoId],
    });

    if (!result || !result.ok) {
      throw new Error((result && result.error) || "頁面擷取失敗");
    }
    emitProgress(reqId, "parsing", 30);
    console.log(LOG, "extract ok:", result.title);
    return result;
  } finally {
    chrome.tabs.remove(tab.id).catch(() => {});
  }
}

async function resolveAudioMeta(url, reqId) {
  const videoId = parseVideoId(url);
  if (!videoId) throw new Error("無法辨識 YouTube 影片網址");
  const meta = await extractViaYouTubeTab(videoId, reqId);
  return { videoId, ...meta };
}

async function downloadBlob(url, reqId) {
  emitProgress(reqId, "downloading", 0);
  console.log(LOG, "downloading audio…");
  const res = await fetch(url, { credentials: "omit" });
  if (!res.ok) throw new Error("下載音訊失敗 HTTP " + res.status);

  const total = parseInt(res.headers.get("content-length") || "0", 10);
  if (!res.body || !total) {
    const buf = await res.arrayBuffer();
    emitProgress(reqId, "downloading", 100);
    return new Blob([buf]);
  }

  const reader = res.body.getReader();
  const chunks = [];
  let received = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    emitProgress(reqId, "downloading", Math.min(99, Math.round((received / total) * 100)));
  }
  emitProgress(reqId, "downloading", 100);
  return new Blob(chunks);
}

function uploadToFirebase(storagePath, idToken, blob, mime, reqId) {
  return new Promise((resolve, reject) => {
    emitProgress(reqId, "uploading", 0);
    console.log(LOG, "uploading to Firebase…", blob.size, "bytes");
    const name = encodeURIComponent(storagePath);
    const url = `https://firebasestorage.googleapis.com/v0/b/${FB_BUCKET}/o?uploadType=media&name=${name}`;
    const xhr = new XMLHttpRequest();
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        emitProgress(reqId, "uploading", Math.round((e.loaded / e.total) * 100));
      }
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        emitProgress(reqId, "uploading", 100);
        resolve();
      } else {
        reject(new Error(`Firebase 上傳失敗 HTTP ${xhr.status}`));
      }
    };
    xhr.onerror = () => reject(new Error("Firebase 上傳網路錯誤"));
    xhr.open("POST", url);
    xhr.setRequestHeader("Authorization", `Bearer ${idToken}`);
    xhr.setRequestHeader("Content-Type", mime || "application/octet-stream");
    xhr.send(blob);
  });
}

async function extractAndUpload({ url, uid, jobId, idToken, reqId }) {
  console.log(LOG, "EXTRACT_AND_UPLOAD", url);
  const meta = await resolveAudioMeta(url, reqId);
  const filename = safeName(meta.title, meta.videoId, meta.mime);
  const storagePath = `uploads/${uid}/${jobId}/${filename}`;

  const blob = await downloadBlob(meta.audioUrl, reqId);
  if (!blob.size) throw new Error("下載到的音訊檔案是空的");

  await uploadToFirebase(storagePath, idToken, blob, meta.mime, reqId);

  return { ok: true, filename, storagePath, bytes: blob.size, mime: meta.mime };
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "EXTRACT_AND_UPLOAD") {
    extractAndUpload(msg)
      .then(sendResponse)
      .catch((e) => sendResponse({ ok: false, error: String(e?.message || e) }));
    return true;
  }
  if (msg?.type === "PING") {
    sendResponse({ ok: true, version: "0.4.2" });
    return false;
  }
});
