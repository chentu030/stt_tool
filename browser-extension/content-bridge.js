// ─────────────────────────────────────────────────────────────
// Content script injected into the transcription site.
// Bridges the web page <-> the extension's service worker via window.postMessage
// (page cannot talk to the service worker directly).
// ─────────────────────────────────────────────────────────────

(function () {
  function announce() {
    window.postMessage({ source: "stt-ext", type: "READY" }, "*");
  }

  // Tell the page the extension is installed (now and after it loads).
  announce();
  document.addEventListener("DOMContentLoaded", announce);

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
