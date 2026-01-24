import { els } from "../../ui/dom.js";
import { state } from "../../core/state.js";
import { toRadians } from "../../core/geo.js";
import {
  clamp,
  normalizeDeltaDegrees,
  normalizeHeadingDegrees,
  meanHeadingDegreesFromSinCos,
  circularMeanDegrees,
  resizeCanvasToCssPixels,
  renderDeviationBarPlot,
  formatWindowSeconds,
} from "../../core/common.js";
import {
  getHeadingSampleForMode,
  getHeadingSourcePreference,
  normalizeHeadingSource,
} from "../../core/heading.js";

const LIFTER_DEFAULT_WINDOW_SECONDS = 300;
const LIFTER_MIN_SPEED = 0.5;
const LIFTER_HISTORY_MAX_MS = 2 * 60 * 60 * 1000;
const LIFTER_BIN_COUNT = 60;
const LIFTER_DEBUG_TICK_MS = 250;
const LIFTER_DEBUG_SPEED_DEFAULT = 1;
const LIFTER_DEBUG_SPEED_MIN = 0.5;
const LIFTER_DEBUG_SPEED_MAX = 4;
const LIFTER_DEBUG_SPEED_STEP = 0.5;

const lifterHistory = [];
let lifterWindowSeconds = LIFTER_DEFAULT_WINDOW_SECONDS;
let lifterLastSampleTs = null;
let lifterBinDurationMs = Math.round((LIFTER_DEFAULT_WINDOW_SECONDS * 1000) / LIFTER_BIN_COUNT);
let lifterLastBinId = null;
let lifterLastRenderAt = 0;
let lifterRenderTimer = null;
const lifterBins = new Map();
let lifterLastRawPosition = null;
let lifterHeadingSource = "kalman";
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

let lifterDeps = {
  setHeadingSourcePreference: null,
  updateHeadingSourceToggles: null,
  hardReload: null,
};

function initLifter(deps = {}) {
  lifterDeps = { ...lifterDeps, ...deps };
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
  lifterLastRawPosition = null;
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
  if (lifterHeadingSource === "debug-wind") {
    if (source !== "debug-wind") return;
  } else if (source === "debug-wind") {
    return;
  }
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

function recordLifterHeadingFromPosition(position) {
  const sample = getHeadingSampleForMode("lifter", position, lifterLastRawPosition);
  if (!sample) return;
  if (sample.source === "gps") {
    lifterLastRawPosition = position;
  }
  if (!Number.isFinite(sample.speed) || sample.speed < LIFTER_MIN_SPEED) return;
  recordLifterHeadingFromSource(sample.source, sample.heading, sample.ts);
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
    const sample = lifterDebug.samples[lifterDebug.cursor];
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
    lifterHeadingSource = getHeadingSourcePreference("lifter");
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
  const normalized =
    nextSource === "debug-wind" ? "debug-wind" : normalizeHeadingSource(nextSource);
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

  renderDeviationBarPlot(ctx, width, height, binValues, meanDeg, {
    activeIndex,
    deltaFn: (value, mean) => normalizeDeltaDegrees(value - mean),
  });
}

function setLifterSettingsOpen(open) {
  const next = Boolean(open);
  if (els.lifterSettingsView) {
    els.lifterSettingsView.setAttribute("aria-hidden", next ? "false" : "true");
  }
  document.body.classList.toggle("lifter-settings-open", next);
  if (next) {
    if (lifterDeps.updateHeadingSourceToggles) {
      lifterDeps.updateHeadingSourceToggles();
    }
    syncLifterWindowUi();
  }
}

function bindLifterEvents() {
  if (els.openLifterSettings) {
    els.openLifterSettings.addEventListener("click", () => {
      const isOpen = document.body.classList.contains("lifter-settings-open");
      setLifterSettingsOpen(!isOpen);
    });
  }

  if (els.closeLifterSettings) {
    els.closeLifterSettings.addEventListener("click", () => {
      setLifterSettingsOpen(false);
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
      const next =
        lifterHeadingSource === "debug-wind"
          ? getHeadingSourcePreference("lifter")
          : "debug-wind";
      setLifterHeadingSource(next);
    });
  }

  if (els.lifterDebugRefresh) {
    els.lifterDebugRefresh.addEventListener("click", () => {
      if (lifterDeps.hardReload) {
        lifterDeps.hardReload();
      }
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

  if (els.lifterModelToggle) {
    els.lifterModelToggle.addEventListener("click", () => {
      if (!lifterDeps.setHeadingSourcePreference) return;
      const enabled = getHeadingSourcePreference("lifter") === "kalman";
      lifterDeps.setHeadingSourcePreference("lifter", enabled ? "gps" : "kalman");
    });
  }
}

function enterLifterView() {
  syncLifterWindowUi();
  syncLifterDebugToggleUi();
  startLifterDebugPlayback();
  rebuildLifterBins();
  requestLifterRender({ force: true });
}

function leaveLifterView() {
  stopLifterDebugPlayback();
  if (lifterRenderTimer) {
    clearTimeout(lifterRenderTimer);
    lifterRenderTimer = null;
  }
}

function isDebugHeadingSource() {
  return lifterHeadingSource === "debug-wind";
}

export {
  initLifter,
  bindLifterEvents,
  recordLifterHeadingFromPosition,
  requestLifterRender,
  setLifterHeadingSource,
  setLifterSettingsOpen,
  enterLifterView,
  leaveLifterView,
  syncLifterDebugToggleUi,
  syncLifterWindowUi,
  isDebugHeadingSource,
};
