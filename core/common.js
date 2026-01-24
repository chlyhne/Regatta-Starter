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

function renderDeviationBarPlot(ctx, width, height, binValues, meanValue, options = {}) {
  if (!ctx || !Array.isArray(binValues) || !Number.isFinite(meanValue)) return;
  const binCount = binValues.length;
  if (!binCount) return;

  const activeIndex = Number.isFinite(options.activeIndex)
    ? options.activeIndex
    : binCount - 1;
  const deltaFn =
    typeof options.deltaFn === "function"
      ? options.deltaFn
      : (value, mean) => normalizeDeltaDegrees(value - mean);
  const scaleStep = Number.isFinite(options.scaleStep) ? options.scaleStep : 2;
  const gridStepSmall = Number.isFinite(options.gridStepSmall) ? options.gridStepSmall : 2;
  const gridStepLarge = Number.isFinite(options.gridStepLarge) ? options.gridStepLarge : 4;
  const gridStepThreshold = Number.isFinite(options.gridStepThreshold)
    ? options.gridStepThreshold
    : 6;
  const lineDash = Array.isArray(options.lineDash) ? options.lineDash : [6, 8];
  const padding = Number.isFinite(options.padding) ? options.padding : 10;

  const deltas = new Array(binCount).fill(null);
  let maxAbs = 0;
  const inactiveLimit = Math.min(activeIndex, binCount - 1);
  for (let i = 0; i < inactiveLimit; i += 1) {
    const value = binValues[i];
    if (!Number.isFinite(value)) continue;
    const delta = deltaFn(value, meanValue);
    if (!Number.isFinite(delta)) continue;
    deltas[i] = delta;
    maxAbs = Math.max(maxAbs, Math.abs(delta));
  }

  if (!Number.isFinite(maxAbs) || maxAbs <= 0) {
    maxAbs = scaleStep;
  } else {
    maxAbs = Math.max(scaleStep, Math.ceil(maxAbs / scaleStep) * scaleStep);
  }

  if (activeIndex >= 0 && activeIndex < binCount) {
    const activeValue = binValues[activeIndex];
    if (Number.isFinite(activeValue)) {
      let delta = deltaFn(activeValue, meanValue);
      if (Number.isFinite(delta)) {
        delta = clamp(delta, -maxAbs, maxAbs);
        deltas[activeIndex] = delta;
      }
    }
  }

  const centerX = width / 2;
  const maxBar = Math.max(1, centerX - padding);
  const xScale = maxBar / maxAbs;
  const stepY = height / binCount;
  const gap = Math.min(2, Math.max(0, stepY - 1));
  const barH = Math.max(1, stepY - gap);

  const gridStep = maxAbs >= gridStepThreshold ? gridStepLarge : gridStepSmall;
  const maxGrid = Math.floor(maxAbs / gridStep) * gridStep;
  if (maxGrid >= gridStep) {
    ctx.save();
    ctx.strokeStyle = "#000000";
    ctx.lineWidth = 2;
    ctx.setLineDash(lineDash);
    for (let value = gridStep; value <= maxGrid; value += gridStep) {
      const dx = value * xScale;
      const xLeft = centerX - dx;
      const xRight = centerX + dx;
      [xLeft, xRight].forEach((x) => {
        if (!Number.isFinite(x) || x < 0 || x > width) return;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();
      });
    }
    ctx.restore();
  }

  ctx.fillStyle = "#000000";
  for (let i = 0; i < binCount; i += 1) {
    const delta = deltas[i];
    if (!Number.isFinite(delta)) continue;
    const barLen = delta * xScale;
    const barW = Math.abs(barLen);
    const x = centerX + Math.min(0, barLen);
    const y = height - (i + 1) * stepY + gap / 2;
    ctx.fillRect(x, y, barW, barH);
  }

  ctx.save();
  ctx.strokeStyle = "#000000";
  ctx.lineWidth = 2;
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.moveTo(centerX, 0);
  ctx.lineTo(centerX, height);
  ctx.stroke();
  ctx.restore();
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
  resizeCanvasToCssPixels,
  renderDeviationBarPlot,
};
