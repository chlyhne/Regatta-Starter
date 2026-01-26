import { els } from "../../ui/dom.js";
import { state } from "../../core/state.js";
import { toRadians } from "../../core/geo.js";
import { isGpsStale } from "../../core/gps-watch.js";
import {
  clamp,
  normalizeDeltaDegrees,
  normalizeAngleRad,
  normalizeDeltaRad,
  headingRadToDegrees,
  unwrapHeadingDegrees,
  resizeCanvasToCssPixels,
  formatWindowSeconds,
} from "../../core/common.js";
import { getHeadingSampleForMode, getHeadingSourcePreference } from "../../core/heading.js";

const KNOTS_TO_MS = 0.514444;
const VMG_IMU_GPS_MIN_SPEED = 2 * KNOTS_TO_MS;
const VMG_IMU_GPS_BLEND_TAU = 12;
const VMG_IMU_DT_CLAMP = { min: 0.005, max: 0.25 };
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
const VMG_PLOT_WINDOW_TAU_FACTOR = 4;
const VMG_PLOT_SCALE_STEP = 2;
const VMG_PLOT_GRID_SMALL = 2;
const VMG_PLOT_GRID_LARGE = 4;
const VMG_PLOT_GRID_THRESHOLD = 6;
const VMG_PLOT_GRID_DASH = [6, 8];
const VMG_PLOT_PADDING = 10;
const VMG_PLOT_HISTORY_PAD_MS = 5000;

const vmgPlotHistory = [];
let vmgPlotTauSeconds = VMG_BASELINE_TAU_DEFAULT_SEC;
let vmgPlotLastSampleTs = null;
let vmgPlotFast = null;
let vmgPlotLastRaw = null;
let vmgSpeedBaseline = null;
let vmgHeadingBaseline = null;
let vmgPlotLastRenderAt = 0;
let vmgPlotRenderTimer = null;
const vmgEstimate = {
  lastHeading: null,
  lastHeadingUnwrapped: null,
  lastRawPosition: null,
};
const vmgImu = {
  headingRad: null,
  lastTimestamp: null,
  lastGpsTs: null,
};
let vmgWarmup = false;
let vmgMode = "beat";
let vmgTack = "starboard";
let vmgSmoothCurrent = true;
let vmgCapEnabled = true;

let vmgDeps = {
  setHeadingSourcePreference: null,
  setImuEnabled: null,
  updateHeadingSourceToggles: null,
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
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);

  if (!Number.isFinite(vmgPlotLastSampleTs)) {
    ctx.fillStyle = "#000000";
    ctx.font = "16px sans-serif";
    ctx.fillText("No data", 12, 24);
    return;
  }

  const windowSeconds = getVmgPlotWindowSeconds();
  const windowMs = Math.max(1000, windowSeconds * 1000);
  const endTs = vmgPlotLastSampleTs;
  const startTs = endTs - windowMs;

  const samples = vmgPlotHistory.filter(
    (sample) => sample && Number.isFinite(sample.ts) && sample.ts >= startTs
  );

  if (!samples.length) {
    ctx.fillStyle = "#000000";
    ctx.font = "16px sans-serif";
    ctx.fillText("No data", 12, 24);
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
  const labelMargin = 44;
  const plotLeft = Math.min(labelMargin, Math.max(0, width - 20));
  const plotRight = Math.max(plotLeft + 1, width - 6);
  const plotWidth = Math.max(1, plotRight - plotLeft);
  const centerY = height / 2;
  const maxBar = Math.max(1, centerY - VMG_PLOT_PADDING);
  const yScale = maxBar / maxAbs;

  const gridStep =
    maxAbs >= VMG_PLOT_GRID_THRESHOLD ? VMG_PLOT_GRID_LARGE : VMG_PLOT_GRID_SMALL;
  const maxGrid = Math.floor(maxAbs / gridStep) * gridStep;
  if (maxGrid >= gridStep) {
    ctx.save();
    ctx.strokeStyle = "#000000";
    ctx.lineWidth = 2;
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

  fillArea(1, "rgba(0, 120, 0, 0.25)");
  fillArea(-1, "rgba(160, 0, 0, 0.25)");

  ctx.save();
  ctx.strokeStyle = "#000000";
  ctx.lineWidth = 2;
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
    ctx.fillStyle = "#000000";
    ctx.fillRect(lastX - 2, lastY - 2, 4, 4);
    ctx.restore();
  }

  ctx.save();
  ctx.strokeStyle = "#000000";
  ctx.lineWidth = 2;
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.moveTo(plotLeft, centerY);
  ctx.lineTo(plotRight, centerY);
  ctx.stroke();
  ctx.restore();

  ctx.save();
  ctx.fillStyle = "#000000";
  ctx.font = "12px sans-serif";
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  const labelX = Math.max(6, plotLeft - 6);
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
  vmgEstimate.lastRawPosition = null;
  setVmgWarmupState(false);
  resetVmgPlotHistory();
  resetVmgImuState();
}

function applyVmgImuYawRate(yawRateRad, dtSeconds) {
  if (!state.imuEnabled) return;
  if (!Number.isFinite(yawRateRad) || !Number.isFinite(dtSeconds)) return;
  if (!Number.isFinite(vmgImu.headingRad)) return;
  const delta = yawRateRad * dtSeconds;
  vmgImu.headingRad = normalizeAngleRad(vmgImu.headingRad + delta);
}

function updateVmgImuFromGps(sample) {
  if (!state.imuEnabled) return;
  if (!sample || !Number.isFinite(sample.heading)) return;
  if (!Number.isFinite(sample.speed) || sample.speed < VMG_IMU_GPS_MIN_SPEED) return;
  const headingRad = normalizeAngleRad(toRadians(sample.heading));
  if (!Number.isFinite(vmgImu.headingRad)) {
    vmgImu.headingRad = headingRad;
    vmgImu.lastGpsTs = sample.ts;
    return;
  }
  const lastTs = Number.isFinite(vmgImu.lastGpsTs) ? vmgImu.lastGpsTs : sample.ts;
  const dtSec = Math.max(0, (sample.ts - lastTs) / 1000);
  if (dtSec <= 0) return;
  vmgImu.lastGpsTs = sample.ts;
  const delta = normalizeDeltaRad(headingRad - vmgImu.headingRad);
  const weight = 1 - Math.exp(-dtSec / VMG_IMU_GPS_BLEND_TAU);
  if (!Number.isFinite(weight) || weight <= 0) return;
  vmgImu.headingRad = normalizeAngleRad(vmgImu.headingRad + delta * weight);
}

function getVmgSignedTwaRad() {
  if (vmgMode === "reach") return 0;
  const twaDeg = vmgMode === "run" ? getVmgDownTwaDegrees() : getVmgTwaDegrees();
  const signed = vmgTack === "starboard" ? twaDeg : -twaDeg;
  return toRadians(signed);
}

function computeVmgImprovementPercent(speed, headingDeg, headingBaselineDeg, speedBaseline) {
  if (!Number.isFinite(speed)) return null;
  if (!Number.isFinite(headingDeg) || !Number.isFinite(headingBaselineDeg)) return null;
  if (!Number.isFinite(speedBaseline) || Math.abs(speedBaseline) < VMG_EVAL_MIN_BASE) return null;
  const dv = speed - speedBaseline;
  const dhDeg = normalizeDeltaDegrees(headingDeg - headingBaselineDeg);
  const dhRad = toRadians(dhDeg);
  const twaRad = getVmgSignedTwaRad();
  const headingTerm = Math.cos(dhRad) - Math.tan(twaRad) * Math.sin(dhRad);
  const speedRatio = 1 + dv / speedBaseline;
  const ratio = speedRatio * headingTerm;
  if (!Number.isFinite(ratio)) return null;
  return (ratio - 1) * 100;
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
    if (vmgDeps.updateHeadingSourceToggles) {
      vmgDeps.updateHeadingSourceToggles();
    }
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
  resetVmgEstimator();
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
  resetVmgEstimator();
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

  if (els.vmgModelToggle) {
    els.vmgModelToggle.addEventListener("click", () => {
      if (!vmgDeps.setHeadingSourcePreference) return;
      const enabled = getHeadingSourcePreference("vmg") === "kalman";
      vmgDeps.setHeadingSourcePreference("vmg", enabled ? "gps" : "kalman");
    });
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

function applyVmgImuSample(yawRateRad, timestamp) {
  if (!Number.isFinite(yawRateRad)) return;
  const ts = Number.isFinite(timestamp) ? timestamp : Date.now();
  if (!Number.isFinite(vmgImu.lastTimestamp)) {
    vmgImu.lastTimestamp = ts;
    return;
  }
  const vmgDtRaw = (ts - vmgImu.lastTimestamp) / 1000;
  vmgImu.lastTimestamp = ts;
  const vmgDt = clamp(vmgDtRaw, VMG_IMU_DT_CLAMP.min, VMG_IMU_DT_CLAMP.max);
  if (vmgDt <= 0) return;
  applyVmgImuYawRate(yawRateRad, vmgDt);
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
  const maxIntervalMs = 200;
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
  vmgPlotHistory.length = 0;
  vmgPlotLastSampleTs = null;
  vmgPlotFast = null;
  vmgPlotLastRaw = null;
  vmgSpeedBaseline = null;
  vmgHeadingBaseline = null;
  requestVmgPlotRender({ force: true });
}

function resetVmgImuState() {
  vmgImu.headingRad = null;
  vmgImu.lastTimestamp = null;
  vmgImu.lastGpsTs = null;
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
  const sample = getHeadingSampleForMode("vmg", position, vmgEstimate.lastRawPosition);
  if (!sample) return null;
  if (sample.source === "gps") {
    vmgEstimate.lastRawPosition = position;
  }
  return sample;
}

function isVmgGpsBad() {
  if (!state.position) return true;
  if (isGpsStale()) return true;
  const accuracy = state.position.coords?.accuracy;
  if (!Number.isFinite(accuracy)) return true;
  return accuracy > 20;
}

function applyFirstOrderFilter(prevValue, nextValue, dtSec, tauSec) {
  if (!Number.isFinite(nextValue)) return prevValue;
  if (!Number.isFinite(tauSec) || tauSec <= 0) return nextValue;
  if (!Number.isFinite(prevValue)) return nextValue;
  const alpha = 1 - Math.exp(-dtSec / tauSec);
  return prevValue + alpha * (nextValue - prevValue);
}

function recordVmgPlotSample(value, timestampMs) {
  if (!Number.isFinite(value)) return;
  const ts = Number.isFinite(timestampMs) ? timestampMs : Date.now();
  vmgPlotHistory.push({ ts, value });
  vmgPlotLastSampleTs = ts;
  const cutoff = ts - (getVmgPlotWindowSeconds() * 1000 + VMG_PLOT_HISTORY_PAD_MS);
  while (vmgPlotHistory.length && vmgPlotHistory[0].ts < cutoff) {
    vmgPlotHistory.shift();
  }
  requestVmgPlotRender();
}

function updateLatestVmgPlotSample(value, timestampMs) {
  if (!Number.isFinite(value)) return;
  const ts = Number.isFinite(timestampMs) ? timestampMs : Date.now();
  const last = vmgPlotHistory[vmgPlotHistory.length - 1];
  if (last && last.ts === ts) {
    last.value = value;
    vmgPlotLastSampleTs = ts;
    requestVmgPlotRender();
    return;
  }
  recordVmgPlotSample(value, ts);
}

function updateVmgPlotFilters(sample, headingDeg, timestampMs) {
  if (!sample || !Number.isFinite(sample.speed)) return true;
  if (!Number.isFinite(headingDeg)) return true;
  const ts = Number.isFinite(timestampMs) ? timestampMs : Date.now();
  if (!Number.isFinite(vmgPlotLastSampleTs)) {
    vmgSpeedBaseline = sample.speed;
    vmgHeadingBaseline = headingDeg;
    vmgPlotFast = 0;
    vmgPlotLastRaw = 0;
    updateLatestVmgPlotSample(0, ts);
    return true;
  }
  const dtSec = Math.max(0, (ts - vmgPlotLastSampleTs) / 1000);
  if (dtSec <= 0) return false;
  const baselineTau = vmgPlotTauSeconds;
  vmgSpeedBaseline = applyFirstOrderFilter(vmgSpeedBaseline, sample.speed, dtSec, baselineTau);
  vmgHeadingBaseline = applyFirstOrderFilter(vmgHeadingBaseline, headingDeg, dtSec, baselineTau);
  const rawImprovement = computeVmgImprovementPercent(
    sample.speed,
    headingDeg,
    vmgHeadingBaseline,
    vmgSpeedBaseline
  );
  const warmup = !Number.isFinite(rawImprovement);
  if (warmup) {
    updateLatestVmgPlotSample(0, ts);
    return true;
  }
  vmgPlotLastRaw = rawImprovement;
  if (vmgSmoothCurrent) {
    const fastTau = Math.max(0.05, baselineTau / 10);
    vmgPlotFast = applyFirstOrderFilter(vmgPlotFast, rawImprovement, dtSec, fastTau);
  } else {
    vmgPlotFast = rawImprovement;
  }
  const capped = vmgCapEnabled
    ? clamp(vmgPlotFast, -VMG_EVAL_MAX_GAIN, VMG_EVAL_MAX_GAIN)
    : vmgPlotFast;
  updateLatestVmgPlotSample(Number.isFinite(capped) ? capped : 0, ts);
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
  if (!Number.isFinite(vmgPlotLastRaw)) return;
  vmgPlotFast = vmgPlotLastRaw;
  const value = vmgCapEnabled
    ? clamp(vmgPlotFast, -VMG_EVAL_MAX_GAIN, VMG_EVAL_MAX_GAIN)
    : vmgPlotFast;
  updateLatestVmgPlotSample(Number.isFinite(value) ? value : 0, vmgPlotLastSampleTs);
}

function applyVmgCapSetting() {
  if (!Number.isFinite(vmgPlotLastSampleTs)) return;
  if (!Number.isFinite(vmgPlotLastRaw)) return;
  if (!vmgSmoothCurrent) {
    vmgPlotFast = vmgPlotLastRaw;
  }
  const value = vmgCapEnabled
    ? clamp(vmgPlotFast, -VMG_EVAL_MAX_GAIN, VMG_EVAL_MAX_GAIN)
    : vmgPlotFast;
  updateLatestVmgPlotSample(Number.isFinite(value) ? value : 0, vmgPlotLastSampleTs);
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
  resetVmgImuState,
  setVmgSettingsOpen,
  updateVmgImuToggle,
  updateVmgSmoothToggle,
  updateVmgCapToggle,
  enterVmgView,
  applyVmgImuSample,
};
