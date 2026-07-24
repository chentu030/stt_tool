/**
 * Minimal Cadence notes RPC client for sandboxed community iframes.
 * Host methods: cadence.notes.get | list | update | create | attach
 * Declare permissions: notes_read and/or notes_write in albireus.json
 * Remote attach via url also needs: network
 *
 * Usage (inside your extension page):
 *   <script src="https://YOUR_HOST/samples/notes-rpc-client.js"></script>
 *   const notes = await CadenceNotes.list({ q: "會議", limit: 20 });
 *   await CadenceNotes.attach(noteId, { filename: "a.png", dataUrl: "data:image/png;base64,…" });
 *   await CadenceNotes.attachFile(noteId, fileInput.files[0]);
 */
(function (global) {
  "use strict";

  var RESULT = "cadence.notes.result";
  var pending = Object.create(null);

  function reqId() {
    if (global.crypto && typeof global.crypto.randomUUID === "function") {
      return global.crypto.randomUUID();
    }
    return "r_" + Date.now() + "_" + Math.random().toString(36).slice(2, 10);
  }

  function call(type, params, timeoutMs) {
    var id = reqId();
    var ms = typeof timeoutMs === "number" ? timeoutMs : 20000;
    return new Promise(function (resolve, reject) {
      pending[id] = { resolve: resolve, reject: reject };
      var payload = Object.assign({ type: type, reqId: id }, params || {});
      try {
        global.parent.postMessage(payload, "*");
      } catch (err) {
        delete pending[id];
        reject(err);
        return;
      }
      global.setTimeout(function () {
        if (!pending[id]) return;
        delete pending[id];
        reject(new Error("notes RPC timeout"));
      }, ms);
    });
  }

  global.addEventListener("message", function (e) {
    var data = e && e.data;
    if (!data || data.type !== RESULT || !data.reqId) return;
    var slot = pending[data.reqId];
    if (!slot) return;
    delete pending[data.reqId];
    if (data.ok) slot.resolve(data.data);
    else {
      var err = new Error((data.error && data.error.message) || "notes RPC failed");
      err.code = data.error && data.error.code;
      slot.reject(err);
    }
  });

  global.CadenceNotes = {
    get: function (noteId) {
      return call("cadence.notes.get", { noteId: noteId });
    },
    list: function (opts) {
      return call("cadence.notes.list", opts || {});
    },
    update: function (noteId, patch) {
      return call("cadence.notes.update", { noteId: noteId, patch: patch || {} });
    },
    create: function (fields) {
      return call("cadence.notes.create", fields || {});
    },
    /**
     * Attach a file to a writable note.
     * opts: { filename?, contentType?, dataBase64? | dataUrl? | url?, insert?: "append"|"none" }
     * Default timeout 120s (upload).
     */
    attach: function (noteId, opts, timeoutMs) {
      var params = Object.assign({ noteId: noteId }, opts || {});
      return call(
        "cadence.notes.attach",
        params,
        typeof timeoutMs === "number" ? timeoutMs : 120000
      );
    },
    /** Read a browser File/Blob as dataUrl and attach. */
    attachFile: function (noteId, file, opts, timeoutMs) {
      return new Promise(function (resolve, reject) {
        if (!file) {
          reject(new Error("缺少 file"));
          return;
        }
        var reader = new FileReader();
        reader.onload = function () {
          var dataUrl = reader.result;
          if (typeof dataUrl !== "string") {
            reject(new Error("無法讀取檔案"));
            return;
          }
          var merged = Object.assign({}, opts || {}, {
            filename: (opts && opts.filename) || file.name || "attachment",
            contentType: (opts && opts.contentType) || file.type || undefined,
            dataUrl: dataUrl,
          });
          global.CadenceNotes.attach(noteId, merged, timeoutMs).then(resolve, reject);
        };
        reader.onerror = function () {
          reject(reader.error || new Error("讀取檔案失敗"));
        };
        reader.readAsDataURL(file);
      });
    },
  };
})(typeof window !== "undefined" ? window : globalThis);
