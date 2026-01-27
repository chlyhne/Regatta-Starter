import { els } from "../../ui/dom.js";
import { state } from "../../core/state.js";
import {
  clamp,
  normalizeDeltaDegrees,
  normalizeHeadingDegrees,
  resizeCanvasToCssPixels,
  formatWindowSeconds,
  renderSignedLinePlot,
} from "../../core/common.js";
import {
  getHeadingSampleForMode,
  getHeadingSourcePreference,
  normalizeHeadingSource,
} from "../../core/heading.js";

const LIFTER_DEFAULT_WINDOW_SECONDS = 300;
const LIFTER_MIN_SPEED = 0.5;
const LIFTER_PLOT_WINDOW_TAU_FACTOR = 2;
const LIFTER_PLOT_HISTORY_PAD_MS = 5000;
const LIFTER_PLOT_RENDER_INTERVAL_MS = 200;
const LIFTER_PLOT_PADDING = 10;
const LIFTER_PLOT_MIN_HALF_WIDTH = 1;
const LIFTER_PLOT_MIN_HEIGHT = 1;
const LIFTER_PLOT_MIN_SCALE_DEG = 2;
const LIFTER_PLOT_LINE_WIDTH = 2;
const LIFTER_PLOT_FONT_MAIN = "16px sans-serif";
const LIFTER_PLOT_BG = "#ffffff";
const LIFTER_PLOT_FG = "#000000";
const LIFTER_PLOT_POS_FILL = "rgba(0, 120, 0, 0.25)";
const LIFTER_PLOT_NEG_FILL = "rgba(160, 0, 0, 0.25)";
const LIFTER_PLOT_POS_LINE = "rgb(0, 120, 0)";
const LIFTER_PLOT_NEG_LINE = "rgb(160, 0, 0)";

const lifterPlotHistory = [];
let lifterWindowSeconds = LIFTER_DEFAULT_WINDOW_SECONDS;
let lifterLastSampleTs = null;
let lifterLastRenderAt = 0;
let lifterRenderTimer = null;
let lifterLastRawPosition = null;
let lifterHeadingSource = "kalman";
let lifterHeadingBaseline = null;

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
  lifterLastRawPosition = null;
  lifterHeadingBaseline = null;
}

function applyHeadingBaselineFilter(prevHeading, nextHeading, dtSec, tauSec) {
  if (!Number.isFinite(nextHeading)) return prevHeading;
  if (!Number.isFinite(tauSec) || tauSec <= 0) return nextHeading;
  if (!Number.isFinite(prevHeading)) return nextHeading;
  const alpha = dtSec / (tauSec + dtSec);
  const delta = normalizeDeltaDegrees(nextHeading - prevHeading);
  return prevHeading + alpha * delta;
}

function recordLifterPlotSample(value, timestampMs) {
  if (!Number.isFinite(value)) return;
  const ts = Number.isFinite(timestampMs) ? timestampMs : Date.now();
  lifterPlotHistory.push({ ts, value });
  lifterLastSampleTs = ts;
  const windowMs =
    clampLifterWindowSeconds(lifterWindowSeconds) *
    LIFTER_PLOT_WINDOW_TAU_FACTOR *
    1000;
  const cutoff = ts - (windowMs + LIFTER_PLOT_HISTORY_PAD_MS);
  while (lifterPlotHistory.length && lifterPlotHistory[0].ts < cutoff) {
    lifterPlotHistory.shift();
  }
}

function recordLifterHeadingFromSource(source, heading, timestamp) {
  const safeHeading = normalizeHeadingDegrees(heading);
  if (!Number.isFinite(safeHeading)) return;
  const ts = Number.isFinite(timestamp) ? timestamp : Date.now();
  if (!Number.isFinite(lifterLastSampleTs)) {
    lifterHeadingBaseline = safeHeading;
  } else {
    const dtSec = Math.max(0, (ts - lifterLastSampleTs) / 1000);
    const tauSec = clampLifterWindowSeconds(lifterWindowSeconds);
    lifterHeadingBaseline = applyHeadingBaselineFilter(
      lifterHeadingBaseline,
      safeHeading,
      dtSec,
      tauSec
    );
  }
  const delta = Number.isFinite(lifterHeadingBaseline)
    ? normalizeDeltaDegrees(safeHeading - lifterHeadingBaseline)
    : 0;
  recordLifterPlotSample(delta, ts);
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
    ctx.fillStyle = LIFTER_PLOT_FG;
    ctx.font = LIFTER_PLOT_FONT_MAIN;
    ctx.fillText("No heading", 12, 24);
    return;
  }

  const meanDeg = normalizeHeadingDegrees(lifterHeadingBaseline);
  if (!Number.isFinite(meanDeg)) {
    ctx.fillStyle = LIFTER_PLOT_FG;
    ctx.font = LIFTER_PLOT_FONT_MAIN;
    ctx.fillText("No heading", 12, 24);
    return;
  }

  if (els.lifterMeanValue) {
    els.lifterMeanValue.textContent = `${Math.round(meanDeg)}°`;
  }

  const windowSeconds =
    clampLifterWindowSeconds(lifterWindowSeconds) *
    LIFTER_PLOT_WINDOW_TAU_FACTOR;
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

  renderSignedLinePlot(ctx, {
    samples,
    startTs,
    endTs,
    rect: { left: 0, right: width, top: 0, bottom: height },
    orientation: "vertical",
    scaleStep: LIFTER_PLOT_MIN_SCALE_DEG,
    padding: LIFTER_PLOT_PADDING,
    minHalfExtent: LIFTER_PLOT_MIN_HALF_WIDTH,
    colors: {
      fg: LIFTER_PLOT_FG,
      posFill: LIFTER_PLOT_POS_FILL,
      negFill: LIFTER_PLOT_NEG_FILL,
      posLine: LIFTER_PLOT_POS_LINE,
      negLine: LIFTER_PLOT_NEG_LINE,
    },
    lineWidth: LIFTER_PLOT_LINE_WIDTH,
    zeroLineWidth: LIFTER_PLOT_LINE_WIDTH,
    showGrid: false,
    lineBySign: true,
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
    const onWindowChange = () => {
      lifterWindowSeconds = clampLifterWindowSeconds(els.lifterWindow.value);
      syncLifterWindowUi();
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
