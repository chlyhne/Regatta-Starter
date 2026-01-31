import { toRadians } from "./geo.js";

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function normalizeDeltaDegrees(delta) {
  let wrapped = (delta + 540) % 360;
  wrapped -= 180;
  return wrapped;
}

function normalizeAngleRad(angle) {
  let wrapped = angle % (2 * Math.PI);
  if (wrapped < 0) wrapped += 2 * Math.PI;
  return wrapped;
}

function normalizeDeltaRad(delta) {
  let wrapped = (delta + Math.PI) % (2 * Math.PI);
  if (wrapped < 0) wrapped += 2 * Math.PI;
  return wrapped - Math.PI;
}

function headingRadToDegrees(headingRad) {
  if (!Number.isFinite(headingRad)) return null;
  const deg = (headingRad * 180) / Math.PI;
  let wrapped = deg % 360;
  if (wrapped < 0) wrapped += 360;
  return wrapped;
}

function unwrapHeadingDegrees(heading, lastHeading, lastUnwrapped) {
  if (!Number.isFinite(heading)) return null;
  if (!Number.isFinite(lastHeading) || !Number.isFinite(lastUnwrapped)) {
    return heading;
  }
  const delta = normalizeDeltaDegrees(heading - lastHeading);
  return lastUnwrapped + delta;
}

function headingFromVelocity(velocity) {
  if (!velocity || !Number.isFinite(velocity.x) || !Number.isFinite(velocity.y)) {
    return null;
  }
  const headingRad = Math.atan2(velocity.x, velocity.y);
  if (!Number.isFinite(headingRad)) return null;
  const headingDeg = (headingRad * 180) / Math.PI;
  return headingDeg < 0 ? headingDeg + 360 : headingDeg;
}

function formatWindowSeconds(seconds) {
  const safe = Math.max(0, Math.round(seconds || 0));
  if (safe < 90) return `${safe} s`;
  const minutes = Math.round(safe / 60);
  return `${minutes} min`;
}

function trimTrailingZeros(value) {
  if (!value.includes(".")) return value;
  return value.replace(/\.?0+$/, "");
}

function normalizeHeadingDegrees(degrees) {
  if (!Number.isFinite(degrees)) return null;
  let wrapped = degrees % 360;
  if (wrapped < 0) wrapped += 360;
  return wrapped;
}

function meanHeadingDegreesFromSinCos(sumSin, sumCos) {
  if (!Number.isFinite(sumSin) || !Number.isFinite(sumCos)) return null;
  if (sumSin === 0 && sumCos === 0) return null;
  const meanRad = Math.atan2(sumSin, sumCos);
  return normalizeHeadingDegrees((meanRad * 180) / Math.PI);
}

function circularMeanDegrees(angles) {
  if (!angles || !angles.length) return null;
  let sumSin = 0;
  let sumCos = 0;
  let count = 0;
  angles.forEach((deg) => {
    if (!Number.isFinite(deg)) return;
    const rad = toRadians(deg);
    sumSin += Math.sin(rad);
    sumCos += Math.cos(rad);
    count += 1;
  });
  if (!count) return null;
  return meanHeadingDegreesFromSinCos(sumSin, sumCos);
}

function median(values) {
  if (!Array.isArray(values) || !values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2) return sorted[mid];
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

function fitLinearTrend(times, values) {
  const points = [];
  for (let i = 0; i < times.length; i += 1) {
    const time = times[i];
    const value = values[i];
    if (!Number.isFinite(time) || !Number.isFinite(value)) continue;
    points.push({ time, value });
  }
  if (!points.length) {
    return { slope: 0, intercept: 0, offset: Number.isFinite(times[0]) ? times[0] : 0, count: 0 };
  }

  const offset = points[0].time;
  const count = points.length;
  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumXX = 0;
  for (let i = 0; i < count; i += 1) {
    const x = points[i].time - offset;
    const y = points[i].value;
    sumX += x;
    sumY += y;
    sumXY += x * y;
    sumXX += x * x;
  }
  const denom = count * sumXX - sumX * sumX;
  const slope = denom ? (count * sumXY - sumX * sumY) / denom : 0;
  const intercept = (sumY - slope * sumX) / count;
  return { slope, intercept, offset, count };
}

function evaluateTrend(trend, time) {
  if (!trend || !Number.isFinite(time)) return 0;
  const slope = Number.isFinite(trend.slope) ? trend.slope : 0;
  const intercept = Number.isFinite(trend.intercept) ? trend.intercept : 0;
  const offset = Number.isFinite(trend.offset) ? trend.offset : 0;
  return intercept + slope * (time - offset);
}

function solveLinearSystem(matrix, vector) {
  const size = vector.length;
  const a = matrix.map((row) => row.slice());
  const b = vector.slice();

  for (let i = 0; i < size; i += 1) {
    let pivotRow = i;
    let pivotValue = Math.abs(a[i][i]);
    for (let r = i + 1; r < size; r += 1) {
      const value = Math.abs(a[r][i]);
      if (value > pivotValue) {
        pivotValue = value;
        pivotRow = r;
      }
    }
    if (pivotValue <= 1e-12) return null;
    if (pivotRow !== i) {
      [a[i], a[pivotRow]] = [a[pivotRow], a[i]];
      [b[i], b[pivotRow]] = [b[pivotRow], b[i]];
    }
    const pivot = a[i][i];
    for (let c = i; c < size; c += 1) {
      a[i][c] /= pivot;
    }
    b[i] /= pivot;
    for (let r = i + 1; r < size; r += 1) {
      const factor = a[r][i];
      if (factor === 0) continue;
      for (let c = i; c < size; c += 1) {
        a[r][c] -= factor * a[i][c];
      }
      b[r] -= factor * b[i];
    }
  }

  const solution = new Array(size).fill(0);
  for (let i = size - 1; i >= 0; i -= 1) {
    let sum = b[i];
    for (let c = i + 1; c < size; c += 1) {
      sum -= a[i][c] * solution[c];
    }
    solution[i] = sum;
  }
  return solution;
}

function resizeCanvasToCssPixels(canvas) {
  if (!canvas) return null;
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(1, rect.width || 0);
  const height = Math.max(1, rect.height || 0);
  const dpr = window.devicePixelRatio || 1;
  const targetWidth = Math.max(1, Math.round(width * dpr));
  const targetHeight = Math.max(1, Math.round(height * dpr));
  if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
    canvas.width = targetWidth;
    canvas.height = targetHeight;
  }
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, width, height };
}

export {
  clamp,
  normalizeDeltaDegrees,
  normalizeAngleRad,
  normalizeDeltaRad,
  headingRadToDegrees,
  unwrapHeadingDegrees,
  headingFromVelocity,
  formatWindowSeconds,
  trimTrailingZeros,
  normalizeHeadingDegrees,
  meanHeadingDegreesFromSinCos,
  circularMeanDegrees,
  median,
  fitLinearTrend,
  evaluateTrend,
  solveLinearSystem,
  resizeCanvasToCssPixels,
};
