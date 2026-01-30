import { els } from "../../ui/dom.js";
import { state } from "../../core/state.js";
import {
  normalizeHeadingDegrees,
  resizeCanvasToCssPixels,
  trimTrailingZeros,
  unwrapHeadingDegrees,
} from "../../core/common.js";
import {
  computeTickStep,
  drawLagTicks,
  drawLagTicksCentered,
  drawLine,
  drawXAxisTicks,
  drawStemPlot,
  drawTimeTicks,
  drawYAxisGrid,
  drawZeroLine,
  formatLagMinutes,
} from "../../core/plot.js";

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
const WIND_AUTOCORR_MINUTES_MIN = 0;
const WIND_AUTOCORR_MINUTES_MAX = 120;
const WIND_AUTOCORR_STEP_MINUTES = 10;
const WIND_PERIODOGRAM_MINUTES_MIN = 0;
const WIND_PERIODOGRAM_MINUTES_MAX = 120;
const WIND_PERIODOGRAM_STEP_MINUTES = 10;
const AUTO_CORR_MAX_POINTS = 600;
const AUTO_CORR_GAP_MULTIPLIER = 6;
const AUTO_CORR_DOT_SIZE = 4;
const PERIODOGRAM_MIN_PERIOD_SEC = 60;
const PERIODOGRAM_MIN_POINTS = 80;
const PERIODOGRAM_MAX_POINTS = 240;

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

function formatWindowMinutes(value) {
  const minutes = Number.parseInt(value, 10);
  if (!Number.isFinite(minutes)) return "--";
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

function snapAutoCorrMinutes(value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return WIND_AUTOCORR_MINUTES_MIN;
  const clamped = Math.min(
    WIND_AUTOCORR_MINUTES_MAX,
    Math.max(WIND_AUTOCORR_MINUTES_MIN, parsed)
  );
  const stepped =
    Math.round(clamped / WIND_AUTOCORR_STEP_MINUTES) * WIND_AUTOCORR_STEP_MINUTES;
  return Math.min(
    WIND_AUTOCORR_MINUTES_MAX,
    Math.max(WIND_AUTOCORR_MINUTES_MIN, stepped)
  );
}

function snapPeriodogramMinutes(value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return WIND_PERIODOGRAM_MINUTES_MIN;
  const clamped = Math.min(
    WIND_PERIODOGRAM_MINUTES_MAX,
    Math.max(WIND_PERIODOGRAM_MINUTES_MIN, parsed)
  );
  const stepped =
    Math.round(clamped / WIND_PERIODOGRAM_STEP_MINUTES) * WIND_PERIODOGRAM_STEP_MINUTES;
  return Math.min(
    WIND_PERIODOGRAM_MINUTES_MAX,
    Math.max(WIND_PERIODOGRAM_MINUTES_MIN, stepped)
  );
}

function resolveAutoCorrCapMinutes() {
  const fallback = Number.isFinite(state.windHistoryMinutes)
    ? state.windHistoryMinutes
    : WIND_HISTORY_MINUTES_MIN;
  const base = Number.isFinite(state.windAutoCorrMinutes)
    ? state.windAutoCorrMinutes
    : fallback;
  return snapAutoCorrMinutes(base);
}

function resolvePeriodogramCapMinutes() {
  const fallback = Number.isFinite(state.windAutoCorrMinutes)
    ? state.windAutoCorrMinutes
    : Number.isFinite(state.windHistoryMinutes)
      ? state.windHistoryMinutes
      : WIND_HISTORY_MINUTES_MIN;
  const base = Number.isFinite(state.windPeriodogramMinutes)
    ? state.windPeriodogramMinutes
    : fallback;
  return snapPeriodogramMinutes(base);
}

function buildWindUrl() {
  return `/wind?t=${Date.now()}`;
}

function getHistoryRequestMinutes() {
  return snapHistoryMinutes(state.windHistoryMinutes || WIND_HISTORY_MINUTES_MIN);
}

function buildWindHistoryUrl() {
  const minutes = getHistoryRequestMinutes();
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
  const minutes = getHistoryRequestMinutes();
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

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2) return sorted[mid];
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

function chooseAutoCorrStepMs(samples, windowMs) {
  const deltas = [];
  for (let i = 1; i < samples.length; i += 1) {
    const prev = samples[i - 1];
    const next = samples[i];
    if (!prev || !next) continue;
    const dt = next.ts - prev.ts;
    if (Number.isFinite(dt) && dt > 0) {
      deltas.push(dt);
    }
  }
  const medianDelta = median(deltas);
  const base = Number.isFinite(medianDelta) ? medianDelta : WIND_POLL_INTERVAL_MS;
  const maxStep = windowMs / AUTO_CORR_MAX_POINTS;
  const stepMs = Math.max(base, maxStep, 1000);
  return Math.min(stepMs, windowMs);
}

function buildUniformSeries(samples, key, startTs, endTs, stepMs) {
  if (!Number.isFinite(stepMs) || stepMs <= 0) return [];
  const usable = samples
    .filter((sample) => sample && Number.isFinite(sample.ts) && Number.isFinite(sample[key]))
    .sort((a, b) => a.ts - b.ts);
  if (!usable.length) return [];

  const values = [];
  let idx = 0;
  const maxGap = stepMs * AUTO_CORR_GAP_MULTIPLIER;

  for (let ts = startTs; ts <= endTs + 1; ts += stepMs) {
    while (idx < usable.length && usable[idx].ts < ts) {
      idx += 1;
    }
    const prev = idx > 0 ? usable[idx - 1] : null;
    const next = idx < usable.length ? usable[idx] : null;
    let value = null;

    if (prev && next) {
      const span = next.ts - prev.ts;
      if (Number.isFinite(span) && span > 0 && span <= maxGap) {
        const ratio = (ts - prev.ts) / span;
        value = prev[key] + (next[key] - prev[key]) * ratio;
      } else if (Math.abs(ts - prev.ts) <= stepMs) {
        value = prev[key];
      } else if (Math.abs(next.ts - ts) <= stepMs) {
        value = next[key];
      }
    } else if (prev && Math.abs(ts - prev.ts) <= stepMs) {
      value = prev[key];
    } else if (next && Math.abs(next.ts - ts) <= stepMs) {
      value = next[key];
    }

    values.push(Number.isFinite(value) ? value : null);
  }

  return values;
}

function buildIrregularSeries(samples, key, startTs, endTs) {
  return samples
    .filter(
      (sample) =>
        sample &&
        Number.isFinite(sample.ts) &&
        Number.isFinite(sample[key]) &&
        sample.ts >= startTs &&
        sample.ts <= endTs
    )
    .sort((a, b) => a.ts - b.ts)
    .map((sample) => ({ ts: sample.ts, value: sample[key] }));
}

function detrendSeries(values) {
  const indices = [];
  const vals = [];
  values.forEach((value, index) => {
    if (!Number.isFinite(value)) return;
    indices.push(index);
    vals.push(value);
  });
  if (!indices.length) return values;

  const count = indices.length;
  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumXX = 0;
  for (let i = 0; i < count; i += 1) {
    const x = indices[i];
    const y = vals[i];
    sumX += x;
    sumY += y;
    sumXY += x * y;
    sumXX += x * x;
  }
  const denom = count * sumXX - sumX * sumX;
  const slope = denom ? (count * sumXY - sumX * sumY) / denom : 0;
  const intercept = (sumY - slope * sumX) / count;

  return values.map((value, index) =>
    Number.isFinite(value) ? value - (intercept + slope * index) : null
  );
}

function detrendSeriesWithTimes(values, times) {
  const indices = [];
  const vals = [];
  values.forEach((value, index) => {
    const time = times[index];
    if (!Number.isFinite(value) || !Number.isFinite(time)) return;
    indices.push(time);
    vals.push(value);
  });
  if (!indices.length) return values;

  const offset = indices[0];
  const count = indices.length;
  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumXX = 0;
  for (let i = 0; i < count; i += 1) {
    const x = indices[i] - offset;
    const y = vals[i];
    sumX += x;
    sumY += y;
    sumXY += x * y;
    sumXX += x * x;
  }
  const denom = count * sumXX - sumX * sumX;
  const slope = denom ? (count * sumXY - sumX * sumY) / denom : 0;
  const intercept = (sumY - slope * sumX) / count;

  return values.map((value, index) => {
    const time = times[index];
    if (!Number.isFinite(value) || !Number.isFinite(time)) return null;
    return value - (intercept + slope * (time - offset));
  });
}

function centerSeries(values) {
  const finite = values.filter((value) => Number.isFinite(value));
  if (!finite.length) {
    return { values, mean: 0, variance: 0, count: 0 };
  }
  const mean = finite.reduce((sum, value) => sum + value, 0) / finite.length;
  let varianceSum = 0;
  const centered = values.map((value) => {
    if (!Number.isFinite(value)) return null;
    const delta = value - mean;
    varianceSum += delta * delta;
    return delta;
  });
  const variance = varianceSum / finite.length;
  return { values: centered, mean, variance, count: finite.length };
}

function computeAutoCorrelation(values, maxLagCount) {
  const detrended = detrendSeries(values);
  const valid = detrended.filter((value) => Number.isFinite(value));
  if (valid.length < 4) return null;
  const mean = valid.reduce((sum, value) => sum + value, 0) / valid.length;
  const centered = detrended.map((value) =>
    Number.isFinite(value) ? value - mean : null
  );
  let varianceSum = 0;
  centered.forEach((value) => {
    if (!Number.isFinite(value)) return;
    varianceSum += value * value;
  });
  if (!Number.isFinite(varianceSum) || varianceSum <= 1e-6) return null;

  const maxLag = Math.min(maxLagCount, values.length - 1);
  if (maxLag < 0) return null;
  const acf = [];

  for (let lag = 0; lag <= maxLag; lag += 1) {
    let sum = 0;
    let count = 0;
    for (let i = 0; i < centered.length - lag; i += 1) {
      const first = centered[i];
      const second = centered[i + lag];
      if (!Number.isFinite(first) || !Number.isFinite(second)) continue;
      sum += first * second;
      count += 1;
    }
    acf.push(count >= 2 ? sum / varianceSum : null);
  }
  if (acf.length) {
    acf[0] = 1;
  }
  return acf;
}

function computeCrossCorrelation(seriesA, seriesB, maxLagCount) {
  const detrendedA = detrendSeries(seriesA);
  const detrendedB = detrendSeries(seriesB);
  const validA = detrendedA.filter((value) => Number.isFinite(value));
  const validB = detrendedB.filter((value) => Number.isFinite(value));
  if (validA.length < 4 || validB.length < 4) return null;
  const meanA = validA.reduce((sum, value) => sum + value, 0) / validA.length;
  const meanB = validB.reduce((sum, value) => sum + value, 0) / validB.length;
  const maxLag = Math.min(
    maxLagCount,
    Math.max(0, detrendedA.length - 1),
    Math.max(0, detrendedB.length - 1)
  );
  if (maxLag < 0) return null;
  const values = [];

  for (let lag = -maxLag; lag <= maxLag; lag += 1) {
    let sum = 0;
    let count = 0;
    for (let i = 0; i < detrendedA.length; i += 1) {
      const j = i + lag;
      if (j < 0 || j >= detrendedB.length) continue;
      const first = detrendedA[i];
      const second = detrendedB[j];
      if (!Number.isFinite(first) || !Number.isFinite(second)) continue;
      sum += (first - meanA) * (second - meanB);
      count += 1;
    }
    values.push(count >= 2 ? sum / count : null);
  }
  return { values, maxLag };
}

function computeLombScarglePeriodogram(times, values, minFreq, maxFreq, pointCount, variance) {
  if (!Array.isArray(times) || !Array.isArray(values)) return [];
  if (!Number.isFinite(minFreq) || !Number.isFinite(maxFreq)) return [];
  if (minFreq <= 0 || maxFreq <= 0 || maxFreq <= minFreq) return [];
  if (!Number.isFinite(pointCount) || pointCount < 2) return [];

  const samples = [];
  const count = Math.max(2, Math.floor(pointCount));
  const step = (maxFreq - minFreq) / (count - 1);
  const useVariance = Number.isFinite(variance) && variance > 0 ? variance : null;

  for (let i = 0; i < count; i += 1) {
    const freq = minFreq + step * i;
    const omega = 2 * Math.PI * freq;
    let sumSin2 = 0;
    let sumCos2 = 0;
    for (let j = 0; j < times.length; j += 1) {
      const time = times[j];
      const value = values[j];
      if (!Number.isFinite(time) || !Number.isFinite(value)) continue;
      const angle = 2 * omega * time;
      sumSin2 += Math.sin(angle);
      sumCos2 += Math.cos(angle);
    }
    const tau = omega !== 0 ? Math.atan2(sumSin2, sumCos2) / (2 * omega) : 0;

    let sumC = 0;
    let sumS = 0;
    let sumCC = 0;
    let sumSS = 0;
    for (let j = 0; j < times.length; j += 1) {
      const time = times[j];
      const value = values[j];
      if (!Number.isFinite(time) || !Number.isFinite(value)) continue;
      const angle = omega * (time - tau);
      const cosVal = Math.cos(angle);
      const sinVal = Math.sin(angle);
      sumC += value * cosVal;
      sumS += value * sinVal;
      sumCC += cosVal * cosVal;
      sumSS += sinVal * sinVal;
    }

    let power = 0;
    if (sumCC > 1e-10) {
      power += (sumC * sumC) / sumCC;
    }
    if (sumSS > 1e-10) {
      power += (sumS * sumS) / sumSS;
    }
    power *= 0.5;
    if (useVariance) {
      power /= useVariance;
    }
    if (!Number.isFinite(power)) continue;
    samples.push({ frequency: freq, power });
  }
  return samples;
}

function formatCorrValue(value) {
  if (!Number.isFinite(value)) return "";
  const rounded = Math.round(value * 100) / 100;
  return trimTrailingZeros(rounded.toFixed(2));
}

function formatCovValue(value) {
  if (!Number.isFinite(value)) return "";
  const rounded = Math.round(value * 100) / 100;
  return trimTrailingZeros(rounded.toFixed(2));
}

function formatPowerValue(value) {
  if (!Number.isFinite(value)) return "";
  const rounded = Math.round(value * 100) / 100;
  return trimTrailingZeros(rounded.toFixed(2));
}

function buildLagSamples(acf, stepMs) {
  const samples = [];
  acf.forEach((value, index) => {
    if (!Number.isFinite(value)) return;
    const clamped = Math.max(-1, Math.min(1, value));
    samples.push({ ts: index * stepMs, value: clamped });
  });
  return samples;
}

function buildLagSamplesWithStart(values, stepMs, startLag) {
  const samples = [];
  values.forEach((value, index) => {
    if (!Number.isFinite(value)) return;
    const lag = startLag + index;
    samples.push({ ts: lag * stepMs, value });
  });
  return samples;
}

function getWindowSamples() {
  const windowMinutes = snapHistoryMinutes(state.windHistoryMinutes || WIND_HISTORY_MINUTES_MIN);
  const windowMs = windowMinutes * 60 * 1000;
  const startTs = Date.now() - windowMs;
  const endTs = startTs + windowMs;
  return {
    startTs,
    endTs,
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
  drawTimeTicks(ctx, rect, startTs, startTs + windowMs, windowMinutes, {
    font: WIND_PLOT_TIME_FONT,
  });

  drawLine(ctx, samples, "speed", rect, {
    min,
    max,
    startTs,
    windowMs,
    color: "#000000",
    lineWidth: WIND_PLOT_LINE_WIDTH,
  });
}

function drawPlotMessage(ctx, message) {
  ctx.fillStyle = "#000000";
  ctx.font = WIND_PLOT_LABEL_FONT;
  ctx.fillText(message, WIND_PLOT_PADDING, WIND_PLOT_PADDING + 12);
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
  drawTimeTicks(ctx, rect, startTs, startTs + windowMs, windowMinutes, {
    font: WIND_PLOT_TIME_FONT,
  });

  drawLine(ctx, samples, "dirUnwrapped", rect, {
    min,
    max,
    startTs,
    windowMs,
    color: "#000000",
    lineWidth: WIND_PLOT_LINE_WIDTH,
  });
}

function renderAutoCorrPlot(canvas, key, emptyLabel) {
  if (!document.body.classList.contains("racekbl-mode")) return;
  if (!canvas) return;
  const canvasInfo = resizeCanvasToCssPixels(canvas);
  if (!canvasInfo) return;
  const { ctx, width, height } = canvasInfo;

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);

  const { startTs, endTs, windowMs, windowMinutes, samples } = getWindowSamples();
  if (!samples.length) {
    drawPlotMessage(ctx, "Waiting for wind");
    return;
  }

  const hasData = samples.some((sample) => Number.isFinite(sample?.[key]));
  if (!hasData) {
    drawPlotMessage(ctx, emptyLabel);
    return;
  }

  const maxLagMinutes = resolveAutoCorrCapMinutes();
  const maxLagMs = Math.min(windowMs, maxLagMinutes * 60 * 1000);
  const stepMs = chooseAutoCorrStepMs(samples, maxLagMs);
  const maxLagCount = Math.floor(maxLagMs / stepMs);
  if (maxLagCount < 1) {
    drawPlotMessage(ctx, "Not enough data");
    return;
  }

  const series = buildUniformSeries(samples, key, startTs, endTs, stepMs);
  const acf = computeAutoCorrelation(series, maxLagCount);
  if (!acf || !acf.length) {
    drawPlotMessage(ctx, "Not enough data");
    return;
  }

  const rect = {
    left: WIND_PLOT_PADDING + WIND_PLOT_LABEL_GUTTER,
    right: width - WIND_PLOT_PADDING,
    top: WIND_PLOT_PADDING,
    bottom: height - WIND_PLOT_PADDING - WIND_PLOT_TIME_GUTTER,
  };

  const min = -1;
  const max = 1;
  const tickStep = computeTickStep(max - min, 0.25);
  drawYAxisGrid(ctx, rect, min, max, tickStep, formatCorrValue);
  const lagLabelMinutes = Math.min(windowMinutes, maxLagMinutes);
  drawLagTicks(ctx, rect, maxLagMs, lagLabelMinutes);

  const lagSamples = buildLagSamples(acf, stepMs);
  if (!lagSamples.length) {
    drawPlotMessage(ctx, "Not enough data");
    return;
  }

  drawStemPlot(ctx, lagSamples, rect, {
    min,
    max,
    startTs: 0,
    windowMs: maxLagMs,
    color: "#000000",
    lineWidth: 1,
    dotRadius: AUTO_CORR_DOT_SIZE / 2,
  });
  drawZeroLine(ctx, rect, min, max);
}

function renderCrossCorrPlot(canvas, keyA, keyB, emptyLabelA, emptyLabelB) {
  if (!document.body.classList.contains("racekbl-mode")) return;
  if (!canvas) return;
  const canvasInfo = resizeCanvasToCssPixels(canvas);
  if (!canvasInfo) return;
  const { ctx, width, height } = canvasInfo;

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);

  const { startTs, endTs, windowMs, windowMinutes, samples } = getWindowSamples();
  if (!samples.length) {
    drawPlotMessage(ctx, "Waiting for wind");
    return;
  }

  const hasA = samples.some((sample) => Number.isFinite(sample?.[keyA]));
  const hasB = samples.some((sample) => Number.isFinite(sample?.[keyB]));
  if (!hasA) {
    drawPlotMessage(ctx, emptyLabelA);
    return;
  }
  if (!hasB) {
    drawPlotMessage(ctx, emptyLabelB);
    return;
  }

  const maxLagMinutes = resolveAutoCorrCapMinutes();
  const maxLagMs = Math.min(windowMs, maxLagMinutes * 60 * 1000);
  const stepMs = chooseAutoCorrStepMs(samples, maxLagMs);
  const maxLagCount = Math.floor(maxLagMs / stepMs);
  if (maxLagCount < 1) {
    drawPlotMessage(ctx, "Not enough data");
    return;
  }

  const seriesA = buildUniformSeries(samples, keyA, startTs, endTs, stepMs);
  const seriesB = buildUniformSeries(samples, keyB, startTs, endTs, stepMs);
  const cross = computeCrossCorrelation(seriesA, seriesB, maxLagCount);
  if (!cross || !cross.values.length) {
    drawPlotMessage(ctx, "Not enough data");
    return;
  }

  const lagRangeMs = cross.maxLag * stepMs;
  if (!Number.isFinite(lagRangeMs) || lagRangeMs <= 0) {
    drawPlotMessage(ctx, "Not enough data");
    return;
  }

  const lagSamples = buildLagSamplesWithStart(cross.values, stepMs, -cross.maxLag);
  const finiteValues = lagSamples.map((sample) => sample.value).filter(Number.isFinite);
  if (!finiteValues.length) {
    drawPlotMessage(ctx, "Not enough data");
    return;
  }

  let min = Math.min(...finiteValues);
  let max = Math.max(...finiteValues);
  if (min === max) {
    const pad = Math.max(1, Math.abs(min) * 0.1);
    min -= pad;
    max += pad;
  } else {
    const pad = (max - min) * 0.1;
    min -= pad;
    max += pad;
  }

  const rect = {
    left: WIND_PLOT_PADDING + WIND_PLOT_LABEL_GUTTER,
    right: width - WIND_PLOT_PADDING,
    top: WIND_PLOT_PADDING,
    bottom: height - WIND_PLOT_PADDING - WIND_PLOT_TIME_GUTTER,
  };

  const range = max - min;
  const baseStep = range > 0 ? range / 4 : 1;
  const tickStep = computeTickStep(range, baseStep);
  drawYAxisGrid(ctx, rect, min, max, tickStep, formatCovValue);
  const lagLabelMinutes = Math.min(windowMinutes, maxLagMinutes);
  drawLagTicksCentered(ctx, rect, lagRangeMs, lagLabelMinutes);

  drawStemPlot(ctx, lagSamples, rect, {
    min,
    max,
    startTs: -lagRangeMs,
    windowMs: lagRangeMs * 2,
    color: "#000000",
    lineWidth: 1,
    dotRadius: AUTO_CORR_DOT_SIZE / 2,
  });
  drawZeroLine(ctx, rect, min, max);
}

function renderSpeedAutoCorrPlot() {
  renderAutoCorrPlot(els.raceKblSpeedAcfCanvas, "speed", "No speed data");
}

function renderDirAutoCorrPlot() {
  renderAutoCorrPlot(els.raceKblDirAcfCanvas, "dirUnwrapped", "No dir data");
}

function renderDirSpeedCrossCorrPlot() {
  renderCrossCorrPlot(
    els.raceKblXcorrDirSpeedCanvas,
    "dirUnwrapped",
    "speed",
    "No dir data",
    "No speed data"
  );
}

function renderSpeedPeriodogramPlot() {
  if (!document.body.classList.contains("racekbl-mode")) return;
  if (!els.raceKblSpeedPeriodogramCanvas) return;
  const canvasInfo = resizeCanvasToCssPixels(els.raceKblSpeedPeriodogramCanvas);
  if (!canvasInfo) return;
  const { ctx, width, height } = canvasInfo;

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);

  const { startTs, endTs, windowMs, windowMinutes, samples } = getWindowSamples();
  if (!samples.length) {
    drawPlotMessage(ctx, "Waiting for wind");
    return;
  }

  const series = buildIrregularSeries(samples, "speed", startTs, endTs);
  if (!series.length) {
    drawPlotMessage(ctx, "No speed data");
    return;
  }
  if (series.length < 4) {
    drawPlotMessage(ctx, "Not enough data");
    return;
  }

  const baseTs = series[0].ts;
  const times = [];
  const values = [];
  series.forEach((point) => {
    const time = (point.ts - baseTs) / 1000;
    if (!Number.isFinite(time) || !Number.isFinite(point.value)) return;
    times.push(time);
    values.push(point.value);
  });

  if (times.length < 4) {
    drawPlotMessage(ctx, "Not enough data");
    return;
  }

  const detrended = detrendSeriesWithTimes(values, times);
  const centered = centerSeries(detrended);
  if (centered.count < 4 || !Number.isFinite(centered.variance) || centered.variance <= 1e-6) {
    drawPlotMessage(ctx, "Not enough data");
    return;
  }

  const deltas = [];
  for (let i = 1; i < times.length; i += 1) {
    const dt = times[i] - times[i - 1];
    if (Number.isFinite(dt) && dt > 0) {
      deltas.push(dt);
    }
  }
  const medianDelta = median(deltas);
  const baseDelta = Number.isFinite(medianDelta)
    ? medianDelta
    : WIND_POLL_INTERVAL_MS / 1000;
  const minPeriodSec = Math.max(PERIODOGRAM_MIN_PERIOD_SEC, baseDelta * 2);
  const maxPeriodCapMinutes = resolvePeriodogramCapMinutes();
  const maxPeriodSec = Math.min(windowMs / 1000, maxPeriodCapMinutes * 60);
  if (!Number.isFinite(maxPeriodSec) || maxPeriodSec <= minPeriodSec) {
    drawPlotMessage(ctx, "Not enough data");
    return;
  }

  const minFreq = 1 / maxPeriodSec;
  const maxFreq = 1 / minPeriodSec;
  const pointCount = Math.min(
    PERIODOGRAM_MAX_POINTS,
    Math.max(PERIODOGRAM_MIN_POINTS, Math.round(windowMinutes * 2))
  );
  const spectrum = computeLombScarglePeriodogram(
    times,
    centered.values,
    minFreq,
    maxFreq,
    pointCount,
    centered.variance
  );
  if (!spectrum.length) {
    drawPlotMessage(ctx, "Not enough data");
    return;
  }

  const minPeriodMinutes = minPeriodSec / 60;
  const maxPeriodMinutes = maxPeriodSec / 60;
  const periodSamples = spectrum
    .map(({ frequency, power }) => ({
      ts: 1 / frequency / 60,
      value: power,
    }))
    .filter(
      (sample) =>
        Number.isFinite(sample.ts) &&
        Number.isFinite(sample.value) &&
        sample.ts >= minPeriodMinutes &&
        sample.ts <= maxPeriodMinutes
    )
    .sort((a, b) => a.ts - b.ts);

  if (!periodSamples.length) {
    drawPlotMessage(ctx, "Not enough data");
    return;
  }

  const powerValues = periodSamples.map((sample) => sample.value).filter(Number.isFinite);
  if (!powerValues.length) {
    drawPlotMessage(ctx, "Not enough data");
    return;
  }

  let min = 0;
  let max = Math.max(...powerValues);
  if (!Number.isFinite(max) || max <= 0) {
    max = 1;
  } else {
    max *= 1.1;
  }

  const rect = {
    left: WIND_PLOT_PADDING + WIND_PLOT_LABEL_GUTTER,
    right: width - WIND_PLOT_PADDING,
    top: WIND_PLOT_PADDING,
    bottom: height - WIND_PLOT_PADDING - WIND_PLOT_TIME_GUTTER,
  };

  const yStep = computeTickStep(max - min, Math.max(0.1, max / 4));
  drawYAxisGrid(ctx, rect, min, max, yStep, formatPowerValue);
  const periodRange = maxPeriodMinutes - minPeriodMinutes;
  const xStep = computeTickStep(periodRange, 5);
  drawXAxisTicks(ctx, rect, minPeriodMinutes, maxPeriodMinutes, xStep, formatLagMinutes, {
    font: WIND_PLOT_TIME_FONT,
  });

  drawStemPlot(ctx, periodSamples, rect, {
    min,
    max,
    startTs: minPeriodMinutes,
    windowMs: maxPeriodMinutes - minPeriodMinutes,
    color: "#000000",
    lineWidth: 1,
    dotRadius: AUTO_CORR_DOT_SIZE / 2,
  });
  drawZeroLine(ctx, rect, min, max);
}

function renderRaceKblPlots() {
  renderSpeedPlot();
  renderDirectionPlot();
  renderSpeedAutoCorrPlot();
  renderDirAutoCorrPlot();
  renderDirSpeedCrossCorrPlot();
  renderSpeedPeriodogramPlot();
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
  const autoMinutes = resolveAutoCorrCapMinutes();
  if (autoMinutes !== state.windAutoCorrMinutes) {
    state.windAutoCorrMinutes = autoMinutes;
  }
  if (els.raceKblAutoCorr) {
    els.raceKblAutoCorr.value = String(autoMinutes);
  }
  if (els.raceKblAutoCorrValue) {
    els.raceKblAutoCorrValue.textContent = formatWindowMinutes(autoMinutes);
  }
  const periodMinutes = resolvePeriodogramCapMinutes();
  if (periodMinutes !== state.windPeriodogramMinutes) {
    state.windPeriodogramMinutes = periodMinutes;
  }
  if (els.raceKblPeriodogram) {
    els.raceKblPeriodogram.value = String(periodMinutes);
  }
  if (els.raceKblPeriodogramValue) {
    els.raceKblPeriodogramValue.textContent = formatWindowMinutes(periodMinutes);
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
  const requiredHours = Math.max(1, Math.ceil(getHistoryRequestMinutes() / 60));
  if (requiredHours > historyLoadedHours && document.body.classList.contains("racekbl-mode")) {
    fetchWindHistory();
    return;
  }
  updateRaceKblUi();
}

function setAutoCorrWindow(minutes) {
  const clamped = snapAutoCorrMinutes(minutes);
  state.windAutoCorrMinutes = clamped;
  if (raceKblDeps.saveSettings) {
    raceKblDeps.saveSettings();
  }
  if (els.raceKblAutoCorr) {
    els.raceKblAutoCorr.value = String(clamped);
  }
  if (els.raceKblAutoCorrValue) {
    els.raceKblAutoCorrValue.textContent = formatWindowMinutes(clamped);
  }
  const requiredHours = Math.max(1, Math.ceil(getHistoryRequestMinutes() / 60));
  if (requiredHours > historyLoadedHours && document.body.classList.contains("racekbl-mode")) {
    fetchWindHistory();
    return;
  }
  updateRaceKblUi();
}

function setPeriodogramWindow(minutes) {
  const clamped = snapPeriodogramMinutes(minutes);
  state.windPeriodogramMinutes = clamped;
  if (raceKblDeps.saveSettings) {
    raceKblDeps.saveSettings();
  }
  if (els.raceKblPeriodogram) {
    els.raceKblPeriodogram.value = String(clamped);
  }
  if (els.raceKblPeriodogramValue) {
    els.raceKblPeriodogramValue.textContent = formatWindowMinutes(clamped);
  }
  const requiredHours = Math.max(1, Math.ceil(getHistoryRequestMinutes() / 60));
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
  if (els.raceKblAutoCorr) {
    els.raceKblAutoCorr.addEventListener("input", () => {
      setAutoCorrWindow(els.raceKblAutoCorr.value);
    });
  }
  if (els.raceKblPeriodogram) {
    els.raceKblPeriodogram.addEventListener("input", () => {
      setPeriodogramWindow(els.raceKblPeriodogram.value);
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
