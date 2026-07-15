// Bridges the transcription site <-> extension service worker.

(function () {
  console.log("[stt-ext] content bridge injected on", location.href);

  function announce() {
    window.postMessage({ source: "stt-ext", type: "READY", version: "0.4.1" }, "*");
  }

  announce();
  document.addEventListener("DOMContentLoaded", announce);
  let n = 0;
  const iv = setInterval(() => {
    announce();
    if (++n >= 5) clearInterval(iv);
  }, 400);

  // Forward progress from service worker to the page.
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type !== "PROGRESS" || !msg.reqId) return;
    window.postMessage(
      { source: "stt-ext", type: "EXTRACT_PROGRESS", reqId: msg.reqId, stage: msg.stage, pct: msg.pct },
      "*"
    );
  });

  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    const d = event.data;
    if (!d || d.source !== "stt-page") return;

    if (d.type === "PING") {
      announce();
      return;
    }

    const reply = (result) => {
      window.postMessage(
        { source: "stt-ext", type: "EXTRACT_RESULT", reqId: d.reqId, result },
        "*"
      );
    };

    if (d.type === "EXTRACT_AND_UPLOAD") {
      chrome.runtime.sendMessage(
        {
          type: "EXTRACT_AND_UPLOAD",
          url: d.url,
          uid: d.uid,
          jobId: d.jobId,
          idToken: d.idToken,
          reqId: d.reqId,
        },
        (resp) => {
          const err = chrome.runtime.lastError;
          reply(err ? { ok: false, error: err.message } : resp);
        }
      );
      return;
    }

    if (d.type === "EXTRACT_AUDIO") {
      chrome.runtime.sendMessage({ type: "EXTRACT_AUDIO", url: d.url }, (resp) => {
        const err = chrome.runtime.lastError;
        reply(err ? { ok: false, error: err.message } : resp);
      });
    }
  });
})();
