import { els } from "../../ui/dom.js";
import { state } from "../../core/state.js";
import { toRadians } from "../../core/geo.js";
import { isGpsStale } from "../../core/gps-watch.js";
import {
  clamp,
  normalizeDeltaDegrees,
  unwrapHeadingDegrees,
  resizeCanvasToCssPixels,
  formatWindowSeconds,
  headingFromVelocity,
} from "../../core/common.js";
import { canUseKalmanHeading } from "../../core/heading.js";

const VMG_EVAL_TWA_UP_DEG = 45;
const VMG_EVAL_TWA_UP_MIN = 35;
const VMG_EVAL_TWA_UP_MAX = 50;
const VMG_EVAL_TWA_DOWN_DEG = 150;
const VMG_EVAL_TWA_DOWN_MIN = 110;
const VMG_EVAL_TWA_DOWN_MAX = 175;
const VMG_EVAL_MAX_GAIN = 50;
const VMG_EVAL_MIN_BASE = 0.2;
const VMG_BASELINE_TAU_DEFAULT_SEC = 45;
const VMG_BASELINE_TAU_MIN_SEC = 15;
const VMG_BASELINE_TAU_MAX_SEC = 75;
const VMG_FAST_TAU_FACTOR = 0.1;
const VMG_FAST_TAU_MIN_SEC = 0.05;
const VMG_PLOT_WINDOW_TAU_FACTOR = 2;
const VMG_PLOT_SCALE_STEP = 2;
const VMG_PLOT_GRID_SMALL = 2;
const VMG_PLOT_GRID_LARGE = 4;
const VMG_PLOT_GRID_THRESHOLD = 6;
const VMG_PLOT_GRID_DASH = [6, 8];
const VMG_PLOT_PADDING = 10;
const VMG_PLOT_HISTORY_PAD_MS = 5000;
const VMG_PLOT_MIN_WINDOW_MS = 1000;
const VMG_PLOT_RENDER_INTERVAL_MS = 200;
const VMG_PLOT_LABEL_MARGIN = 44;
const VMG_PLOT_LABEL_CLAMP_INSET = 20;
const VMG_PLOT_RIGHT_INSET = 6;
const VMG_PLOT_LABEL_MIN_X = 6;
const VMG_PLOT_LABEL_GAP = 6;
const VMG_PLOT_MIN_WIDTH = 1;
const VMG_PLOT_MIN_HALF_HEIGHT = 1;
const VMG_PLOT_NO_DATA_X = 12;
const VMG_PLOT_NO_DATA_Y = 24;
const VMG_PLOT_FONT_MAIN = "16px sans-serif";
const VMG_PLOT_FONT_LABEL = "12px sans-serif";
const VMG_PLOT_GRID_LINE_WIDTH = 2;
const VMG_PLOT_SERIES_LINE_WIDTH = 2;
const VMG_PLOT_ZERO_LINE_WIDTH = 2;
const VMG_PLOT_POINT_SIZE = 4;
const VMG_PLOT_BG = "#ffffff";
const VMG_PLOT_FG = "#000000";
const VMG_PLOT_POS_FILL = "rgba(0, 120, 0, 0.25)";
const VMG_PLOT_NEG_FILL = "rgba(160, 0, 0, 0.25)";
const VMG_GPS_BAD_ACCURACY_M = 20;

const VMG_CASE_KEYS = [
  "beat-port",
  "beat-starboard",
  "reach",
  "run-port",
  "run-starboard",
];

const vmgPlotStates = VMG_CASE_KEYS.reduce((acc, key) => {
  acc[key] = { history: [], fast: null, lastRaw: null };
  return acc;
}, {});

let vmgPlotTauSeconds = VMG_BASELINE_TAU_DEFAULT_SEC;
let vmgPlotLastSampleTs = null;
let vmgSpeedBaseline = null;
let vmgHeadingBaseline = null;
let vmgPlotLastRenderAt = 0;
let vmgPlotRenderTimer = null;
const vmgEstimate = {
  lastHeading: null,
  lastHeadingUnwrapped: null,
};
let vmgWarmup = false;
let vmgMode = "beat";
let vmgTack = "starboard";
let vmgSmoothCurrent = true;
let vmgCapEnabled = true;

function getVmgCaseKey(mode = vmgMode, tack = vmgTack) {
  if (mode === "reach") return "reach";
  const safeMode = mode === "run" ? "run" : "beat";
  const safeTack = tack === "port" ? "port" : "starboard";
  return `${safeMode}-${safeTack}`;
}

function getActiveVmgPlotState() {
  return vmgPlotStates[getVmgCaseKey()];
}

function forEachVmgPlotState(callback) {
  VMG_CASE_KEYS.forEach((key) => callback(vmgPlotStates[key], key));
}

let vmgDeps = {
  setImuEnabled: null,
  hardReload: null,
  saveSettings: null,
};

function initVmg(deps = {}) {
  vmgDeps = { ...vmgDeps, ...deps };
}

function renderVmgPlot() {
  if (!document.body.classList.contains("vmg-mode")) return;
  if (!els.vmgCanvas) return;
  const canvasInfo = resizeCanvasToCssPixels(els.vmgCanvas);
  if (!canvasInfo) return;
  const { ctx, width, height } = canvasInfo;

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = VMG_PLOT_BG;
  ctx.fillRect(0, 0, width, height);

  const activeState = getActiveVmgPlotState();
  if (!Number.isFinite(vmgPlotLastSampleTs) || !activeState.history.length) {
    ctx.fillStyle = VMG_PLOT_FG;
    ctx.font = VMG_PLOT_FONT_MAIN;
    ctx.fillText("No data", VMG_PLOT_NO_DATA_X, VMG_PLOT_NO_DATA_Y);
    return;
  }

  const windowSeconds = getVmgPlotWindowSeconds();
  const windowMs = Math.max(VMG_PLOT_MIN_WINDOW_MS, windowSeconds * 1000);
  const endTs = vmgPlotLastSampleTs;
  const startTs = endTs - windowMs;

  const samples = activeState.history.filter(
    (sample) => sample && Number.isFinite(sample.ts) && sample.ts >= startTs
  );

  if (!samples.length) {
    ctx.fillStyle = VMG_PLOT_FG;
    ctx.font = VMG_PLOT_FONT_MAIN;
    ctx.fillText("No data", VMG_PLOT_NO_DATA_X, VMG_PLOT_NO_DATA_Y);
    return;
  }

  let maxAbs = 0;
  samples.forEach((sample) => {
    if (!sample || !Number.isFinite(sample.value)) return;
    maxAbs = Math.max(maxAbs, Math.abs(sample.value));
  });
  if (!Number.isFinite(maxAbs) || maxAbs <= 0) {
    maxAbs = VMG_PLOT_SCALE_STEP;
  } else {
    maxAbs = Math.max(
      VMG_PLOT_SCALE_STEP,
      Math.ceil(maxAbs / VMG_PLOT_SCALE_STEP) * VMG_PLOT_SCALE_STEP
    );
  }
  const labelMargin = VMG_PLOT_LABEL_MARGIN;
  const plotLeft = Math.min(labelMargin, Math.max(0, width - VMG_PLOT_LABEL_CLAMP_INSET));
  const plotRight = Math.max(plotLeft + VMG_PLOT_MIN_WIDTH, width - VMG_PLOT_RIGHT_INSET);
  const plotWidth = Math.max(VMG_PLOT_MIN_WIDTH, plotRight - plotLeft);
  const centerY = height / 2;
  const maxBar = Math.max(VMG_PLOT_MIN_HALF_HEIGHT, centerY - VMG_PLOT_PADDING);
  const yScale = maxBar / maxAbs;

  const gridStep =
    maxAbs >= VMG_PLOT_GRID_THRESHOLD ? VMG_PLOT_GRID_LARGE : VMG_PLOT_GRID_SMALL;
  const maxGrid = Math.floor(maxAbs / gridStep) * gridStep;
  if (maxGrid >= gridStep) {
    ctx.save();
    ctx.strokeStyle = VMG_PLOT_FG;
    ctx.lineWidth = VMG_PLOT_GRID_LINE_WIDTH;
    ctx.setLineDash(VMG_PLOT_GRID_DASH);
    for (let value = gridStep; value <= maxGrid; value += gridStep) {
      const dy = value * yScale;
      const yUp = centerY - dy;
      const yDown = centerY + dy;
      [yUp, yDown].forEach((y) => {
        if (!Number.isFinite(y) || y < 0 || y > height) return;
        ctx.beginPath();
        ctx.moveTo(plotLeft, y);
        ctx.lineTo(plotRight, y);
        ctx.stroke();
      });
    }
    ctx.restore();
  }

  const points = [];
  samples.forEach((sample) => {
    if (!sample || !Number.isFinite(sample.value)) return;
    const t = clamp((sample.ts - startTs) / windowMs, 0, 1);
    const x = plotLeft + t * plotWidth;
    const y = centerY - sample.value * yScale;
    points.push({ x, y, value: sample.value });
  });

  const fillArea = (sign, fillStyle) => {
    if (!points.length) return;
    ctx.save();
    ctx.fillStyle = fillStyle;
    ctx.beginPath();
    let started = false;
    for (let i = 0; i < points.length; i += 1) {
      const point = points[i];
      const prev = i > 0 ? points[i - 1] : null;
      const isOnSide = sign > 0 ? point.value >= 0 : point.value <= 0;
      const wasOnSide = prev
        ? sign > 0
          ? prev.value >= 0
          : prev.value <= 0
        : false;

      if (!prev) {
        if (isOnSide) {
          ctx.moveTo(point.x, centerY);
          ctx.lineTo(point.x, point.y);
          started = true;
        }
        continue;
      }

      if (wasOnSide && isOnSide) {
        ctx.lineTo(point.x, point.y);
        continue;
      }

      if (wasOnSide && !isOnSide) {
        const denom = prev.value - point.value;
        const tCross = Number.isFinite(denom) && denom !== 0 ? prev.value / denom : 0;
        const xCross = prev.x + clamp(tCross, 0, 1) * (point.x - prev.x);
        ctx.lineTo(xCross, centerY);
        ctx.closePath();
        started = false;
        continue;
      }

      if (!wasOnSide && isOnSide) {
        const denom = prev.value - point.value;
        const tCross = Number.isFinite(denom) && denom !== 0 ? prev.value / denom : 0;
        const xCross = prev.x + clamp(tCross, 0, 1) * (point.x - prev.x);
        ctx.moveTo(xCross, centerY);
        ctx.lineTo(point.x, point.y);
        started = true;
      }
    }
    if (started) {
      const last = points[points.length - 1];
      ctx.lineTo(last.x, centerY);
      ctx.closePath();
    }
    ctx.fill();
    ctx.restore();
  };

  fillArea(1, VMG_PLOT_POS_FILL);
  fillArea(-1, VMG_PLOT_NEG_FILL);

  ctx.save();
  ctx.strokeStyle = VMG_PLOT_FG;
  ctx.lineWidth = VMG_PLOT_SERIES_LINE_WIDTH;
  ctx.setLineDash([]);
  ctx.beginPath();
  let started = false;
  let pointCount = 0;
  let lastX = null;
  let lastY = null;
  points.forEach((point) => {
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return;
    const x = point.x;
    const y = point.y;
    pointCount += 1;
    lastX = x;
    lastY = y;
    if (!started) {
      ctx.moveTo(x, y);
      started = true;
    } else {
      ctx.lineTo(x, y);
    }
  });
  if (started) {
    ctx.stroke();
  }
  ctx.restore();

  if (pointCount === 1 && Number.isFinite(lastX) && Number.isFinite(lastY)) {
    ctx.save();
    ctx.fillStyle = VMG_PLOT_FG;
    const halfPoint = VMG_PLOT_POINT_SIZE / 2;
    ctx.fillRect(lastX - halfPoint, lastY - halfPoint, VMG_PLOT_POINT_SIZE, VMG_PLOT_POINT_SIZE);
    ctx.restore();
  }

  ctx.save();
  ctx.strokeStyle = VMG_PLOT_FG;
  ctx.lineWidth = VMG_PLOT_ZERO_LINE_WIDTH;
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.moveTo(plotLeft, centerY);
  ctx.lineTo(plotRight, centerY);
  ctx.stroke();
  ctx.restore();

  ctx.save();
  ctx.fillStyle = VMG_PLOT_FG;
  ctx.font = VMG_PLOT_FONT_LABEL;
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  const labelX = Math.max(VMG_PLOT_LABEL_MIN_X, plotLeft - VMG_PLOT_LABEL_GAP);
  ctx.fillText("0%", labelX, centerY);
  for (let value = gridStep; value <= maxGrid; value += gridStep) {
    const dy = value * yScale;
    const yUp = centerY - dy;
    const yDown = centerY + dy;
    ctx.fillText(`+${value}%`, labelX, yUp);
    ctx.fillText(`-${value}%`, labelX, yDown);
  }
  ctx.restore();
}

function resetVmgEstimator() {
  vmgEstimate.lastHeading = null;
  vmgEstimate.lastHeadingUnwrapped = null;
  setVmgWarmupState(false);
  resetVmgPlotHistory();
}

function computeVmgImprovementPercent(
  speed,
  headingDeg,
  headingBaselineDeg,
  speedBaseline,
  targetTwaRad
) {
  if (!Number.isFinite(speed)) return null;
  if (!Number.isFinite(headingDeg) || !Number.isFinite(headingBaselineDeg)) return null;
  if (!Number.isFinite(speedBaseline) || Math.abs(speedBaseline) < VMG_EVAL_MIN_BASE) return null;
  if (!Number.isFinite(targetTwaRad)) return null;
  const dhDeg = normalizeDeltaDegrees(headingDeg - headingBaselineDeg);
  const dhRad = toRadians(dhDeg);
  const cosTarget = Math.cos(targetTwaRad);
  if (!Number.isFinite(cosTarget) || Math.abs(cosTarget) < 1e-6) return null;
  const baselineVmg = speedBaseline * cosTarget;
  const instantVmg = speed * Math.cos(targetTwaRad + dhRad);
  const ratio = instantVmg / baselineVmg;
  if (!Number.isFinite(ratio)) return null;
  return (ratio - 1) * 100;
}


function updateVmgEstimate(position) {
  const sample = getVmgSample(position);
  if (!sample) return;

  const heading = sample.heading;
  const headingUnwrapped = unwrapHeadingDegrees(
    heading,
    vmgEstimate.lastHeading,
    vmgEstimate.lastHeadingUnwrapped
  );
  vmgEstimate.lastHeading = heading;
  vmgEstimate.lastHeadingUnwrapped = headingUnwrapped;
  if (Number.isFinite(heading)) {
    const headingForFilters = Number.isFinite(headingUnwrapped) ? headingUnwrapped : heading;
    const warmup = updateVmgPlotFilters(sample, headingForFilters, sample.ts);
    setVmgWarmupState(warmup);
  }
}

function applyVmgSettings(settings = {}) {
  if (Number.isFinite(settings.baselineTauSeconds)) {
    vmgPlotTauSeconds = clampVmgTauSeconds(settings.baselineTauSeconds);
  }
  if (settings.smoothCurrent !== undefined) {
    vmgSmoothCurrent = Boolean(settings.smoothCurrent);
  }
  if (settings.capEnabled !== undefined) {
    vmgCapEnabled = Boolean(settings.capEnabled);
  }
  syncVmgWindowUi();
  updateVmgSmoothToggle();
  updateVmgCapToggle();
  applyVmgSmoothSetting();
  applyVmgCapSetting();
}

function setVmgImuWarningOpen(open) {
  const next = Boolean(open);
  if (els.vmgImuModal) {
    els.vmgImuModal.setAttribute("aria-hidden", next ? "false" : "true");
  }
  document.body.classList.toggle("vmg-imu-open", next);
}

function setVmgSettingsOpen(open) {
  const next = Boolean(open);
  if (els.vmgSettingsView) {
    els.vmgSettingsView.setAttribute("aria-hidden", next ? "false" : "true");
  }
  document.body.classList.toggle("vmg-settings-open", next);
  if (next) {
    updateVmgImuToggle();
    updateVmgSmoothToggle();
    updateVmgCapToggle();
    syncVmgWindowUi();
  }
}

function setVmgMode(mode) {
  const normalized = mode === "reach" || mode === "run" ? mode : "beat";
  vmgMode = normalized;
  if (els.vmgModeBeat) {
    els.vmgModeBeat.setAttribute(
      "aria-pressed",
      normalized === "beat" ? "true" : "false"
    );
  }
  if (els.vmgModeReach) {
    els.vmgModeReach.setAttribute(
      "aria-pressed",
      normalized === "reach" ? "true" : "false"
    );
  }
  if (els.vmgModeRun) {
    els.vmgModeRun.setAttribute(
      "aria-pressed",
      normalized === "run" ? "true" : "false"
    );
  }
  requestVmgPlotRender({ force: true });
}

function setVmgTack(tack) {
  const normalized = tack === "port" ? "port" : "starboard";
  vmgTack = normalized;
  const isStarboard = normalized === "starboard";
  const isPort = normalized === "port";
  if (els.vmgTackStarboard) {
    els.vmgTackStarboard.setAttribute("aria-pressed", isStarboard ? "true" : "false");
  }
  if (els.vmgTackPort) {
    els.vmgTackPort.setAttribute("aria-pressed", isPort ? "true" : "false");
  }
  requestVmgPlotRender({ force: true });
}

function bindVmgEvents() {
  if (els.openVmgSettings) {
    els.openVmgSettings.addEventListener("click", () => {
      const isOpen = document.body.classList.contains("vmg-settings-open");
      setVmgSettingsOpen(!isOpen);
    });
  }

  if (els.closeVmgSettings) {
    els.closeVmgSettings.addEventListener("click", () => {
      setVmgSettingsOpen(false);
    });
  }

  if (els.vmgWindow) {
    vmgPlotTauSeconds = clampVmgTauSeconds(vmgPlotTauSeconds);
    syncVmgWindowUi();
    const onWindowChange = () => {
      const nextTauSeconds = clampVmgTauSeconds(els.vmgWindow.value);
      vmgPlotTauSeconds = nextTauSeconds;
      syncVmgWindowUi();
      pruneVmgEvalHistory(Date.now() - getVmgEvalHistoryMs());
      requestVmgPlotRender({ force: true });
      if (vmgDeps.saveSettings) {
        vmgDeps.saveSettings();
      }
    };
    els.vmgWindow.addEventListener("input", onWindowChange);
    els.vmgWindow.addEventListener("change", onWindowChange);
  }

  if (els.vmgImuToggle) {
    els.vmgImuToggle.addEventListener("click", async () => {
      if (!vmgDeps.setImuEnabled) return;
      await vmgDeps.setImuEnabled(!state.imuEnabled);
      updateVmgImuToggle();
      if (state.imuEnabled) {
        setVmgImuWarningOpen(true);
      } else {
        setVmgImuWarningOpen(false);
      }
    });
  }

  if (els.vmgSmoothToggle) {
    els.vmgSmoothToggle.addEventListener("click", () => {
      vmgSmoothCurrent = !vmgSmoothCurrent;
      updateVmgSmoothToggle();
      applyVmgSmoothSetting();
      if (vmgDeps.saveSettings) {
        vmgDeps.saveSettings();
      }
    });
  }

  if (els.vmgCapToggle) {
    els.vmgCapToggle.addEventListener("click", () => {
      vmgCapEnabled = !vmgCapEnabled;
      updateVmgCapToggle();
      applyVmgSmoothSetting();
      applyVmgCapSetting();
      if (vmgDeps.saveSettings) {
        vmgDeps.saveSettings();
      }
    });
  }

  if (els.vmgModeBeat || els.vmgModeReach || els.vmgModeRun) {
    setVmgMode("beat");

    if (els.vmgModeBeat) {
      els.vmgModeBeat.addEventListener("click", () => {
        setVmgMode("beat");
      });
    }

    if (els.vmgModeReach) {
      els.vmgModeReach.addEventListener("click", () => {
        setVmgMode("reach");
      });
    }

    if (els.vmgModeRun) {
      els.vmgModeRun.addEventListener("click", () => {
        setVmgMode("run");
      });
    }
  }

  if (els.vmgTackPort || els.vmgTackStarboard) {
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
      resetVmgEstimator();
    };
    syncVmgTwa();
    els.vmgTwa.addEventListener("input", syncVmgTwa);
  }

  if (els.vmgTwaDown) {
    const syncVmgTwaDown = () => {
      if (els.vmgTwaDownValue) {
        els.vmgTwaDownValue.textContent = `${els.vmgTwaDown.value} deg`;
      }
      resetVmgEstimator();
    };
    syncVmgTwaDown();
    els.vmgTwaDown.addEventListener("input", syncVmgTwaDown);
  }

  if (els.closeVmgImu) {
    els.closeVmgImu.addEventListener("click", () => {
      setVmgImuWarningOpen(false);
    });
  }
}

function enterVmgView() {
  syncVmgWindowUi();
  requestVmgPlotRender({ force: true });
}

function getVmgSettingsSnapshot() {
  return {
    baselineTauSeconds: vmgPlotTauSeconds,
    mode: vmgMode,
    tack: vmgTack,
    twaUpDeg: getVmgTwaDegrees(),
    twaDownDeg: getVmgDownTwaDegrees(),
    imuEnabled: state.imuEnabled,
    smoothCurrent: vmgSmoothCurrent,
    capEnabled: vmgCapEnabled,
  };
}

function getVmgPersistedSettings() {
  return {
    baselineTauSeconds: vmgPlotTauSeconds,
    smoothCurrent: vmgSmoothCurrent,
    capEnabled: vmgCapEnabled,
  };
}

function clampVmgTauSeconds(seconds) {
  const safe = Number.parseInt(seconds, 10);
  if (!Number.isFinite(safe)) return vmgPlotTauSeconds;
  return clamp(safe, VMG_BASELINE_TAU_MIN_SEC, VMG_BASELINE_TAU_MAX_SEC);
}

function syncVmgWindowUi() {
  const tauSeconds = clampVmgTauSeconds(vmgPlotTauSeconds);
  vmgPlotTauSeconds = tauSeconds;
  if (els.vmgWindow) {
    els.vmgWindow.value = String(tauSeconds);
  }
  if (els.vmgWindowValue) {
    els.vmgWindowValue.textContent = formatWindowSeconds(tauSeconds);
  }
}

function getVmgPlotWindowSeconds() {
  return vmgPlotTauSeconds * VMG_PLOT_WINDOW_TAU_FACTOR;
}

function requestVmgPlotRender(options = {}) {
  if (!document.body.classList.contains("vmg-mode")) return;
  const now = Date.now();
  const force = options && options.force;
  const maxIntervalMs = VMG_PLOT_RENDER_INTERVAL_MS;
  const elapsed = now - vmgPlotLastRenderAt;
  if (force || !Number.isFinite(vmgPlotLastRenderAt) || elapsed >= maxIntervalMs) {
    if (vmgPlotRenderTimer) {
      clearTimeout(vmgPlotRenderTimer);
      vmgPlotRenderTimer = null;
    }
    vmgPlotLastRenderAt = now;
    renderVmgPlot();
    return;
  }
  if (vmgPlotRenderTimer) return;
  vmgPlotRenderTimer = setTimeout(() => {
    vmgPlotRenderTimer = null;
    vmgPlotLastRenderAt = Date.now();
    renderVmgPlot();
  }, maxIntervalMs - elapsed);
}

function resetVmgPlotHistory() {
  forEachVmgPlotState((state) => {
    state.history.length = 0;
    state.fast = null;
    state.lastRaw = null;
  });
  vmgPlotLastSampleTs = null;
  vmgSpeedBaseline = null;
  vmgHeadingBaseline = null;
  requestVmgPlotRender({ force: true });
}

function getVmgTwaDegrees() {
  if (!els.vmgTwa) return VMG_EVAL_TWA_UP_DEG;
  const value = Number.parseFloat(els.vmgTwa.value);
  if (!Number.isFinite(value)) return VMG_EVAL_TWA_UP_DEG;
  return clamp(value, VMG_EVAL_TWA_UP_MIN, VMG_EVAL_TWA_UP_MAX);
}

function getVmgDownTwaDegrees() {
  if (!els.vmgTwaDown) return VMG_EVAL_TWA_DOWN_DEG;
  const value = Number.parseFloat(els.vmgTwaDown.value);
  if (!Number.isFinite(value)) return VMG_EVAL_TWA_DOWN_DEG;
  return clamp(value, VMG_EVAL_TWA_DOWN_MIN, VMG_EVAL_TWA_DOWN_MAX);
}

function getVmgSample(position) {
  if (!position || !position.coords) return null;
  if (!canUseKalmanHeading(position)) return null;
  if (!state.velocity || !Number.isFinite(state.speed)) return null;
  const heading = headingFromVelocity(state.velocity);
  if (!Number.isFinite(heading)) return null;
  const ts = Number.isFinite(position.timestamp) ? position.timestamp : Date.now();
  return { speed: state.speed, heading, ts, source: "kalman" };
}

function isVmgGpsBad() {
  if (!state.position) return true;
  if (isGpsStale()) return true;
  const accuracy = state.position.coords?.accuracy;
  if (!Number.isFinite(accuracy)) return true;
  return accuracy > VMG_GPS_BAD_ACCURACY_M;
}

function applyFirstOrderFilter(prevValue, nextValue, dtSec, tauSec) {
  if (!Number.isFinite(nextValue)) return prevValue;
  if (!Number.isFinite(tauSec) || tauSec <= 0) return nextValue;
  if (!Number.isFinite(prevValue)) return nextValue;
  const alpha = dtSec / (tauSec + dtSec);
  return prevValue + alpha * (nextValue - prevValue);
}

function applyHeadingBaselineFilter(prevHeading, nextHeading, dtSec, tauSec) {
  if (!Number.isFinite(nextHeading)) return prevHeading;
  if (!Number.isFinite(tauSec) || tauSec <= 0) return nextHeading;
  if (!Number.isFinite(prevHeading)) return nextHeading;
  const alpha = dtSec / (tauSec + dtSec);
  const delta = normalizeDeltaDegrees(nextHeading - prevHeading);
  return prevHeading + alpha * delta;
}

function recordVmgPlotSample(state, value, timestampMs, requestRender = true) {
  if (!Number.isFinite(value)) return;
  const ts = Number.isFinite(timestampMs) ? timestampMs : Date.now();
  state.history.push({ ts, value });
  vmgPlotLastSampleTs = ts;
  const cutoff = ts - (getVmgPlotWindowSeconds() * 1000 + VMG_PLOT_HISTORY_PAD_MS);
  while (state.history.length && state.history[0].ts < cutoff) {
    state.history.shift();
  }
  if (requestRender) {
    requestVmgPlotRender();
  }
}

function updateLatestVmgPlotSample(state, value, timestampMs, requestRender = true) {
  if (!Number.isFinite(value)) return;
  const ts = Number.isFinite(timestampMs) ? timestampMs : Date.now();
  const last = state.history[state.history.length - 1];
  if (last && last.ts === ts) {
    last.value = value;
    vmgPlotLastSampleTs = ts;
    if (requestRender) {
      requestVmgPlotRender();
    }
    return;
  }
  recordVmgPlotSample(state, value, ts, requestRender);
}

function updateVmgPlotFilters(sample, headingDeg, timestampMs) {
  if (!sample || !Number.isFinite(sample.speed)) return true;
  if (!Number.isFinite(headingDeg)) return true;
  const ts = Number.isFinite(timestampMs) ? timestampMs : Date.now();
  if (!Number.isFinite(vmgPlotLastSampleTs)) {
    vmgSpeedBaseline = sample.speed;
    vmgHeadingBaseline = headingDeg;
    forEachVmgPlotState((state) => {
      state.fast = 0;
      state.lastRaw = 0;
      updateLatestVmgPlotSample(state, 0, ts, false);
    });
    requestVmgPlotRender();
    return true;
  }
  const dtSec = Math.max(0, (ts - vmgPlotLastSampleTs) / 1000);
  if (dtSec <= 0) return false;
  const baselineTau = vmgPlotTauSeconds;
  vmgSpeedBaseline = applyFirstOrderFilter(vmgSpeedBaseline, sample.speed, dtSec, baselineTau);
  vmgHeadingBaseline = applyHeadingBaselineFilter(
    vmgHeadingBaseline,
    headingDeg,
    dtSec,
    baselineTau
  );
  if (!Number.isFinite(vmgSpeedBaseline) || Math.abs(vmgSpeedBaseline) < VMG_EVAL_MIN_BASE) {
    forEachVmgPlotState((state) => {
      state.fast = 0;
      state.lastRaw = 0;
      updateLatestVmgPlotSample(state, 0, ts, false);
    });
    requestVmgPlotRender();
    return true;
  }

  const upTwaRad = toRadians(getVmgTwaDegrees());
  const downTwaRad = toRadians(getVmgDownTwaDegrees());
  const targetMap = {
    "beat-port": -upTwaRad,
    "beat-starboard": upTwaRad,
    reach: 0,
    "run-port": -downTwaRad,
    "run-starboard": downTwaRad,
  };
  const fastTau = Math.max(VMG_FAST_TAU_MIN_SEC, baselineTau * VMG_FAST_TAU_FACTOR);

  forEachVmgPlotState((state, key) => {
    const targetRad = targetMap[key];
    const rawImprovement = computeVmgImprovementPercent(
      sample.speed,
      headingDeg,
      vmgHeadingBaseline,
      vmgSpeedBaseline,
      targetRad
    );
    if (!Number.isFinite(rawImprovement)) {
      state.fast = 0;
      state.lastRaw = 0;
      updateLatestVmgPlotSample(state, 0, ts, false);
      return;
    }
    state.lastRaw = rawImprovement;
    if (vmgSmoothCurrent) {
      state.fast = applyFirstOrderFilter(state.fast, rawImprovement, dtSec, fastTau);
    } else {
      state.fast = rawImprovement;
    }
    const capped = vmgCapEnabled
      ? clamp(state.fast, -VMG_EVAL_MAX_GAIN, VMG_EVAL_MAX_GAIN)
      : state.fast;
    updateLatestVmgPlotSample(state, Number.isFinite(capped) ? capped : 0, ts, false);
  });
  requestVmgPlotRender();
  return false;
}

function updateVmgGpsState() {
  if (!els.vmgPlot) return;
  els.vmgPlot.classList.toggle("gps-bad", isVmgGpsBad());
}

function setVmgWarmupState(active) {
  const next = Boolean(active);
  if (vmgWarmup === next) return;
  vmgWarmup = next;
  if (els.vmgWarmup) {
    els.vmgWarmup.setAttribute("aria-hidden", next ? "false" : "true");
  }
}

function updateVmgImuToggle() {
  if (els.vmgImuToggle) {
    els.vmgImuToggle.setAttribute("aria-pressed", state.imuEnabled ? "true" : "false");
  }
}

function updateVmgSmoothToggle() {
  if (els.vmgSmoothToggle) {
    els.vmgSmoothToggle.setAttribute("aria-pressed", vmgSmoothCurrent ? "true" : "false");
  }
}

function updateVmgCapToggle() {
  if (els.vmgCapToggle) {
    els.vmgCapToggle.setAttribute("aria-pressed", vmgCapEnabled ? "true" : "false");
  }
}

function applyVmgSmoothSetting() {
  if (!Number.isFinite(vmgPlotLastSampleTs)) return;
  const state = getActiveVmgPlotState();
  if (!Number.isFinite(state.lastRaw)) return;
  state.fast = state.lastRaw;
  const value = vmgCapEnabled
    ? clamp(state.fast, -VMG_EVAL_MAX_GAIN, VMG_EVAL_MAX_GAIN)
    : state.fast;
  updateLatestVmgPlotSample(state, Number.isFinite(value) ? value : 0, vmgPlotLastSampleTs);
}

function applyVmgCapSetting() {
  if (!Number.isFinite(vmgPlotLastSampleTs)) return;
  const state = getActiveVmgPlotState();
  if (!Number.isFinite(state.lastRaw)) return;
  if (!vmgSmoothCurrent) {
    state.fast = state.lastRaw;
  }
  const value = vmgCapEnabled
    ? clamp(state.fast, -VMG_EVAL_MAX_GAIN, VMG_EVAL_MAX_GAIN)
    : state.fast;
  updateLatestVmgPlotSample(state, Number.isFinite(value) ? value : 0, vmgPlotLastSampleTs);
}

export {
  initVmg,
  applyVmgSettings,
  bindVmgEvents,
  getVmgSettingsSnapshot,
  getVmgPersistedSettings,
  updateVmgEstimate,
  updateVmgGpsState,
  requestVmgPlotRender,
  syncVmgWindowUi,
  resetVmgEstimator,
  setVmgSettingsOpen,
  updateVmgImuToggle,
  updateVmgSmoothToggle,
  updateVmgCapToggle,
  enterVmgView,
};
