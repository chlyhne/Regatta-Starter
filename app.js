import { els } from "./dom.js";
import {
  state,
  hemisphereGroups,
  LINES_KEY,
  DEBUG_COORDS,
  COORD_DECIMAL_DIGITS,
  COORD_DD_DIGITS,
  DEBUG_SPEED,
  DEBUG_HEADING,
  START_BEEP_DURATION_MS,
  START_BEEP_FREQUENCY,
} from "./state.js";
import { unlockAudio, playBeep, handleCountdownBeeps, resetBeepState } from "./audio.js";
import { applyForwardOffset, toRadians } from "./geo.js";
import { applyKalmanFilter, applyImuYawRate, predictKalmanState } from "./kalman.js";
import { recordTrackPoints, renderTrack } from "./track.js";
import { fitRaceText } from "./race-fit.js";
import { updateGPSDisplay, updateDebugControls } from "./gps-ui.js";
import {
  hasLine,
  updateLineStatus,
  updateStatusUnitLabels,
  updateRaceHintUnits,
  updateRaceMetricLabels,
  setRaceMetric,
  updateLineProjection,
} from "./race.js";
import {
  GPS_OPTIONS_RACE,
  getGpsOptionsForMode,
  clearGpsRetryTimer,
  stopDebugGps,
  startDebugGps,
  startRealGps,
  isGpsStale,
  scheduleGpsRetry,
  requestHighPrecisionPosition,
} from "./gps-watch.js";
import {
  computeVelocityFromHeading,
  computeVelocityFromPositions,
} from "./velocity.js";
import {
  loadSettings as loadSettingsFromStorage,
  saveSettings as saveSettingsToStorage,
  MAX_COUNTDOWN_SECONDS,
} from "./settings.js";
import {
  formatUnitLabel,
  normalizeTimeFormat,
  normalizeSpeedUnit,
  normalizeDistanceUnit,
  getDistanceUnitMeta,
  formatClockTime,
  formatTimeInput,
  formatTimeRemainingHMSFull,
  splitDurationSeconds,
  formatTimeRemainingHMS,
} from "./format.js";
import { KALMAN_TUNING } from "./tuning.js";

const NO_CACHE_KEY = "racetimer-nocache";
const SPEED_HISTORY_WINDOW_MS =
  KALMAN_TUNING.processNoise.speedScale.recentMaxSpeedWindowSeconds * 1000;
const KALMAN_PREDICT_HZ = 5;
const KALMAN_PREDICT_INTERVAL_MS = Math.round(1000 / KALMAN_PREDICT_HZ);
const IMU_MAPPING_DEFAULT = { axes: ["alpha", "beta", "gamma"], signs: [1, 1, 1] };
const IMU_MAPPING_CANDIDATES = buildImuMappingCandidates();
const VMG_TAU_SECONDS = 10;
const VMG_RLS_INIT_P = 100;
const KNOTS_TO_MS = 0.514444;
const VMG_IMU_GPS_MIN_SPEED = 2 * KNOTS_TO_MS;
const VMG_IMU_GPS_BLEND_TAU = 12;
const VMG_IMU_DT_CLAMP = { min: 0.005, max: 0.25 };
const VMG_MIN_SLOPE_SCALE = 0.02;
const VMG_SLOPE_RANGE = 1.25;
const VMG_POSITION_RANGE = 40;
const VMG_CONF_MIN = 12;
const VMG_CONF_MAX = 90;
const VMG_CONF_SCALE = 60;
const VMG_EVAL_WINDOW_SEC = 30;
const VMG_EVAL_TWA_DEG = 45;
const VMG_EVAL_MAX_GAIN = 50;
const VMG_EVAL_MIN_BASE = 0.2;
const VMG_EVAL_HISTORY_MS = (VMG_EVAL_WINDOW_SEC * 2 + 5) * 1000;
const LIFTER_DEFAULT_WINDOW_SECONDS = 300;
const LIFTER_MIN_SPEED = 0.5;
const LIFTER_HISTORY_MAX_MS = 2 * 60 * 60 * 1000;
const LIFTER_BIN_COUNT = 60;
const LIFTER_DEBUG_TICK_MS = 250;
const LIFTER_DEBUG_SPEED_DEFAULT = 1;
const LIFTER_DEBUG_SPEED_MIN = 0.5;
const LIFTER_DEBUG_SPEED_MAX = 4;
const LIFTER_DEBUG_SPEED_STEP = 0.5;
let kalmanPredictTimer = null;
let lastKalmanPredictionTs = 0;
let countdownPickerLive = false;
let imuListening = false;
let imuCalibrationActive = false;
let imuCalibrationSamples = [];
let imuCalibrationTimer = null;
let imuCalibrationError = "";
const lifterHistory = [];
let lifterWindowSeconds = LIFTER_DEFAULT_WINDOW_SECONDS;
let lifterLastSampleTs = null;
let lifterBinDurationMs = Math.round((LIFTER_DEFAULT_WINDOW_SECONDS * 1000) / LIFTER_BIN_COUNT);
let lifterLastBinId = null;
let lifterLastRenderAt = 0;
let lifterRenderTimer = null;
const lifterBins = new Map();
let lifterHeadingSource = "gps";
const lifterDebug = {
  enabled: false,
  loading: false,
  error: null,
  samples: null,
  cursor: 0,
  startWallTs: 0,
  playbackStartMs: 0,
  speed: LIFTER_DEBUG_SPEED_DEFAULT,
  requestId: 0,
  timer: null,
};
const vmgEstimate = {
  lastTs: null,
  lastHeading: null,
  lastHeadingUnwrapped: null,
  lastRawPosition: null,
  lastSpeed: null,
  headingRef: null,
  theta0: 0,
  theta1: 0,
  p11: VMG_RLS_INIT_P,
  p12: 0,
  p22: VMG_RLS_INIT_P,
  residualVar: null,
  sampleCount: 0,
  slope: null,
  slopeStdErr: null,
};
const vmgEvalHistory = [];
const vmgImu = {
  headingRad: null,
  lastTimestamp: null,
  lastGpsTs: null,
};
let vmgTack = "starboard";

function updateViewportHeight() {
  const height = window.visualViewport?.height || window.innerHeight;
  if (!Number.isFinite(height)) return;
  document.documentElement.style.setProperty("--app-height", `${height}px`);
}

function formatBowOffsetValue(meters) {
  if (!Number.isFinite(meters)) return "";
  const { factor } = getDistanceUnitMeta();
  const value = meters * factor;
  const rounded = Math.round(value * 100) / 100;
  return trimTrailingZeros(rounded.toFixed(2));
}

function parseBowOffsetInput() {
  if (!els.bowOffset) return state.bowOffsetMeters;
  const raw = Number.parseFloat(String(els.bowOffset.value || "").replace(",", "."));
  if (!Number.isFinite(raw)) return 0;
  const safe = Math.max(0, raw);
  const { factor } = getDistanceUnitMeta();
  return safe / factor;
}

function syncBowOffsetInput() {
  if (els.bowOffset) {
    els.bowOffset.value = formatBowOffsetValue(state.bowOffsetMeters);
  }
  if (els.bowOffsetUnit) {
    els.bowOffsetUnit.textContent = formatUnitLabel(getDistanceUnitMeta().label);
  }
}

function formatBoatLengthValue(meters) {
  if (!Number.isFinite(meters)) return "";
  const { factor } = getDistanceUnitMeta();
  const value = meters * factor;
  const rounded = Math.round(value * 100) / 100;
  return trimTrailingZeros(rounded.toFixed(2));
}

function parseBoatLengthInput() {
  if (!els.boatLength) return state.boatLengthMeters;
  const raw = Number.parseFloat(String(els.boatLength.value || "").replace(",", "."));
  if (!Number.isFinite(raw)) return 0;
  const safe = Math.max(0, raw);
  const { factor } = getDistanceUnitMeta();
  return safe / factor;
}

function syncBoatLengthInput() {
  if (els.boatLength) {
    els.boatLength.value = formatBoatLengthValue(state.boatLengthMeters);
  }
  if (els.boatLengthUnit) {
    els.boatLengthUnit.textContent = formatUnitLabel(getDistanceUnitMeta().label);
  }
}

function commitBoatInputs() {
  let changed = false;
  if (els.boatLength) {
    const raw = String(els.boatLength.value || "").trim();
    if (raw) {
      state.boatLengthMeters = parseBoatLengthInput();
      changed = true;
    } else {
      syncBoatLengthInput();
    }
  }
  if (els.bowOffset) {
    const raw = String(els.bowOffset.value || "").trim();
    if (raw) {
      state.bowOffsetMeters = parseBowOffsetInput();
      changed = true;
    } else {
      syncBowOffsetInput();
    }
  }
  if (changed) {
    saveSettings();
  }
}

function createDebugPosition() {
  return {
    coords: {
      latitude: DEBUG_COORDS.lat,
      longitude: DEBUG_COORDS.lon,
      accuracy: 3,
      speed: DEBUG_SPEED,
      heading: DEBUG_HEADING,
    },
    timestamp: Date.now(),
  };
}

function readDebugFlagFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const raw = params.get("debug");
  if (raw === null) return null;
  const normalized = raw.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return null;
}

function applyDebugFlagFromUrl() {
  const flag = readDebugFlagFromUrl();
  if (flag === null) return;
  state.debugGpsEnabled = flag;
}

function syncNoCacheToken() {
  const url = new URL(window.location.href);
  const token = url.searchParams.get("nocache");
  if (token) {
    sessionStorage.setItem(NO_CACHE_KEY, token);
  }
}

function getNoCacheQuery() {
  const token = sessionStorage.getItem(NO_CACHE_KEY);
  if (!token) return "";
  return `?nocache=${encodeURIComponent(token)}`;
}

async function hardReload() {
  const url = new URL(window.location.href);
  const token = String(Date.now());
  sessionStorage.setItem(NO_CACHE_KEY, token);
  url.searchParams.set("nocache", token);

  try {
    if ("serviceWorker" in navigator) {
      const registration = await navigator.serviceWorker.getRegistration();
      if (registration) {
        await registration.update();
        if (registration.waiting) {
          registration.waiting.postMessage({ type: "SKIP_WAITING" });
        }
      }
    }
  } catch {
    // Ignore update errors; the reload still bypasses caches via nocache.
  }

  window.location.replace(url.toString());
}

function clearNoCacheParam() {
  const url = new URL(window.location.href);
  const token = url.searchParams.get("nocache");
  if (!token) return;
  sessionStorage.setItem(NO_CACHE_KEY, token);
}

function setRaceTimingControlsEnabled(enabled) {
  const disabled = !enabled;
  if (els.racePlus) els.racePlus.disabled = disabled;
  if (els.raceMinus) els.raceMinus.disabled = disabled;
  if (els.syncRace) els.syncRace.disabled = disabled;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function normalizeDeltaDegrees(delta) {
  let wrapped = (delta + 540) % 360;
  wrapped -= 180;
  return wrapped;
}

function normalizeAngleRad(angle) {
  let wrapped = angle % (2 * Math.PI);
  if (wrapped < 0) wrapped += 2 * Math.PI;
  return wrapped;
}

function normalizeDeltaRad(delta) {
  let wrapped = (delta + Math.PI) % (2 * Math.PI);
  if (wrapped < 0) wrapped += 2 * Math.PI;
  return wrapped - Math.PI;
}

function headingRadToDegrees(headingRad) {
  if (!Number.isFinite(headingRad)) return null;
  const deg = (headingRad * 180) / Math.PI;
  let wrapped = deg % 360;
  if (wrapped < 0) wrapped += 360;
  return wrapped;
}

function unwrapHeadingDegrees(heading, lastHeading, lastUnwrapped) {
  if (!Number.isFinite(heading)) return null;
  if (!Number.isFinite(lastHeading) || !Number.isFinite(lastUnwrapped)) {
    return heading;
  }
  const delta = normalizeDeltaDegrees(heading - lastHeading);
  return lastUnwrapped + delta;
}

function headingFromVelocity(velocity) {
  if (!velocity || !Number.isFinite(velocity.x) || !Number.isFinite(velocity.y)) {
    return null;
  }
  const headingRad = Math.atan2(velocity.x, velocity.y);
  if (!Number.isFinite(headingRad)) return null;
  const headingDeg = (headingRad * 180) / Math.PI;
  return headingDeg < 0 ? headingDeg + 360 : headingDeg;
}

function formatWindowSeconds(seconds) {
  const safe = Math.max(0, Math.round(seconds || 0));
  if (safe < 90) return `${safe} s`;
  const minutes = Math.round(safe / 60);
  return `${minutes} min`;
}

function clampLifterWindowSeconds(seconds) {
  const safe = Number.parseInt(seconds, 10);
  if (!Number.isFinite(safe)) return LIFTER_DEFAULT_WINDOW_SECONDS;
  return clamp(safe, 60, 1800);
}

function syncLifterWindowUi() {
  if (els.lifterWindow) {
    els.lifterWindow.value = String(lifterWindowSeconds);
  }
  if (els.lifterWindowValue) {
    els.lifterWindowValue.textContent = formatWindowSeconds(lifterWindowSeconds);
  }
}

function normalizeHeadingDegrees(degrees) {
  if (!Number.isFinite(degrees)) return null;
  let wrapped = degrees % 360;
  if (wrapped < 0) wrapped += 360;
  return wrapped;
}

function meanHeadingDegreesFromSinCos(sumSin, sumCos) {
  if (!Number.isFinite(sumSin) || !Number.isFinite(sumCos)) return null;
  if (sumSin === 0 && sumCos === 0) return null;
  const meanRad = Math.atan2(sumSin, sumCos);
  return normalizeHeadingDegrees((meanRad * 180) / Math.PI);
}

function circularMeanDegrees(angles) {
  if (!angles || !angles.length) return null;
  let sumSin = 0;
  let sumCos = 0;
  let count = 0;
  angles.forEach((deg) => {
    if (!Number.isFinite(deg)) return;
    const rad = toRadians(deg);
    sumSin += Math.sin(rad);
    sumCos += Math.cos(rad);
    count += 1;
  });
  if (!count) return null;
  return meanHeadingDegreesFromSinCos(sumSin, sumCos);
}

function getLifterBinDurationMs(seconds = lifterWindowSeconds) {
  const safeSeconds = clampLifterWindowSeconds(seconds);
  const windowMs = safeSeconds * 1000;
  return Math.max(1, Math.round(windowMs / LIFTER_BIN_COUNT));
}

function getLifterBinId(timestampMs, binDurationMs = lifterBinDurationMs) {
  const ts = Number.isFinite(timestampMs) ? timestampMs : 0;
  const duration = Number.isFinite(binDurationMs) && binDurationMs > 0 ? binDurationMs : 1;
  return Math.floor(ts / duration);
}

function rebuildLifterBins() {
  lifterBins.clear();
  lifterBinDurationMs = getLifterBinDurationMs(lifterWindowSeconds);
  if (!Number.isFinite(lifterLastSampleTs)) {
    lifterLastBinId = null;
    return;
  }
  lifterLastBinId = getLifterBinId(lifterLastSampleTs);
  lifterHistory.forEach((sample) => {
    if (!sample) return;
    if (!Number.isFinite(sample.ts) || !Number.isFinite(sample.heading)) return;
    const binId = getLifterBinId(sample.ts);
    let bin = lifterBins.get(binId);
    if (!bin) {
      bin = { sumSin: 0, sumCos: 0, count: 0 };
      lifterBins.set(binId, bin);
    }
    const rad = toRadians(sample.heading);
    bin.sumSin += Math.sin(rad);
    bin.sumCos += Math.cos(rad);
    bin.count += 1;
  });
}

function updateLifterBinsWithSample(timestampMs, headingDegrees, cutoffTs) {
  const nextDuration = getLifterBinDurationMs(lifterWindowSeconds);
  if (nextDuration !== lifterBinDurationMs) {
    rebuildLifterBins();
    return;
  }
  const binId = getLifterBinId(timestampMs);
  let bin = lifterBins.get(binId);
  if (!bin) {
    bin = { sumSin: 0, sumCos: 0, count: 0 };
    lifterBins.set(binId, bin);
  }
  const rad = toRadians(headingDegrees);
  bin.sumSin += Math.sin(rad);
  bin.sumCos += Math.cos(rad);
  bin.count += 1;

  const previousBinId = lifterLastBinId;
  lifterLastBinId = binId;
  if (!Number.isFinite(previousBinId) || previousBinId === binId) return;
  if (!Number.isFinite(cutoffTs)) return;
  const cutoffBinId = getLifterBinId(cutoffTs);
  for (const key of lifterBins.keys()) {
    if (key < cutoffBinId) {
      lifterBins.delete(key);
    }
  }
}

function requestLifterRender(options = {}) {
  if (!document.body.classList.contains("lifter-mode")) return;
  const force = options.force === true;
  const speed =
    lifterHeadingSource === "debug-wind" ? Math.max(0.1, lifterDebug.speed || 1) : 1;
  const maxIntervalMs = 1000 / speed;
  const now = Date.now();
  const elapsed = now - lifterLastRenderAt;
  if (force || !Number.isFinite(lifterLastRenderAt) || elapsed >= maxIntervalMs) {
    if (lifterRenderTimer) {
      clearTimeout(lifterRenderTimer);
      lifterRenderTimer = null;
    }
    lifterLastRenderAt = now;
    renderLifterPlot();
    return;
  }
  if (lifterRenderTimer) return;
  const delay = Math.max(0, maxIntervalMs - elapsed);
  lifterRenderTimer = setTimeout(() => {
    lifterRenderTimer = null;
    lifterLastRenderAt = Date.now();
    renderLifterPlot();
  }, delay);
}

function resetLifterHistory() {
  lifterHistory.length = 0;
  lifterLastSampleTs = null;
  lifterLastBinId = null;
  lifterBins.clear();
}

function normalizeLifterDebugSpeed(value) {
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) return LIFTER_DEBUG_SPEED_DEFAULT;
  const clamped = clamp(parsed, LIFTER_DEBUG_SPEED_MIN, LIFTER_DEBUG_SPEED_MAX);
  const steps = Math.round(clamped / LIFTER_DEBUG_SPEED_STEP);
  const snapped = steps * LIFTER_DEBUG_SPEED_STEP;
  return clamp(snapped, LIFTER_DEBUG_SPEED_MIN, LIFTER_DEBUG_SPEED_MAX);
}

function formatLifterDebugSpeed(speed) {
  if (!Number.isFinite(speed)) return "--";
  const rounded = Math.round(speed * 10) / 10;
  if (Number.isInteger(rounded)) return `${rounded}x`;
  return `${rounded.toFixed(1)}x`;
}

function getLifterDebugPlaybackMs(now = Date.now()) {
  if (!Number.isFinite(lifterDebug.startWallTs) || lifterDebug.startWallTs <= 0) {
    return Math.max(0, lifterDebug.playbackStartMs || 0);
  }
  const wallElapsed = Math.max(0, now - lifterDebug.startWallTs);
  const elapsed = (lifterDebug.playbackStartMs || 0) + wallElapsed * lifterDebug.speed;
  return Math.max(0, elapsed);
}

function syncLifterDebugSpeedUi() {
  if (els.lifterDebugSpeedValue) {
    els.lifterDebugSpeedValue.textContent = formatLifterDebugSpeed(lifterDebug.speed);
  }
  if (els.lifterDebugSpeed) {
    els.lifterDebugSpeed.value = String(lifterDebug.speed);
    els.lifterDebugSpeed.disabled =
      lifterHeadingSource !== "debug-wind" || lifterDebug.loading;
  }
}

function setLifterDebugSpeed(nextSpeed) {
  const normalized = normalizeLifterDebugSpeed(nextSpeed);
  if (normalized === lifterDebug.speed) {
    syncLifterDebugSpeedUi();
    return;
  }
  const now = Date.now();
  const elapsed = getLifterDebugPlaybackMs(now);
  if (Number.isFinite(lifterDebug.startWallTs) && lifterDebug.startWallTs > 0) {
    const wallElapsed = Math.max(0, now - lifterDebug.startWallTs);
    lifterDebug.speed = normalized;
    lifterDebug.playbackStartMs = elapsed - wallElapsed * normalized;
  } else {
    lifterDebug.speed = normalized;
    lifterDebug.playbackStartMs = elapsed;
  }
  syncLifterDebugSpeedUi();
}

function syncLifterDebugToggleUi() {
  const enabled = lifterHeadingSource === "debug-wind";
  if (els.lifterDebugToggle) {
    els.lifterDebugToggle.setAttribute("aria-pressed", enabled ? "true" : "false");
    els.lifterDebugToggle.disabled = lifterDebug.loading;
    els.lifterDebugToggle.title = enabled ? "Debug wind on" : "Debug wind off";
    els.lifterDebugToggle.textContent = lifterDebug.loading ? "Loading…" : "Debug";
  }
  syncLifterDebugSpeedUi();
}

function recordLifterHeadingFromSource(source, heading, timestamp) {
  if (source !== lifterHeadingSource) return;
  const safeHeading = normalizeHeadingDegrees(heading);
  if (!Number.isFinite(safeHeading)) return;
  const ts = Number.isFinite(timestamp) ? timestamp : Date.now();
  lifterHistory.push({ ts, heading: safeHeading });
  lifterLastSampleTs = ts;
  const cutoff = ts - LIFTER_HISTORY_MAX_MS;
  while (lifterHistory.length && lifterHistory[0].ts < cutoff) {
    lifterHistory.shift();
  }
  updateLifterBinsWithSample(ts, safeHeading, cutoff);
  requestLifterRender();
}

function recordLifterHeadingFromGps(velocity, speed, timestamp) {
  if (lifterHeadingSource !== "gps") return;
  if (!Number.isFinite(speed) || speed < LIFTER_MIN_SPEED) return;
  const heading = headingFromVelocity(velocity);
  recordLifterHeadingFromSource("gps", heading, timestamp);
}

function parseDebugWindCsv(text) {
  const raw = String(text || "");
  const lines = raw.split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) return [];
  const headers = lines[0].split(",").map((h) => h.trim().toLowerCase());
  const tsIndex = headers.findIndex((h) => h === "timestamp" || h === "time");
  const dirIndex = headers.findIndex((h) => h === "wind_dir_deg" || h.includes("wind_dir"));
  if (dirIndex < 0) return [];

  const samples = [];
  let firstTimestampMs = null;
  for (let i = 1; i < lines.length; i += 1) {
    const cols = lines[i].split(",");
    if (cols.length <= dirIndex) continue;
    const dir = Number.parseFloat(cols[dirIndex]);
    if (!Number.isFinite(dir)) continue;
    let offsetMs = i - 1;
    offsetMs *= 1000;
    if (tsIndex >= 0 && cols.length > tsIndex) {
      const rawTs = String(cols[tsIndex] || "").trim();
      const iso = rawTs.includes("T") ? rawTs : rawTs.replace(" ", "T");
      const parsed = Date.parse(`${iso}Z`);
      if (Number.isFinite(parsed)) {
        if (!Number.isFinite(firstTimestampMs)) {
          firstTimestampMs = parsed;
        }
        offsetMs = parsed - firstTimestampMs;
      }
    }
    samples.push({ offsetMs, heading: normalizeHeadingDegrees(dir) });
  }
  return samples.filter((sample) => Number.isFinite(sample.heading));
}

async function loadLifterDebugWindSamples() {
  if (lifterDebug.samples) return lifterDebug.samples;
  const response = await fetch("./debug_wind_data.csv");
  if (!response.ok) {
    throw new Error(`Failed to load wind data (${response.status})`);
  }
  const text = await response.text();
  const samples = parseDebugWindCsv(text);
  if (!samples.length) {
    throw new Error("No wind samples found");
  }
  lifterDebug.samples = samples;
  return samples;
}

function stopLifterDebugPlayback() {
  lifterDebug.requestId += 1;
  lifterDebug.loading = false;
  if (lifterDebug.timer) {
    clearInterval(lifterDebug.timer);
    lifterDebug.timer = null;
  }
  lifterDebug.cursor = 0;
  lifterDebug.startWallTs = 0;
  lifterDebug.playbackStartMs = 0;
  syncLifterDebugToggleUi();
}

function restartLifterDebugPlayback(now) {
  lifterDebug.cursor = 0;
  lifterDebug.startWallTs = Number.isFinite(now) ? now : Date.now();
  lifterDebug.playbackStartMs = 0;
  resetLifterHistory();
}

function tickLifterDebugPlayback() {
  if (lifterHeadingSource !== "debug-wind") return;
  if (!document.body.classList.contains("lifter-mode")) return;
  const samples = lifterDebug.samples;
  if (!samples || !samples.length) return;
  const now = Date.now();
  if (!Number.isFinite(lifterDebug.startWallTs) || lifterDebug.startWallTs <= 0) {
    restartLifterDebugPlayback(now);
  }
  const elapsedMs = getLifterDebugPlaybackMs(now);
  while (lifterDebug.cursor < samples.length && samples[lifterDebug.cursor].offsetMs <= elapsedMs) {
    const sample = samples[lifterDebug.cursor];
    recordLifterHeadingFromSource(
      "debug-wind",
      sample.heading,
      lifterDebug.startWallTs + sample.offsetMs
    );
    lifterDebug.cursor += 1;
  }
  if (lifterDebug.cursor >= samples.length) {
    restartLifterDebugPlayback(now);
  }
}

async function startLifterDebugPlayback() {
  if (lifterHeadingSource !== "debug-wind") return;
  if (!document.body.classList.contains("lifter-mode")) return;
  if (lifterDebug.timer) return;
  const requestId = (lifterDebug.requestId += 1);
  lifterDebug.loading = true;
  lifterDebug.error = null;
  syncLifterDebugToggleUi();
  try {
    await loadLifterDebugWindSamples();
  } catch (err) {
    lifterDebug.error = err instanceof Error ? err.message : String(err);
    lifterHeadingSource = "gps";
    lifterDebug.enabled = false;
    stopLifterDebugPlayback();
    lifterDebug.loading = false;
    syncLifterDebugToggleUi();
    window.alert(`Debug wind load failed: ${lifterDebug.error}`);
    return;
  }
  if (
    lifterDebug.requestId !== requestId ||
    lifterHeadingSource !== "debug-wind" ||
    !document.body.classList.contains("lifter-mode")
  ) {
    lifterDebug.loading = false;
    syncLifterDebugToggleUi();
    return;
  }
  lifterDebug.loading = false;
  syncLifterDebugToggleUi();
  restartLifterDebugPlayback(Date.now());
  tickLifterDebugPlayback();
  lifterDebug.timer = setInterval(tickLifterDebugPlayback, LIFTER_DEBUG_TICK_MS);
}

function setLifterHeadingSource(nextSource) {
  const normalized = nextSource === "debug-wind" ? "debug-wind" : "gps";
  if (normalized === lifterHeadingSource) return;
  lifterDebug.requestId += 1;
  lifterHeadingSource = normalized;
  lifterDebug.enabled = lifterHeadingSource === "debug-wind";
  resetLifterHistory();
  stopLifterDebugPlayback();
  syncLifterDebugToggleUi();
  if (lifterHeadingSource === "debug-wind") {
    startLifterDebugPlayback();
  } else {
    requestLifterRender({ force: true });
  }
}

function resizeCanvasToCssPixels(canvas) {
  if (!canvas) return null;
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(1, rect.width || 0);
  const height = Math.max(1, rect.height || 0);
  const dpr = window.devicePixelRatio || 1;
  const targetWidth = Math.max(1, Math.round(width * dpr));
  const targetHeight = Math.max(1, Math.round(height * dpr));
  if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
    canvas.width = targetWidth;
    canvas.height = targetHeight;
  }
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, width, height };
}

function renderLifterPlot() {
  if (!document.body.classList.contains("lifter-mode")) return;
  if (!els.lifterCanvas) return;
  const canvasInfo = resizeCanvasToCssPixels(els.lifterCanvas);
  if (!canvasInfo) return;
  const { ctx, width, height } = canvasInfo;

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);

  if (els.lifterMeanValue) {
    els.lifterMeanValue.textContent = "--°";
  }

  if (!Number.isFinite(lifterLastSampleTs)) {
    ctx.fillStyle = "#000000";
    ctx.font = "16px sans-serif";
    ctx.fillText("No heading", 12, 24);
    return;
  }

  const binCount = LIFTER_BIN_COUNT;
  const nextDuration = getLifterBinDurationMs(lifterWindowSeconds);
  if (nextDuration !== lifterBinDurationMs) {
    rebuildLifterBins();
  }

  const binDurationMs = lifterBinDurationMs;
  const lastBinId = getLifterBinId(lifterLastSampleTs, binDurationMs);
  const startBinId = lastBinId - binCount + 1;
  const binValues = new Array(binCount).fill(null);

  for (let i = 0; i < binCount; i += 1) {
    const binId = startBinId + i;
    const bin = lifterBins.get(binId);
    if (!bin || !Number.isFinite(bin.count) || bin.count <= 0) continue;
    const mean = meanHeadingDegreesFromSinCos(bin.sumSin, bin.sumCos);
    if (!Number.isFinite(mean)) continue;
    binValues[i] = mean;
  }

  const activeIndex = binCount - 1;
  const meanBins = binCount > 1 ? binValues.slice(0, activeIndex) : [];
  const meanDeg = circularMeanDegrees(meanBins);
  if (!Number.isFinite(meanDeg)) {
    ctx.fillStyle = "#000000";
    ctx.font = "16px sans-serif";
    ctx.fillText("No heading", 12, 24);
    return;
  }

  if (els.lifterMeanValue) {
    els.lifterMeanValue.textContent = `${Math.round(meanDeg)}°`;
  }

  const deltas = new Array(binCount).fill(null);
  let maxAbs = 0;
  for (let i = 0; i < activeIndex; i += 1) {
    const value = binValues[i];
    if (!Number.isFinite(value)) continue;
    const delta = normalizeDeltaDegrees(value - meanDeg);
    if (!Number.isFinite(delta)) continue;
    deltas[i] = delta;
    maxAbs = Math.max(maxAbs, Math.abs(delta));
  }
  const scaleStep = 2;
  if (!Number.isFinite(maxAbs) || maxAbs <= 0) {
    maxAbs = scaleStep;
  } else {
    maxAbs = Math.max(scaleStep, Math.ceil(maxAbs / scaleStep) * scaleStep);
  }

  const centerX = width / 2;
  const padding = 10;
  const maxBar = Math.max(1, centerX - padding);
  const xScale = maxBar / maxAbs;

  if (activeIndex >= 0) {
    const activeValue = binValues[activeIndex];
    if (Number.isFinite(activeValue)) {
      let delta = normalizeDeltaDegrees(activeValue - meanDeg);
      if (Number.isFinite(delta)) {
        delta = clamp(delta, -maxAbs, maxAbs);
        deltas[activeIndex] = delta;
      }
    }
  }

  const stepY = height / binCount;
  const gap = Math.min(2, Math.max(0, stepY - 1));
  const barH = Math.max(1, stepY - gap);

  const gridStepDeg = maxAbs >= 6 ? 4 : 2;
  const maxGridDeg = Math.floor(maxAbs / gridStepDeg) * gridStepDeg;
  if (maxGridDeg >= gridStepDeg) {
    ctx.save();
    ctx.strokeStyle = "#000000";
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 8]);
    for (let deg = gridStepDeg; deg <= maxGridDeg; deg += gridStepDeg) {
      const dx = deg * xScale;
      const xLeft = centerX - dx;
      const xRight = centerX + dx;
      [xLeft, xRight].forEach((x) => {
        if (!Number.isFinite(x) || x < 0 || x > width) return;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();
      });
    }
    ctx.restore();
  }

  ctx.fillStyle = "#000000";
  for (let i = 0; i < binCount; i += 1) {
    const delta = deltas[i];
    if (!Number.isFinite(delta)) continue;
    const barLen = delta * xScale;
    const barW = Math.abs(barLen);
    const x = centerX + Math.min(0, barLen);
    const y = height - (i + 1) * stepY + gap / 2;
    ctx.fillRect(x, y, barW, barH);
  }

  ctx.save();
  ctx.strokeStyle = "#000000";
  ctx.lineWidth = 2;
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.moveTo(centerX, 0);
  ctx.lineTo(centerX, height);
  ctx.stroke();
  ctx.restore();
}

function resetVmgEstimator() {
  vmgEstimate.lastTs = null;
  vmgEstimate.lastHeading = null;
  vmgEstimate.lastHeadingUnwrapped = null;
  vmgEstimate.lastRawPosition = null;
  vmgEstimate.lastSpeed = null;
  vmgEstimate.headingRef = null;
  vmgEstimate.theta0 = 0;
  vmgEstimate.theta1 = 0;
  vmgEstimate.p11 = VMG_RLS_INIT_P;
  vmgEstimate.p12 = 0;
  vmgEstimate.p22 = VMG_RLS_INIT_P;
  vmgEstimate.residualVar = null;
  vmgEstimate.sampleCount = 0;
  vmgEstimate.slope = null;
  vmgEstimate.slopeStdErr = null;
  renderVmgIndicator();
}

function resetVmgImuState() {
  vmgImu.headingRad = null;
  vmgImu.lastTimestamp = null;
  vmgImu.lastGpsTs = null;
}

function applyVmgImuYawRate(yawRateRad, dtSeconds) {
  if (!state.imuEnabled) return;
  if (!Number.isFinite(yawRateRad) || !Number.isFinite(dtSeconds) || dtSeconds <= 0) return;
  if (!Number.isFinite(vmgImu.headingRad)) return;
  const delta = yawRateRad * dtSeconds;
  if (!Number.isFinite(delta) || delta === 0) return;
  vmgImu.headingRad = normalizeAngleRad(vmgImu.headingRad + delta);
}

function updateVmgImuFromGps(sample) {
  if (!state.imuEnabled) return;
  if (!sample || !Number.isFinite(sample.heading)) return;
  const headingRad = normalizeAngleRad(toRadians(sample.heading));
  if (!Number.isFinite(vmgImu.headingRad)) {
    vmgImu.headingRad = headingRad;
    vmgImu.lastGpsTs = sample.ts;
    return;
  }
  if (!Number.isFinite(sample.speed) || sample.speed < VMG_IMU_GPS_MIN_SPEED) return;
  if (isVmgGpsBad()) return;
  const lastTs = Number.isFinite(vmgImu.lastGpsTs) ? vmgImu.lastGpsTs : sample.ts;
  const dtSec = Math.max(0, (sample.ts - lastTs) / 1000);
  vmgImu.lastGpsTs = sample.ts;
  const delta = normalizeDeltaRad(headingRad - vmgImu.headingRad);
  const weight = 1 - Math.exp(-dtSec / VMG_IMU_GPS_BLEND_TAU);
  if (!Number.isFinite(weight) || weight <= 0) return;
  vmgImu.headingRad = normalizeAngleRad(vmgImu.headingRad + delta * weight);
}

function getVmgHeadingDegrees(sample) {
  if (!sample) return null;
  if (state.imuEnabled) {
    updateVmgImuFromGps(sample);
    const imuHeading = headingRadToDegrees(vmgImu.headingRad);
    if (Number.isFinite(imuHeading)) {
      return imuHeading;
    }
  }
  return sample.heading;
}

function getVmgTwaDegrees() {
  if (!els.vmgTwa) return VMG_EVAL_TWA_DEG;
  const value = Number.parseFloat(els.vmgTwa.value);
  if (!Number.isFinite(value)) return VMG_EVAL_TWA_DEG;
  return clamp(value, 35, 50);
}

function getVmgSample(position) {
  if (!position || !position.coords) return null;
  const coords = position.coords;
  let speed = Number.isFinite(coords.speed) ? coords.speed : null;
  let heading = Number.isFinite(coords.heading) ? coords.heading : null;
  if (!Number.isFinite(speed) || !Number.isFinite(heading)) {
    const previous = vmgEstimate.lastRawPosition;
    if (previous) {
      const computed = computeVelocityFromPositions(position, previous);
      if (!Number.isFinite(speed)) {
        speed = computed.speed;
      }
      if (!Number.isFinite(heading)) {
        heading = headingFromVelocity(computed);
      }
    }
  }
  vmgEstimate.lastRawPosition = position;
  if (!Number.isFinite(speed)) return null;
  if (!Number.isFinite(heading)) {
    heading = null;
  }
  const ts = Number.isFinite(position.timestamp) ? position.timestamp : Date.now();
  return { speed, heading, ts };
}

function isVmgGpsBad() {
  if (!state.position) return true;
  if (isGpsStale()) return true;
  const accuracy = state.position.coords?.accuracy;
  if (!Number.isFinite(accuracy)) return true;
  return accuracy > 20;
}

function pruneVmgEvalHistory(cutoffTs) {
  let index = 0;
  while (index < vmgEvalHistory.length && vmgEvalHistory[index].ts < cutoffTs) {
    index += 1;
  }
  const keepFrom = Math.max(0, index - 1);
  if (keepFrom > 0) {
    vmgEvalHistory.splice(0, keepFrom);
  }
}

function recordVmgEvalSample(sample, heading, headingUnwrapped) {
  if (!sample) return;
  if (!Number.isFinite(sample.speed)) return;
  if (!Number.isFinite(headingUnwrapped)) return;
  const ts = Number.isFinite(sample.ts) ? sample.ts : Date.now();
  const safeHeading = normalizeHeadingDegrees(heading);
  if (!Number.isFinite(safeHeading)) return;
  vmgEvalHistory.push({
    ts,
    speed: sample.speed,
    heading: safeHeading,
    headingUnwrapped,
  });
  pruneVmgEvalHistory(ts - VMG_EVAL_HISTORY_MS);
}

function interpolateLinear(prev, curr, ts, key) {
  if (!prev || !curr) return null;
  const start = prev.ts;
  const end = curr.ts;
  const span = end - start;
  if (!Number.isFinite(span) || span <= 0) {
    return Number.isFinite(prev[key]) ? prev[key] : null;
  }
  const frac = clamp((ts - start) / span, 0, 1);
  const value = prev[key] + (curr[key] - prev[key]) * frac;
  return Number.isFinite(value) ? value : null;
}

function interpolateHeadingDegrees(prev, curr, ts) {
  const unwrapped = interpolateLinear(prev, curr, ts, "headingUnwrapped");
  if (!Number.isFinite(unwrapped)) return null;
  return normalizeHeadingDegrees(unwrapped);
}

function forEachVmgEvalSegment(startTs, endTs, callback) {
  for (let i = 1; i < vmgEvalHistory.length; i += 1) {
    const prev = vmgEvalHistory[i - 1];
    const curr = vmgEvalHistory[i];
    if (!prev || !curr) continue;
    if (curr.ts <= startTs || prev.ts >= endTs) continue;
    const segStart = Math.max(prev.ts, startTs);
    const segEnd = Math.min(curr.ts, endTs);
    if (segEnd <= segStart) continue;
    callback(prev, curr, segStart, segEnd);
  }
}

function computeWindowHeadingMean(startTs, endTs) {
  let sumSin = 0;
  let sumCos = 0;
  let duration = 0;
  forEachVmgEvalSegment(startTs, endTs, (prev, curr, segStart, segEnd) => {
    const midTs = (segStart + segEnd) / 2;
    const heading = interpolateHeadingDegrees(prev, curr, midTs);
    if (!Number.isFinite(heading)) return;
    const weight = segEnd - segStart;
    const rad = toRadians(heading);
    sumSin += Math.sin(rad) * weight;
    sumCos += Math.cos(rad) * weight;
    duration += weight;
  });
  if (duration <= 0) return null;
  return meanHeadingDegreesFromSinCos(sumSin, sumCos);
}

function computeVmgAtTime(prev, curr, ts, windAxisDeg) {
  if (!Number.isFinite(windAxisDeg)) return null;
  const heading = interpolateHeadingDegrees(prev, curr, ts);
  if (!Number.isFinite(heading)) return null;
  const speed = interpolateLinear(prev, curr, ts, "speed");
  if (!Number.isFinite(speed)) return null;
  const angleDiff = Math.abs(normalizeDeltaDegrees(heading - windAxisDeg));
  return speed * Math.cos(toRadians(angleDiff));
}

function computeWindowVmgAverage(startTs, endTs, windAxisDeg) {
  let sum = 0;
  let duration = 0;
  forEachVmgEvalSegment(startTs, endTs, (prev, curr, segStart, segEnd) => {
    const v0 = computeVmgAtTime(prev, curr, segStart, windAxisDeg);
    const v1 = computeVmgAtTime(prev, curr, segEnd, windAxisDeg);
    if (!Number.isFinite(v0) || !Number.isFinite(v1)) return;
    const segAvg = 0.5 * (v0 + v1);
    const weight = segEnd - segStart;
    sum += segAvg * weight;
    duration += weight;
  });
  if (duration <= 0) return null;
  return sum / duration;
}

function computeVmgWindAxis(startTs, endTs) {
  const meanHeading = computeWindowHeadingMean(startTs, endTs);
  if (!Number.isFinite(meanHeading)) return null;
  const twa = getVmgTwaDegrees();
  const offset = vmgTack === "starboard" ? twa : -twa;
  return normalizeHeadingDegrees(meanHeading + offset);
}

function formatVmgChangePercent(percent) {
  if (!Number.isFinite(percent)) return "--%";
  if (percent >= VMG_EVAL_MAX_GAIN) return ">50%";
  if (percent <= -VMG_EVAL_MAX_GAIN) return "<-50%";
  const rounded = Math.round(percent);
  const sign = rounded > 0 ? "+" : "";
  return `${sign}${rounded}%`;
}

function renderVmgIndicator() {
  if (!els.vmgEvalValue) return;
  if (!vmgEvalHistory.length) {
    els.vmgEvalValue.textContent = "--%";
    return;
  }

  const windowMs = VMG_EVAL_WINDOW_SEC * 1000;
  const endTs = vmgEvalHistory[vmgEvalHistory.length - 1].ts;
  const currentStart = endTs - windowMs;
  const prevStart = currentStart - windowMs;
  pruneVmgEvalHistory(prevStart - 1000);

  const windAxis = computeVmgWindAxis(prevStart, currentStart);
  if (!Number.isFinite(windAxis)) {
    els.vmgEvalValue.textContent = "--%";
    return;
  }

  const prevAvg = computeWindowVmgAverage(prevStart, currentStart, windAxis);
  const currAvg = computeWindowVmgAverage(currentStart, endTs, windAxis);
  if (!Number.isFinite(prevAvg) || !Number.isFinite(currAvg)) {
    els.vmgEvalValue.textContent = "--%";
    return;
  }
  if (Math.abs(prevAvg) < VMG_EVAL_MIN_BASE) {
    els.vmgEvalValue.textContent = "--%";
    return;
  }

  const percent = ((currAvg - prevAvg) / Math.abs(prevAvg)) * 100;
  els.vmgEvalValue.textContent = formatVmgChangePercent(percent);
}

function updateVmgEstimate(position) {
  const sample = getVmgSample(position);
  if (!sample) return;

  const heading = getVmgHeadingDegrees(sample);
  const headingUnwrapped = unwrapHeadingDegrees(
    heading,
    vmgEstimate.lastHeading,
    vmgEstimate.lastHeadingUnwrapped
  );
  vmgEstimate.lastHeading = heading;
  vmgEstimate.lastHeadingUnwrapped = headingUnwrapped;
  vmgEstimate.lastSpeed = sample.speed;

  if (Number.isFinite(headingUnwrapped)) {
    recordVmgEvalSample(sample, heading, headingUnwrapped);
  }
  if (!Number.isFinite(headingUnwrapped)) return;
  if (!Number.isFinite(vmgEstimate.lastTs)) {
    vmgEstimate.lastTs = sample.ts;
    vmgEstimate.headingRef = headingUnwrapped;
    vmgEstimate.theta0 = sample.speed;
    vmgEstimate.theta1 = 0;
    vmgEstimate.p11 = VMG_RLS_INIT_P;
    vmgEstimate.p12 = 0;
    vmgEstimate.p22 = VMG_RLS_INIT_P;
    vmgEstimate.residualVar = null;
    vmgEstimate.sampleCount = 0;
    vmgEstimate.slope = null;
    vmgEstimate.slopeStdErr = null;
    renderVmgIndicator();
    return;
  }

  const dtSec = Math.max(0, (sample.ts - vmgEstimate.lastTs) / 1000);
  vmgEstimate.lastTs = sample.ts;
  if (dtSec <= 0) return;

  const lambda = Math.exp(-dtSec / VMG_TAU_SECONDS);
  const alpha = 1 - lambda;

  if (!Number.isFinite(vmgEstimate.headingRef)) {
    vmgEstimate.headingRef = headingUnwrapped;
  }
  const headingDelta = headingUnwrapped - vmgEstimate.headingRef;
  const x0 = 1;
  const x1 = headingDelta;

  const p11 = vmgEstimate.p11;
  const p12 = vmgEstimate.p12;
  const p22 = vmgEstimate.p22;
  const px0 = p11 * x0 + p12 * x1;
  const px1 = p12 * x0 + p22 * x1;
  const denom = lambda + x0 * px0 + x1 * px1;
  if (!Number.isFinite(denom) || denom <= 0) {
    resetVmgEstimator();
    return;
  }

  const k0 = px0 / denom;
  const k1 = px1 / denom;
  const theta0 = vmgEstimate.theta0;
  const theta1 = vmgEstimate.theta1;
  const predicted = x0 * theta0 + x1 * theta1;
  const residual = sample.speed - predicted;

  const nextTheta0 = theta0 + k0 * residual;
  const nextTheta1 = theta1 + k1 * residual;
  const p11Next = (p11 - k0 * px0) / lambda;
  const p12NextA = (p12 - k0 * px1) / lambda;
  const p12NextB = (p12 - k1 * px0) / lambda;
  const p12Next = 0.5 * (p12NextA + p12NextB);
  const p22Next = (p22 - k1 * px1) / lambda;

  vmgEstimate.theta0 = nextTheta0;
  vmgEstimate.theta1 = nextTheta1;
  vmgEstimate.p11 = p11Next;
  vmgEstimate.p12 = p12Next;
  vmgEstimate.p22 = p22Next;
  vmgEstimate.sampleCount += 1;

  let residualVar = vmgEstimate.residualVar;
  if (!Number.isFinite(residualVar)) {
    residualVar = residual * residual;
  } else {
    residualVar = (1 - alpha) * residualVar + alpha * residual * residual;
  }
  vmgEstimate.residualVar = residualVar;

  let slope = null;
  let slopeStdErr = null;
  if (Number.isFinite(nextTheta1) && Number.isFinite(p22Next) && p22Next >= 0) {
    slope = nextTheta1;
    if (Number.isFinite(residualVar)) {
      slopeStdErr = Math.sqrt(residualVar * p22Next);
    }
  }
  if (vmgEstimate.sampleCount < 2) {
    slope = null;
    slopeStdErr = null;
  }
  vmgEstimate.slope = slope;
  vmgEstimate.slopeStdErr = slopeStdErr;

  renderVmgIndicator();
}

function updateVmgGpsState() {
  const target = els.vmgEval || els.vmgBar;
  if (!target) return;
  target.classList.toggle("gps-bad", isVmgGpsBad());
}

function buildImuMappingCandidates() {
  const permutations = [
    ["alpha", "beta", "gamma"],
    ["alpha", "gamma", "beta"],
    ["beta", "alpha", "gamma"],
    ["beta", "gamma", "alpha"],
    ["gamma", "alpha", "beta"],
    ["gamma", "beta", "alpha"],
  ];
  const candidates = [];
  permutations.forEach((axes) => {
    for (const sx of [-1, 1]) {
      for (const sy of [-1, 1]) {
        for (const sz of [-1, 1]) {
          candidates.push({ axes, signs: [sx, sy, sz] });
        }
      }
    }
  });
  return candidates;
}

function isImuCalibrated() {
  const calibration = state.imuCalibration;
  return (
    calibration &&
    Array.isArray(calibration.axes) &&
    calibration.axes.length === 3 &&
    Array.isArray(calibration.signs) &&
    calibration.signs.length === 3
  );
}

function getImuMapping() {
  return isImuCalibrated() ? state.imuCalibration : IMU_MAPPING_DEFAULT;
}

function mapRotationToVector(rotation, mapping) {
  if (!rotation) return { x: 0, y: 0, z: 0 };
  const axes = mapping?.axes || IMU_MAPPING_DEFAULT.axes;
  const signs = mapping?.signs || IMU_MAPPING_DEFAULT.signs;
  const values = {
    alpha: Number.isFinite(rotation.alpha) ? rotation.alpha : 0,
    beta: Number.isFinite(rotation.beta) ? rotation.beta : 0,
    gamma: Number.isFinite(rotation.gamma) ? rotation.gamma : 0,
  };
  return {
    x: (values[axes[0]] || 0) * (signs[0] || 1),
    y: (values[axes[1]] || 0) * (signs[1] || 1),
    z: (values[axes[2]] || 0) * (signs[2] || 1),
  };
}

function getImuGravityAlpha() {
  const config = KALMAN_TUNING.imu.gravityLowPass;
  const baseLength = config.baseBoatLengthMeters;
  const boatLength = Number.isFinite(state.boatLengthMeters) ? state.boatLengthMeters : baseLength;
  const effectiveLength = Math.max(baseLength, boatLength);
  const scale = Math.sqrt(baseLength / effectiveLength);
  return clamp(config.baseAlpha * scale, config.minAlpha, config.maxAlpha);
}

function updateGravityFromEvent(accel, linear) {
  if (!accel) return null;
  const raw = {
    x: Number(accel.x) || 0,
    y: Number(accel.y) || 0,
    z: Number(accel.z) || 0,
  };
  let next = raw;
  if (linear) {
    const lx = Number(linear.x) || 0;
    const ly = Number(linear.y) || 0;
    const lz = Number(linear.z) || 0;
    const candidate = { x: raw.x - lx, y: raw.y - ly, z: raw.z - lz };
    const candidateMag = Math.hypot(candidate.x, candidate.y, candidate.z);
    if (Number.isFinite(candidateMag) && candidateMag > 0.1) {
      next = candidate;
    }
  }
  if (!state.imu.gravity) {
    state.imu.gravity = { ...next };
  } else {
    const alpha = getImuGravityAlpha();
    state.imu.gravity.x += alpha * (next.x - state.imu.gravity.x);
    state.imu.gravity.y += alpha * (next.y - state.imu.gravity.y);
    state.imu.gravity.z += alpha * (next.z - state.imu.gravity.z);
  }
  return state.imu.gravity;
}

function readImuSample(event) {
  const accel = event.accelerationIncludingGravity;
  const gravity = updateGravityFromEvent(accel, event.acceleration);
  if (!gravity) return null;
  const rotation = event.rotationRate;
  if (!rotation) return null;
  const alpha = Number(rotation.alpha);
  const beta = Number(rotation.beta);
  const gamma = Number(rotation.gamma);
  state.imu.lastRotation = {
    alpha: Number.isFinite(alpha) ? alpha : 0,
    beta: Number.isFinite(beta) ? beta : 0,
    gamma: Number.isFinite(gamma) ? gamma : 0,
  };
  return {
    rotation: { alpha, beta, gamma },
    gravity: { ...gravity },
  };
}

function resetImuState() {
  state.imu.gravity = null;
  state.imu.lastTimestamp = null;
  state.imu.lastRotation = null;
  state.imu.lastYawRate = null;
}

function handleDeviceMotion(event) {
  if (!state.imuEnabled) return;
  const sample = readImuSample(event);
  if (!sample) return;
  const mapping = getImuMapping();
  const omegaDeg = mapRotationToVector(sample.rotation, mapping);
  const omegaX = toRadians(omegaDeg.x);
  const omegaY = toRadians(omegaDeg.y);
  const omegaZ = toRadians(omegaDeg.z);
  const g = sample.gravity;
  const gMag = Math.hypot(g.x, g.y, g.z);
  if (!Number.isFinite(gMag) || gMag <= 0) return;
  const gx = g.x / gMag;
  const gy = g.y / gMag;
  const gz = g.z / gMag;
  const yawRate = -(omegaX * gx + omegaY * gy + omegaZ * gz);
  state.imu.lastYawRate = yawRate;

  const timestamp = Number.isFinite(event.timeStamp) ? event.timeStamp : Date.now();
  if (!Number.isFinite(state.imu.lastTimestamp)) {
    state.imu.lastTimestamp = timestamp;
    return;
  }
  const dtRaw = (timestamp - state.imu.lastTimestamp) / 1000;
  state.imu.lastTimestamp = timestamp;
  const dtClamp = KALMAN_TUNING.imu.dtClampSeconds;
  const dt = clamp(dtRaw, dtClamp.min, dtClamp.max);
  if (dt <= 0) return;
  applyImuYawRate(yawRate, dt);

  if (!Number.isFinite(vmgImu.lastTimestamp)) {
    vmgImu.lastTimestamp = timestamp;
    return;
  }
  const vmgDtRaw = (timestamp - vmgImu.lastTimestamp) / 1000;
  vmgImu.lastTimestamp = timestamp;
  const vmgDt = clamp(vmgDtRaw, VMG_IMU_DT_CLAMP.min, VMG_IMU_DT_CLAMP.max);
  if (vmgDt <= 0) return;
  applyVmgImuYawRate(yawRate, vmgDt);
}

async function requestImuPermission() {
  if (typeof DeviceMotionEvent === "undefined") return false;
  if (typeof DeviceMotionEvent.requestPermission !== "function") return true;
  try {
    const result = await DeviceMotionEvent.requestPermission();
    return result === "granted";
  } catch (err) {
    return false;
  }
}

function stopImu() {
  if (imuListening) {
    window.removeEventListener("devicemotion", handleDeviceMotion);
    imuListening = false;
  }
  state.imuEnabled = false;
  resetImuState();
  resetVmgImuState();
}

async function startImu() {
  if (imuListening) return true;
  if (typeof DeviceMotionEvent === "undefined") return false;
  const granted = await requestImuPermission();
  if (!granted) return false;
  window.addEventListener("devicemotion", handleDeviceMotion, { passive: true });
  imuListening = true;
  state.imuEnabled = true;
  resetImuState();
  resetVmgImuState();
  if (state.kalman) {
    const vx = state.kalman.x[2];
    const vy = state.kalman.x[3];
    const heading = Math.atan2(vx, vy);
    if (Number.isFinite(heading)) {
      state.kalman.headingRad = heading;
    }
  }
  return true;
}

async function setImuEnabled(enabled) {
  const next = Boolean(enabled);
  if (next === state.imuEnabled) return;
  if (!next) {
    stopImu();
    updateDebugControls();
    return;
  }
  if (!isImuCalibrated()) {
    const goToSettings = window.confirm(
      "IMU needs calibration before use. Open Settings to calibrate now?"
    );
    if (goToSettings) {
      setView("settings");
      openImuCalibrationModal();
    }
    return;
  }
  const confirmed = window.confirm(
    "IMU requires the device to be fixed firmly to the boat. Heading becomes more precise and responsive. Enable IMU?"
  );
  if (!confirmed) return;
  const started = await startImu();
  if (!started) {
    window.alert("IMU permission was not granted on this device.");
  }
  updateDebugControls();
}

function updateImuCalibrationUi() {
  const calibrated = isImuCalibrated();
  if (els.openImuCalibration) {
    els.openImuCalibration.textContent = calibrated ? "Recalibrate IMU" : "Calibrate IMU";
  }
  if (els.imuCalibrationStatus) {
    els.imuCalibrationStatus.textContent = calibrated
      ? "IMU: calibrated"
      : "IMU: not calibrated";
  }
  if (els.startImuCalibration) {
    els.startImuCalibration.disabled = imuCalibrationActive;
  }
  if (els.imuCalibrationProgress) {
    let text = "Ready.";
    if (imuCalibrationError) {
      text = imuCalibrationError;
    } else if (imuCalibrationActive) {
      text = "Rotating... keep clockwise.";
    } else if (calibrated) {
      text = "Calibration saved.";
    } else {
      text = "Not calibrated.";
    }
    els.imuCalibrationProgress.textContent = text;
  }
}

function openImuCalibrationModal() {
  document.body.classList.add("imu-calibration-open");
  if (els.imuCalibrationModal) {
    els.imuCalibrationModal.setAttribute("aria-hidden", "false");
  }
  updateImuCalibrationUi();
}

function closeImuCalibrationModal() {
  stopImuCalibration();
  document.body.classList.remove("imu-calibration-open");
  if (els.imuCalibrationModal) {
    els.imuCalibrationModal.setAttribute("aria-hidden", "true");
  }
}

function computeImuCalibrationMapping(samples) {
  const minRotation = KALMAN_TUNING.imu.calibration.minRotationDegPerSec;
  const minSamples = KALMAN_TUNING.imu.calibration.minSamples;
  const minYawMean = KALMAN_TUNING.imu.calibration.minYawMeanDegPerSec;
  const minPositiveFraction = KALMAN_TUNING.imu.calibration.minPositiveFraction;
  const valid = samples.filter((sample) => {
    const rotation = sample.rotation;
    if (!rotation) return false;
    const mag = Math.hypot(
      Number(rotation.alpha) || 0,
      Number(rotation.beta) || 0,
      Number(rotation.gamma) || 0
    );
    return Number.isFinite(mag) && mag >= minRotation;
  });
  if (valid.length < minSamples) {
    return null;
  }

  let best = null;
  let bestScore = -Infinity;
  let bestStats = null;
  IMU_MAPPING_CANDIDATES.forEach((candidate) => {
    let sum = 0;
    let count = 0;
    let positive = 0;
    valid.forEach((sample) => {
      const g = sample.gravity;
      const gMag = Math.hypot(g.x, g.y, g.z);
      if (!Number.isFinite(gMag) || gMag <= 0) return;
      const ghat = { x: g.x / gMag, y: g.y / gMag, z: g.z / gMag };
      const omegaDeg = mapRotationToVector(sample.rotation, candidate);
      const dot = omegaDeg.x * ghat.x + omegaDeg.y * ghat.y + omegaDeg.z * ghat.z;
      const yawRate = -dot;
      if (!Number.isFinite(yawRate)) return;
      sum += yawRate;
      if (yawRate > 0) {
        positive += 1;
      }
      count += 1;
    });
    if (!count) return;
    const score = sum / count;
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
      bestStats = {
        meanYaw: score,
        positiveFraction: positive / count,
      };
    }
  });

  if (
    !best ||
    !Number.isFinite(bestScore) ||
    bestScore <= 0 ||
    !bestStats ||
    bestStats.meanYaw < minYawMean ||
    bestStats.positiveFraction < minPositiveFraction
  ) {
    return null;
  }
  return {
    axes: [...best.axes],
    signs: [...best.signs],
    calibratedAt: Date.now(),
  };
}

function handleImuCalibrationMotion(event) {
  const sample = readImuSample(event);
  if (!sample) return;
  imuCalibrationSamples.push(sample);
}

function stopImuCalibration() {
  if (imuCalibrationTimer) {
    clearTimeout(imuCalibrationTimer);
    imuCalibrationTimer = null;
  }
  window.removeEventListener("devicemotion", handleImuCalibrationMotion);
  imuCalibrationActive = false;
}

async function startImuCalibration() {
  if (imuCalibrationActive) return;
  imuCalibrationError = "";
  if (state.imuEnabled) {
    stopImu();
    updateDebugControls();
  }
  const granted = await requestImuPermission();
  if (!granted) {
    imuCalibrationError = "IMU permission not granted.";
    updateImuCalibrationUi();
    return;
  }
  imuCalibrationSamples = [];
  resetImuState();
  imuCalibrationActive = true;
  updateImuCalibrationUi();
  window.addEventListener("devicemotion", handleImuCalibrationMotion, { passive: true });
  const durationMs = KALMAN_TUNING.imu.calibration.durationSeconds * 1000;
  imuCalibrationTimer = setTimeout(() => {
    stopImuCalibration();
    const mapping = computeImuCalibrationMapping(imuCalibrationSamples);
    if (!mapping) {
      imuCalibrationError = "Calibration failed. Rotate clockwise and try again.";
      updateImuCalibrationUi();
      return;
    }
    state.imuCalibration = mapping;
    saveSettings();
    updateImuCalibrationUi();
  }, durationMs);
}

async function requestWakeLock() {
  if (!("wakeLock" in navigator)) return;
  try {
    if (state.wakeLock) return;
    state.wakeLock = await navigator.wakeLock.request("screen");
  } catch (err) {
    console.warn("Wake lock failed", err);
  }
}

function releaseWakeLock() {
  if (!state.wakeLock) return;
  state.wakeLock.release().catch(() => {});
  state.wakeLock = null;
}

function syncCountdownPicker(secondsOverride) {
  if (!els.countdownHours || !els.countdownMinutes || !els.countdownSeconds) return;
  const totalSeconds = Number.isFinite(secondsOverride)
    ? secondsOverride
    : state.start.countdownSeconds;
  const { hours, minutes, seconds } = splitDurationSeconds(totalSeconds);
  setNumberInputValue(els.countdownHours, hours);
  setNumberInputValue(els.countdownMinutes, minutes);
  setNumberInputValue(els.countdownSeconds, seconds);
}

function setCountdownPickerLive(active) {
  countdownPickerLive = Boolean(active);
}

function cancelActiveCountdown(options = {}) {
  const { force = false, clearAbsolute = false } = options;
  if (!force && state.start.mode !== "countdown") return;
  const hasStart = Boolean(state.start.startTs);
  if (!hasStart && !clearAbsolute) return;
  const remaining = hasStart ? Math.max(0, Math.round((state.start.startTs - Date.now()) / 1000)) : null;
  if (hasStart) {
    state.start.countdownSeconds = remaining;
  }
  state.start.startTs = null;
  if (clearAbsolute) {
    state.start.absoluteTime = "";
  }
  state.start.freeze = null;
  state.start.crossedEarly = false;
  setCountdownPickerLive(false);
  resetBeepState();
  saveSettings();
  if (clearAbsolute && els.absoluteTime) {
    els.absoluteTime.value = "";
  }
  if (Number.isFinite(remaining)) {
    syncCountdownPicker(remaining);
  }
  updateStartDisplay();
  updateLineProjection();
}

function getCountdownSecondsFromPicker() {
  if (!els.countdownHours || !els.countdownMinutes || !els.countdownSeconds) {
    return state.start.countdownSeconds;
  }
  const hours = Number.parseInt(els.countdownHours.value, 10) || 0;
  const minutes = Number.parseInt(els.countdownMinutes.value, 10) || 0;
  const seconds = Number.parseInt(els.countdownSeconds.value, 10) || 0;
  const total = hours * 3600 + minutes * 60 + seconds;
  return Math.min(Math.max(total, 0), MAX_COUNTDOWN_SECONDS);
}

function updateSoundToggle() {
  if (els.soundOn) {
    els.soundOn.setAttribute("aria-pressed", state.soundEnabled ? "true" : "false");
  }
  if (els.soundOff) {
    els.soundOff.setAttribute("aria-pressed", state.soundEnabled ? "false" : "true");
  }
}

function updateTimeFormatToggle() {
  const format = normalizeTimeFormat(state.timeFormat);
  if (els.timeFormat24) {
    els.timeFormat24.setAttribute("aria-pressed", format === "24h" ? "true" : "false");
  }
  if (els.timeFormat12) {
    els.timeFormat12.setAttribute("aria-pressed", format === "12h" ? "true" : "false");
  }
}

function updateSpeedUnitToggle() {
  const unit = normalizeSpeedUnit(state.speedUnit);
  if (els.speedUnitMs) {
    els.speedUnitMs.setAttribute("aria-pressed", unit === "ms" ? "true" : "false");
  }
  if (els.speedUnitKn) {
    els.speedUnitKn.setAttribute("aria-pressed", unit === "kn" ? "true" : "false");
  }
  if (els.speedUnitMph) {
    els.speedUnitMph.setAttribute("aria-pressed", unit === "mph" ? "true" : "false");
  }
}

function updateDistanceUnitToggle() {
  const unit = normalizeDistanceUnit(state.distanceUnit);
  if (els.distanceUnitM) {
    els.distanceUnitM.setAttribute("aria-pressed", unit === "m" ? "true" : "false");
  }
  if (els.distanceUnitFt) {
    els.distanceUnitFt.setAttribute("aria-pressed", unit === "ft" ? "true" : "false");
  }
  if (els.distanceUnitYd) {
    els.distanceUnitYd.setAttribute("aria-pressed", unit === "yd" ? "true" : "false");
  }
}

function setSoundEnabled(enabled) {
  state.soundEnabled = Boolean(enabled);
  saveSettings();
  updateSoundToggle();
}

function setTimeFormat(format) {
  state.timeFormat = normalizeTimeFormat(format);
  saveSettings();
  updateTimeFormatToggle();
  updateCurrentTime();
  updateStartDisplay();
}

function setSpeedUnit(unit) {
  state.speedUnit = normalizeSpeedUnit(unit);
  saveSettings();
  updateSpeedUnitToggle();
  updateLineProjection();
  updateGPSDisplay();
}

function setDistanceUnit(unit) {
  state.distanceUnit = normalizeDistanceUnit(unit);
  saveSettings();
  updateDistanceUnitToggle();
  updateStatusUnitLabels();
  updateRaceMetricLabels();
  syncBowOffsetInput();
  syncBoatLengthInput();
  updateLineProjection();
  updateGPSDisplay();
}

function updateStartModeToggle() {
  const isCountdown = state.start.mode === "countdown";
  if (els.startModeAbsolute) {
    els.startModeAbsolute.setAttribute("aria-pressed", isCountdown ? "false" : "true");
  }
  if (els.startModeCountdown) {
    els.startModeCountdown.setAttribute("aria-pressed", isCountdown ? "true" : "false");
  }
  if (els.startModeAbsolutePanel) {
    els.startModeAbsolutePanel.hidden = isCountdown;
  }
  if (els.startModeCountdownPanel) {
    els.startModeCountdownPanel.hidden = !isCountdown;
  }
  if (els.setStart) {
    els.setStart.textContent = isCountdown ? "Begin" : "Set";
  }
}

function loadSettings() {
  const settings = loadSettingsFromStorage();
  state.line = settings.line;
  state.coordsFormat = settings.coordsFormat;
  state.lineName = settings.lineMeta?.name || null;
  state.lineSourceId = settings.lineMeta?.sourceId || null;
  state.debugGpsEnabled = settings.debugGpsEnabled;
  state.useKalman = true;
  state.bowOffsetMeters = settings.bowOffsetMeters;
  state.boatLengthMeters = settings.boatLengthMeters;
  state.imuCalibration = settings.imuCalibration || null;
  state.soundEnabled = settings.soundEnabled;
  state.timeFormat = settings.timeFormat;
  state.speedUnit = settings.speedUnit;
  state.distanceUnit = settings.distanceUnit;
  state.start = { ...state.start, ...settings.start };
  delete state.start.preStartSign;
}

function saveSettings() {
  saveSettingsToStorage({
    line: state.line,
    lineMeta: {
      name: state.lineName,
      sourceId: state.lineSourceId,
    },
    coordsFormat: state.coordsFormat,
    debugGpsEnabled: state.debugGpsEnabled,
    useKalman: true,
    bowOffsetMeters: state.bowOffsetMeters,
    boatLengthMeters: state.boatLengthMeters,
    imuCalibration: state.imuCalibration,
    soundEnabled: state.soundEnabled,
    timeFormat: state.timeFormat,
    speedUnit: state.speedUnit,
    distanceUnit: state.distanceUnit,
    start: {
      mode: state.start.mode,
      countdownSeconds: state.start.countdownSeconds,
      absoluteTime: state.start.absoluteTime,
      startTs: state.start.startTs,
      crossedEarly: state.start.crossedEarly,
    },
  });
}

function loadSavedLines() {
  try {
    const raw = localStorage.getItem(LINES_KEY);
    state.savedLines = raw ? JSON.parse(raw) : [];
  } catch (err) {
    console.warn("Failed to load saved lines", err);
    state.savedLines = [];
  }
}

function hasStartLine() {
  return (
    Number.isFinite(state.line.a.lat) &&
    Number.isFinite(state.line.a.lon) &&
    Number.isFinite(state.line.b.lat) &&
    Number.isFinite(state.line.b.lon)
  );
}

function updateLineNameDisplay() {
  if (!els.statusLineName) return;
  if (!hasStartLine()) {
    els.statusLineName.textContent = "NO LINE";
    return;
  }
  els.statusLineName.textContent = state.lineName || "--";
}

function syncLineNameWithSavedLines() {
  if (!state.lineSourceId) {
    updateLineNameDisplay();
    return;
  }
  const exists = state.savedLines.some((line) => line.id === state.lineSourceId);
  if (!exists) {
    state.lineName = null;
    state.lineSourceId = null;
    saveSettings();
  }
  updateLineNameDisplay();
}

function saveSavedLines() {
  localStorage.setItem(LINES_KEY, JSON.stringify(state.savedLines));
}

function openLoadModal() {
  if (!els.savedLinesList) return;
  state.selectedLineId = null;
  renderSavedLinesList();
  document.body.classList.add("modal-open");
  if (els.loadModal) {
    els.loadModal.setAttribute("aria-hidden", "false");
  }
}

function closeLoadModal() {
  document.body.classList.remove("modal-open");
  if (els.loadModal) {
    els.loadModal.setAttribute("aria-hidden", "true");
  }
}

function renderSavedLinesList() {
  if (!els.savedLinesList) return;
  els.savedLinesList.innerHTML = "";
  if (!state.savedLines.length) {
    const empty = document.createElement("div");
    empty.className = "hint";
    empty.textContent = "No saved lines yet.";
    els.savedLinesList.appendChild(empty);
    updateModalButtons();
    return;
  }
  state.savedLines.forEach((line) => {
    const row = document.createElement("div");
    row.className = "modal-item";
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = line.name;
    if (state.selectedLineId === line.id) {
      button.classList.add("selected");
    }
    button.addEventListener("click", () => {
      state.selectedLineId = line.id;
      renderSavedLinesList();
    });
    row.appendChild(button);
    els.savedLinesList.appendChild(row);
  });
  updateModalButtons();
}

function updateModalButtons() {
  const hasSelection = Boolean(state.selectedLineId);
  if (els.confirmLoad) {
    els.confirmLoad.disabled = !hasSelection;
  }
  if (els.confirmDelete) {
    els.confirmDelete.disabled = !hasSelection;
  }
}

function updateInputs() {
  syncCoordinateInputs();
  syncCountdownPicker();
  syncBowOffsetInput();
  syncBoatLengthInput();
  updateStartModeToggle();
  updateSoundToggle();
  updateTimeFormatToggle();
  updateSpeedUnitToggle();
  updateDistanceUnitToggle();
  updateStatusUnitLabels();
  updateRaceHintUnits();
  els.absoluteTime.value = state.start.absoluteTime || "";
}

function normalizeCoordinateFormat(format) {
  if (format === "dd" || format === "ddm" || format === "dms") return format;
  return "dd";
}

function getCoordinateFormatLabel(format) {
  const normalized = normalizeCoordinateFormat(format);
  if (normalized === "ddm") return "Deg+Min";
  if (normalized === "dms") return "DMS";
  return "Decimal";
}

function syncCoordinateFormatUI() {
  const format = normalizeCoordinateFormat(state.coordsFormat);
  if (els.coordsFormatBtn) {
    els.coordsFormatBtn.textContent = `Format: ${getCoordinateFormatLabel(format)}`;
  }
  if (els.coordsDoneTop) {
    els.coordsDoneTop.hidden = format === "dd";
  }
  if (els.coordsFormatDD) els.coordsFormatDD.hidden = format !== "dd";
  if (els.coordsFormatDDM) els.coordsFormatDDM.hidden = format !== "ddm";
  if (els.coordsFormatDMS) els.coordsFormatDMS.hidden = format !== "dms";
}

function trimTrailingZeros(value) {
  if (!value.includes(".")) return value;
  return value.replace(/\.?0+$/, "");
}

function swapStartLineMarks() {
  const nextA = { ...state.line.b };
  const nextB = { ...state.line.a };
  state.line.a = nextA;
  state.line.b = nextB;
  state.lineName = null;
  state.lineSourceId = null;
  saveSettings();
  updateLineNameDisplay();
  updateInputs();
  updateLineStatus();
  updateLineProjection();
}

function formatCoordinateValue(value, digits) {
  const fixed = value.toFixed(digits);
  const trimmed = trimTrailingZeros(fixed);
  return trimmed === "-0" ? "0" : trimmed;
}

function roundFraction(value, digits) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function formatFractionDigits(value, digits) {
  if (!Number.isFinite(value) || value <= 0) return "";
  const fixed = value.toFixed(digits);
  const parts = fixed.split(".");
  if (parts.length < 2) return "";
  return parts[1].replace(/0+$/, "");
}

function splitDecimalToDDM(value, kind) {
  const abs = Math.abs(value);
  let deg = Math.floor(abs);
  const minTotal = (abs - deg) * 60;
  let min = Math.floor(minTotal);
  let minFraction = roundFraction(minTotal - min, COORD_DECIMAL_DIGITS);
  if (minFraction >= 1) {
    min += 1;
    minFraction = 0;
  }
  if (min >= 60) {
    min = 0;
    deg += 1;
  }
  const hemi = kind === "lon" ? (value < 0 ? "W" : "E") : value < 0 ? "S" : "N";
  return { deg, min, minDec: formatFractionDigits(minFraction, COORD_DECIMAL_DIGITS), hemi };
}

function splitDecimalToDMS(value, kind) {
  const abs = Math.abs(value);
  let deg = Math.floor(abs);
  const minTotal = (abs - deg) * 60;
  let min = Math.floor(minTotal);
  const secTotal = (minTotal - min) * 60;
  let sec = Math.floor(secTotal);
  let secFraction = roundFraction(secTotal - sec, COORD_DECIMAL_DIGITS);
  if (secFraction >= 1) {
    sec += 1;
    secFraction = 0;
  }
  if (sec >= 60) {
    sec = 0;
    min += 1;
  }
  if (min >= 60) {
    min = 0;
    deg += 1;
  }
  const hemi = kind === "lon" ? (value < 0 ? "W" : "E") : value < 0 ? "S" : "N";
  return { deg, min, sec, secDec: formatFractionDigits(secFraction, COORD_DECIMAL_DIGITS), hemi };
}

function setNumberInputValue(input, value) {
  if (!input) return;
  if (!Number.isFinite(value)) {
    input.value = "";
    return;
  }
  input.value = String(value);
}

function setFixedInputValue(input, value, digits) {
  if (!input) return;
  if (!Number.isFinite(value)) {
    input.value = "";
    return;
  }
  input.value = formatCoordinateValue(value, digits);
}

function setDigitsInputValue(input, value) {
  if (!input) return;
  if (typeof value === "string") {
    input.value = value;
    return;
  }
  if (!Number.isFinite(value)) {
    input.value = "";
    return;
  }
  input.value = String(value);
}

function populateNumberSelect(select, options = {}) {
  if (!select) return;
  const min = Number.isFinite(options.min) ? options.min : 0;
  const max = Number.isFinite(options.max) ? options.max : 0;
  const pad = Number.isFinite(options.pad) ? options.pad : 0;
  const includePlaceholder = options.placeholder !== false;
  const previous = select.value;
  select.innerHTML = "";

  if (includePlaceholder) {
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "--";
    select.appendChild(placeholder);
  }

  for (let value = min; value <= max; value += 1) {
    const option = document.createElement("option");
    option.value = String(value);
    option.textContent = pad ? String(value).padStart(pad, "0") : String(value);
    select.appendChild(option);
  }

  if (previous !== "") {
    select.value = previous;
  }
}

function initCoordinatePickers() {
  const latDegreeSelects = [
    els.ddm.latA.deg,
    els.ddm.latB.deg,
    els.dms.latA.deg,
    els.dms.latB.deg,
  ].filter(Boolean);
  latDegreeSelects.forEach((select) => populateNumberSelect(select, { max: 90 }));

  const lonDegreeSelects = [
    els.ddm.lonA.deg,
    els.ddm.lonB.deg,
    els.dms.lonA.deg,
    els.dms.lonB.deg,
  ].filter(Boolean);
  lonDegreeSelects.forEach((select) => populateNumberSelect(select, { max: 180 }));

  const minuteSelects = [
    els.ddm.latA.min,
    els.ddm.lonA.min,
    els.ddm.latB.min,
    els.ddm.lonB.min,
    els.dms.latA.min,
    els.dms.lonA.min,
    els.dms.latB.min,
    els.dms.lonB.min,
  ].filter(Boolean);
  minuteSelects.forEach((select) => populateNumberSelect(select, { max: 59, pad: 2 }));

  const secondSelects = [
    els.dms.latA.sec,
    els.dms.lonA.sec,
    els.dms.latB.sec,
    els.dms.lonB.sec,
  ].filter(Boolean);
  secondSelects.forEach((select) => populateNumberSelect(select, { max: 59, pad: 2 }));
}

function initCountdownPicker() {
  populateNumberSelect(els.countdownHours, { max: 23, pad: 2, placeholder: false });
  populateNumberSelect(els.countdownMinutes, { max: 59, pad: 2, placeholder: false });
  populateNumberSelect(els.countdownSeconds, { max: 59, pad: 2, placeholder: false });
}


function applyDDMDegreeLimit(group, maxDegrees) {
  if (!group || !group.deg || !group.min || !group.minDec) return;
  const degrees = Number.parseInt(group.deg.value, 10);
  const limitHit = Number.isFinite(degrees) && degrees === maxDegrees;
  if (limitHit) {
    group.min.value = "0";
    group.minDec.value = "";
  }
  group.min.disabled = limitHit;
  group.minDec.disabled = limitHit;
}

function applyDMSDegreeLimit(group, maxDegrees) {
  if (!group || !group.deg || !group.min || !group.sec || !group.secDec) return;
  const degrees = Number.parseInt(group.deg.value, 10);
  const limitHit = Number.isFinite(degrees) && degrees === maxDegrees;
  if (limitHit) {
    group.min.value = "0";
    group.sec.value = "0";
    group.secDec.value = "";
  }
  group.min.disabled = limitHit;
  group.sec.disabled = limitHit;
  group.secDec.disabled = limitHit;
}

function applyCoordinatePickerConstraints() {
  applyDDMDegreeLimit(els.ddm.latA, 90);
  applyDDMDegreeLimit(els.ddm.lonA, 180);
  applyDDMDegreeLimit(els.ddm.latB, 90);
  applyDDMDegreeLimit(els.ddm.lonB, 180);
  applyDMSDegreeLimit(els.dms.latA, 90);
  applyDMSDegreeLimit(els.dms.lonA, 180);
  applyDMSDegreeLimit(els.dms.latB, 90);
  applyDMSDegreeLimit(els.dms.lonB, 180);
}

function handleCoordinateInputsChanged() {
  applyCoordinatePickerConstraints();
  parseLineInputs();
  updateInputs();
  updateLineStatus();
  updateLineProjection();
  refreshHemisphereButtons();
}

function refreshHemisphereButtons() {
  Object.values(hemisphereGroups).forEach(({ input, buttons }) => {
    const value = input.value || "";
    buttons.forEach((button) => {
      const isActive = button.dataset.value === value;
      button.classList.toggle("active", isActive);
      button.setAttribute("aria-pressed", isActive ? "true" : "false");
    });
  });
}

function initHemisphereToggles() {
  document.querySelectorAll(".coords-hemis").forEach((container) => {
    const target = container.dataset.target;
    const input = document.getElementById(target);
    if (!input) return;
    const buttons = Array.from(container.querySelectorAll(".coords-hemisphere"));
    if (!buttons.length) return;
    hemisphereGroups[target] = { input, buttons };
    buttons.forEach((button) => {
      button.addEventListener("click", () => {
        const next = button.dataset.value;
        if (input.value === next) return;
        input.value = next;
        handleCoordinateInputsChanged();
      });
    });
  });
}

function syncCoordinateInputs() {
  const activeFormat = normalizeCoordinateFormat(state.coordsFormat);
  syncCoordinateFormatUI();

  syncCoordinateField({
    value: state.line.a.lat,
    kind: "lat",
    activeFormat,
    dd: els.latA,
    ddm: els.ddm.latA,
    dms: els.dms.latA,
  });
  syncCoordinateField({
    value: state.line.a.lon,
    kind: "lon",
    activeFormat,
    dd: els.lonA,
    ddm: els.ddm.lonA,
    dms: els.dms.lonA,
  });
  syncCoordinateField({
    value: state.line.b.lat,
    kind: "lat",
    activeFormat,
    dd: els.latB,
    ddm: els.ddm.latB,
    dms: els.dms.latB,
  });
  syncCoordinateField({
    value: state.line.b.lon,
    kind: "lon",
    activeFormat,
    dd: els.lonB,
    ddm: els.ddm.lonB,
    dms: els.dms.lonB,
  });

  applyCoordinatePickerConstraints();
  refreshHemisphereButtons();
}

function syncCoordinateField({ value, kind, activeFormat, dd, ddm, dms }) {
  if (Number.isFinite(value)) {
    if (dd) setFixedInputValue(dd, value, COORD_DD_DIGITS);
    if (ddm && ddm.deg && ddm.min && ddm.minDec && ddm.hemi) {
      const parts = splitDecimalToDDM(value, kind);
      setNumberInputValue(ddm.deg, parts.deg);
      setNumberInputValue(ddm.min, parts.min);
      setDigitsInputValue(ddm.minDec, parts.minDec);
      ddm.hemi.value = parts.hemi;
    }
    if (dms && dms.deg && dms.min && dms.sec && dms.secDec && dms.hemi) {
      const parts = splitDecimalToDMS(value, kind);
      setNumberInputValue(dms.deg, parts.deg);
      setNumberInputValue(dms.min, parts.min);
      setNumberInputValue(dms.sec, parts.sec);
      setDigitsInputValue(dms.secDec, parts.secDec);
      dms.hemi.value = parts.hemi;
    }
    return;
  }

  if (activeFormat !== "dd" && dd) dd.value = "";
  if (activeFormat !== "ddm" && ddm) {
    if (ddm.deg) ddm.deg.value = "";
    if (ddm.min) ddm.min.value = "";
    if (ddm.minDec) ddm.minDec.value = "";
  }
  if (activeFormat !== "dms" && dms) {
    if (dms.deg) dms.deg.value = "";
    if (dms.min) dms.min.value = "";
    if (dms.sec) dms.sec.value = "";
    if (dms.secDec) dms.secDec.value = "";
  }
}

function parseDecimalDegreesInput(input) {
  if (!input) return null;
  const parsed = Number.parseFloat(input.value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseDigitFraction(input, maxDigits) {
  if (!input) return null;
  const raw = String(input.value || "").trim();
  if (!raw) return 0;
  if (raw.length > maxDigits) return null;
  if (!/^\d+$/.test(raw)) return null;
  const digits = Number.parseInt(raw, 10);
  if (!Number.isFinite(digits)) return null;
  return digits / 10 ** raw.length;
}

function parseDDMInput(group, kind) {
  if (!group || !group.deg || !group.min || !group.minDec || !group.hemi) return null;
  if (!group.deg.value || !group.min.value) return null;
  const deg = Number.parseInt(group.deg.value, 10);
  const minInt = Number.parseInt(group.min.value, 10);
  if (!Number.isFinite(deg) || !Number.isFinite(minInt)) return null;
  if (minInt < 0 || minInt >= 60) return null;
  const maxDeg = kind === "lon" ? 180 : 90;
  if (deg < 0 || deg > maxDeg) return null;
  const minFraction = parseDigitFraction(group.minDec, COORD_DECIMAL_DIGITS);
  if (minFraction === null) return null;
  const minutes = minInt + minFraction;
  if (minutes < 0 || minutes >= 60) return null;
  if (deg === maxDeg && minutes > 0) return null;
  const hemi = group.hemi.value;
  const sign =
    kind === "lon" ? (hemi === "W" ? -1 : hemi === "E" ? 1 : null) : hemi === "S" ? -1 : hemi === "N" ? 1 : null;
  if (sign === null) return null;
  return sign * (deg + minutes / 60);
}

function parseDMSInput(group, kind) {
  if (!group || !group.deg || !group.min || !group.sec || !group.secDec || !group.hemi) return null;
  if (!group.deg.value || !group.min.value || !group.sec.value) return null;
  const deg = Number.parseInt(group.deg.value, 10);
  const min = Number.parseInt(group.min.value, 10);
  const secInt = Number.parseInt(group.sec.value, 10);
  if (!Number.isFinite(deg) || !Number.isFinite(min) || !Number.isFinite(secInt)) return null;
  if (min < 0 || min >= 60) return null;
  if (secInt < 0 || secInt >= 60) return null;
  const maxDeg = kind === "lon" ? 180 : 90;
  if (deg < 0 || deg > maxDeg) return null;
  const secFraction = parseDigitFraction(group.secDec, COORD_DECIMAL_DIGITS);
  if (secFraction === null) return null;
  const sec = secInt + secFraction;
  if (sec < 0 || sec >= 60) return null;
  if (deg === maxDeg && (min > 0 || sec > 0)) return null;
  const hemi = group.hemi.value;
  const sign =
    kind === "lon" ? (hemi === "W" ? -1 : hemi === "E" ? 1 : null) : hemi === "S" ? -1 : hemi === "N" ? 1 : null;
  if (sign === null) return null;
  return sign * (deg + min / 60 + sec / 3600);
}

function parseLineInputs(options = {}) {
  const preserveLineMeta = Boolean(options.preserveLineMeta);
  const format = normalizeCoordinateFormat(state.coordsFormat);
  const previous = {
    a: { ...state.line.a },
    b: { ...state.line.b },
  };

  let aLat = null;
  let aLon = null;
  let bLat = null;
  let bLon = null;

  if (format === "ddm") {
    aLat = parseDDMInput(els.ddm.latA, "lat");
    aLon = parseDDMInput(els.ddm.lonA, "lon");
    bLat = parseDDMInput(els.ddm.latB, "lat");
    bLon = parseDDMInput(els.ddm.lonB, "lon");
  } else if (format === "dms") {
    aLat = parseDMSInput(els.dms.latA, "lat");
    aLon = parseDMSInput(els.dms.lonA, "lon");
    bLat = parseDMSInput(els.dms.latB, "lat");
    bLon = parseDMSInput(els.dms.lonB, "lon");
  } else {
    aLat = parseDecimalDegreesInput(els.latA);
    aLon = parseDecimalDegreesInput(els.lonA);
    bLat = parseDecimalDegreesInput(els.latB);
    bLon = parseDecimalDegreesInput(els.lonB);
  }

  state.line.a.lat = Number.isFinite(aLat) ? aLat : null;
  state.line.a.lon = Number.isFinite(aLon) ? aLon : null;
  state.line.b.lat = Number.isFinite(bLat) ? bLat : null;
  state.line.b.lon = Number.isFinite(bLon) ? bLon : null;

  const changed =
    state.line.a.lat !== previous.a.lat ||
    state.line.a.lon !== previous.a.lon ||
    state.line.b.lat !== previous.b.lat ||
    state.line.b.lon !== previous.b.lon;

  if (changed && !preserveLineMeta) {
    state.lineName = null;
    state.lineSourceId = null;
  }

  saveSettings();
  updateLineNameDisplay();
}

function computeStartTimestamp() {
  if (state.start.mode === "countdown") {
    const seconds = Math.min(
      Math.max(Number.parseInt(state.start.countdownSeconds, 10) || 0, 0),
      MAX_COUNTDOWN_SECONDS
    );
    return Date.now() + seconds * 1000;
  }
  if (!state.start.absoluteTime) return null;
  const parts = state.start.absoluteTime.split(":").map(Number);
  const [hours, minutes, seconds = 0] = parts;
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  const now = new Date();
  const target = new Date(now);
  target.setHours(hours, minutes, seconds, 0);
  if (target.getTime() <= now.getTime()) {
    target.setDate(target.getDate() + 1);
  }
  return target.getTime();
}

function setStart(options = {}) {
  state.start.startTs = computeStartTimestamp();
  state.start.crossedEarly = false;
  state.start.freeze = null;
  resetBeepState();
  saveSettings();
  if (options.goToRace) {
    setView("race");
  }
}

function syncStartToMinute() {
  if (!state.start.startTs) return;
  const now = Date.now();
  const deltaMs = state.start.startTs - now;
  if (deltaMs <= 0) return;
  if (deltaMs < 60000) {
    state.start.startTs = now + 60000;
  } else {
    const roundedMs = Math.round(deltaMs / 60000) * 60000;
    state.start.startTs = now + roundedMs;
  }
  resetBeepState();
  saveSettings();
  updateStartDisplay();
  updateLineProjection();
}

function adjustStart(seconds) {
  if (!state.start.startTs) return;
  state.start.startTs += seconds * 1000;
  if (state.start.startTs > Date.now()) {
    resetBeepState();
  }
  saveSettings();
}

function updateStartDisplay() {
  const canAdjustStart =
    Boolean(state.start.startTs) && state.start.startTs > Date.now();
  setRaceTimingControlsEnabled(canAdjustStart);

  if (!state.start.startTs) {
    setCountdownPickerLive(false);
    if (els.statusTime) {
      els.statusTime.textContent = "NO TIME";
    }
    if (els.statusStartTime) {
      els.statusStartTime.textContent = "NO TIME";
    }
    els.raceCountdown.textContent = "NO TIME";
    if (els.raceStartClock) {
      els.raceStartClock.textContent = "Start not set";
    }
    state.start.freeze = null;
    document.body.classList.remove("race-success", "race-fail");
    resetBeepState();
    fitRaceText();
    return;
  }
  const now = Date.now();
  const delta = Math.max(0, (state.start.startTs - now) / 1000);
  if (state.start.mode === "countdown" && countdownPickerLive) {
    syncCountdownPicker(Math.max(0, Math.round(delta)));
    if (delta <= 0) {
      countdownPickerLive = false;
    }
  }
  if (els.statusTime) {
    els.statusTime.textContent = formatTimeRemainingHMSFull(delta);
  }
  if (delta > 0) {
    if (state.start.freeze) {
      state.start.freeze = null;
    }
    document.body.classList.remove("race-success", "race-fail");
    els.raceCountdown.textContent = formatTimeRemainingHMS(delta);
    handleCountdownBeeps(delta);
  }
  const startDate = new Date(state.start.startTs);
  const formattedTime = formatClockTime(startDate, false);
  if (els.raceStartClock) {
    els.raceStartClock.textContent = `Start at ${formattedTime}`;
  }
  if (els.statusStartTime) {
    els.statusStartTime.textContent = formatClockTime(startDate, true);
  }
  if (delta <= 0) {
    if (!state.audio.startBeeped) {
      if (document.body.classList.contains("race-mode")) {
        playBeep(START_BEEP_DURATION_MS, START_BEEP_FREQUENCY);
      }
      state.audio.startBeeped = true;
    }
    setGpsMode("setup");
    const outcomeText = state.start.crossedEarly ? "False\nStart" : "Good\nStart";
    if (!state.start.freeze) {
      state.start.freeze = {
        countdown: outcomeText,
      };
    }
    if (!state.start.freeze.countdown) {
      state.start.freeze.countdown = outcomeText;
    }
    els.raceCountdown.textContent = state.start.freeze.countdown;
    if (state.start.crossedEarly) {
      document.body.classList.add("race-fail");
      document.body.classList.remove("race-success");
    } else {
      document.body.classList.add("race-success");
      document.body.classList.remove("race-fail");
    }
    state.audio.lastBeepSecond = null;
  }
  fitRaceText();
}

function updateCurrentTime() {
  if (!els.currentTime) return;
  const now = new Date();
  els.currentTime.textContent = formatClockTime(now, true);
}

function resetPositionState() {
  state.position = null;
  state.bowPosition = null;
  state.kalmanPosition = null;
  state.lastPosition = null;
  state.velocity = { x: 0, y: 0 };
  state.speed = 0;
  state.speedHistory = [];
  state.kalman = null;
  lastKalmanPredictionTs = 0;
  resetVmgEstimator();
  resetVmgImuState();
  state.gpsTrackRaw = [];
  state.gpsTrackDevice = [];
  state.gpsTrackFiltered = [];
  state.lastGpsFixAt = null;
  updateGPSDisplay();
  updateLineProjection();
}

function recordSpeedSample(speed, timestamp) {
  if (!Number.isFinite(speed)) return;
  const ts = Number.isFinite(timestamp) ? timestamp : Date.now();
  state.speedHistory.push({ ts, speed });
  const cutoff = ts - SPEED_HISTORY_WINDOW_MS;
  while (state.speedHistory.length && state.speedHistory[0].ts < cutoff) {
    state.speedHistory.shift();
  }
}

function setDebugGpsEnabled(enabled) {
  const next = Boolean(enabled);
  if (state.debugGpsEnabled === next) {
    updateDebugControls();
    return;
  }
  state.debugGpsEnabled = next;
  saveSettings();
  state.kalman = null;
  if (state.debugGpsEnabled) {
    startDebugGps(handlePosition, createDebugPosition);
  } else {
    stopDebugGps();
    resetPositionState();
    startRealGps(handlePosition, handlePositionError, getGpsOptionsForMode(state.gpsMode));
  }
  updateDebugControls();
}

function setGpsMode(mode, options = {}) {
  const prev = state.gpsMode;
  const next = mode === "race" ? "race" : "setup";
  const force = Boolean(options.force);
  const highAccuracy = Boolean(options.highAccuracy);
  state.gpsMode = next;
  if (state.debugGpsEnabled) {
    return;
  }
  if (!force && state.geoWatchId !== null && prev === next && !highAccuracy && !isGpsStale()) {
    return;
  }
  const gpsOptions = highAccuracy ? GPS_OPTIONS_RACE : getGpsOptionsForMode(state.gpsMode);
  startRealGps(handlePosition, handlePositionError, gpsOptions);
}

function applyKalmanEstimate(result, options = {}) {
  if (!result) return;
  const rawPosition = options.rawPosition || null;
  const recordTrack = options.recordTrack !== false;
  // Keep device position/velocity as the canonical state; compute bow separately.
  const bowPosition = applyForwardOffset(
    result.position,
    result.velocity,
    state.bowOffsetMeters
  );
  state.kalmanPosition = result.position;
  state.position = result.position;
  state.bowPosition = bowPosition;
  state.velocity = result.velocity;
  state.speed = result.speed;
  recordLifterHeadingFromGps(
    result.velocity,
    result.speed,
    result.position?.timestamp || Date.now()
  );
  if (recordTrack) {
    recordTrackPoints(rawPosition, result.position, bowPosition);
  }
  updateGPSDisplay();
  updateLineProjection();
}

function startKalmanPredictionLoop() {
  if (kalmanPredictTimer) return;
  kalmanPredictTimer = setInterval(() => {
    if (!state.kalman) return;
    const prediction = predictKalmanState(Date.now());
    if (!prediction) return;
    const ts = prediction.position?.timestamp || Date.now();
    if (ts === lastKalmanPredictionTs) return;
    lastKalmanPredictionTs = ts;
    applyKalmanEstimate(prediction);
  }, KALMAN_PREDICT_INTERVAL_MS);
}

function handlePosition(position) {
  const filtered = applyKalmanFilter(position);
  state.lastGpsFixAt = position.timestamp || Date.now();
  clearGpsRetryTimer();
  if (filtered) {
    applyKalmanEstimate(filtered, { rawPosition: position });
    recordSpeedSample(filtered.speed, position.timestamp || Date.now());
    state.lastPosition = state.position;
    updateVmgEstimate(position);
    return;
  }
  const coords = position.coords;
  if (Number.isFinite(coords.speed) && Number.isFinite(coords.heading)) {
    state.speed = coords.speed;
    state.velocity = computeVelocityFromHeading(coords.speed, coords.heading);
  } else {
    const computed = computeVelocityFromPositions(position, state.lastPosition);
    state.speed = computed.speed;
    state.velocity = { x: computed.x, y: computed.y };
  }
  state.position = position;
  state.bowPosition = applyForwardOffset(
    position,
    state.velocity,
    state.bowOffsetMeters
  );
  recordLifterHeadingFromGps(
    state.velocity,
    state.speed,
    position.timestamp || Date.now()
  );
  // Raw fallback: track device and bow separately, consistent with Kalman path.
  state.kalmanPosition = null;
  recordTrackPoints(position, position, state.bowPosition);
  recordSpeedSample(state.speed, position.timestamp || Date.now());
  state.lastPosition = state.position;
  updateGPSDisplay();
  updateLineProjection();
  updateVmgEstimate(position);
}

function handlePositionError(err) {
  const icons = [els.gpsIcon, els.vmgGpsIcon].filter(Boolean);
  if (!icons.length) return;
  icons.forEach((icon) => {
    icon.classList.add("bad");
    icon.classList.remove("ok", "warn");
    icon.title = `GPS error: ${err.message}`;
  });
  if (!state.debugGpsEnabled && err && (err.code === 2 || err.code === 3)) {
    scheduleGpsRetry(handlePosition, handlePositionError);
  }
}

function initGeolocation() {
  if (state.debugGpsEnabled) {
    startDebugGps(handlePosition, createDebugPosition);
    return;
  }
  setGpsMode(state.gpsMode, { force: true });
}

function registerServiceWorker() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch((err) => {
      console.warn("Service worker failed", err);
    });
  }
}

function bindEvents() {
  const coordinateInputs = [
    els.latA,
    els.lonA,
    els.latB,
    els.lonB,
    els.ddm.latA.deg,
    els.ddm.latA.min,
    els.ddm.latA.minDec,
    els.ddm.latA.hemi,
    els.ddm.lonA.deg,
    els.ddm.lonA.min,
    els.ddm.lonA.minDec,
    els.ddm.lonA.hemi,
    els.ddm.latB.deg,
    els.ddm.latB.min,
    els.ddm.latB.minDec,
    els.ddm.latB.hemi,
    els.ddm.lonB.deg,
    els.ddm.lonB.min,
    els.ddm.lonB.minDec,
    els.ddm.lonB.hemi,
    els.dms.latA.deg,
    els.dms.latA.min,
    els.dms.latA.sec,
    els.dms.latA.secDec,
    els.dms.latA.hemi,
    els.dms.lonA.deg,
    els.dms.lonA.min,
    els.dms.lonA.sec,
    els.dms.lonA.secDec,
    els.dms.lonA.hemi,
    els.dms.latB.deg,
    els.dms.latB.min,
    els.dms.latB.sec,
    els.dms.latB.secDec,
    els.dms.latB.hemi,
    els.dms.lonB.deg,
    els.dms.lonB.min,
    els.dms.lonB.sec,
    els.dms.lonB.secDec,
    els.dms.lonB.hemi,
  ].filter(Boolean);

  coordinateInputs.forEach((input) => {
    input.addEventListener("change", () => {
      applyCoordinatePickerConstraints();
      parseLineInputs();
      updateInputs();
      updateLineStatus();
      updateLineProjection();
    });
  });

  const digitInputs = [
    { input: els.ddm.latA.minDec, maxDigits: COORD_DECIMAL_DIGITS },
    { input: els.ddm.lonA.minDec, maxDigits: COORD_DECIMAL_DIGITS },
    { input: els.ddm.latB.minDec, maxDigits: COORD_DECIMAL_DIGITS },
    { input: els.ddm.lonB.minDec, maxDigits: COORD_DECIMAL_DIGITS },
    { input: els.dms.latA.secDec, maxDigits: COORD_DECIMAL_DIGITS },
    { input: els.dms.lonA.secDec, maxDigits: COORD_DECIMAL_DIGITS },
    { input: els.dms.latB.secDec, maxDigits: COORD_DECIMAL_DIGITS },
    { input: els.dms.lonB.secDec, maxDigits: COORD_DECIMAL_DIGITS },
  ].filter(({ input }) => Boolean(input));

  digitInputs.forEach(({ input, maxDigits }) => {
    input.addEventListener("input", () => {
      const sanitized = String(input.value || "")
        .replace(/\D/g, "")
        .slice(0, maxDigits);
      if (sanitized !== input.value) {
        input.value = sanitized;
      }
    });
  });

  els.useA.addEventListener("click", () => {
    requestHighPrecisionPosition(handlePosition, handlePositionError, (position) => {
      const sourcePosition = state.kalmanPosition;
      if (!sourcePosition) {
        window.alert("Waiting for Kalman GPS fix. Try again in a moment.");
        return;
      }
      state.line.a = {
        lat: sourcePosition.coords.latitude,
        lon: sourcePosition.coords.longitude,
      };
      state.lineName = null;
      state.lineSourceId = null;
      saveSettings();
      updateLineNameDisplay();
      updateInputs();
      updateLineStatus();
      updateLineProjection();
    });
  });

  els.useB.addEventListener("click", () => {
    requestHighPrecisionPosition(handlePosition, handlePositionError, (position) => {
      const sourcePosition = state.kalmanPosition;
      if (!sourcePosition) {
        window.alert("Waiting for Kalman GPS fix. Try again in a moment.");
        return;
      }
      state.line.b = {
        lat: sourcePosition.coords.latitude,
        lon: sourcePosition.coords.longitude,
      };
      state.lineName = null;
      state.lineSourceId = null;
      saveSettings();
      updateLineNameDisplay();
      updateInputs();
      updateLineStatus();
      updateLineProjection();
    });
  });

  if (els.openSetup) {
    els.openSetup.addEventListener("click", () => {
      setView("setup");
    });
  }

  if (els.openVmg) {
    els.openVmg.addEventListener("click", () => {
      setView("vmg");
    });
  }

  if (els.openLifter) {
    els.openLifter.addEventListener("click", () => {
      setView("lifter");
    });
  }

  if (els.openHomeButtons && els.openHomeButtons.length) {
    els.openHomeButtons.forEach((button) => {
      button.addEventListener("click", () => {
        setView("home");
      });
    });
  }

  if (els.lifterWindow) {
    lifterWindowSeconds = clampLifterWindowSeconds(els.lifterWindow.value);
    syncLifterWindowUi();
    lifterBinDurationMs = getLifterBinDurationMs(lifterWindowSeconds);
    rebuildLifterBins();
    const onWindowChange = () => {
      lifterWindowSeconds = clampLifterWindowSeconds(els.lifterWindow.value);
      syncLifterWindowUi();
      lifterBinDurationMs = getLifterBinDurationMs(lifterWindowSeconds);
      rebuildLifterBins();
      requestLifterRender({ force: true });
    };
    els.lifterWindow.addEventListener("input", onWindowChange);
    els.lifterWindow.addEventListener("change", onWindowChange);
  }

  if (els.lifterDebugToggle) {
    syncLifterDebugToggleUi();
    els.lifterDebugToggle.addEventListener("click", () => {
      const next = lifterHeadingSource === "debug-wind" ? "gps" : "debug-wind";
      setLifterHeadingSource(next);
    });
  }

  if (els.lifterDebugRefresh) {
    els.lifterDebugRefresh.addEventListener("click", () => {
      hardReload();
    });
  }

  if (els.lifterDebugSpeed) {
    lifterDebug.speed = normalizeLifterDebugSpeed(els.lifterDebugSpeed.value);
    syncLifterDebugSpeedUi();
    const onSpeedChange = () => {
      setLifterDebugSpeed(els.lifterDebugSpeed.value);
    };
    els.lifterDebugSpeed.addEventListener("input", onSpeedChange);
    els.lifterDebugSpeed.addEventListener("change", onSpeedChange);
  }

  if (els.vmgTackPort || els.vmgTackStarboard) {
    const setVmgTack = (tack) => {
      vmgTack = tack === "port" ? "port" : "starboard";
      const isStarboard = tack === "starboard";
      if (els.vmgTackStarboard) {
        els.vmgTackStarboard.setAttribute("aria-pressed", isStarboard ? "true" : "false");
      }
      if (els.vmgTackPort) {
        els.vmgTackPort.setAttribute("aria-pressed", isStarboard ? "false" : "true");
      }
      if (els.vmgLabelLeft && els.vmgLabelRight) {
        if (isStarboard) {
          els.vmgLabelLeft.textContent = "Bear away";
          els.vmgLabelRight.textContent = "Head up";
        } else {
          els.vmgLabelLeft.textContent = "Head up";
          els.vmgLabelRight.textContent = "Bear away";
        }
      }
      if (els.vmgBar) {
        const left = isStarboard ? "bear away" : "head up";
        const right = isStarboard ? "head up" : "bear away";
        els.vmgBar.setAttribute("aria-label", `VMG balance: ${left} left, ${right} right`);
      }
      renderVmgIndicator();
    };

    setVmgTack("starboard");

    if (els.vmgTackPort) {
      els.vmgTackPort.addEventListener("click", () => {
        setVmgTack("port");
      });
    }

    if (els.vmgTackStarboard) {
      els.vmgTackStarboard.addEventListener("click", () => {
        setVmgTack("starboard");
      });
    }
  }

  if (els.vmgTwa) {
    const syncVmgTwa = () => {
      if (els.vmgTwaValue) {
        els.vmgTwaValue.textContent = `${els.vmgTwa.value} deg`;
      }
      renderVmgIndicator();
    };
    syncVmgTwa();
    els.vmgTwa.addEventListener("input", syncVmgTwa);
  }

  els.openMap.addEventListener("click", () => {
    window.location.href = `map.html${getNoCacheQuery()}`;
  });

  if (els.swapMarks) {
    els.swapMarks.addEventListener("click", () => {
      swapStartLineMarks();
    });
  }

  if (els.swapCoords) {
    els.swapCoords.addEventListener("click", () => {
      swapStartLineMarks();
    });
  }

  if (els.swapLocation) {
    els.swapLocation.addEventListener("click", () => {
      swapStartLineMarks();
    });
  }

  els.openCoords.addEventListener("click", () => {
    setView("coords");
  });

  if (els.coordsFormatBtn) {
    els.coordsFormatBtn.addEventListener("click", () => {
      const formats = ["dd", "ddm", "dms"];
      const current = normalizeCoordinateFormat(state.coordsFormat);
      const index = formats.indexOf(current);
      state.coordsFormat = formats[(index + 1) % formats.length];
      saveSettings();
      updateInputs();
    });
  }

  if (els.coordsDoneTop) {
    els.coordsDoneTop.addEventListener("click", () => {
      setView("setup");
    });
  }

  els.openLocation.addEventListener("click", () => {
    setView("location");
  });

  if (els.openSettings) {
    els.openSettings.addEventListener("click", () => {
      setView("settings");
    });
  }

  if (els.openBoat) {
    els.openBoat.addEventListener("click", () => {
      setView("boat");
    });
  }

  if (els.homeRefresh) {
    els.homeRefresh.addEventListener("click", () => {
      hardReload();
    });
  }

  const openInfoButton = els.openInfo || document.getElementById("open-info");
  if (openInfoButton) {
    openInfoButton.addEventListener("click", (event) => {
      event.preventDefault();
      setView("info");
    });
  }

  if (els.openTrack) {
    els.openTrack.addEventListener("click", () => {
      setView("track");
    });
  }

  els.saveLine.addEventListener("click", () => {
    if (!hasLine()) {
      window.alert("No start line defined. Set port and starboard marks first.");
      return;
    }
    const nameInput = window.prompt("Name this start line:");
    const timestamp = new Date().toLocaleString("en-GB", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    const name = (nameInput || "").trim() || `Line ${state.savedLines.length + 1} (${timestamp})`;
    const entry = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      name,
      line: {
        a: { ...state.line.a },
        b: { ...state.line.b },
      },
    };
    state.savedLines.unshift(entry);
    saveSavedLines();
    state.lineName = entry.name || null;
    state.lineSourceId = entry.id;
    state.selectedLineId = entry.id;
    saveSettings();
    updateLineNameDisplay();
    updateLineProjection();
  });

  if (els.loadLine) {
    els.loadLine.addEventListener("click", () => {
      openLoadModal();
    });
  }

  if (els.confirmLoad) {
    els.confirmLoad.addEventListener("click", () => {
      if (!state.selectedLineId) return;
      const entry = state.savedLines.find((line) => line.id === state.selectedLineId);
      if (!entry) return;
      state.line = {
        a: { ...entry.line.a },
        b: { ...entry.line.b },
      };
      state.lineName = entry.name || null;
      state.lineSourceId = entry.id || null;
      updateInputs();
      updateLineStatus();
      updateLineProjection();
      saveSettings();
      updateLineNameDisplay();
      closeLoadModal();
    });
  }

  if (els.confirmDelete) {
    els.confirmDelete.addEventListener("click", () => {
      if (!state.selectedLineId) return;
      const entry = state.savedLines.find((line) => line.id === state.selectedLineId);
      if (!entry) return;
      const confirmed = window.confirm(`Delete "${entry.name}"?`);
      if (!confirmed) return;
      state.savedLines = state.savedLines.filter((line) => line.id !== entry.id);
      if (state.lineSourceId === entry.id) {
        state.lineName = null;
        state.lineSourceId = null;
        saveSettings();
        updateLineNameDisplay();
      }
      saveSavedLines();
      state.selectedLineId = null;
      renderSavedLinesList();
    });
  }

  if (els.closeLoad) {
    els.closeLoad.addEventListener("click", () => {
      closeLoadModal();
    });
  }

  const countdownInputs = [
    els.countdownHours,
    els.countdownMinutes,
    els.countdownSeconds,
  ].filter(Boolean);

  if (countdownInputs.length) {
    countdownInputs.forEach((input) => {
      input.addEventListener("focus", () => {
        cancelActiveCountdown({ force: true, clearAbsolute: true });
      });
      input.addEventListener("pointerdown", () => {
        cancelActiveCountdown({ force: true, clearAbsolute: true });
      });
      input.addEventListener("change", () => {
        setCountdownPickerLive(false);
        state.start.countdownSeconds = getCountdownSecondsFromPicker();
        saveSettings();
      });
    });
  }

  if (els.absoluteTime) {
    els.absoluteTime.addEventListener("change", () => {
      state.start.absoluteTime = els.absoluteTime.value;
      saveSettings();
    });
  }

  if (els.startModeAbsolute) {
    els.startModeAbsolute.addEventListener("click", () => {
      state.start.mode = "absolute";
      cancelActiveCountdown();
      saveSettings();
      updateStartModeToggle();
    });
  }

  if (els.startModeCountdown) {
    els.startModeCountdown.addEventListener("click", () => {
      state.start.mode = "countdown";
      const hasActiveStart = Boolean(state.start.startTs) && state.start.startTs > Date.now();
      if (hasActiveStart) {
        const remaining = Math.max(0, Math.round((state.start.startTs - Date.now()) / 1000));
        state.start.countdownSeconds = remaining;
        setCountdownPickerLive(true);
        syncCountdownPicker(remaining);
      } else {
        setCountdownPickerLive(false);
      }
      saveSettings();
      updateStartModeToggle();
      updateStartDisplay();
    });
  }

  if (els.setStart) {
    els.setStart.addEventListener("click", () => {
      unlockAudio();
      if (state.start.mode === "countdown") {
        state.start.countdownSeconds = getCountdownSecondsFromPicker();
        saveSettings();
        setCountdownPickerLive(true);
        setStart({ goToRace: false });
        if (state.start.startTs) {
          const startDate = new Date(state.start.startTs);
          const absoluteValue = formatTimeInput(startDate);
          state.start.absoluteTime = absoluteValue;
          if (els.absoluteTime) {
            els.absoluteTime.value = absoluteValue;
          }
          saveSettings();
        }
      } else {
        state.start.mode = "absolute";
        saveSettings();
        cancelActiveCountdown();
        setStart({ goToRace: false });
      }
      updateStartDisplay();
      updateLineProjection();
    });
  }

  els.goRace.addEventListener("click", () => {
    unlockAudio();
    setView("race");
  });

  els.closeRace.addEventListener("click", () => {
    setView("setup");
  });


  els.closeCoords.addEventListener("click", () => {
    setView("setup");
  });

  els.closeLocation.addEventListener("click", () => {
    setView("setup");
  });

  if (els.closeSettings) {
    els.closeSettings.addEventListener("click", () => {
      setView("home");
    });
  }

  const closeInfoButton = els.closeInfo || document.getElementById("close-info");
  if (closeInfoButton) {
    closeInfoButton.addEventListener("click", (event) => {
      event.preventDefault();
      setView("home");
    });
  }
  if (els.closeBoat) {
    els.closeBoat.addEventListener("click", () => {
      commitBoatInputs();
      setView("home");
    });
  }

  if (els.closeTrack) {
    const closeTrack = (event) => {
      if (event) {
        event.preventDefault();
        event.stopPropagation();
      }
      setView("setup");
    };
    els.closeTrack.addEventListener("click", closeTrack);
    els.closeTrack.addEventListener("touchend", closeTrack, { passive: false });
    els.closeTrack.addEventListener("pointerup", closeTrack);
  }

  if (els.bowOffset) {
    els.bowOffset.addEventListener("change", () => {
      state.bowOffsetMeters = parseBowOffsetInput();
      saveSettings();
    });
    els.bowOffset.addEventListener("focus", () => {
      els.bowOffset.value = "";
    });
  }
  if (els.boatLength) {
    els.boatLength.addEventListener("change", () => {
      state.boatLengthMeters = parseBoatLengthInput();
      saveSettings();
    });
    els.boatLength.addEventListener("focus", () => {
      els.boatLength.value = "";
    });
  }

  if (els.soundOn) {
    els.soundOn.addEventListener("click", () => {
      setSoundEnabled(true);
    });
  }

  if (els.soundOff) {
    els.soundOff.addEventListener("click", () => {
      setSoundEnabled(false);
    });
  }

  if (els.timeFormat24) {
    els.timeFormat24.addEventListener("click", () => {
      setTimeFormat("24h");
    });
  }

  if (els.timeFormat12) {
    els.timeFormat12.addEventListener("click", () => {
      setTimeFormat("12h");
    });
  }

  if (els.speedUnitMs) {
    els.speedUnitMs.addEventListener("click", () => {
      setSpeedUnit("ms");
    });
  }

  if (els.speedUnitKn) {
    els.speedUnitKn.addEventListener("click", () => {
      setSpeedUnit("kn");
    });
  }

  if (els.speedUnitMph) {
    els.speedUnitMph.addEventListener("click", () => {
      setSpeedUnit("mph");
    });
  }

  if (els.distanceUnitM) {
    els.distanceUnitM.addEventListener("click", () => {
      setDistanceUnit("m");
    });
  }

  if (els.distanceUnitFt) {
    els.distanceUnitFt.addEventListener("click", () => {
      setDistanceUnit("ft");
    });
  }

  if (els.distanceUnitYd) {
    els.distanceUnitYd.addEventListener("click", () => {
      setDistanceUnit("yd");
    });
  }

  if (els.syncRace) {
    els.syncRace.addEventListener("click", () => {
      if (!state.start.startTs || state.start.startTs <= Date.now()) return;
      unlockAudio();
      syncStartToMinute();
    });
  }

  if (els.raceMetricDistance) {
    els.raceMetricDistance.addEventListener("click", () => {
      setRaceMetric("distance");
    });
  }

  if (els.raceMetricTime) {
    els.raceMetricTime.addEventListener("click", () => {
      setRaceMetric("time");
    });
  }

  if (els.racePlus) {
    els.racePlus.addEventListener("click", () => {
      if (!state.start.startTs || state.start.startTs <= Date.now()) return;
      unlockAudio();
      adjustStart(1);
      updateStartDisplay();
      updateLineProjection();
    });
  }

  if (els.raceMinus) {
    els.raceMinus.addEventListener("click", () => {
      if (!state.start.startTs || state.start.startTs <= Date.now()) return;
      unlockAudio();
      adjustStart(-1);
      updateStartDisplay();
      updateLineProjection();
    });
  }

  if (els.raceImuToggle) {
    els.raceImuToggle.addEventListener("click", () => {
      setImuEnabled(!state.imuEnabled);
    });
  }

  if (els.debugGpsToggle) {
    els.debugGpsToggle.addEventListener("click", () => {
      setDebugGpsEnabled(!state.debugGpsEnabled);
    });
  }

  if (els.debugImuToggle) {
    els.debugImuToggle.addEventListener("click", () => {
      setImuEnabled(!state.imuEnabled);
    });
  }

  if (els.openImuCalibration) {
    els.openImuCalibration.addEventListener("click", () => {
      openImuCalibrationModal();
    });
  }

  if (els.startImuCalibration) {
    els.startImuCalibration.addEventListener("click", () => {
      startImuCalibration();
    });
  }

  if (els.closeImuCalibration) {
    els.closeImuCalibration.addEventListener("click", () => {
      closeImuCalibrationModal();
    });
  }

  if (els.debugRefresh) {
    els.debugRefresh.addEventListener("click", () => {
      hardReload();
    });
  }

  if (els.vmgDebugRefresh) {
    els.vmgDebugRefresh.addEventListener("click", () => {
      hardReload();
    });
  }


  window.addEventListener("hashchange", syncViewFromHash);
}

function setView(view) {
  const leavingLifter = document.body.classList.contains("lifter-mode") && view !== "lifter";
  if (leavingLifter) {
    stopLifterDebugPlayback();
    if (lifterRenderTimer) {
      clearTimeout(lifterRenderTimer);
      lifterRenderTimer = null;
    }
  }
  document.body.classList.remove(
    "home-mode",
    "vmg-mode",
    "lifter-mode",
    "race-mode",
    "coords-mode",
    "location-mode",
    "settings-mode",
    "boat-mode",
    "info-mode",
    "track-mode"
  );
  [
    "home-view",
    "vmg-view",
    "lifter-view",
    "race-view",
    "coords-view",
    "location-view",
    "settings-view",
    "boat-view",
    "info-view",
    "track-view",
    "setup-view",
  ].forEach((id) => {
    const section = document.getElementById(id);
    if (section) {
      section.setAttribute("aria-hidden", "true");
    }
  });

  if (view === "home") {
    updateInputs();
    updateImuCalibrationUi();
    document.body.classList.remove("race-mode");
    document.body.classList.remove("coords-mode");
    document.body.classList.remove("location-mode");
    document.body.classList.remove("info-mode");
    document.body.classList.remove("track-mode");
    document.body.classList.add("home-mode");
    document.getElementById("race-view").setAttribute("aria-hidden", "true");
    document.getElementById("coords-view").setAttribute("aria-hidden", "true");
    document.getElementById("location-view").setAttribute("aria-hidden", "true");
    document.getElementById("info-view").setAttribute("aria-hidden", "true");
    document.getElementById("track-view").setAttribute("aria-hidden", "true");
    document.getElementById("setup-view").setAttribute("aria-hidden", "true");
    document.getElementById("home-view").setAttribute("aria-hidden", "false");
    history.replaceState(null, "", "#home");
    window.scrollTo({ top: 0, behavior: "instant" });
    releaseWakeLock();
    setGpsMode("setup");
    return;
  }
  if (view === "vmg") {
    document.body.classList.remove("race-mode");
    document.body.classList.remove("coords-mode");
    document.body.classList.remove("location-mode");
    document.body.classList.remove("info-mode");
    document.body.classList.remove("track-mode");
    document.body.classList.add("vmg-mode");
    document.getElementById("race-view").setAttribute("aria-hidden", "true");
    document.getElementById("coords-view").setAttribute("aria-hidden", "true");
    document.getElementById("location-view").setAttribute("aria-hidden", "true");
    document.getElementById("info-view").setAttribute("aria-hidden", "true");
    document.getElementById("track-view").setAttribute("aria-hidden", "true");
    document.getElementById("setup-view").setAttribute("aria-hidden", "true");
    document.getElementById("vmg-view").setAttribute("aria-hidden", "false");
    history.replaceState(null, "", "#vmg");
    window.scrollTo({ top: 0, behavior: "instant" });
    releaseWakeLock();
    setGpsMode("setup");
    return;
  }
  if (view === "lifter") {
    document.body.classList.remove("race-mode");
    document.body.classList.remove("coords-mode");
    document.body.classList.remove("location-mode");
    document.body.classList.remove("info-mode");
    document.body.classList.remove("track-mode");
    document.body.classList.add("lifter-mode");
    document.getElementById("race-view").setAttribute("aria-hidden", "true");
    document.getElementById("coords-view").setAttribute("aria-hidden", "true");
    document.getElementById("location-view").setAttribute("aria-hidden", "true");
    document.getElementById("info-view").setAttribute("aria-hidden", "true");
    document.getElementById("track-view").setAttribute("aria-hidden", "true");
    document.getElementById("setup-view").setAttribute("aria-hidden", "true");
    document.getElementById("lifter-view").setAttribute("aria-hidden", "false");
    history.replaceState(null, "", "#lifter");
    window.scrollTo({ top: 0, behavior: "instant" });
    releaseWakeLock();
    setGpsMode("setup");
    syncLifterWindowUi();
    syncLifterDebugToggleUi();
    startLifterDebugPlayback();
    rebuildLifterBins();
    requestLifterRender({ force: true });
    return;
  }
  if (view === "race") {
    document.body.classList.add("race-mode");
    document.body.classList.remove("coords-mode");
    document.body.classList.remove("location-mode");
    document.body.classList.remove("info-mode");
    document.body.classList.remove("track-mode");
    document.getElementById("race-view").setAttribute("aria-hidden", "false");
    document.getElementById("coords-view").setAttribute("aria-hidden", "true");
    document.getElementById("info-view").setAttribute("aria-hidden", "true");
    document.getElementById("track-view").setAttribute("aria-hidden", "true");
    document.getElementById("setup-view").setAttribute("aria-hidden", "true");
    history.replaceState(null, "", "#race");
    window.scrollTo({ top: 0, behavior: "instant" });
    requestWakeLock();
    setGpsMode("race");
    fitRaceText();
    return;
  }
  if (view === "coords") {
    updateInputs();
    document.body.classList.remove("race-mode");
    document.body.classList.add("coords-mode");
    document.body.classList.remove("location-mode");
    document.body.classList.remove("info-mode");
    document.body.classList.remove("track-mode");
    document.getElementById("race-view").setAttribute("aria-hidden", "true");
    document.getElementById("coords-view").setAttribute("aria-hidden", "false");
    document.getElementById("location-view").setAttribute("aria-hidden", "true");
    document.getElementById("info-view").setAttribute("aria-hidden", "true");
    document.getElementById("track-view").setAttribute("aria-hidden", "true");
    document.getElementById("setup-view").setAttribute("aria-hidden", "true");
    history.replaceState(null, "", "#coords");
    window.scrollTo({ top: 0, behavior: "instant" });
    releaseWakeLock();
    setGpsMode("setup");
    return;
  }
  if (view === "location") {
    document.body.classList.remove("race-mode");
    document.body.classList.remove("coords-mode");
    document.body.classList.add("location-mode");
    document.body.classList.remove("info-mode");
    document.body.classList.remove("track-mode");
    document.getElementById("race-view").setAttribute("aria-hidden", "true");
    document.getElementById("coords-view").setAttribute("aria-hidden", "true");
    document.getElementById("location-view").setAttribute("aria-hidden", "false");
    document.getElementById("info-view").setAttribute("aria-hidden", "true");
    document.getElementById("track-view").setAttribute("aria-hidden", "true");
    document.getElementById("setup-view").setAttribute("aria-hidden", "true");
    history.replaceState(null, "", "#location");
    releaseWakeLock();
    setGpsMode("setup", { force: true, highAccuracy: true });
    return;
  }
  if (view === "settings") {
    updateInputs();
    updateImuCalibrationUi();
    document.body.classList.remove("race-mode");
    document.body.classList.remove("coords-mode");
    document.body.classList.remove("location-mode");
    document.body.classList.add("settings-mode");
    document.body.classList.remove("info-mode");
    document.body.classList.remove("track-mode");
    document.getElementById("race-view").setAttribute("aria-hidden", "true");
    document.getElementById("coords-view").setAttribute("aria-hidden", "true");
    document.getElementById("location-view").setAttribute("aria-hidden", "true");
    document.getElementById("settings-view").setAttribute("aria-hidden", "false");
    document.getElementById("boat-view").setAttribute("aria-hidden", "true");
    document.getElementById("info-view").setAttribute("aria-hidden", "true");
    document.getElementById("track-view").setAttribute("aria-hidden", "true");
    document.getElementById("setup-view").setAttribute("aria-hidden", "true");
    history.replaceState(null, "", "#settings");
    window.scrollTo({ top: 0, behavior: "instant" });
    releaseWakeLock();
    setGpsMode("setup");
    return;
  }
  if (view === "boat") {
    updateInputs();
    document.body.classList.remove("race-mode");
    document.body.classList.remove("coords-mode");
    document.body.classList.remove("location-mode");
    document.body.classList.remove("settings-mode");
    document.body.classList.add("boat-mode");
    document.body.classList.remove("info-mode");
    document.body.classList.remove("track-mode");
    document.getElementById("race-view").setAttribute("aria-hidden", "true");
    document.getElementById("coords-view").setAttribute("aria-hidden", "true");
    document.getElementById("location-view").setAttribute("aria-hidden", "true");
    document.getElementById("settings-view").setAttribute("aria-hidden", "true");
    document.getElementById("boat-view").setAttribute("aria-hidden", "false");
    document.getElementById("info-view").setAttribute("aria-hidden", "true");
    document.getElementById("track-view").setAttribute("aria-hidden", "true");
    document.getElementById("setup-view").setAttribute("aria-hidden", "true");
    history.replaceState(null, "", "#boat");
    window.scrollTo({ top: 0, behavior: "instant" });
    releaseWakeLock();
    setGpsMode("setup");
    return;
  }
  if (view === "info") {
    document.body.classList.remove("race-mode");
    document.body.classList.remove("coords-mode");
    document.body.classList.remove("location-mode");
    document.body.classList.add("info-mode");
    document.body.classList.remove("track-mode");
    document.getElementById("race-view").setAttribute("aria-hidden", "true");
    document.getElementById("coords-view").setAttribute("aria-hidden", "true");
    document.getElementById("location-view").setAttribute("aria-hidden", "true");
    document.getElementById("info-view").setAttribute("aria-hidden", "false");
    document.getElementById("track-view").setAttribute("aria-hidden", "true");
    document.getElementById("setup-view").setAttribute("aria-hidden", "true");
    history.replaceState(null, "", "#info");
    window.scrollTo({ top: 0, behavior: "instant" });
    releaseWakeLock();
    setGpsMode("setup");
    return;
  }
  if (view === "track") {
    document.body.classList.remove("race-mode");
    document.body.classList.remove("coords-mode");
    document.body.classList.remove("location-mode");
    document.body.classList.remove("info-mode");
    document.body.classList.add("track-mode");
    document.getElementById("race-view").setAttribute("aria-hidden", "true");
    document.getElementById("coords-view").setAttribute("aria-hidden", "true");
    document.getElementById("location-view").setAttribute("aria-hidden", "true");
    document.getElementById("info-view").setAttribute("aria-hidden", "true");
    document.getElementById("track-view").setAttribute("aria-hidden", "false");
    document.getElementById("setup-view").setAttribute("aria-hidden", "true");
    history.replaceState(null, "", "#track");
    window.scrollTo({ top: 0, behavior: "instant" });
    releaseWakeLock();
    setGpsMode("setup", { force: true, highAccuracy: true });
    renderTrack();
    return;
  }
  document.body.classList.remove("race-mode");
  document.body.classList.remove("coords-mode");
  document.body.classList.remove("location-mode");
  document.body.classList.remove("info-mode");
  document.body.classList.remove("track-mode");
  document.getElementById("race-view").setAttribute("aria-hidden", "true");
  document.getElementById("coords-view").setAttribute("aria-hidden", "true");
  document.getElementById("location-view").setAttribute("aria-hidden", "true");
  document.getElementById("info-view").setAttribute("aria-hidden", "true");
  document.getElementById("track-view").setAttribute("aria-hidden", "true");
  document.getElementById("setup-view").setAttribute("aria-hidden", "false");
  history.replaceState(null, "", "#setup");
  releaseWakeLock();
  setGpsMode("setup");
}

function syncViewFromHash() {
  if (location.hash === "#home") {
    setView("home");
    return;
  }
  if (location.hash === "#vmg") {
    setView("vmg");
    return;
  }
  if (location.hash === "#lifter") {
    setView("lifter");
    return;
  }
  if (location.hash === "#race") {
    setView("race");
    return;
  }
  if (location.hash === "#coords") {
    setView("coords");
    return;
  }
  if (location.hash === "#location") {
    setView("location");
    return;
  }
  if (location.hash === "#info") {
    setView("info");
    return;
  }
  if (location.hash === "#track") {
    setView("track");
    return;
  }
  if (location.hash === "#settings") {
    setView("settings");
    return;
  }
  if (location.hash === "#boat") {
    setView("boat");
    return;
  }
  if (location.hash === "#setup") {
    setView("setup");
    return;
  }
  setView("home");
}

function tick() {
  updateLineProjection();
  updateStartDisplay();
  updateCurrentTime();
  updateDebugControls();
  updateVmgGpsState();
  if (document.body.classList.contains("track-mode")) {
    renderTrack();
  }
  if (isGpsStale()) {
    scheduleGpsRetry(handlePosition, handlePositionError);
  }
  requestAnimationFrame(() => {
    setTimeout(tick, 1000);
  });
}

loadSettings();
applyDebugFlagFromUrl();
syncNoCacheToken();
initCoordinatePickers();
initCountdownPicker();
initHemisphereToggles();
loadSavedLines();
syncLineNameWithSavedLines();
updateInputs();
updateLineStatus();
updateRaceMetricLabels();
bindEvents();
initGeolocation();
startKalmanPredictionLoop();
registerServiceWorker();
clearNoCacheParam();
updateStartDisplay();
updateGPSDisplay();
updateImuCalibrationUi();
updateCurrentTime();
syncViewFromHash();
tick();
updateViewportHeight();

window.addEventListener("resize", () => {
  updateViewportHeight();
  if (document.body.classList.contains("lifter-mode")) {
    requestLifterRender({ force: true });
  }
  if (document.body.classList.contains("track-mode")) {
    renderTrack();
  }
});

if (window.visualViewport) {
  window.visualViewport.addEventListener("resize", updateViewportHeight);
}

document.addEventListener("click", unlockAudio, { once: true });
document.addEventListener("touchstart", unlockAudio, { once: true });
document.addEventListener("pointerdown", unlockAudio, { once: true });
updateDebugControls();

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && document.body.classList.contains("race-mode")) {
    requestWakeLock();
  }
});
