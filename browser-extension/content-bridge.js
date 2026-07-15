// ─────────────────────────────────────────────────────────────
// Content script injected into the transcription site.
// Bridges the web page <-> the extension's service worker via window.postMessage
// (page cannot talk to the service worker directly).
// ─────────────────────────────────────────────────────────────

(function () {
  console.log("[stt-ext] content bridge injected on", location.href);

  function announce() {
    window.postMessage({ source: "stt-ext", type: "READY" }, "*");
  }

  // Tell the page the extension is installed (now and after it loads).
  announce();
  document.addEventListener("DOMContentLoaded", announce);
  // Re-announce a few times in case the page's listener attaches after us.
  let n = 0;
  const iv = setInterval(() => {
    announce();
    if (++n >= 5) clearInterval(iv);
  }, 400);

  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    const d = event.data;
    if (!d || d.source !== "stt-page") return;

    if (d.type === "PING") {
      announce();
      return;
    }

    if (d.type === "EXTRACT_AUDIO") {
      chrome.runtime.sendMessage({ type: "EXTRACT_AUDIO", url: d.url }, (resp) => {
        const err = chrome.runtime.lastError;
        window.postMessage(
          {
            source: "stt-ext",
            type: "EXTRACT_RESULT",
            reqId: d.reqId,
            result: err ? { ok: false, error: err.message } : resp,
          },
          "*"
        );
      });
    }
  });
})();
