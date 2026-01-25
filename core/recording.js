const DB_NAME = "racetimer-recording";
const STORE_NAME = "chunks";
const DB_VERSION = 2;
const DEFAULT_MAX_QUEUE_BYTES = 5 * 1024 * 1024;
const DEFAULT_CHUNK_BYTES = 512 * 1024;
const FLUSH_INTERVAL_MS = 2000;
const UPLOAD_RETRY_DELAY_MS = 10000;
const DEVICE_ID_KEY = "racetimer-device-id";

const encoder = typeof TextEncoder !== "undefined" ? new TextEncoder() : null;

let recordingEnabled = false;
let sessionId = null;
let deviceId = null;
let sessionStartedAt = null;
let chunkSequence = 0;
let pendingLines = [];
let pendingBytes = 0;
let pendingFirstTs = null;
let pendingLastTs = null;
let flushTimer = null;
let flushChain = Promise.resolve();
let dbPromise = null;

let uploadEndpoint = "";
let getUploadToken = null;
let maxQueueBytes = DEFAULT_MAX_QUEUE_BYTES;
let chunkTargetBytes = DEFAULT_CHUNK_BYTES;
let uploadInProgress = false;
let uploadRetryTimer = null;

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

function getByteLength(text) {
  if (!text) return 0;
  if (encoder) return encoder.encode(text).length;
  return String(text).length;
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
      if (db.objectStoreNames.contains("records")) {
        db.deleteObjectStore("records");
      }
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, {
          keyPath: "id",
        });
        store.createIndex("createdAt", "createdAt");
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("IndexedDB error"));
  });
  return dbPromise;
}

function buildSessionId() {
  return `sess-${Date.now()}-${randomId(6)}`;
}

function isRecordingEnabled() {
  return recordingEnabled;
}

function configureRecordingUpload(options = {}) {
  uploadEndpoint = typeof options.endpoint === "string" ? options.endpoint : "";
  getUploadToken = typeof options.getToken === "function" ? options.getToken : null;
  if (Number.isFinite(options.maxQueueBytes) && options.maxQueueBytes > 0) {
    maxQueueBytes = options.maxQueueBytes;
  }
  if (Number.isFinite(options.chunkTargetBytes) && options.chunkTargetBytes > 0) {
    chunkTargetBytes = options.chunkTargetBytes;
  }
}

function clearFlushTimer() {
  if (!flushTimer) return;
  clearTimeout(flushTimer);
  flushTimer = null;
}

function scheduleFlush() {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushPendingChunk();
  }, FLUSH_INTERVAL_MS);
}

function queueRecord(record) {
  const line = JSON.stringify(record);
  const lineBytes = getByteLength(line) + 1;
  if (pendingLines.length && pendingBytes + lineBytes > chunkTargetBytes) {
    flushPendingChunk();
  }
  pendingLines.push(line);
  pendingBytes += lineBytes;
  if (!Number.isFinite(pendingFirstTs)) {
    pendingFirstTs = record.ts;
  }
  pendingLastTs = record.ts;
  scheduleFlush();
}

function flushPendingChunk() {
  if (!pendingLines.length) {
    clearFlushTimer();
    return;
  }
  const lines = pendingLines;
  const bytes = pendingBytes;
  const firstTs = pendingFirstTs;
  const lastTs = pendingLastTs;
  pendingLines = [];
  pendingBytes = 0;
  pendingFirstTs = null;
  pendingLastTs = null;
  clearFlushTimer();

  const payload = `${lines.join("\n")}\n`;
  const chunk = {
    id: `chunk-${Date.now()}-${randomId(4)}`,
    kind: "data",
    createdAt: Date.now(),
    sessionId,
    deviceId,
    sequence: chunkSequence,
    byteLength: bytes,
    firstTs,
    lastTs,
    payload,
  };
  chunkSequence += 1;
  flushChain = flushChain
    .then(() => writeChunk(chunk, { prune: true }))
    .catch((err) => {
      console.warn("Recording flush failed", err);
    });
}

async function flushRecording() {
  flushPendingChunk();
  await flushChain;
}

async function writeChunk(chunk, options = {}) {
  const db = await openRecordingDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    store.add(chunk);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error("IndexedDB write failed"));
    tx.onabort = () => reject(tx.error || new Error("IndexedDB write aborted"));
  });
  if (options.prune) {
    await pruneQueueToSize(db);
  }
  scheduleUpload(0);
}

async function pruneQueueToSize(db) {
  if (!Number.isFinite(maxQueueBytes) || maxQueueBytes <= 0) return;
  let total = 0;
  const toDelete = [];
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const index = store.index("createdAt");
    index.openCursor(null, "prev").onsuccess = (event) => {
      const cursor = event.target.result;
      if (!cursor) {
        resolve();
        return;
      }
      const value = cursor.value || {};
      const kind = value.kind || "data";
      if (kind === "data") {
        const size = Number.isFinite(value.byteLength) ? value.byteLength : 0;
        total += size;
        if (total > maxQueueBytes) {
          toDelete.push(cursor.primaryKey);
        }
      }
      cursor.continue();
    };
    tx.onerror = () => reject(tx.error || new Error("IndexedDB read failed"));
  });
  if (!toDelete.length) return;
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    toDelete.forEach((key) => store.delete(key));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error("IndexedDB prune failed"));
    tx.onabort = () => reject(tx.error || new Error("IndexedDB prune aborted"));
  });
}

async function getOldestChunk() {
  const db = await openRecordingDb();
  return await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const index = store.index("createdAt");
    const request = index.openCursor();
    request.onsuccess = (event) => {
      const cursor = event.target.result;
      if (!cursor) {
        resolve(null);
        return;
      }
      resolve(cursor.value || null);
    };
    request.onerror = () => reject(request.error || new Error("IndexedDB read failed"));
  });
}

async function deleteChunk(id) {
  const db = await openRecordingDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    store.delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error("IndexedDB delete failed"));
    tx.onabort = () => reject(tx.error || new Error("IndexedDB delete aborted"));
  });
}

function scheduleUpload(delayMs) {
  if (!uploadEndpoint) return;
  if (uploadRetryTimer) return;
  const delay = Number.isFinite(delayMs) ? delayMs : 0;
  uploadRetryTimer = setTimeout(() => {
    uploadRetryTimer = null;
    drainUploadQueue();
  }, delay);
}

async function uploadChunk(chunk) {
  if (!uploadEndpoint || !chunk) return false;
  if (typeof navigator !== "undefined" && "onLine" in navigator && !navigator.onLine) {
    return false;
  }
  const headers = {
    "Content-Type": "application/x-ndjson",
    "X-Device-Id": chunk.deviceId || "unknown",
    "X-Session-Id": chunk.sessionId || "unknown",
    "X-Chunk-Id": chunk.id,
    "X-Chunk-Index": String(chunk.sequence ?? 0),
    "X-Chunk-Kind": chunk.kind || "data",
    "X-Chunk-Bytes": String(chunk.byteLength || 0),
  };
  if (Number.isFinite(chunk.firstTs)) {
    headers["X-Chunk-First-Ts"] = String(chunk.firstTs);
  }
  if (Number.isFinite(chunk.lastTs)) {
    headers["X-Chunk-Last-Ts"] = String(chunk.lastTs);
  }
  const token = getUploadToken ? getUploadToken() : "";
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }
  const body = new Blob([chunk.payload || ""], { type: "application/x-ndjson" });
  const response = await fetch(uploadEndpoint, {
    method: "POST",
    headers,
    body,
  });
  return response.ok;
}

async function drainUploadQueue() {
  if (uploadInProgress) return;
  uploadInProgress = true;
  try {
    while (true) {
      const chunk = await getOldestChunk();
      if (!chunk) break;
      const ok = await uploadChunk(chunk);
      if (!ok) {
        scheduleUpload(UPLOAD_RETRY_DELAY_MS);
        break;
      }
      await deleteChunk(chunk.id);
    }
  } catch (err) {
    console.warn("Upload failed", err);
    scheduleUpload(UPLOAD_RETRY_DELAY_MS);
  } finally {
    uploadInProgress = false;
  }
}

function resumeUploadQueue() {
  scheduleUpload(0);
}

function resetPendingBuffer() {
  pendingLines = [];
  pendingBytes = 0;
  pendingFirstTs = null;
  pendingLastTs = null;
  clearFlushTimer();
  flushChain = Promise.resolve();
}

async function enqueueMetaChunk(meta) {
  const record = {
    ts: sessionStartedAt,
    type: "meta",
    sessionId,
    deviceId,
    payload: meta || null,
  };
  const payload = `${JSON.stringify(record)}\n`;
  const bytes = getByteLength(payload);
  const chunk = {
    id: `meta-${sessionId}`,
    kind: "meta",
    createdAt: sessionStartedAt,
    sessionId,
    deviceId,
    sequence: chunkSequence,
    byteLength: bytes,
    firstTs: record.ts,
    lastTs: record.ts,
    payload,
  };
  chunkSequence += 1;
  flushChain = flushChain
    .then(() => writeChunk(chunk, { prune: false }))
    .catch((err) => {
      console.warn("Meta write failed", err);
    });
}

async function enqueueFinalChunk() {
  const ts = Date.now();
  const record = {
    ts,
    type: "final",
    sessionId,
    deviceId,
    payload: { endedAt: ts },
  };
  const payload = `${JSON.stringify(record)}\n`;
  const bytes = getByteLength(payload);
  const chunk = {
    id: `final-${sessionId}-${randomId(4)}`,
    kind: "final",
    createdAt: ts,
    sessionId,
    deviceId,
    sequence: chunkSequence,
    byteLength: bytes,
    firstTs: ts,
    lastTs: ts,
    payload,
  };
  chunkSequence += 1;
  flushChain = flushChain
    .then(() => writeChunk(chunk, { prune: false }))
    .catch((err) => {
      console.warn("Final write failed", err);
    });
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
  chunkSequence = 0;
  resetPendingBuffer();
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
  await enqueueMetaChunk(payload);
  scheduleUpload(0);
  return { ok: true, sessionId, deviceId };
}

function stopRecording() {
  if (!recordingEnabled) return;
  recordingEnabled = false;
  flushPendingChunk();
  enqueueFinalChunk();
  scheduleUpload(0);
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
  flushRecording,
  getDeviceId,
  configureRecordingUpload,
  resumeUploadQueue,
};
