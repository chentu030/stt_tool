// ─────────────────────────────────────────────────────────────
// Service worker: extracts YouTube audio using the USER's IP.
//
// Primary path (v0.3): open a background YouTube tab and run InnerTube from
// the *page* context (same origin, ytcfg visitorData, normal cookies).
// Fallback: direct InnerTube from the service worker (often LOGIN_REQUIRED).
// ─────────────────────────────────────────────────────────────

const LOG = "[stt-ext]";

const AUDIO_ITAG_PREFERENCE = [140, 251, 250, 249, 139, 18];
const INNERTUBE_KEY = "AIzaSyA8eiZmM1FaDVjRy-df2KTyQ_vz_yYM39w";

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
  } catch (_) {
    /* not a URL */
  }
  if (/^[a-zA-Z0-9_-]{11}$/.test(input)) return input;
  return null;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function waitTabComplete(tabId, timeoutMs = 45000) {
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

async function sendTabExtract(tabId, videoId) {
  const reqId = Math.random().toString(36).slice(2);
  let lastErr = "";
  for (let i = 0; i < 8; i++) {
    try {
      const resp = await chrome.tabs.sendMessage(tabId, {
        type: "EXTRACT_ON_PAGE",
        videoId,
        reqId,
      });
      if (resp?.ok) return resp;
      lastErr = resp?.error || "頁面擷取失敗";
    } catch (e) {
      lastErr = e?.message || String(e);
    }
    await sleep(800);
  }
  throw new Error(lastErr || "無法與 YouTube 分頁通訊");
}

async function extractViaYouTubeTab(videoId) {
  console.log(LOG, "opening background YouTube tab…");
  const tab = await chrome.tabs.create({
    url: `https://www.youtube.com/watch?v=${videoId}`,
    active: false,
  });
  try {
    await waitTabComplete(tab.id);
    await sleep(1500); // let ytcfg initialise
    const result = await sendTabExtract(tab.id, videoId);
    console.log(LOG, "page extract ok:", result.title);
    return result;
  } finally {
    chrome.tabs.remove(tab.id).catch(() => {});
  }
}

async function fetchPlayerSw(videoId, client) {
  const body = {
    context: { client: client.ctx },
    videoId,
    playbackContext: { contentPlaybackContext: { html5Preference: "HTML5_PREF_WANTS" } },
    contentCheckOk: true,
    racyCheckOk: true,
  };
  const res = await fetch(
    `https://www.youtube.com/youtubei/v1/player?prettyPrint=false`,
    {
      method: "POST",
      credentials: "omit",
      headers: {
        "Content-Type": "application/json",
        "X-YouTube-Client-Name": client.id,
        "X-YouTube-Client-Version": client.ctx.clientVersion,
      },
      body: JSON.stringify(body),
    }
  );
  if (!res.ok) throw new Error(`${client.name} HTTP ${res.status}`);
  return res.json();
}

function pickAudio(streamingData) {
  const fmts = (streamingData?.adaptiveFormats || []).filter(
    (f) => (f.mimeType || "").startsWith("audio/") && f.url
  );
  if (!fmts.length) {
    const combined = (streamingData?.formats || []).find((f) => f.url && f.itag === 18);
    return combined || null;
  }
  fmts.sort((a, b) => {
    const ia = AUDIO_ITAG_PREFERENCE.indexOf(a.itag);
    const ib = AUDIO_ITAG_PREFERENCE.indexOf(b.itag);
    const ra = ia === -1 ? 99 : ia;
    const rb = ib === -1 ? 99 : ib;
    if (ra !== rb) return ra - rb;
    return (b.bitrate || 0) - (a.bitrate || 0);
  });
  return fmts[0];
}

function extFromMime(mime) {
  if (mime.includes("mp4") || mime.includes("m4a")) return "m4a";
  if (mime.includes("webm") || mime.includes("opus")) return "webm";
  return "audio";
}

function arrayBufferToBase64(buf) {
  const bytes = new Uint8Array(buf);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

async function extractViaServiceWorker(videoId) {
  const errors = [];
  for (const client of SW_CLIENTS) {
    try {
      const player = await fetchPlayerSw(videoId, client);
      const status = player?.playabilityStatus?.status;
      if (status !== "OK") {
        errors.push(`${client.name}: ${status} ${player?.playabilityStatus?.reason || ""}`);
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
  throw new Error("背景 API 備援失敗（" + errors.join(" / ") + "）");
}

async function extractAudio(url) {
  const videoId = parseVideoId(url);
  if (!videoId) throw new Error("無法辨識 YouTube 影片網址");
  console.log(LOG, "extract videoId:", videoId);

  let meta = null;
  let tabErr = "";
  try {
    meta = await extractViaYouTubeTab(videoId);
  } catch (e) {
    tabErr = e?.message || String(e);
    console.warn(LOG, "tab extract failed:", tabErr);
  }

  if (!meta?.ok) {
    try {
      meta = await extractViaServiceWorker(videoId);
    } catch (swErr) {
      throw new Error(
        tabErr
          ? `YouTube 分頁擷取失敗：${tabErr}；${swErr?.message || swErr}`
          : swErr?.message || String(swErr)
      );
    }
  }

  const safeTitle = String(meta.title || videoId).replace(/[\\/:*?"<>|]/g, "_").slice(0, 120);
  console.log(LOG, "downloading audio…");
  const audioRes = await fetch(meta.audioUrl, { credentials: "omit" });
  if (!audioRes.ok) throw new Error("下載音訊失敗 HTTP " + audioRes.status);
  const buf = await audioRes.arrayBuffer();
  console.log(LOG, "downloaded", buf.byteLength, "bytes");

  return {
    base64: arrayBufferToBase64(buf),
    filename: `${safeTitle}.${extFromMime(meta.mime || "")}`,
    mime: meta.mime || "audio/mp4",
    bytes: buf.byteLength,
  };
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "EXTRACT_AUDIO") {
    console.log(LOG, "EXTRACT_AUDIO request:", msg.url);
    extractAudio(msg.url)
      .then((r) => {
        console.log(LOG, "done:", r.filename, r.bytes, "bytes");
        sendResponse({ ok: true, ...r });
      })
      .catch((e) => {
        console.error(LOG, "error:", e);
        sendResponse({ ok: false, error: String(e?.message || e) });
      });
    return true;
  }
  if (msg?.type === "PING") {
    sendResponse({ ok: true, version: "0.3.0" });
    return false;
  }
});
