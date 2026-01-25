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
  normalizeHeadingDegrees,
  meanHeadingDegreesFromSinCos,
  resizeCanvasToCssPixels,
  formatWindowSeconds,
} from "../../core/common.js";
import { getHeadingSampleForMode, getHeadingSourcePreference } from "../../core/heading.js";

const VMG_TAU_SECONDS = 10;
const VMG_RLS_INIT_P = 100;
const KNOTS_TO_MS = 0.514444;
const VMG_IMU_GPS_MIN_SPEED = 2 * KNOTS_TO_MS;
const VMG_IMU_GPS_BLEND_TAU = 12;
const VMG_IMU_DT_CLAMP = { min: 0.005, max: 0.25 };
const VMG_EVAL_WINDOW_SEC = 30;
const VMG_EVAL_TWA_UP_DEG = 45;
const VMG_EVAL_TWA_UP_MIN = 35;
const VMG_EVAL_TWA_UP_MAX = 50;
const VMG_EVAL_TWA_DOWN_DEG = 150;
const VMG_EVAL_TWA_DOWN_MIN = 110;
const VMG_EVAL_TWA_DOWN_MAX = 175;
const VMG_EVAL_MAX_GAIN = 50;
const VMG_EVAL_MIN_BASE = 0.2;
const VMG_EVAL_HISTORY_PAD_MS = 5000;
const VMG_EVAL_WARMUP_MIN_MS = 1000;
const VMG_BASELINE_TAU_DEFAULT_SEC = 45;
const VMG_BASELINE_TAU_MIN_SEC = 15;
const VMG_BASELINE_TAU_MAX_SEC = 75;
const VMG_PLOT_WINDOW_TAU_FACTOR = 6;
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
let vmgPlotBaseline = null;
let vmgPlotFast = null;
let vmgPlotLastRenderAt = 0;
let vmgPlotRenderTimer = null;
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
let vmgWarmup = false;
let vmgMode = "beating";
let vmgTack = "starboard";

let vmgDeps = {
  setHeadingSourcePreference: null,
  setImuEnabled: null,
  updateHeadingSourceToggles: null,
  hardReload: null,
};

function initVmg(deps = {}) {
  vmgDeps = { ...vmgDeps, ...deps };
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
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
      });
    }
    ctx.restore();
  }

  ctx.save();
  ctx.strokeStyle = "#000000";
  ctx.lineWidth = 2;
  ctx.setLineDash([]);
  ctx.beginPath();
  let started = false;
  let pointCount = 0;
  let lastX = null;
  let lastY = null;
  samples.forEach((sample) => {
    if (!sample || !Number.isFinite(sample.value)) return;
    const age = clamp((endTs - sample.ts) / windowMs, 0, 1);
    const x = age * width;
    const y = centerY - sample.value * yScale;
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
  ctx.moveTo(0, centerY);
  ctx.lineTo(width, centerY);
  ctx.stroke();
  ctx.restore();
}

function resetVmgPlotHistory() {
  vmgPlotHistory.length = 0;
  vmgPlotLastSampleTs = null;
  vmgPlotBaseline = null;
  vmgPlotFast = null;
  requestVmgPlotRender({ force: true });
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
  vmgEvalHistory.length = 0;
  setVmgWarmupState(false);
  resetVmgPlotHistory();
  resetVmgImuState();
}

function resetVmgImuState() {
  vmgImu.headingRad = null;
  vmgImu.lastTimestamp = null;
  vmgImu.lastGpsTs = null;
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

function getVmgEvalWindowSeconds() {
  if (vmgMode === "reaching") {
    return Math.max(1, getVmgPlotWindowSeconds() / 2);
  }
  return VMG_EVAL_WINDOW_SEC;
}

function getVmgEvalHistoryMs() {
  const minWindowSeconds = VMG_EVAL_WINDOW_SEC * 2;
  const windowSeconds = Math.max(minWindowSeconds, getVmgPlotWindowSeconds());
  return windowSeconds * 1000 + VMG_EVAL_HISTORY_PAD_MS;
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
  pruneVmgEvalHistory(ts - getVmgEvalHistoryMs());
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
  if (vmgMode === "reaching") {
    return normalizeHeadingDegrees(meanHeading);
  }
  const twa = vmgMode === "downwind" ? getVmgDownTwaDegrees() : getVmgTwaDegrees();
  const offset = vmgTack === "starboard" ? twa : -twa;
  return normalizeHeadingDegrees(meanHeading + offset);
}

function computeVmgChangePercent() {
  if (!vmgEvalHistory.length) {
    return { percent: null, warmup: false };
  }

  const windowSec = getVmgEvalWindowSeconds();
  const windowMs = windowSec * 1000;
  const endTs = vmgEvalHistory[vmgEvalHistory.length - 1].ts;
  const startTs = vmgEvalHistory[0].ts;
  const span = endTs - startTs;
  const warmup = !Number.isFinite(span) || span < 2 * windowMs;
  const effectiveWindowMs = warmup
    ? Math.max(VMG_EVAL_WARMUP_MIN_MS, span / 2)
    : windowMs;
  if (!Number.isFinite(effectiveWindowMs) || effectiveWindowMs <= 0) {
    return { percent: null, warmup: true };
  }
  const currentStart = endTs - effectiveWindowMs;
  const prevStart = currentStart - effectiveWindowMs;
  pruneVmgEvalHistory(endTs - getVmgEvalHistoryMs());

  const windAxis = computeVmgWindAxis(prevStart, currentStart);
  if (!Number.isFinite(windAxis)) {
    return { percent: null, warmup };
  }

  const prevAvg = computeWindowVmgAverage(prevStart, currentStart, windAxis);
  const currAvg = computeWindowVmgAverage(currentStart, endTs, windAxis);
  if (!Number.isFinite(prevAvg) || !Number.isFinite(currAvg)) {
    return { percent: null, warmup };
  }
  const sign = vmgMode === "downwind" ? -1 : 1;
  const prevScore = prevAvg * sign;
  const currScore = currAvg * sign;
  if (Math.abs(prevScore) < VMG_EVAL_MIN_BASE) {
    return { percent: null, warmup };
  }

  return {
    percent: ((currScore - prevScore) / Math.abs(prevScore)) * 100,
    warmup,
  };
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

function updateVmgPlotFilters(rawValue, timestampMs) {
  if (!Number.isFinite(rawValue)) return;
  const ts = Number.isFinite(timestampMs) ? timestampMs : Date.now();
  const clamped = clamp(rawValue, -VMG_EVAL_MAX_GAIN, VMG_EVAL_MAX_GAIN);
  if (!Number.isFinite(vmgPlotLastSampleTs)) {
    vmgPlotBaseline = clamped;
    vmgPlotFast = clamped;
    recordVmgPlotSample(0, ts);
    return;
  }
  const dtSec = Math.max(0, (ts - vmgPlotLastSampleTs) / 1000);
  if (dtSec <= 0) return;
  const baselineTau = vmgPlotTauSeconds;
  const fastTau = Math.max(0.05, baselineTau / 10);
  vmgPlotBaseline = applyFirstOrderFilter(vmgPlotBaseline, clamped, dtSec, baselineTau);
  vmgPlotFast = applyFirstOrderFilter(vmgPlotFast, clamped, dtSec, fastTau);
  const delta = clamp(vmgPlotFast - vmgPlotBaseline, -VMG_EVAL_MAX_GAIN, VMG_EVAL_MAX_GAIN);
  recordVmgPlotSample(delta, ts);
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
    const result = computeVmgChangePercent();
    const warmup = result ? result.warmup : true;
    setVmgWarmupState(warmup);
    if (result && Number.isFinite(result.percent)) {
      updateVmgPlotFilters(result.percent, sample.ts);
    } else if (!vmgPlotHistory.length) {
      updateVmgPlotFilters(0, sample.ts);
    }
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
    requestVmgPlotRender({ force: true });
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
  requestVmgPlotRender();
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
    syncVmgWindowUi();
  }
}

function setVmgMode(mode) {
  const normalized =
    mode === "reaching" || mode === "downwind" ? mode : "beating";
  vmgMode = normalized;
  if (els.vmgModeBeating) {
    els.vmgModeBeating.setAttribute(
      "aria-pressed",
      normalized === "beating" ? "true" : "false"
    );
  }
  if (els.vmgModeReaching) {
    els.vmgModeReaching.setAttribute(
      "aria-pressed",
      normalized === "reaching" ? "true" : "false"
    );
  }
  if (els.vmgModeDownwind) {
    els.vmgModeDownwind.setAttribute(
      "aria-pressed",
      normalized === "downwind" ? "true" : "false"
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
    const tauSeconds = clampVmgTauSeconds(els.vmgWindow.value);
    vmgPlotTauSeconds = tauSeconds;
    syncVmgWindowUi();
    const onWindowChange = () => {
      const nextTauSeconds = clampVmgTauSeconds(els.vmgWindow.value);
      vmgPlotTauSeconds = nextTauSeconds;
      syncVmgWindowUi();
      pruneVmgEvalHistory(Date.now() - getVmgEvalHistoryMs());
      requestVmgPlotRender({ force: true });
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

  if (els.vmgModeBeating || els.vmgModeReaching || els.vmgModeDownwind) {
    setVmgMode("beating");

    if (els.vmgModeBeating) {
      els.vmgModeBeating.addEventListener("click", () => {
        setVmgMode("beating");
      });
    }

    if (els.vmgModeReaching) {
      els.vmgModeReaching.addEventListener("click", () => {
        setVmgMode("reaching");
      });
    }

    if (els.vmgModeDownwind) {
      els.vmgModeDownwind.addEventListener("click", () => {
        setVmgMode("downwind");
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

  if (els.vmgDebugRefresh) {
    els.vmgDebugRefresh.addEventListener("click", () => {
      if (vmgDeps.hardReload) {
        vmgDeps.hardReload();
      }
    });
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
  };
}

export {
  initVmg,
  bindVmgEvents,
  getVmgSettingsSnapshot,
  updateVmgEstimate,
  updateVmgGpsState,
  requestVmgPlotRender,
  syncVmgWindowUi,
  resetVmgEstimator,
  resetVmgImuState,
  setVmgSettingsOpen,
  updateVmgImuToggle,
  enterVmgView,
  applyVmgImuSample,
};
