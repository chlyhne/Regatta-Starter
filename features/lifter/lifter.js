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

let lifterDeps = {
  setHeadingSourcePreference: null,
  updateHeadingSourceToggles: null,
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
  const maxIntervalMs = 1000;
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

function recordLifterHeadingFromSource(source, heading, timestamp) {
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

function setLifterHeadingSource(nextSource) {
  const normalized = normalizeHeadingSource(nextSource);
  if (normalized === lifterHeadingSource) return;
  lifterHeadingSource = normalized;
  resetLifterHistory();
  requestLifterRender({ force: true });
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
  rebuildLifterBins();
  requestLifterRender({ force: true });
}

function leaveLifterView() {
  if (lifterRenderTimer) {
    clearTimeout(lifterRenderTimer);
    lifterRenderTimer = null;
  }
}

function getLifterSettingsSnapshot() {
  return {
    windowSeconds: lifterWindowSeconds,
    headingSource: lifterHeadingSource,
  };
}

export {
  initLifter,
  bindLifterEvents,
  getLifterSettingsSnapshot,
  resetLifterHistory,
  recordLifterHeadingFromPosition,
  requestLifterRender,
  setLifterHeadingSource,
  setLifterSettingsOpen,
  enterLifterView,
  leaveLifterView,
  syncLifterWindowUi,
};
