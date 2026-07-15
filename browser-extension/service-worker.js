// ─────────────────────────────────────────────────────────────
// Service worker v0.4 — fast path: reuse YouTube tab, download as Blob,
// upload straight to Firebase (no base64 round-trip through the page).
// ─────────────────────────────────────────────────────────────

const LOG = "[stt-ext]";
const FB_BUCKET = "stt-tool-f6e6d.firebasestorage.app";
const AUDIO_ITAG_PREFERENCE = [140, 251, 250, 249, 139, 18];

const SW_CLIENTS = [
  {
    name: "ANDROID_VR",
    id: "28",
    ctx: {
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
];

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

function waitTabComplete(tabId, timeoutMs = 22000) {
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

async function findOrOpenYouTubeTab(videoId) {
  const tabs = await chrome.tabs.query({ url: ["*://*.youtube.com/*"] });
  for (const t of tabs) {
    try {
      const u = new URL(t.url || "");
      const v = u.searchParams.get("v");
      if (v === videoId) {
        console.log(LOG, "reuse existing YouTube tab", t.id);
        return { tabId: t.id, created: false };
      }
    } catch (_) {}
  }
  console.log(LOG, "open background YouTube tab…");
  const tab = await chrome.tabs.create({
    url: `https://www.youtube.com/watch?v=${videoId}`,
    active: false,
  });
  return { tabId: tab.id, created: true };
}

async function sendTabExtract(tabId, videoId) {
  const reqId = Math.random().toString(36).slice(2);
  let lastErr = "";
  for (let i = 0; i < 12; i++) {
    try {
      const resp = await chrome.tabs.sendMessage(tabId, {
        type: "EXTRACT_ON_PAGE",
        videoId,
        reqId,
      });
      if (resp?.ok) return resp;
      lastErr = resp?.error || "頁面擷取失敗";
      if (!lastErr.includes("Could not establish")) break;
    } catch (e) {
      lastErr = e?.message || String(e);
    }
    await sleep(350);
  }
  throw new Error(lastErr || "無法與 YouTube 分頁通訊");
}

async function extractViaYouTubeTab(videoId, reqId) {
  emitProgress(reqId, "parsing", 5);
  const { tabId, created } = await findOrOpenYouTubeTab(videoId);
  try {
    if (created) await waitTabComplete(tabId);
    else await sleep(300);
    emitProgress(reqId, "parsing", 15);
    await sleep(created ? 600 : 200);
    const result = await sendTabExtract(tabId, videoId);
    emitProgress(reqId, "parsing", 30);
    return result;
  } finally {
    if (created) chrome.tabs.remove(tabId).catch(() => {});
  }
}

async function fetchPlayerSw(videoId, client) {
  const body = {
    context: { client: client.ctx },
    videoId,
    contentCheckOk: true,
    racyCheckOk: true,
  };
  const res = await fetch("https://www.youtube.com/youtubei/v1/player?prettyPrint=false", {
    method: "POST",
    credentials: "omit",
    headers: {
      "Content-Type": "application/json",
      "X-YouTube-Client-Name": client.id,
      "X-YouTube-Client-Version": client.ctx.clientVersion,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${client.name} HTTP ${res.status}`);
  return res.json();
}

function pickAudio(streamingData) {
  const fmts = (streamingData?.adaptiveFormats || []).filter(
    (f) => (f.mimeType || "").startsWith("audio/") && f.url
  );
  if (!fmts.length) {
    return (streamingData?.formats || []).find((f) => f.url && f.itag === 18) || null;
  }
  fmts.sort((a, b) => {
    const ia = AUDIO_ITAG_PREFERENCE.indexOf(a.itag);
    const ib = AUDIO_ITAG_PREFERENCE.indexOf(b.itag);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib) || (b.bitrate || 0) - (a.bitrate || 0);
  });
  return fmts[0];
}

async function extractViaServiceWorker(videoId) {
  const errors = [];
  for (const client of SW_CLIENTS) {
    try {
      const player = await fetchPlayerSw(videoId, client);
      const status = player?.playabilityStatus?.status;
      if (status !== "OK") {
        errors.push(`${client.name}: ${status}`);
        continue;
      }
      const fmt = pickAudio(player.streamingData);
      if (!fmt) {
        errors.push(`${client.name}: 無直連音訊`);
        continue;
      }
      return {
        ok: true,
        audioUrl: fmt.url,
        mime: (fmt.mimeType || "audio/mp4").split(";")[0],
        title: player?.videoDetails?.title || videoId,
      };
    } catch (e) {
      errors.push(`${client.name}: ${e?.message || e}`);
    }
  }
  throw new Error(errors.join(" / "));
}

async function resolveAudioMeta(url, reqId) {
  const videoId = parseVideoId(url);
  if (!videoId) throw new Error("無法辨識 YouTube 影片網址");

  let tabErr = "";
  try {
    const meta = await extractViaYouTubeTab(videoId, reqId);
    if (meta?.ok) return { videoId, ...meta };
  } catch (e) {
    tabErr = e?.message || String(e);
    console.warn(LOG, "tab extract:", tabErr);
  }

  emitProgress(reqId, "parsing", 20);
  try {
    const meta = await extractViaServiceWorker(videoId);
    return { videoId, ...meta };
  } catch (swErr) {
    throw new Error(
      tabErr ? `YouTube 分頁：${tabErr}；API 備援：${swErr?.message || swErr}` : swErr?.message || String(swErr)
    );
  }
}

async function downloadBlob(url, reqId) {
  emitProgress(reqId, "downloading", 0);
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

  console.log(LOG, "download", filename);
  const blob = await downloadBlob(meta.audioUrl, reqId);

  console.log(LOG, "upload", storagePath, blob.size, "bytes");
  await uploadToFirebase(storagePath, idToken, blob, meta.mime, reqId);

  return { ok: true, filename, storagePath, bytes: blob.size, mime: meta.mime };
}

// Legacy: return base64 (slow for large files — kept for compatibility)
async function extractAudioLegacy(url) {
  const meta = await resolveAudioMeta(url, null);
  const blob = await downloadBlob(meta.audioUrl, null);
  const buf = await blob.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return {
    ok: true,
    base64: btoa(binary),
    filename: safeName(meta.title, meta.videoId, meta.mime),
    mime: meta.mime,
    bytes: buf.byteLength,
  };
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "EXTRACT_AND_UPLOAD") {
    extractAndUpload(msg)
      .then(sendResponse)
      .catch((e) => sendResponse({ ok: false, error: String(e?.message || e) }));
    return true;
  }
  if (msg?.type === "EXTRACT_AUDIO") {
    extractAudioLegacy(msg.url)
      .then(sendResponse)
      .catch((e) => sendResponse({ ok: false, error: String(e?.message || e) }));
    return true;
  }
  if (msg?.type === "PING") {
    sendResponse({ ok: true, version: "0.4.0" });
    return false;
  }
});
