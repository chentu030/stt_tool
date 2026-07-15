// ─────────────────────────────────────────────────────────────
// Service worker: extracts YouTube audio using the USER's IP.
//
// YouTube blocks datacenter IPs (our Cloud Run backend), but this runs inside
// the user's own browser, so requests go out on their residential IP — exactly
// how TubeMate works. We use the ANDROID_VR InnerTube client because it returns
// direct (non-ciphered, PO-token-free) audio URLs, so no signature deciphering
// is needed.
// ─────────────────────────────────────────────────────────────

// Prefer m4a (140) then opus formats; fall back to highest audio bitrate.
const AUDIO_ITAG_PREFERENCE = [140, 251, 250, 249, 139, 18];

// Public InnerTube key used by the mobile clients.
const INNERTUBE_KEY = "AIzaSyA8eiZmM1FaDVjRy-df2KTyQ_vz_yYM39w";

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

async function fetchPlayer(videoId) {
  const body = {
    context: {
      client: {
        clientName: "ANDROID_VR",
        clientVersion: "1.60.19",
        deviceMake: "Oculus",
        deviceModel: "Quest 3",
        osName: "Android",
        osVersion: "12L",
        androidSdkVersion: 32,
        hl: "en",
        gl: "US",
        userAgent:
          "com.google.android.apps.youtube.vr.oculus/1.60.19 (Linux; U; Android 12L; en_US; Quest 3 Build/SQ3A.220605.009.A1) gzip",
      },
    },
    videoId,
    playbackContext: { contentPlaybackContext: { html5Preference: "HTML5_PREF_WANTS" } },
    contentCheckOk: true,
    racyCheckOk: true,
  };
  const res = await fetch(
    `https://youtubei.googleapis.com/youtubei/v1/player?key=${INNERTUBE_KEY}&prettyPrint=false`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-YouTube-Client-Name": "28",
        "X-YouTube-Client-Version": "1.60.19",
      },
      body: JSON.stringify(body),
    }
  );
  if (!res.ok) throw new Error("InnerTube player API HTTP " + res.status);
  return res.json();
}

function pickAudio(streamingData) {
  const fmts = (streamingData?.adaptiveFormats || []).filter(
    (f) => (f.mimeType || "").startsWith("audio/") && f.url
  );
  if (!fmts.length) return null;
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

async function extractAudio(url) {
  const videoId = parseVideoId(url);
  if (!videoId) throw new Error("無法辨識 YouTube 影片網址");

  const player = await fetchPlayer(videoId);
  const status = player?.playabilityStatus?.status;
  if (status && status !== "OK") {
    const reason = player?.playabilityStatus?.reason || "";
    throw new Error(`YouTube 拒絕播放 (${status}) ${reason}`);
  }

  const fmt = pickAudio(player.streamingData);
  if (!fmt) throw new Error("找不到可下載的音訊格式（可能為私人或受限影片）");

  const title = (player?.videoDetails?.title || videoId)
    .replace(/[\\/:*?"<>|]/g, "_")
    .slice(0, 120);

  const audioRes = await fetch(fmt.url);
  if (!audioRes.ok) throw new Error("下載音訊失敗 HTTP " + audioRes.status);
  const buf = await audioRes.arrayBuffer();

  return {
    base64: arrayBufferToBase64(buf),
    filename: `${title}.${extFromMime(fmt.mimeType || "")}`,
    mime: (fmt.mimeType || "audio/mp4").split(";")[0],
    bytes: buf.byteLength,
  };
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "EXTRACT_AUDIO") {
    extractAudio(msg.url)
      .then((r) => sendResponse({ ok: true, ...r }))
      .catch((e) => sendResponse({ ok: false, error: String(e?.message || e) }));
    return true; // keep the message channel open for the async response
  }
  if (msg?.type === "PING") {
    sendResponse({ ok: true });
    return false;
  }
});
