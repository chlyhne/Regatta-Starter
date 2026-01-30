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
};
