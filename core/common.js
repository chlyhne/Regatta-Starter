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

function renderSignedLinePlot(ctx, options = {}) {
  if (!ctx) return null;
  const samples = Array.isArray(options.samples) ? options.samples : [];
  if (!samples.length) return null;
  const rect = options.rect || {};
  const left = Number.isFinite(rect.left) ? rect.left : 0;
  const right = Number.isFinite(rect.right) ? rect.right : 0;
  const top = Number.isFinite(rect.top) ? rect.top : 0;
  const bottom = Number.isFinite(rect.bottom) ? rect.bottom : 0;
  const width = Math.max(0, right - left);
  const height = Math.max(0, bottom - top);
  if (width <= 0 || height <= 0) return null;

  const startTs = Number.isFinite(options.startTs) ? options.startTs : 0;
  const endTs = Number.isFinite(options.endTs) ? options.endTs : 0;
  const windowMs = endTs - startTs;
  if (!Number.isFinite(windowMs) || windowMs <= 0) return null;

  let maxAbs = 0;
  samples.forEach((sample) => {
    if (!sample || !Number.isFinite(sample.value)) return;
    maxAbs = Math.max(maxAbs, Math.abs(sample.value));
  });

  const scaleStep = Number.isFinite(options.scaleStep) ? options.scaleStep : 2;
  if (!Number.isFinite(maxAbs) || maxAbs <= 0) {
    maxAbs = Math.max(scaleStep, 1);
  } else if (scaleStep > 0) {
    maxAbs = Math.max(scaleStep, Math.ceil(maxAbs / scaleStep) * scaleStep);
  }

  const orientation = options.orientation === "vertical" ? "vertical" : "horizontal";
  const padding = Number.isFinite(options.padding) ? options.padding : 10;
  const minHalfExtent = Number.isFinite(options.minHalfExtent) ? options.minHalfExtent : 1;
  const centerX = left + width / 2;
  const centerY = top + height / 2;
  const halfExtent = orientation === "horizontal" ? height / 2 : width / 2;
  const maxBar = Math.max(minHalfExtent, halfExtent - padding);
  const scale = maxBar / maxAbs;

  const showGrid = options.showGrid !== false;
  const gridStepSmall = Number.isFinite(options.gridStepSmall) ? options.gridStepSmall : 2;
  const gridStepLarge = Number.isFinite(options.gridStepLarge) ? options.gridStepLarge : 4;
  const gridStepThreshold = Number.isFinite(options.gridStepThreshold)
    ? options.gridStepThreshold
    : 6;
  const gridDash = Array.isArray(options.gridDash) ? options.gridDash : [6, 8];
  const gridStep = maxAbs >= gridStepThreshold ? gridStepLarge : gridStepSmall;
  const maxGrid = gridStep > 0 ? Math.floor(maxAbs / gridStep) * gridStep : 0;

  const colors = options.colors || {};
  const fg = colors.fg || "#000000";
  const posFill = colors.posFill || "rgba(0, 120, 0, 0.25)";
  const negFill = colors.negFill || "rgba(160, 0, 0, 0.25)";
  const posLine = colors.posLine || posFill || fg;
  const negLine = colors.negLine || negFill || fg;
  const lineWidth = Number.isFinite(options.lineWidth) ? options.lineWidth : 2;
  const zeroLineWidth = Number.isFinite(options.zeroLineWidth) ? options.zeroLineWidth : 2;
  const pointSize = Number.isFinite(options.pointSize) ? options.pointSize : 4;

  if (showGrid && maxGrid >= gridStep) {
    ctx.save();
    ctx.strokeStyle = fg;
    ctx.lineWidth = lineWidth;
    ctx.setLineDash(gridDash);
    for (let value = gridStep; value <= maxGrid; value += gridStep) {
      const offset = value * scale;
      if (orientation === "horizontal") {
        const yUp = centerY - offset;
        const yDown = centerY + offset;
        [yUp, yDown].forEach((y) => {
          if (!Number.isFinite(y) || y < top || y > bottom) return;
          ctx.beginPath();
          ctx.moveTo(left, y);
          ctx.lineTo(right, y);
          ctx.stroke();
        });
      } else {
        const xLeft = centerX - offset;
        const xRight = centerX + offset;
        [xLeft, xRight].forEach((x) => {
          if (!Number.isFinite(x) || x < left || x > right) return;
          ctx.beginPath();
          ctx.moveTo(x, top);
          ctx.lineTo(x, bottom);
          ctx.stroke();
        });
      }
    }
    ctx.restore();
  }

  const points = [];
  samples.forEach((sample) => {
    if (!sample || !Number.isFinite(sample.value) || !Number.isFinite(sample.ts)) return;
    const t = clamp((sample.ts - startTs) / windowMs, 0, 1);
    if (orientation === "horizontal") {
      const x = left + t * width;
      const y = centerY - sample.value * scale;
      points.push({ x, y, value: sample.value });
    } else {
      const y = bottom - t * height;
      const x = centerX + sample.value * scale;
      points.push({ x, y, value: sample.value });
    }
  });

  const fillSide = (sign, fillStyle) => {
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
          if (orientation === "horizontal") {
            ctx.moveTo(point.x, centerY);
          } else {
            ctx.moveTo(centerX, point.y);
          }
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
        if (orientation === "horizontal") {
          const xCross = prev.x + clamp(tCross, 0, 1) * (point.x - prev.x);
          ctx.lineTo(xCross, centerY);
        } else {
          const yCross = prev.y + clamp(tCross, 0, 1) * (point.y - prev.y);
          ctx.lineTo(centerX, yCross);
        }
        ctx.closePath();
        started = false;
        continue;
      }

      if (!wasOnSide && isOnSide) {
        const denom = prev.value - point.value;
        const tCross = Number.isFinite(denom) && denom !== 0 ? prev.value / denom : 0;
        if (orientation === "horizontal") {
          const xCross = prev.x + clamp(tCross, 0, 1) * (point.x - prev.x);
          ctx.moveTo(xCross, centerY);
        } else {
          const yCross = prev.y + clamp(tCross, 0, 1) * (point.y - prev.y);
          ctx.moveTo(centerX, yCross);
        }
        ctx.lineTo(point.x, point.y);
        started = true;
      }
    }
    if (started) {
      const last = points[points.length - 1];
      if (orientation === "horizontal") {
        ctx.lineTo(last.x, centerY);
      } else {
        ctx.lineTo(centerX, last.y);
      }
      ctx.closePath();
    }
    ctx.fill();
    ctx.restore();
  };

  fillSide(1, posFill);
  fillSide(-1, negFill);

  const lineBySign = options.lineBySign === true;
  ctx.save();
  ctx.lineWidth = lineWidth;
  ctx.setLineDash([]);
  if (lineBySign) {
    for (let i = 1; i < points.length; i += 1) {
      const prev = points[i - 1];
      const next = points[i];
      if (!prev || !next) continue;
      if (!Number.isFinite(prev.x) || !Number.isFinite(prev.y)) continue;
      if (!Number.isFinite(next.x) || !Number.isFinite(next.y)) continue;
      const prevPos = prev.value >= 0;
      const nextPos = next.value >= 0;
      if (prevPos === nextPos) {
        ctx.strokeStyle = prevPos ? posLine : negLine;
        ctx.beginPath();
        ctx.moveTo(prev.x, prev.y);
        ctx.lineTo(next.x, next.y);
        ctx.stroke();
        continue;
      }
      const denom = prev.value - next.value;
      const tCross = Number.isFinite(denom) && denom !== 0 ? prev.value / denom : 0;
      if (orientation === "horizontal") {
        const xCross = prev.x + clamp(tCross, 0, 1) * (next.x - prev.x);
        ctx.strokeStyle = prevPos ? posLine : negLine;
        ctx.beginPath();
        ctx.moveTo(prev.x, prev.y);
        ctx.lineTo(xCross, centerY);
        ctx.stroke();
        ctx.strokeStyle = nextPos ? posLine : negLine;
        ctx.beginPath();
        ctx.moveTo(xCross, centerY);
        ctx.lineTo(next.x, next.y);
        ctx.stroke();
      } else {
        const yCross = prev.y + clamp(tCross, 0, 1) * (next.y - prev.y);
        ctx.strokeStyle = prevPos ? posLine : negLine;
        ctx.beginPath();
        ctx.moveTo(prev.x, prev.y);
        ctx.lineTo(centerX, yCross);
        ctx.stroke();
        ctx.strokeStyle = nextPos ? posLine : negLine;
        ctx.beginPath();
        ctx.moveTo(centerX, yCross);
        ctx.lineTo(next.x, next.y);
        ctx.stroke();
      }
    }
  } else {
    ctx.strokeStyle = fg;
    ctx.beginPath();
    let started = false;
    let lastX = null;
    let lastY = null;
    points.forEach((point) => {
      if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return;
      lastX = point.x;
      lastY = point.y;
      if (!started) {
        ctx.moveTo(point.x, point.y);
        started = true;
      } else {
        ctx.lineTo(point.x, point.y);
      }
    });
    if (started) {
      ctx.stroke();
      if (points.length === 1 && Number.isFinite(lastX) && Number.isFinite(lastY)) {
        const halfPoint = pointSize / 2;
        ctx.fillStyle = fg;
        ctx.fillRect(lastX - halfPoint, lastY - halfPoint, pointSize, pointSize);
      }
    }
  }
  ctx.restore();

  ctx.save();
  ctx.strokeStyle = fg;
  ctx.lineWidth = zeroLineWidth;
  ctx.setLineDash([]);
  ctx.beginPath();
  if (orientation === "horizontal") {
    ctx.moveTo(left, centerY);
    ctx.lineTo(right, centerY);
  } else {
    ctx.moveTo(centerX, top);
    ctx.lineTo(centerX, bottom);
  }
  ctx.stroke();
  ctx.restore();

  return {
    maxAbs,
    scale,
    centerX,
    centerY,
    gridStep,
    maxGrid,
  };
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
  renderSignedLinePlot,
};
