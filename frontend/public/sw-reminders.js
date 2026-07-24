/**
 * Cadence schedule reminders — keeps firing when the app tab is closed
 * (Chromium Notification Triggers when available; otherwise wakes via SW messages).
 */
/* eslint-disable no-undef */

const DB_NAME = "cadence_reminders_sw_v1";
const STORE = "pending";
const FIRED_STORE = "fired";

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "key" });
      if (!db.objectStoreNames.contains(FIRED_STORE)) db.createObjectStore(FIRED_STORE, { keyPath: "key" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idbReq(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function putAll(reminders) {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    await idbReq(store.clear());
    for (const r of reminders) {
      await idbReq(store.put(r));
    }
    await new Promise((res, rej) => {
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
  } finally {
    db.close();
  }
}

async function listPending() {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE, "readonly");
    return (await idbReq(tx.objectStore(STORE).getAll())) || [];
  } finally {
    db.close();
  }
}

async function wasFired(key) {
  const db = await openDb();
  try {
    const tx = db.transaction(FIRED_STORE, "readonly");
    const row = await idbReq(tx.objectStore(FIRED_STORE).get(key));
    return !!row;
  } finally {
    db.close();
  }
}

async function markFired(key) {
  const db = await openDb();
  try {
    const tx = db.transaction(FIRED_STORE, "readwrite");
    await idbReq(tx.objectStore(FIRED_STORE).put({ key, at: Date.now() }));
  } finally {
    db.close();
  }
}

function supportsTimestampTrigger() {
  try {
    return typeof TimestampTrigger === "function";
  } catch {
    return false;
  }
}

async function showAt(reminder) {
  if (await wasFired(reminder.key)) return;
  const opts = {
    body: reminder.body || "",
    tag: reminder.key,
    data: { url: reminder.url || "/journal", key: reminder.key },
    renotify: true,
  };
  if (supportsTimestampTrigger() && reminder.fireAt > Date.now() + 1500) {
    try {
      opts.showTrigger = new TimestampTrigger(reminder.fireAt);
    } catch {
      /* fall through */
    }
  }
  if (reminder.fireAt > Date.now() + 1500 && !opts.showTrigger) {
    // No trigger support — skip future items; page timers handle while open.
    return;
  }
  await markFired(reminder.key);
  await self.registration.showNotification(reminder.title || "行程提醒", opts);
}

async function armAll() {
  const list = await listPending();
  const now = Date.now();
  for (const r of list) {
    if (!r || !r.key || !r.fireAt) continue;
    if (r.fireAt < now - 60_000) continue;
    if (r.fireAt <= now + 1500) {
      await showAt(r);
      continue;
    }
    if (supportsTimestampTrigger()) {
      await showAt(r);
    }
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      await self.clients.claim();
      await armAll();
    })()
  );
});

self.addEventListener("message", (event) => {
  const data = event.data || {};
  if (data.type === "SYNC_REMINDERS" && Array.isArray(data.reminders)) {
    event.waitUntil(
      (async () => {
        await putAll(
          data.reminders.map((r) => ({
            key: String(r.key || ""),
            title: String(r.title || "行程提醒"),
            body: String(r.body || ""),
            url: String(r.url || "/journal"),
            fireAt: Number(r.fireAt) || 0,
          })).filter((r) => r.key && r.fireAt)
        );
        await armAll();
      })()
    );
  }
  if (data.type === "CHECK_DUE") {
    event.waitUntil(armAll());
  }
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/journal";
  event.waitUntil(
    (async () => {
      const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const c of clients) {
        if ("focus" in c) {
          await c.focus();
          if ("navigate" in c) await c.navigate(url);
          return;
        }
      }
      await self.clients.openWindow(url);
    })()
  );
});

self.addEventListener("periodicsync", (event) => {
  if (event.tag === "cadence-reminders") {
    event.waitUntil(armAll());
  }
});
