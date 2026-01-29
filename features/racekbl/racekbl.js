import { els } from "../../ui/dom.js";
import { state } from "../../core/state.js";
import {
  normalizeHeadingDegrees,
  resizeCanvasToCssPixels,
  trimTrailingZeros,
  unwrapHeadingDegrees,
} from "../../core/common.js";

const WIND_POLL_INTERVAL_MS = 15000;
const WIND_HISTORY_MINUTES_MIN = 20;
const WIND_HISTORY_MINUTES_MAX = 24 * 60;
const WIND_HISTORY_MARKS_MINUTES = [20, 30, 60, 120, 240, 480, 720, 1440];
const WIND_HISTORY_WINDOW_MS = WIND_HISTORY_MINUTES_MAX * 60 * 1000;
const WIND_PLOT_PADDING = 4;
const WIND_PLOT_GAP = 18;
const WIND_PLOT_LABEL_GUTTER = 30;
const WIND_PLOT_TIME_GUTTER = 22;
const WIND_PLOT_LABEL_FONT = "14px sans-serif";
const WIND_PLOT_LINE_WIDTH = 2;
const WIND_PLOT_TIME_FONT = "12px sans-serif";
const TIME_TICK_OPTIONS_MIN = [5, 15, 20, 30, 60, 120, 240, 360];
const TIME_TICK_TARGET = 7;

const windSamples = [];
let windPollTimer = null;
let windPollInFlight = false;
let lastFetchAt = null;
let lastError = "";
let lastDir = null;
let lastDirUnwrapped = null;
let lastSampleHash = null;
let lastRenderAt = 0;
let renderTimer = null;
let historyLoadedHours = 0;

let raceKblDeps = {
  saveSettings: null,
};

function formatWindValue(value) {
  if (!Number.isFinite(value)) return "--";
  const rounded = Math.round(value * 10) / 10;
  return trimTrailingZeros(rounded.toFixed(1));
}

function formatDirection(value) {
  if (!Number.isFinite(value)) return "--";
  return `${Math.round(value)}°`;
}

function clampHistoryMinutes(value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return WIND_HISTORY_MINUTES_MIN;
  return Math.min(WIND_HISTORY_MINUTES_MAX, Math.max(WIND_HISTORY_MINUTES_MIN, parsed));
}

function snapHistoryMinutes(value) {
  const minutes = clampHistoryMinutes(value);
  let best = WIND_HISTORY_MARKS_MINUTES[0];
  let bestDiff = Math.abs(minutes - best);
  WIND_HISTORY_MARKS_MINUTES.forEach((candidate) => {
    const diff = Math.abs(minutes - candidate);
    if (diff < bestDiff || (diff === bestDiff && candidate > best)) {
      best = candidate;
      bestDiff = diff;
    }
  });
  return best;
}

function formatHistoryMinutes(value) {
  const minutes = snapHistoryMinutes(value);
  if (minutes < 60) {
    return `${minutes} min`;
  }
  const hours = Math.floor(minutes / 60);
  const extra = minutes % 60;
  if (!extra) {
    return `${hours} h`;
  }
  return `${hours} h ${extra} m`;
}

function buildWindUrl() {
  return `/wind?t=${Date.now()}`;
}

function buildWindHistoryUrl() {
  const minutes = snapHistoryMinutes(state.windHistoryMinutes || WIND_HISTORY_MINUTES_MIN);
  const hours = Math.max(1, Math.ceil(minutes / 60));
  return `/wind?history=1&hours=${hours}&t=${Date.now()}`;
}

function resetWindHistory() {
  windSamples.length = 0;
  lastDir = null;
  lastDirUnwrapped = null;
  lastSampleHash = null;
  historyLoadedHours = 0;
}

function recordWindSample(sample) {
  if (!sample) return;
  if (sample.sampleHash && sample.sampleHash === lastSampleHash) {
    return;
  }
  const ts = Number.isFinite(sample.ts) ? sample.ts : Date.now();
  const speed = Number.isFinite(sample.speed) ? sample.speed : null;
  const gust = Number.isFinite(sample.gust) ? sample.gust : null;
  let dir = Number.isFinite(sample.dir) ? sample.dir : null;
  let dirUnwrapped = null;
  if (Number.isFinite(dir)) {
    dir = normalizeHeadingDegrees(dir);
    dirUnwrapped = unwrapHeadingDegrees(dir, lastDir, lastDirUnwrapped);
    lastDir = dir;
    lastDirUnwrapped = dirUnwrapped;
  }
  if (!Number.isFinite(speed) && !Number.isFinite(gust) && !Number.isFinite(dir)) return;
  windSamples.push({ ts, speed, gust, dir, dirUnwrapped, sampleHash: sample.sampleHash || null });
  if (sample.sampleHash) {
    lastSampleHash = sample.sampleHash;
  }
  const cutoff = ts - WIND_HISTORY_WINDOW_MS;
  while (windSamples.length && windSamples[0].ts < cutoff) {
    windSamples.shift();
  }
}

function getLatestSample() {
  for (let i = windSamples.length - 1; i >= 0; i -= 1) {
    const sample = windSamples[i];
    if (!sample) continue;
    if (
      Number.isFinite(sample.speed) ||
      Number.isFinite(sample.gust) ||
      Number.isFinite(sample.dir)
    ) {
      return sample;
    }
  }
  return null;
}

function updateRaceKblStatus() {
  if (els.raceKblStatus) {
    if (lastError) {
      els.raceKblStatus.textContent = lastError;
    } else if (lastFetchAt) {
      els.raceKblStatus.textContent = "Live";
    } else {
      els.raceKblStatus.textContent = "Waiting";
    }
  }
}

function updateRaceKblUi() {
  updateRaceKblStatus();
  requestRaceKblRender();
}

function parseLatestSample(data) {
  if (!data || typeof data !== "object") return null;
  const speed = Number.parseFloat(data.windSpeed ?? data.speed ?? data.wind_speed);
  const gust = Number.parseFloat(data.windGust ?? data.gust ?? data.wind_gust);
  const dir = Number.parseFloat(data.windDirDeg ?? data.windDir ?? data.dir);
  const ts = data.updatedAt ? Date.parse(data.updatedAt) : Date.now();
  const sampleHash = typeof data.sampleHash === "string" ? data.sampleHash : null;
  return {
    speed,
    gust,
    dir,
    ts: Number.isFinite(ts) ? ts : Date.now(),
    sampleHash,
  };
}

function parseHistoryEntry(entry) {
  if (!entry || typeof entry !== "object") return null;
  const speed = Number.parseFloat(entry.windSpeed ?? entry.speed ?? entry.wind_speed);
  const gust = Number.parseFloat(entry.windGust ?? entry.gust ?? entry.wind_gust);
  const dir = Number.parseFloat(entry.windDirDeg ?? entry.windDir ?? entry.dir);
  const ts = Number.isFinite(entry.ts) ? entry.ts : Date.now();
  return {
    speed,
    gust,
    dir,
    ts,
  };
}

function applyLatestPayload(data) {
  const latest = parseLatestSample(data);
  if (!latest) return;
  recordWindSample(latest);
  lastFetchAt = latest.ts;
  lastError = "";
}

function applyHistoryPayload(data) {
  if (!data || !Array.isArray(data.history)) return false;
  const minutes = clampHistoryMinutes(state.windHistoryMinutes || WIND_HISTORY_MINUTES_MIN);
  historyLoadedHours = Math.max(historyLoadedHours, Math.max(1, Math.ceil(minutes / 60)));
  resetWindHistory();
  const entries = data.history
    .map(parseHistoryEntry)
    .filter(Boolean)
    .sort((a, b) => (a.ts || 0) - (b.ts || 0));
  entries.forEach((entry) => recordWindSample(entry));
  const latest = parseLatestSample(data);
  if (latest) {
    const lastSample = getLatestSample();
    if (!lastSample || lastSample.ts !== latest.ts) {
      recordWindSample(latest);
    }
    lastFetchAt = latest.ts;
    lastError = "";
  }
  return true;
}

async function fetchWindSample() {
  if (windPollInFlight) return;
  windPollInFlight = true;
  try {
    const url = buildWindUrl();
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`Wind error ${response.status}`);
    }
    const data = await response.json();
    applyLatestPayload(data);
  } catch (err) {
    lastError = err instanceof Error ? err.message : "Wind fetch failed";
  } finally {
    windPollInFlight = false;
    updateRaceKblUi();
  }
}

async function fetchWindHistory() {
  if (windPollInFlight) return;
  windPollInFlight = true;
  try {
    const url = buildWindHistoryUrl();
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`Wind error ${response.status}`);
    }
    const data = await response.json();
    if (!applyHistoryPayload(data)) {
      applyLatestPayload(data);
    }
  } catch (err) {
    lastError = err instanceof Error ? err.message : "Wind fetch failed";
  } finally {
    windPollInFlight = false;
    updateRaceKblUi();
  }
}

function startWindPolling() {
  if (windPollTimer) return;
  fetchWindHistory();
  windPollTimer = setInterval(fetchWindSample, WIND_POLL_INTERVAL_MS);
}

function stopWindPolling() {
  if (!windPollTimer) return;
  clearInterval(windPollTimer);
  windPollTimer = null;
}

function requestRaceKblRender() {
  if (!document.body.classList.contains("racekbl-mode")) return;
  const now = Date.now();
  const elapsed = now - lastRenderAt;
  if (elapsed >= 200 || !Number.isFinite(lastRenderAt)) {
    if (renderTimer) {
      clearTimeout(renderTimer);
      renderTimer = null;
    }
    lastRenderAt = now;
    renderRaceKblPlots();
    return;
  }
  if (renderTimer) return;
  renderTimer = setTimeout(() => {
    renderTimer = null;
    lastRenderAt = Date.now();
    renderRaceKblPlots();
  }, 200 - elapsed);
}

function drawLine(ctx, samples, key, rect, options = {}) {
  const values = samples.filter((sample) => Number.isFinite(sample?.[key]));
  if (!values.length) return;
  const min = options.min;
  const max = options.max;
  if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) return;
  const width = rect.right - rect.left;
  const height = rect.bottom - rect.top;
  if (width <= 0 || height <= 0) return;
  const range = max - min;
  const mapX = (ts) => rect.left + ((ts - options.startTs) / options.windowMs) * width;
  const mapY = (value) => rect.bottom - ((value - min) / range) * height;

  ctx.save();
  ctx.strokeStyle = options.color || "#000000";
  ctx.lineWidth = options.lineWidth || WIND_PLOT_LINE_WIDTH;
  ctx.setLineDash(options.dash || []);
  ctx.beginPath();
  let started = false;
  samples.forEach((sample) => {
    if (!sample || !Number.isFinite(sample.ts) || !Number.isFinite(sample[key])) return;
    const x = mapX(sample.ts);
    const y = mapY(sample[key]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    if (!started) {
      ctx.moveTo(x, y);
      started = true;
    } else {
      ctx.lineTo(x, y);
    }
  });
  ctx.stroke();
  ctx.restore();
}

function computeTickStep(range, baseStep) {
  let step = baseStep;
  if (!Number.isFinite(range) || range <= 0) return step;
  let lines = Math.floor(range / step) + 1;
  while (lines >= 7) {
    step *= 2;
    lines = Math.floor(range / step) + 1;
  }
  return step;
}

function drawYAxisGrid(ctx, rect, min, max, step, labelFn) {
  if (!Number.isFinite(min) || !Number.isFinite(max) || !Number.isFinite(step)) return;
  if (min === max) return;
  const range = max - min;
  const mapY = (value) => rect.bottom - ((value - min) / range) * (rect.bottom - rect.top);
  const firstTick = Math.ceil(min / step) * step;

  ctx.save();
  ctx.strokeStyle = "#000000";
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 6]);
  ctx.fillStyle = "#000000";
  ctx.font = "12px sans-serif";
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";

  for (let value = firstTick; value <= max + 1e-6; value += step) {
    const y = mapY(value);
    if (!Number.isFinite(y)) continue;
    ctx.beginPath();
    ctx.moveTo(rect.left, y);
    ctx.lineTo(rect.right, y);
    ctx.stroke();
    if (typeof labelFn === "function") {
      ctx.fillText(labelFn(value), rect.left - 8, y);
    }
  }
  ctx.restore();
}

function chooseTimeTickMinutes(windowMinutes) {
  const safe = Math.max(1, windowMinutes);
  let best = TIME_TICK_OPTIONS_MIN[0];
  let bestDiff = Infinity;
  TIME_TICK_OPTIONS_MIN.forEach((candidate) => {
    const count = Math.floor(safe / candidate) + 1;
    const diff = Math.abs(count - TIME_TICK_TARGET);
    if (diff < bestDiff || (diff === bestDiff && candidate > best)) {
      bestDiff = diff;
      best = candidate;
    }
  });
  return best;
}

function formatTimeTickLabel(ts) {
  const date = new Date(ts);
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${hours}:${minutes}`;
}

function drawTimeTicks(ctx, rect, startTs, endTs, windowMinutes) {
  if (!Number.isFinite(startTs) || !Number.isFinite(endTs)) return;
  const windowMs = endTs - startTs;
  if (!Number.isFinite(windowMs) || windowMs <= 0) return;

  const tickMinutes = chooseTimeTickMinutes(windowMinutes);
  const tickMs = tickMinutes * 60 * 1000;
  if (!Number.isFinite(tickMs) || tickMs <= 0) return;

  const firstTick = Math.ceil(startTs / tickMs) * tickMs;
  const width = rect.right - rect.left;
  if (width <= 0) return;

  ctx.save();
  ctx.strokeStyle = "#000000";
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 6]);
  ctx.fillStyle = "#000000";
  ctx.font = WIND_PLOT_TIME_FONT;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";

  for (let ts = firstTick; ts <= endTs + 1; ts += tickMs) {
    const x = rect.left + ((ts - startTs) / windowMs) * width;
    if (!Number.isFinite(x)) continue;
    ctx.beginPath();
    ctx.moveTo(x, rect.top);
    ctx.lineTo(x, rect.bottom);
    ctx.stroke();
    ctx.fillText(formatTimeTickLabel(ts), x, rect.bottom + 6);
  }
  ctx.restore();
}

function getWindowSamples() {
  const windowMinutes = snapHistoryMinutes(state.windHistoryMinutes || WIND_HISTORY_MINUTES_MIN);
  const windowMs = windowMinutes * 60 * 1000;
  const startTs = Date.now() - windowMs;
  return {
    startTs,
    windowMs,
    windowMinutes,
    samples: windSamples.filter((sample) => sample && sample.ts >= startTs),
  };
}

function renderSpeedPlot() {
  if (!document.body.classList.contains("racekbl-mode")) return;
  if (!els.raceKblSpeedCanvas) return;
  const canvasInfo = resizeCanvasToCssPixels(els.raceKblSpeedCanvas);
  if (!canvasInfo) return;
  const { ctx, width, height } = canvasInfo;

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);

  const { startTs, windowMs, samples, windowMinutes } = getWindowSamples();
  if (!samples.length) {
    ctx.fillStyle = "#000000";
    ctx.font = WIND_PLOT_LABEL_FONT;
    ctx.fillText("Waiting for wind", WIND_PLOT_PADDING, WIND_PLOT_PADDING + 12);
    return;
  }

  const speedValues = [];
  samples.forEach((sample) => {
    if (Number.isFinite(sample.speed)) speedValues.push(sample.speed);
  });

  if (!speedValues.length) {
    ctx.fillStyle = "#000000";
    ctx.font = WIND_PLOT_LABEL_FONT;
    ctx.fillText("No speed data", WIND_PLOT_PADDING, WIND_PLOT_PADDING + 12);
    return;
  }

  let min = Math.min(...speedValues);
  let max = Math.max(...speedValues);
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    min = 0;
    max = 1;
  }
  if (min === max) {
    min -= 0.5;
    max += 0.5;
  } else {
    const pad = Math.max(0.2, (max - min) * 0.1);
    min -= pad;
    max += pad;
  }

  const rect = {
    left: WIND_PLOT_PADDING + WIND_PLOT_LABEL_GUTTER,
    right: width - WIND_PLOT_PADDING,
    top: WIND_PLOT_PADDING,
    bottom: height - WIND_PLOT_PADDING - WIND_PLOT_TIME_GUTTER,
  };

  const tickStep = computeTickStep(max - min, 1);
  drawYAxisGrid(ctx, rect, min, max, tickStep, (value) => `${formatWindValue(value)} kn`);
  drawTimeTicks(ctx, rect, startTs, startTs + windowMs, windowMinutes);

  drawLine(ctx, samples, "speed", rect, {
    min,
    max,
    startTs,
    windowMs,
    color: "#000000",
    lineWidth: WIND_PLOT_LINE_WIDTH,
  });
}

function renderDirectionPlot() {
  if (!document.body.classList.contains("racekbl-mode")) return;
  if (!els.raceKblDirCanvas) return;
  const canvasInfo = resizeCanvasToCssPixels(els.raceKblDirCanvas);
  if (!canvasInfo) return;
  const { ctx, width, height } = canvasInfo;

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);

  const { startTs, windowMs, samples, windowMinutes } = getWindowSamples();
  if (!samples.length) {
    ctx.fillStyle = "#000000";
    ctx.font = WIND_PLOT_LABEL_FONT;
    ctx.fillText("Waiting for wind", WIND_PLOT_PADDING, WIND_PLOT_PADDING + 12);
    return;
  }

  const dirValues = [];
  samples.forEach((sample) => {
    if (Number.isFinite(sample.dirUnwrapped)) dirValues.push(sample.dirUnwrapped);
  });
  if (!dirValues.length) {
    ctx.fillStyle = "#000000";
    ctx.font = WIND_PLOT_LABEL_FONT;
    ctx.fillText("No dir data", WIND_PLOT_PADDING, WIND_PLOT_PADDING + 12);
    return;
  }

  let min = Math.min(...dirValues);
  let max = Math.max(...dirValues);
  const latest = dirValues[dirValues.length - 1];
  const span = max - min;
  if (!Number.isFinite(span) || span < 10) {
    min = latest - 5;
    max = latest + 5;
  } else if (span > 180) {
    min = latest - 90;
    max = latest + 90;
  }

  const rect = {
    left: WIND_PLOT_PADDING + WIND_PLOT_LABEL_GUTTER,
    right: width - WIND_PLOT_PADDING,
    top: WIND_PLOT_PADDING,
    bottom: height - WIND_PLOT_PADDING - WIND_PLOT_TIME_GUTTER,
  };

  const tickStep = computeTickStep(max - min, 5);
  drawYAxisGrid(ctx, rect, min, max, tickStep, (value) =>
    formatDirection(normalizeHeadingDegrees(value))
  );
  drawTimeTicks(ctx, rect, startTs, startTs + windowMs, windowMinutes);

  drawLine(ctx, samples, "dirUnwrapped", rect, {
    min,
    max,
    startTs,
    windowMs,
    color: "#000000",
    lineWidth: WIND_PLOT_LINE_WIDTH,
  });
}

function renderRaceKblPlots() {
  renderSpeedPlot();
  renderDirectionPlot();
}

function syncRaceKblInputs() {
  const minutes = snapHistoryMinutes(state.windHistoryMinutes || WIND_HISTORY_MINUTES_MIN);
  if (minutes !== state.windHistoryMinutes) {
    state.windHistoryMinutes = minutes;
  }
  if (els.raceKblHistory) {
    els.raceKblHistory.value = String(minutes);
  }
  if (els.raceKblHistoryValue) {
    els.raceKblHistoryValue.textContent = formatHistoryMinutes(minutes);
  }
}

function setHistoryWindow(minutes) {
  const clamped = snapHistoryMinutes(minutes);
  state.windHistoryMinutes = clamped;
  if (raceKblDeps.saveSettings) {
    raceKblDeps.saveSettings();
  }
  if (els.raceKblHistory) {
    els.raceKblHistory.value = String(clamped);
  }
  if (els.raceKblHistoryValue) {
    els.raceKblHistoryValue.textContent = formatHistoryMinutes(clamped);
  }
  const requiredHours = Math.max(1, Math.ceil(clamped / 60));
  if (requiredHours > historyLoadedHours && document.body.classList.contains("racekbl-mode")) {
    fetchWindHistory();
    return;
  }
  updateRaceKblUi();
}

function setRaceKblSettingsOpen(open) {
  const next = Boolean(open);
  if (els.raceKblSettingsView) {
    els.raceKblSettingsView.setAttribute("aria-hidden", next ? "false" : "true");
  }
  document.body.classList.toggle("racekbl-settings-open", next);
  if (next) {
    syncRaceKblInputs();
  }
}

function bindRaceKblEvents() {
  if (els.openRaceKblSettings) {
    els.openRaceKblSettings.addEventListener("click", () => {
      const isOpen = document.body.classList.contains("racekbl-settings-open");
      setRaceKblSettingsOpen(!isOpen);
    });
  }

  if (els.closeRaceKblSettings) {
    els.closeRaceKblSettings.addEventListener("click", () => {
      setRaceKblSettingsOpen(false);
    });
  }

  if (els.raceKblHistory) {
    els.raceKblHistory.addEventListener("input", () => {
      setHistoryWindow(els.raceKblHistory.value);
    });
  }
  document.addEventListener("visibilitychange", () => {
    if (!document.body.classList.contains("racekbl-mode")) return;
    if (document.visibilityState === "hidden") {
      stopWindPolling();
    } else {
      startWindPolling();
    }
  });
}

function initRaceKbl(deps = {}) {
  raceKblDeps = { ...raceKblDeps, ...deps };
  syncRaceKblInputs();
  updateRaceKblUi();
}

function enterRaceKblView() {
  syncRaceKblInputs();
  updateRaceKblUi();
  startWindPolling();
}

function leaveRaceKblView() {
  stopWindPolling();
}

export {
  initRaceKbl,
  bindRaceKblEvents,
  syncRaceKblInputs,
  enterRaceKblView,
  leaveRaceKblView,
  requestRaceKblRender,
  renderRaceKblPlots,
  setRaceKblSettingsOpen,
};
