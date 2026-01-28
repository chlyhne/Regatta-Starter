import { els } from "../../ui/dom.js";
import { state } from "../../core/state.js";
import {
  clamp,
  headingFromVelocity,
  unwrapHeadingDegrees,
  normalizeHeadingDegrees,
  resizeCanvasToCssPixels,
  formatWindowSeconds,
} from "../../core/common.js";
import { canUseKalmanHeading } from "../../core/heading.js";

const LIFTER_DEFAULT_WINDOW_SECONDS = 300;
const LIFTER_MIN_SPEED = 0.5;
const LIFTER_PLOT_HISTORY_PAD_MS = 5000;
const LIFTER_PLOT_RENDER_INTERVAL_MS = 200;
const LIFTER_PLOT_PADDING = 10;
const LIFTER_PLOT_GRID_STEP_DEG = 10;
const LIFTER_PLOT_GRID_DASH = [6, 8];
const LIFTER_PLOT_MIN_RANGE_DEG = 2;
const LIFTER_PLOT_MAX_RANGE_DEG = 45;
const LIFTER_PLOT_LINE_WIDTH = 2;
const LIFTER_PLOT_POINT_SIZE = 4;
const LIFTER_PLOT_FONT_MAIN = "16px sans-serif";
const LIFTER_PLOT_FONT_LABEL = "12px sans-serif";
const LIFTER_PLOT_FG = "#000000";
const LIFTER_PLOT_LABEL_AREA_PX = 28;

const lifterPlotHistory = [];
let lifterWindowSeconds = LIFTER_DEFAULT_WINDOW_SECONDS;
let lifterLastSampleTs = null;
let lifterLastRenderAt = 0;
let lifterRenderTimer = null;
let lifterLastHeading = null;
let lifterLastHeadingUnwrapped = null;

let lifterDeps = {
  setImuEnabled: null,
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

function requestLifterRender(options = {}) {
  if (!document.body.classList.contains("lifter-mode")) return;
  const force = options.force === true;
  const maxIntervalMs = LIFTER_PLOT_RENDER_INTERVAL_MS;
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
  lifterPlotHistory.length = 0;
  lifterLastSampleTs = null;
  lifterLastHeading = null;
  lifterLastHeadingUnwrapped = null;
}

function recordLifterPlotSample(value, timestampMs) {
  if (!Number.isFinite(value)) return;
  const ts = Number.isFinite(timestampMs) ? timestampMs : Date.now();
  lifterPlotHistory.push({ ts, value });
  lifterLastSampleTs = ts;
  const windowMs = clampLifterWindowSeconds(lifterWindowSeconds) * 1000;
  const cutoff = ts - (windowMs + LIFTER_PLOT_HISTORY_PAD_MS);
  while (lifterPlotHistory.length && lifterPlotHistory[0].ts < cutoff) {
    lifterPlotHistory.shift();
  }
}

function recordLifterHeadingFromSource(heading, timestamp) {
  const safeHeading = normalizeHeadingDegrees(heading);
  if (!Number.isFinite(safeHeading)) return;
  const ts = Number.isFinite(timestamp) ? timestamp : Date.now();
  const unwrapped = unwrapHeadingDegrees(
    safeHeading,
    lifterLastHeading,
    lifterLastHeadingUnwrapped
  );
  lifterLastHeading = safeHeading;
  lifterLastHeadingUnwrapped = unwrapped;
  recordLifterPlotSample(unwrapped, ts);
  requestLifterRender();
}

function getLifterSample(position) {
  if (!position || !position.coords) return null;
  if (!canUseKalmanHeading(position)) return null;
  if (!state.velocity || !Number.isFinite(state.speed)) return null;
  const heading = headingFromVelocity(state.velocity);
  if (!Number.isFinite(heading)) return null;
  const ts = Number.isFinite(position.timestamp) ? position.timestamp : Date.now();
  return { speed: state.speed, heading, ts };
}

function recordLifterHeadingFromPosition(position) {
  const sample = getLifterSample(position);
  if (!sample) return;
  if (!Number.isFinite(sample.speed) || sample.speed < LIFTER_MIN_SPEED) return;
  recordLifterHeadingFromSource(sample.heading, sample.ts);
}

function renderLifterPlot() {
  if (!document.body.classList.contains("lifter-mode")) return;
  if (!els.lifterCanvas) return;
  const canvasInfo = resizeCanvasToCssPixels(els.lifterCanvas);
  if (!canvasInfo) return;
  const { ctx, width, height } = canvasInfo;
  const plotHeight = Math.max(0, height - LIFTER_PLOT_LABEL_AREA_PX);

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);

  if (!Number.isFinite(lifterLastSampleTs)) {
    ctx.fillStyle = LIFTER_PLOT_FG;
    ctx.font = LIFTER_PLOT_FONT_MAIN;
    ctx.fillText("No heading", 12, 24);
    return;
  }

  const windowSeconds = clampLifterWindowSeconds(lifterWindowSeconds);
  const windowMs = Math.max(1000, windowSeconds * 1000);
  const endTs = lifterLastSampleTs;
  const startTs = endTs - windowMs;
  const samples = lifterPlotHistory.filter(
    (sample) => sample && Number.isFinite(sample.ts) && sample.ts >= startTs
  );

  if (!samples.length) {
    ctx.fillStyle = LIFTER_PLOT_FG;
    ctx.font = LIFTER_PLOT_FONT_MAIN;
    ctx.fillText("No heading", 12, 24);
    return;
  }

  let latestValue = null;
  for (let i = samples.length - 1; i >= 0; i -= 1) {
    const value = samples[i]?.value;
    if (Number.isFinite(value)) {
      latestValue = value;
      break;
    }
  }

  if (!Number.isFinite(latestValue)) {
    ctx.fillStyle = LIFTER_PLOT_FG;
    ctx.font = LIFTER_PLOT_FONT_MAIN;
    ctx.fillText("No heading", 12, 24);
    return;
  }

  let minValue = latestValue - LIFTER_PLOT_MAX_RANGE_DEG;
  let maxValue = latestValue + LIFTER_PLOT_MAX_RANGE_DEG;
  if (minValue === maxValue) {
    const pad = Math.max(1, LIFTER_PLOT_MIN_RANGE_DEG / 2);
    minValue -= pad;
    maxValue += pad;
  }

  const left = LIFTER_PLOT_PADDING;
  const right = width - LIFTER_PLOT_PADDING;
  const span = maxValue - minValue;
  const scale = span > 0 ? (right - left) / span : 0;
  const mapX = (value) => left + (value - minValue) * scale;

  if (LIFTER_PLOT_GRID_STEP_DEG > 0) {
    ctx.save();
    ctx.strokeStyle = LIFTER_PLOT_FG;
    ctx.lineWidth = LIFTER_PLOT_LINE_WIDTH;
    ctx.setLineDash(LIFTER_PLOT_GRID_DASH);
    ctx.fillStyle = LIFTER_PLOT_FG;
    ctx.font = LIFTER_PLOT_FONT_LABEL;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    const firstGrid = Math.ceil(minValue / LIFTER_PLOT_GRID_STEP_DEG) * LIFTER_PLOT_GRID_STEP_DEG;
    for (let value = firstGrid; value <= maxValue; value += LIFTER_PLOT_GRID_STEP_DEG) {
      const x = mapX(value);
      if (!Number.isFinite(x) || x < 0 || x > width) continue;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, plotHeight);
      ctx.stroke();
      const label = normalizeHeadingDegrees(value);
      if (Number.isFinite(label)) {
        ctx.fillText(`${Math.round(label)}°`, x, plotHeight + 6);
      }
    }
    ctx.restore();
  }

  ctx.save();
  ctx.strokeStyle = LIFTER_PLOT_FG;
  ctx.lineWidth = LIFTER_PLOT_LINE_WIDTH;
  ctx.setLineDash([]);
  ctx.beginPath();
  let started = false;
  let pointCount = 0;
  let lastX = null;
  let lastY = null;
  samples.forEach((sample) => {
    if (!sample || !Number.isFinite(sample.value) || !Number.isFinite(sample.ts)) return;
    const t = clamp((sample.ts - startTs) / windowMs, 0, 1);
    const y = plotHeight - t * plotHeight;
    const x = mapX(sample.value);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    lastX = x;
    lastY = y;
    pointCount += 1;
    if (!started) {
      ctx.moveTo(x, y);
      started = true;
    } else {
      ctx.lineTo(x, y);
    }
  });
  if (started) {
    ctx.stroke();
    if (pointCount === 1 && Number.isFinite(lastX) && Number.isFinite(lastY)) {
      const halfPoint = LIFTER_PLOT_POINT_SIZE / 2;
      ctx.fillStyle = LIFTER_PLOT_FG;
      ctx.fillRect(lastX - halfPoint, lastY - halfPoint, LIFTER_PLOT_POINT_SIZE, LIFTER_PLOT_POINT_SIZE);
    }
  }
  ctx.restore();
}

function setLifterSettingsOpen(open) {
  const next = Boolean(open);
  if (els.lifterSettingsView) {
    els.lifterSettingsView.setAttribute("aria-hidden", next ? "false" : "true");
  }
  document.body.classList.toggle("lifter-settings-open", next);
  if (next) {
    updateLifterImuToggle();
    syncLifterWindowUi();
  }
}

function setLifterImuWarningOpen(open) {
  const next = Boolean(open);
  if (els.vmgImuModal) {
    els.vmgImuModal.setAttribute("aria-hidden", next ? "false" : "true");
  }
  document.body.classList.toggle("vmg-imu-open", next);
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
    const onWindowChange = () => {
      lifterWindowSeconds = clampLifterWindowSeconds(els.lifterWindow.value);
      syncLifterWindowUi();
      requestLifterRender({ force: true });
    };
    els.lifterWindow.addEventListener("input", onWindowChange);
    els.lifterWindow.addEventListener("change", onWindowChange);
  }

  if (els.lifterImuToggle) {
    els.lifterImuToggle.addEventListener("click", async () => {
      if (!lifterDeps.setImuEnabled) return;
      await lifterDeps.setImuEnabled(!state.imuEnabled);
      updateLifterImuToggle();
      if (state.imuEnabled) {
        setLifterImuWarningOpen(true);
      } else {
        setLifterImuWarningOpen(false);
      }
    });
  }
}

function enterLifterView() {
  syncLifterWindowUi();
  requestLifterRender({ force: true });
}

function updateLifterImuToggle() {
  if (els.lifterImuToggle) {
    els.lifterImuToggle.setAttribute("aria-pressed", state.imuEnabled ? "true" : "false");
  }
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
    imuEnabled: state.imuEnabled,
  };
}

export {
  initLifter,
  bindLifterEvents,
  getLifterSettingsSnapshot,
  updateLifterImuToggle,
  resetLifterHistory,
  recordLifterHeadingFromPosition,
  requestLifterRender,
  setLifterSettingsOpen,
  enterLifterView,
  leaveLifterView,
  syncLifterWindowUi,
};
