// ─────────────────────────────────────────────────────────────
// Service worker v0.4.1 — always open a fresh YouTube tab, inject
// content script if needed, no useless SW API fallback.
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

async function ensureContentScript(tabId) {
  try {
    const resp = await chrome.tabs.sendMessage(tabId, { type: "PING" });
    if (resp?.ok) return;
  } catch (_) {}
  console.log(LOG, "inject youtube-page.js into tab", tabId);
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["youtube-page.js"],
  });
  await sleep(400);
}

async function sendTabExtract(tabId, videoId) {
  const reqId = Math.random().toString(36).slice(2);
  let lastErr = "";
  let injected = false;

  for (let i = 0; i < 15; i++) {
    try {
      const resp = await chrome.tabs.sendMessage(tabId, {
        type: "EXTRACT_ON_PAGE",
        videoId,
        reqId,
      });
      if (resp?.ok) return resp;
      lastErr = resp?.error || "頁面擷取失敗";
      break;
    } catch (e) {
      lastErr = e?.message || String(e);
      if (lastErr.includes("Could not establish connection") && !injected) {
        await ensureContentScript(tabId);
        injected = true;
      }
    }
    await sleep(400);
  }
  throw new Error(lastErr || "無法與 YouTube 分頁通訊");
}

async function extractViaYouTubeTab(videoId, reqId) {
  emitProgress(reqId, "parsing", 5);
  // Always open a fresh tab — reusing old tabs often lacks the content script
  // (opened before extension load/reload → "Receiving end does not exist").
  console.log(LOG, "open background YouTube tab…");
  const tab = await chrome.tabs.create({
    url: `https://www.youtube.com/watch?v=${videoId}`,
    active: false,
  });
  try {
    await waitTabComplete(tab.id);
    emitProgress(reqId, "parsing", 12);
    await ensureContentScript(tab.id);
    emitProgress(reqId, "parsing", 18);
    await sleep(600);
    const result = await sendTabExtract(tab.id, videoId);
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
  if (!meta?.ok) throw new Error(meta?.error || "擷取失敗");
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
    sendResponse({ ok: true, version: "0.4.1" });
    return false;
  }
});
