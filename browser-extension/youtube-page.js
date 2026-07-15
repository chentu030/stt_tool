// Content script on youtube.com — runs InnerTube inside the *page* context so
// requests look like a normal YouTube tab (same origin, visitorData, cookies).

const LOG = "[stt-yt-page]";

function injectPageExtract(videoId, reqId) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      window.removeEventListener("message", onMsg);
      reject(new Error("頁面擷取逾時（60 秒）"));
    }, 60000);

    function onMsg(e) {
      if (e.source !== window) return;
      const d = e.data;
      if (d?.source !== "stt-yt-page" || d.reqId !== reqId) return;
      clearTimeout(timer);
      window.removeEventListener("message", onMsg);
      if (d.error) reject(new Error(d.error));
      else resolve(d.result);
    }
    window.addEventListener("message", onMsg);

    const script = document.createElement("script");
    script.textContent = `(${pageExtractSource})(${JSON.stringify(videoId)}, ${JSON.stringify(reqId)})`;
    (document.head || document.documentElement).appendChild(script);
    script.remove();
  });
}

// Runs in the page's JS world (not the extension isolated world).
function pageExtractSource(videoId, reqId) {
  (async () => {
    const post = (payload) =>
      window.postMessage({ source: "stt-yt-page", reqId, ...payload }, "*");

    try {
      const cfg = (k) => (typeof ytcfg !== "undefined" && ytcfg.get ? ytcfg.get(k) : null);
      const visitorData = cfg("VISITOR_DATA");
      const apiKey = cfg("INNERTUBE_API_KEY");

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

      const AUDIO_ITAGS = [140, 251, 250, 249, 139, 18];
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
          const url = apiKey
            ? `/youtubei/v1/player?key=${encodeURIComponent(apiKey)}&prettyPrint=false`
            : "/youtubei/v1/player?prettyPrint=false";
          const r = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          });
          if (!r.ok) {
            errors.push(`${name}: HTTP ${r.status}`);
            continue;
          }
          const player = await r.json();
          const status = player?.playabilityStatus?.status;
          if (status !== "OK") {
            errors.push(`${name}: ${status} ${player?.playabilityStatus?.reason || ""}`);
            continue;
          }
          title = player?.videoDetails?.title || title;
          const fmts = (player.streamingData?.adaptiveFormats || []).filter(
            (f) => (f.mimeType || "").startsWith("audio/") && f.url
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
          // Combined stream (itag 18) as last resort inside this client
          const combined = (player.streamingData?.formats || []).find((f) => f.url && f.itag === 18);
          if (combined) {
            picked = combined;
            break;
          }
          errors.push(`${name}: 無直連音訊`);
        } catch (e) {
          errors.push(`${name}: ${e?.message || e}`);
        }
      }

      if (!picked) {
        post({ error: "找不到可下載的音訊（" + errors.join(" / ") + "）" });
        return;
      }

      post({
        result: {
          ok: true,
          audioUrl: picked.url,
          mime: (picked.mimeType || "audio/mp4").split(";")[0],
          title,
        },
      });
    } catch (e) {
      post({ error: String(e?.message || e) });
    }
  })();
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type !== "EXTRACT_ON_PAGE") return;
  console.log(LOG, "EXTRACT_ON_PAGE", msg.videoId);
  injectPageExtract(msg.videoId, msg.reqId || "page")
    .then((r) => sendResponse(r))
    .catch((e) => sendResponse({ ok: false, error: String(e?.message || e) }));
  return true;
});
