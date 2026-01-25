import { clamp } from "./common.js";
import { state } from "./state.js";

const REPLAY_MANIFEST_URL = "./replay/manifest.json";
const REPLAY_SPEED_DEFAULT = 1;
const REPLAY_SPEED_MIN = 0.5;
const REPLAY_SPEED_MAX = 4;
const REPLAY_SPEED_STEP = 0.5;
const REPLAY_TICK_MS = 200;
const REPLAY_MAX_EVENTS_PER_TICK = 500;

let replayEntries = null;
let replayEvents = [];
let replayCursor = 0;
let replayStartWallTs = 0;
let replayPlaybackStartMs = 0;
let replayBaseTimeMs = 0;
let replayTimer = null;
let replayRequestId = 0;
let replayInfo = null;

let replayDeps = {
  onSample: null,
  onReset: null,
  onStatus: null,
  onStop: null,
};

function initReplay(deps = {}) {
  replayDeps = { ...replayDeps, ...deps };
}

function normalizeReplaySpeed(value) {
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) return REPLAY_SPEED_DEFAULT;
  const clamped = clamp(parsed, REPLAY_SPEED_MIN, REPLAY_SPEED_MAX);
  const steps = Math.round(clamped / REPLAY_SPEED_STEP);
  const snapped = steps * REPLAY_SPEED_STEP;
  return clamp(snapped, REPLAY_SPEED_MIN, REPLAY_SPEED_MAX);
}

function formatReplaySpeed(speed) {
  if (!Number.isFinite(speed)) return "--";
  const rounded = Math.round(speed * 10) / 10;
  if (Number.isInteger(rounded)) return `${rounded}x`;
  return `${rounded.toFixed(1)}x`;
}

function getReplayState() {
  return {
    active: Boolean(state.replay?.active),
    loading: Boolean(state.replay?.loading),
    error: state.replay?.error || "",
    file: state.replay?.file || null,
    speed: Number.isFinite(state.replay?.speed) ? state.replay.speed : REPLAY_SPEED_DEFAULT,
  };
}

function notifyReplayStatus() {
  if (typeof replayDeps.onStatus === "function") {
    replayDeps.onStatus(getReplayState());
  }
}

function clearReplayTimer() {
  if (!replayTimer) return;
  clearInterval(replayTimer);
  replayTimer = null;
}

function getReplayElapsedMs(now = Date.now()) {
  if (!Number.isFinite(replayStartWallTs) || replayStartWallTs <= 0) {
    return Math.max(0, replayPlaybackStartMs || 0);
  }
  const wallElapsed = Math.max(0, now - replayStartWallTs);
  const elapsed = (replayPlaybackStartMs || 0) + wallElapsed * state.replay.speed;
  return Math.max(0, elapsed);
}

function getReplayClockNow(now = Date.now()) {
  if (!state.replay?.active) return null;
  return replayBaseTimeMs + getReplayElapsedMs(now);
}

async function loadReplayEntries() {
  if (Array.isArray(replayEntries)) return replayEntries;
  const response = await fetch(REPLAY_MANIFEST_URL, { cache: "no-cache" });
  if (!response.ok) {
    throw new Error(`Replay manifest missing (${response.status})`);
  }
  const data = await response.json();
  if (!Array.isArray(data)) {
    throw new Error("Replay manifest must be a JSON array.");
  }
  const baseUrl = new URL(REPLAY_MANIFEST_URL, window.location.href);
  replayEntries = data
    .map((entry, index) => {
      if (!entry || typeof entry !== "object") return null;
      const path = typeof entry.path === "string" ? entry.path.trim() : "";
      if (!path) return null;
      const id = typeof entry.id === "string" && entry.id.trim()
        ? entry.id.trim()
        : `replay-${index + 1}`;
      const label = typeof entry.label === "string" && entry.label.trim()
        ? entry.label.trim()
        : path.split("/").pop();
      const url = new URL(path, baseUrl).toString();
      return { id, label, path, url };
    })
    .filter(Boolean);
  return replayEntries;
}

function parseNdjson(text) {
  const lines = String(text || "").split(/\r?\n/);
  const records = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      records.push(JSON.parse(trimmed));
    } catch (err) {
      continue;
    }
  }
  return records;
}

function toNumber(value) {
  if (value === null || value === undefined) return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function normalizeCoords(payload) {
  if (!payload) return null;
  const coords = payload.coords && typeof payload.coords === "object" ? payload.coords : payload;
  const lat = toNumber(coords.latitude ?? coords.lat);
  const lon = toNumber(coords.longitude ?? coords.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return {
    latitude: lat,
    longitude: lon,
    accuracy: toNumber(coords.accuracy),
    altitude: toNumber(coords.altitude),
    altitudeAccuracy: toNumber(coords.altitudeAccuracy),
    speed: toNumber(coords.speed),
    speedAccuracy: toNumber(coords.speedAccuracy),
    heading: toNumber(coords.heading),
    headingAccuracy: toNumber(coords.headingAccuracy),
  };
}

function normalizeVector(vector) {
  if (!vector) return null;
  const x = toNumber(vector.x);
  const y = toNumber(vector.y);
  const z = toNumber(vector.z);
  if (x === null && y === null && z === null) return null;
  return { x, y, z };
}

function normalizeRotation(rotation) {
  if (!rotation) return null;
  const alpha = toNumber(rotation.alpha);
  const beta = toNumber(rotation.beta);
  const gamma = toNumber(rotation.gamma);
  if (alpha === null && beta === null && gamma === null) return null;
  return { alpha, beta, gamma };
}

function buildReplayEventsFromRecords(records) {
  const events = [];
  const derived = [];
  let meta = null;
  records.forEach((record) => {
    if (!record || typeof record !== "object") return;
    if (record.type === "meta" && !meta) {
      meta = record.payload || null;
    }
    if (record.type === "gps") {
      const payload = record.payload || {};
      const deviceTimeMs = toNumber(payload.deviceTimeMs);
      const tsDevice = Number.isFinite(deviceTimeMs) ? deviceTimeMs : toNumber(record.ts);
      if (!Number.isFinite(tsDevice)) return;
      const coords = normalizeCoords(payload);
      if (!coords) return;
      const gpsTimeMs = toNumber(payload.gpsTimeMs);
      const tsGps = Number.isFinite(gpsTimeMs) ? gpsTimeMs : tsDevice;
      events.push({
        type: "gps",
        tsDevice,
        tsGps,
        coords,
      });
      return;
    }
    if (record.type === "imu") {
      const payload = record.payload || {};
      const deviceTimeMs = toNumber(payload.deviceTimeMs);
      const tsDevice = Number.isFinite(deviceTimeMs) ? deviceTimeMs : toNumber(record.ts);
      if (!Number.isFinite(tsDevice)) return;
      const rotation = normalizeRotation(
        payload.rotationRate || payload.rotationDeg || payload.rotation
      );
      const accel = normalizeVector(payload.acceleration);
      const accelGravity = normalizeVector(
        payload.accelerationIncludingGravity || payload.gravity
      );
      if (!rotation || !accelGravity) return;
      events.push({
        type: "imu",
        tsDevice,
        eventTimeMs: toNumber(payload.eventTimeMs),
        intervalMs: toNumber(payload.intervalMs),
        rotationRate: rotation,
        acceleration: accel,
        accelerationIncludingGravity: accelGravity,
        mapping: payload.mapping || null,
      });
      return;
    }
    if (record.type === "derived") {
      const ts = Number(record.ts);
      if (!Number.isFinite(ts)) return;
      const payload = record.payload || {};
      const position = payload.position || null;
      if (!position || !Number.isFinite(position.lat) || !Number.isFinite(position.lon)) {
        return;
      }
      const bow = payload.bowPosition || null;
      const velocity = payload.velocity || null;
      derived.push({
        type: "derived",
        tsDevice: ts,
        ts,
        source: typeof payload.source === "string" ? payload.source : "gps",
        position: {
          lat: position.lat,
          lon: position.lon,
          accuracy: position.accuracy,
          speed: position.speed,
          heading: position.heading,
          altitude: position.altitude,
          altitudeAccuracy: position.altitudeAccuracy,
          speedAccuracy: position.speedAccuracy,
          headingAccuracy: position.headingAccuracy,
        },
        bowPosition: bow
          ? {
              lat: bow.lat,
              lon: bow.lon,
              accuracy: bow.accuracy,
              speed: bow.speed,
              heading: bow.heading,
              altitude: bow.altitude,
              altitudeAccuracy: bow.altitudeAccuracy,
              speedAccuracy: bow.speedAccuracy,
              headingAccuracy: bow.headingAccuracy,
            }
          : null,
        velocity:
          velocity && Number.isFinite(velocity.x) && Number.isFinite(velocity.y)
            ? { x: velocity.x, y: velocity.y }
            : null,
        speed: payload.speed,
      });
    }
  });

  const hasGps = events.some((event) => event.type === "gps");
  const hasImu = events.some((event) => event.type === "imu");
  const output = events.length ? events : derived;
  return {
    events: finalizeReplayEvents(output),
    info: {
      meta,
      hasGps,
      hasImu,
      usesDerived: !events.length && derived.length > 0,
    },
  };
}

function finalizeReplayEvents(events) {
  if (!events.length) return [];
  events.sort((a, b) => a.tsDevice - b.tsDevice);
  const baseDeviceTimeMs = events[0].tsDevice;
  let baseGpsTimeMs = null;
  let baseImuTimeMs = null;
  for (const event of events) {
    if (event.type === "gps" && Number.isFinite(event.tsGps)) {
      baseGpsTimeMs = event.tsGps;
      break;
    }
  }
  for (const event of events) {
    if (event.type === "imu" && Number.isFinite(event.eventTimeMs)) {
      baseImuTimeMs = event.eventTimeMs;
      break;
    }
  }
  if (!Number.isFinite(baseGpsTimeMs)) {
    baseGpsTimeMs = baseDeviceTimeMs;
  }
  if (!Number.isFinite(baseImuTimeMs)) {
    baseImuTimeMs = baseDeviceTimeMs;
  }
  events.forEach((event) => {
    event.offsetMs = Math.max(0, event.tsDevice - baseDeviceTimeMs);
    if (event.type === "gps") {
      const gpsOffset = Number.isFinite(event.tsGps)
        ? event.tsGps - baseGpsTimeMs
        : event.offsetMs;
      event.gpsOffsetMs = Math.max(0, gpsOffset);
    }
    if (event.type === "imu") {
      const imuOffset = Number.isFinite(event.eventTimeMs)
        ? event.eventTimeMs - baseImuTimeMs
        : event.offsetMs;
      event.imuOffsetMs = Math.max(0, imuOffset);
    }
    if (event.type === "derived") {
      event.gpsOffsetMs = event.offsetMs;
    }
  });
  return events;
}

async function readReplayText(response, url) {
  const gzipHint = url.endsWith(".gz") || response.headers.get("Content-Encoding") === "gzip";
  if (!gzipHint) {
    return response.text();
  }
  let shouldDecompress = true;
  if (response.body && typeof response.clone === "function") {
    try {
      const probe = response.clone();
      const reader = probe.body.getReader();
      const { value } = await reader.read();
      if (value && value.length >= 2) {
        shouldDecompress = value[0] === 0x1f && value[1] === 0x8b;
      } else {
        shouldDecompress = false;
      }
      reader.cancel();
    } catch {
      shouldDecompress = true;
    }
  }
  if (!shouldDecompress) {
    return response.text();
  }
  if (typeof DecompressionStream === "undefined" || !response.body) {
    throw new Error("Gzip replay not supported in this browser.");
  }
  const stream = response.body.pipeThrough(new DecompressionStream("gzip"));
  return new Response(stream).text();
}

async function loadReplayData(entry) {
  const response = await fetch(entry.url, { cache: "no-cache" });
  if (!response.ok) {
    throw new Error(`Replay file missing (${response.status})`);
  }
  const text = await readReplayText(response, entry.url);
  const records = parseNdjson(text);
  return buildReplayEventsFromRecords(records);
}

function startReplayTimer() {
  if (replayTimer) return;
  replayTimer = setInterval(() => {
    tickReplay();
  }, REPLAY_TICK_MS);
}

function stopReplayTimer() {
  clearReplayTimer();
  replayEvents = [];
  replayCursor = 0;
  replayStartWallTs = 0;
  replayPlaybackStartMs = 0;
  replayBaseTimeMs = 0;
}

function tickReplay() {
  if (!state.replay.active) return;
  const now = Date.now();
  const elapsedMs = getReplayElapsedMs(now);
  state.replay.clockNow = replayBaseTimeMs + elapsedMs;
  let processed = 0;
  while (replayCursor < replayEvents.length) {
    const sample = replayEvents[replayCursor];
    if (!sample || sample.offsetMs > elapsedMs) break;
    const playbackDeviceTimeMs = replayBaseTimeMs + sample.offsetMs;
    const playbackGpsTimeMs = Number.isFinite(sample.gpsOffsetMs)
      ? replayBaseTimeMs + sample.gpsOffsetMs
      : playbackDeviceTimeMs;
    const playbackImuTimeMs = Number.isFinite(sample.imuOffsetMs)
      ? replayBaseTimeMs + sample.imuOffsetMs
      : playbackDeviceTimeMs;
    if (typeof replayDeps.onSample === "function") {
      replayDeps.onSample(sample, {
        deviceTimeMs: playbackDeviceTimeMs,
        gpsTimeMs: playbackGpsTimeMs,
        imuTimeMs: playbackImuTimeMs,
      });
    }
    replayCursor += 1;
    processed += 1;
    if (processed >= REPLAY_MAX_EVENTS_PER_TICK) {
      break;
    }
  }
  if (replayCursor >= replayEvents.length) {
    stopReplay();
  }
}

async function startReplay(entry) {
  if (!entry) {
    state.replay.error = "Select a replay file.";
    notifyReplayStatus();
    return;
  }
  stopReplay({ silent: true, skipResume: true });
  const requestId = (replayRequestId += 1);
  state.replay.loading = true;
  state.replay.error = "";
  state.replay.file = entry;
  notifyReplayStatus();
  let data = null;
  try {
    data = await loadReplayData(entry);
  } catch (err) {
    if (replayRequestId !== requestId) return;
    state.replay.loading = false;
    state.replay.error = err instanceof Error ? err.message : String(err);
    notifyReplayStatus();
    return;
  }
  if (replayRequestId !== requestId) return;
  if (!data || !Array.isArray(data.events) || !data.events.length) {
    state.replay.loading = false;
    state.replay.error = "Replay file has no usable samples.";
    notifyReplayStatus();
    return;
  }
  replayEvents = data.events;
  replayInfo = data.info || null;
  replayCursor = 0;
  replayBaseTimeMs = Date.now();
  replayStartWallTs = replayBaseTimeMs;
  replayPlaybackStartMs = 0;
  state.replay.loading = false;
  state.replay.active = true;
  state.replay.clockNow = replayBaseTimeMs;
  if (typeof replayDeps.onReset === "function") {
    replayDeps.onReset(replayInfo || {});
  }
  tickReplay();
  startReplayTimer();
  notifyReplayStatus();
}

function stopReplay(options = {}) {
  const silent = options.silent === true;
  const skipResume = options.skipResume === true;
  if (!state.replay.active && !state.replay.loading) {
    if (!silent) notifyReplayStatus();
    return;
  }
  replayRequestId += 1;
  stopReplayTimer();
  state.replay.active = false;
  state.replay.loading = false;
  state.replay.clockNow = null;
  replayInfo = null;
  if (!skipResume && typeof replayDeps.onStop === "function") {
    replayDeps.onStop();
  }
  if (!silent) {
    notifyReplayStatus();
  }
}

function setReplaySpeed(nextSpeed) {
  const normalized = normalizeReplaySpeed(nextSpeed);
  const current = Number.isFinite(state.replay.speed) ? state.replay.speed : REPLAY_SPEED_DEFAULT;
  if (normalized === current) {
    notifyReplayStatus();
    return;
  }
  const now = Date.now();
  const elapsed = getReplayElapsedMs(now);
  state.replay.speed = normalized;
  if (state.replay.active) {
    replayPlaybackStartMs = elapsed;
    replayStartWallTs = now;
    state.replay.clockNow = replayBaseTimeMs + elapsed;
  }
  notifyReplayStatus();
}

export {
  initReplay,
  loadReplayEntries,
  startReplay,
  stopReplay,
  setReplaySpeed,
  getReplayState,
  formatReplaySpeed,
  normalizeReplaySpeed,
  getReplayClockNow,
};
