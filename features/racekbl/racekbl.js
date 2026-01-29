import { els } from "../../ui/dom.js";
import { state } from "../../core/state.js";
import { formatClockTime } from "../../core/format.js";
import {
  normalizeHeadingDegrees,
  resizeCanvasToCssPixels,
  trimTrailingZeros,
  unwrapHeadingDegrees,
} from "../../core/common.js";

const WIND_POLL_INTERVAL_MS = 5000;
const WIND_HISTORY_WINDOW_MS = 20 * 60 * 1000;
const WIND_PLOT_PADDING = 14;
const WIND_PLOT_GAP = 18;
const WIND_PLOT_LABEL_FONT = "14px sans-serif";
const WIND_PLOT_LINE_WIDTH = 2;
const WIND_PLOT_GUST_DASH = [8, 6];

const windSamples = [];
let windPollTimer = null;
let windPollInFlight = false;
let lastFetchAt = null;
let lastError = "";
let lastDir = null;
let lastDirUnwrapped = null;
let lastRenderAt = 0;
let renderTimer = null;

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

function normalizeEndpoint(value) {
  const text = typeof value === "string" ? value.trim() : "";
  return text || "/wind";
}

function buildWindUrl() {
  const endpoint = normalizeEndpoint(state.windEndpoint);
  try {
    const url = new URL(endpoint, window.location.href);
    url.searchParams.set("t", String(Date.now()));
    return url.toString();
  } catch {
    return `/wind?t=${Date.now()}`;
  }
}

function recordWindSample(sample) {
  if (!sample) return;
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
  windSamples.push({ ts, speed, gust, dir, dirUnwrapped });
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

function updateRaceKblNumbers() {
  const latest = getLatestSample();
  if (els.raceKblSpeed) {
    els.raceKblSpeed.textContent = formatWindValue(latest?.speed);
  }
  if (els.raceKblGust) {
    els.raceKblGust.textContent = formatWindValue(latest?.gust);
  }
  if (els.raceKblDir) {
    els.raceKblDir.textContent = formatDirection(latest?.dir);
  }
  if (els.raceKblArrow) {
    const rotation = Number.isFinite(latest?.dir) ? latest.dir : 0;
    els.raceKblArrow.style.transform = `rotate(${rotation}deg)`;
    els.raceKblArrow.style.opacity = Number.isFinite(latest?.dir) ? "1" : "0.25";
  }
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
  if (els.raceKblUpdated) {
    if (lastFetchAt) {
      const stamp = formatClockTime(new Date(lastFetchAt), true);
      els.raceKblUpdated.textContent = `Updated ${stamp}`;
    } else if (lastError) {
      els.raceKblUpdated.textContent = "No wind yet";
    } else {
      els.raceKblUpdated.textContent = "Waiting for wind";
    }
  }
}

function updateRaceKblUi() {
  updateRaceKblNumbers();
  updateRaceKblStatus();
  requestRaceKblRender();
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
    const speed = Number.parseFloat(data.windSpeed ?? data.speed ?? data.wind_speed);
    const gust = Number.parseFloat(data.windGust ?? data.gust ?? data.wind_gust);
    const dir = Number.parseFloat(data.windDirDeg ?? data.windDir ?? data.dir);
    recordWindSample({ speed, gust, dir, ts: Date.now() });
    lastFetchAt = Date.now();
    lastError = "";
  } catch (err) {
    lastError = err instanceof Error ? err.message : "Wind fetch failed";
  } finally {
    windPollInFlight = false;
    updateRaceKblUi();
  }
}

function startWindPolling() {
  if (windPollTimer) return;
  fetchWindSample();
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
    renderRaceKblPlot();
    return;
  }
  if (renderTimer) return;
  renderTimer = setTimeout(() => {
    renderTimer = null;
    lastRenderAt = Date.now();
    renderRaceKblPlot();
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

function renderRaceKblPlot() {
  if (!document.body.classList.contains("racekbl-mode")) return;
  if (!els.raceKblCanvas) return;
  const canvasInfo = resizeCanvasToCssPixels(els.raceKblCanvas);
  if (!canvasInfo) return;
  const { ctx, width, height } = canvasInfo;

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);

  if (!windSamples.length) {
    ctx.fillStyle = "#000000";
    ctx.font = WIND_PLOT_LABEL_FONT;
    ctx.fillText("Waiting for wind", WIND_PLOT_PADDING, WIND_PLOT_PADDING + 12);
    return;
  }

  const now = Date.now();
  const windowMs = WIND_HISTORY_WINDOW_MS;
  const startTs = now - windowMs;
  const samples = windSamples.filter((sample) => sample && sample.ts >= startTs);
  if (!samples.length) {
    ctx.fillStyle = "#000000";
    ctx.font = WIND_PLOT_LABEL_FONT;
    ctx.fillText("Waiting for wind", WIND_PLOT_PADDING, WIND_PLOT_PADDING + 12);
    return;
  }

  const innerHeight = Math.max(0, height - WIND_PLOT_PADDING * 2 - WIND_PLOT_GAP);
  const speedHeight = Math.max(80, Math.round(innerHeight * 0.6));
  const dirHeight = Math.max(60, innerHeight - speedHeight);

  const speedRect = {
    left: WIND_PLOT_PADDING,
    right: width - WIND_PLOT_PADDING,
    top: WIND_PLOT_PADDING,
    bottom: WIND_PLOT_PADDING + speedHeight,
  };
  const dirRect = {
    left: WIND_PLOT_PADDING,
    right: width - WIND_PLOT_PADDING,
    top: speedRect.bottom + WIND_PLOT_GAP,
    bottom: speedRect.bottom + WIND_PLOT_GAP + dirHeight,
  };

  const speedValues = [];
  const gustValues = [];
  const dirValues = [];
  samples.forEach((sample) => {
    if (Number.isFinite(sample.speed)) speedValues.push(sample.speed);
    if (Number.isFinite(sample.gust)) gustValues.push(sample.gust);
    if (Number.isFinite(sample.dirUnwrapped)) dirValues.push(sample.dirUnwrapped);
  });

  if (speedValues.length || gustValues.length) {
    const combined = speedValues.concat(gustValues);
    let min = Math.min(...combined);
    let max = Math.max(...combined);
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

    ctx.save();
    ctx.fillStyle = "#000000";
    ctx.font = WIND_PLOT_LABEL_FONT;
    ctx.fillText("Speed", speedRect.left, speedRect.top + 12);
    ctx.restore();

    drawLine(ctx, samples, "speed", speedRect, {
      min,
      max,
      startTs,
      windowMs,
      color: "#000000",
      lineWidth: WIND_PLOT_LINE_WIDTH,
    });
    drawLine(ctx, samples, "gust", speedRect, {
      min,
      max,
      startTs,
      windowMs,
      color: "#000000",
      lineWidth: WIND_PLOT_LINE_WIDTH,
      dash: WIND_PLOT_GUST_DASH,
    });

    ctx.save();
    ctx.fillStyle = "#000000";
    ctx.font = "12px sans-serif";
    ctx.textAlign = "right";
    ctx.textBaseline = "top";
    ctx.fillText(formatWindValue(max), speedRect.right, speedRect.top + 12);
    ctx.textBaseline = "bottom";
    ctx.fillText(formatWindValue(min), speedRect.right, speedRect.bottom - 4);
    ctx.restore();
  } else {
    ctx.save();
    ctx.fillStyle = "#000000";
    ctx.font = WIND_PLOT_LABEL_FONT;
    ctx.fillText("No speed data", speedRect.left, speedRect.top + 12);
    ctx.restore();
  }

  if (dirValues.length) {
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

    ctx.save();
    ctx.fillStyle = "#000000";
    ctx.font = WIND_PLOT_LABEL_FONT;
    ctx.fillText("Dir", dirRect.left, dirRect.top + 12);
    ctx.restore();

    drawLine(ctx, samples, "dirUnwrapped", dirRect, {
      min,
      max,
      startTs,
      windowMs,
      color: "#000000",
      lineWidth: WIND_PLOT_LINE_WIDTH,
    });

    ctx.save();
    ctx.fillStyle = "#000000";
    ctx.font = "12px sans-serif";
    ctx.textAlign = "right";
    ctx.textBaseline = "top";
    ctx.fillText(formatDirection(normalizeHeadingDegrees(max)), dirRect.right, dirRect.top + 12);
    ctx.textBaseline = "bottom";
    ctx.fillText(formatDirection(normalizeHeadingDegrees(min)), dirRect.right, dirRect.bottom - 4);
    ctx.restore();
  } else {
    ctx.save();
    ctx.fillStyle = "#000000";
    ctx.font = WIND_PLOT_LABEL_FONT;
    ctx.fillText("No dir data", dirRect.left, dirRect.top + 12);
    ctx.restore();
  }

  ctx.save();
  ctx.strokeStyle = "#000000";
  ctx.lineWidth = 1;
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.moveTo(speedRect.left, speedRect.bottom + WIND_PLOT_GAP / 2);
  ctx.lineTo(speedRect.right, speedRect.bottom + WIND_PLOT_GAP / 2);
  ctx.stroke();
  ctx.restore();
}

function syncRaceKblInputs() {
  if (els.raceKblEndpoint) {
    els.raceKblEndpoint.value = normalizeEndpoint(state.windEndpoint);
  }
}

function saveWindEndpoint() {
  if (!els.raceKblEndpoint) return;
  const value = normalizeEndpoint(els.raceKblEndpoint.value);
  state.windEndpoint = value;
  if (raceKblDeps.saveSettings) {
    raceKblDeps.saveSettings();
  }
  syncRaceKblInputs();
  if (document.body.classList.contains("racekbl-mode")) {
    stopWindPolling();
    startWindPolling();
  }
}

function bindRaceKblEvents() {
  if (els.raceKblSaveEndpoint) {
    els.raceKblSaveEndpoint.addEventListener("click", () => {
      saveWindEndpoint();
    });
  }
  if (els.raceKblEndpoint) {
    els.raceKblEndpoint.addEventListener("change", () => {
      saveWindEndpoint();
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
  renderRaceKblPlot,
};
