/* Albireus paid shell: embed HTTPS realtime dashboard via settings.dashboard_url */
(function () {
  const LS = "albireus_rt_dash_url_v1";
  const gate = document.getElementById("gate");
  const frame = document.getElementById("frame");
  const urlInput = document.getElementById("urlInput");
  const hint = document.getElementById("hint");
  const btnSave = document.getElementById("btnSave");

  function qs() {
    try {
      return new URLSearchParams(location.search);
    } catch {
      return new URLSearchParams();
    }
  }

  function parseHostSettings() {
    const q = qs();
    let s = {};
    try {
      s = JSON.parse(q.get("settings") || "{}") || {};
    } catch {
      s = {};
    }
    for (const [k, v] of q.entries()) {
      if (k.startsWith("s_") && k.length > 2) s[k.slice(2)] = v;
    }
    return s;
  }

  function normalizeHttps(raw) {
    const u = String(raw || "").trim();
    if (!u) return "";
    if (/^https:\/\//i.test(u)) return u;
    if (/^http:\/\//i.test(u)) return "";
    if (/^[\w.-]+\//.test(u) || /^[\w.-]+:/.test(u)) return `https://${u}`;
    return "";
  }

  function loadLocal() {
    try {
      return localStorage.getItem(LS) || "";
    } catch {
      return "";
    }
  }

  function saveLocal(url) {
    try {
      localStorage.setItem(LS, url);
    } catch {
      /* ignore */
    }
  }

  function showGate(msg) {
    gate.hidden = false;
    frame.hidden = true;
    frame.removeAttribute("src");
    if (msg) hint.textContent = msg;
  }

  function showFrame(url) {
    gate.hidden = true;
    frame.hidden = false;
    frame.src = url;
  }

  function applyUrl(raw, opts) {
    const url = normalizeHttps(raw);
    if (!url) {
      showGate(
        String(raw || "").trim().toLowerCase().startsWith("http://")
          ? "必須使用 HTTPS 網址（HTTP 無法嵌在 Albireus）"
          : "請輸入有效的 https:// 網址"
      );
      urlInput.value = String(raw || "").trim();
      return false;
    }
    if (opts && opts.persist) saveLocal(url);
    urlInput.value = url;
    showFrame(url);
    return true;
  }

  function resolveInitial() {
    const host = parseHostSettings();
    const fromHost = host.dashboard_url || host.url || "";
    if (fromHost && applyUrl(fromHost, { persist: true })) return;
    const local = loadLocal();
    if (local && applyUrl(local, { persist: false })) return;
    showGate("");
  }

  btnSave.addEventListener("click", () => {
    hint.textContent = "";
    applyUrl(urlInput.value, { persist: true });
  });

  urlInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      btnSave.click();
    }
  });

  window.addEventListener("message", (e) => {
    if (e.data && e.data.type === "albireus:settings") {
      const s = e.data.settings || {};
      const next = s.dashboard_url || s.url;
      if (next) applyUrl(next, { persist: true });
    }
  });

  resolveInitial();
})();
