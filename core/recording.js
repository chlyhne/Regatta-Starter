const DB_NAME = "racetimer-recording";
const STORE_NAME = "records";
const DB_VERSION = 1;
const MAX_AGE_MS = 60 * 60 * 1000;
const FLUSH_INTERVAL_MS = 1000;
const PRUNE_INTERVAL_MS = 15000;
const MAX_BATCH_SIZE = 500;
const DEVICE_ID_KEY = "racetimer-device-id";

let recordingEnabled = false;
let sessionId = null;
let deviceId = null;
let sessionStartedAt = null;
let pendingRecords = [];
let flushTimer = null;
let lastPruneAt = 0;
let dbPromise = null;
let flushChain = Promise.resolve();

function randomId(length = 8) {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    const bytes = new Uint8Array(length);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
  }
  let out = "";
  for (let i = 0; i < length; i += 1) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return out;
}

function getDeviceId() {
  if (deviceId) return deviceId;
  if (typeof localStorage === "undefined") {
    deviceId = `rt-${randomId(12)}`;
    return deviceId;
  }
  const stored = localStorage.getItem(DEVICE_ID_KEY);
  if (stored) {
    deviceId = stored;
    return stored;
  }
  deviceId = `rt-${randomId(12)}`;
  localStorage.setItem(DEVICE_ID_KEY, deviceId);
  return deviceId;
}

function openRecordingDb() {
  if (dbPromise) return dbPromise;
  if (typeof indexedDB === "undefined") {
    dbPromise = Promise.reject(new Error("IndexedDB unavailable"));
    return dbPromise;
  }
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, {
          keyPath: "id",
          autoIncrement: true,
        });
        store.createIndex("ts", "ts");
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("IndexedDB error"));
  });
  return dbPromise;
}

function queueRecord(record) {
  pendingRecords.push(record);
  if (pendingRecords.length >= MAX_BATCH_SIZE) {
    flushPendingRecords();
    return;
  }
  if (!flushTimer) {
    flushTimer = setTimeout(flushPendingRecords, FLUSH_INTERVAL_MS);
  }
}

function flushPendingRecords() {
  if (!pendingRecords.length) {
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    return;
  }
  const records = pendingRecords.slice();
  pendingRecords = [];
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }

  flushChain = flushChain
    .then(() => writeRecords(records))
    .catch((err) => {
      console.warn("Recording flush failed", err);
    });
}

async function writeRecords(records) {
  if (!records.length) return;
  const db = await openRecordingDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    records.forEach((record) => store.add(record));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error("IndexedDB write failed"));
    tx.onabort = () => reject(tx.error || new Error("IndexedDB write aborted"));
  });
  pruneIfNeeded(db);
}

function pruneIfNeeded(db) {
  const now = Date.now();
  if (now - lastPruneAt < PRUNE_INTERVAL_MS) return;
  lastPruneAt = now;
  const cutoff = now - MAX_AGE_MS;
  const tx = db.transaction(STORE_NAME, "readwrite");
  const store = tx.objectStore(STORE_NAME);
  const index = store.index("ts");
  const range = IDBKeyRange.upperBound(cutoff, true);
  index.openCursor(range).onsuccess = (event) => {
    const cursor = event.target.result;
    if (!cursor) return;
    cursor.delete();
    cursor.continue();
  };
}

function buildSessionId() {
  return `sess-${Date.now()}-${randomId(6)}`;
}

function isRecordingEnabled() {
  return recordingEnabled;
}

async function startRecording(meta) {
  if (recordingEnabled) return { ok: true, sessionId, deviceId };
  try {
    await openRecordingDb();
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }

  sessionId = buildSessionId();
  deviceId = getDeviceId();
  sessionStartedAt = Date.now();
  recordingEnabled = true;

  const payload = {
    sessionId,
    deviceId,
    startedAt: sessionStartedAt,
    note: meta?.note || "",
    settings: meta?.settings || null,
    device: meta?.device || null,
    app: meta?.app || null,
  };
  queueRecord({
    ts: sessionStartedAt,
    type: "meta",
    sessionId,
    deviceId,
    payload,
  });
  return { ok: true, sessionId, deviceId };
}

function stopRecording() {
  if (!recordingEnabled) return;
  recordingEnabled = false;
  sessionId = null;
  sessionStartedAt = null;
  flushPendingRecords();
}

function recordSample(type, payload, timestamp) {
  if (!recordingEnabled) return;
  const ts = Number.isFinite(timestamp) ? timestamp : Date.now();
  queueRecord({
    ts,
    type,
    sessionId,
    deviceId,
    payload,
  });
}

export {
  isRecordingEnabled,
  startRecording,
  stopRecording,
  recordSample,
  getDeviceId,
};
