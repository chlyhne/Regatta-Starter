import { clamp, normalizeDeltaDegrees } from "./common.js";

const DEFAULT_TIME_TICK_OPTIONS_MIN = [5, 15, 20, 30, 60, 120, 240, 360];
const DEFAULT_TIME_TICK_TARGET = 7;

function computeTickStep(range, baseStep) {
  let step = baseStep;
  if (!Number.isFinite(range) || range <= 0) return step;
  let lines = Math.floor(range / step) + 1;
  while (lines >= 7) {
    step *= 2;
    lines = Math.floor(range / step) + 1;
  }
  return step;
}

function drawLine(ctx, samples, key, rect, options = {}) {
  const values = samples.filter((sample) => Number.isFinite(sample?.[key]));
  if (!values.length) return;
  const min = options.min;
  const max = options.max;
  if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) return;
  const width = rect.right - rect.left;
  const height = rect.bottom - rect.top;
  if (width <= 0 || height <= 0) return;
  const startTs = options.startTs;
  const windowMs = options.windowMs;
  if (!Number.isFinite(startTs) || !Number.isFinite(windowMs) || windowMs <= 0) return;
  const range = max - min;
  const mapX = (ts) => rect.left + ((ts - startTs) / windowMs) * width;
  const mapY = (value) => rect.bottom - ((value - min) / range) * height;

  ctx.save();
  ctx.strokeStyle = options.color || "#000000";
  ctx.lineWidth = Number.isFinite(options.lineWidth) ? options.lineWidth : 2;
  ctx.setLineDash(options.dash || []);
  ctx.beginPath();
  let started = false;
  samples.forEach((sample) => {
    if (!sample || !Number.isFinite(sample.ts) || !Number.isFinite(sample[key])) return;
    const x = mapX(sample.ts);
    const y = mapY(sample[key]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    if (!started) {
      ctx.moveTo(x, y);
      started = true;
    } else {
      ctx.lineTo(x, y);
    }
  });
  ctx.stroke();
  ctx.restore();
}

function drawStemPlot(ctx, samples, rect, options = {}) {
  const min = options.min;
  const max = options.max;
  if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) return;
  const width = rect.right - rect.left;
  const height = rect.bottom - rect.top;
  if (width <= 0 || height <= 0) return;
  const startTs = options.startTs;
  const windowMs = options.windowMs;
  if (!Number.isFinite(startTs) || !Number.isFinite(windowMs) || windowMs <= 0) return;
  const range = max - min;
  const mapX = (ts) => rect.left + ((ts - startTs) / windowMs) * width;
  const mapY = (value) => rect.bottom - ((value - min) / range) * height;
  const baseY = mapY(0);
  if (!Number.isFinite(baseY)) return;
  const color = options.color || "#000000";
  const dotRadius =
    Number.isFinite(options.dotRadius) && options.dotRadius > 0 ? options.dotRadius : 2;

  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = Number.isFinite(options.lineWidth) ? options.lineWidth : 1;
  ctx.setLineDash([]);

  samples.forEach((sample) => {
    if (!sample || !Number.isFinite(sample.ts) || !Number.isFinite(sample.value)) return;
    const x = mapX(sample.ts);
    const y = mapY(sample.value);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    ctx.beginPath();
    ctx.moveTo(x, baseY);
    ctx.lineTo(x, y);
    ctx.stroke();
    if (dotRadius > 0) {
      ctx.beginPath();
      ctx.arc(x, y, dotRadius, 0, Math.PI * 2);
      ctx.fill();
    }
  });

  ctx.restore();
}

function drawYAxisGrid(ctx, rect, min, max, step, labelFn, options = {}) {
  if (!Number.isFinite(min) || !Number.isFinite(max) || !Number.isFinite(step)) return;
  if (min === max) return;
  const range = max - min;
  const mapY = (value) => rect.bottom - ((value - min) / range) * (rect.bottom - rect.top);
  const firstTick = Math.ceil(min / step) * step;

  const ticks = [];
  let maxLabelWidth = 0;
  ctx.save();
  ctx.font = options.font || "12px sans-serif";
  for (let value = firstTick; value <= max + 1e-6; value += step) {
    const y = mapY(value);
    if (!Number.isFinite(y)) continue;
    const label = typeof labelFn === "function" ? String(labelFn(value)) : "";
    if (label) {
      const width = ctx.measureText(label).width || 0;
      maxLabelWidth = Math.max(maxLabelWidth, width);
    }
    ticks.push({ y, label });
  }
  const labelPadding = Number.isFinite(options.labelPadding) ? options.labelPadding : 6;
  const labelGap = Number.isFinite(options.labelGap) ? options.labelGap : 2;
  const labelX = Math.max(rect.left - labelPadding, maxLabelWidth + labelGap);

  ctx.strokeStyle = options.color || "#000000";
  ctx.lineWidth = Number.isFinite(options.lineWidth) ? options.lineWidth : 1;
  ctx.setLineDash(options.dash || [4, 6]);
  ctx.fillStyle = options.color || "#000000";
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";

  ticks.forEach((tick) => {
    ctx.beginPath();
    ctx.moveTo(rect.left, tick.y);
    ctx.lineTo(rect.right, tick.y);
    ctx.stroke();
    if (tick.label) {
      ctx.fillText(tick.label, labelX, tick.y);
    }
  });
  ctx.restore();
}

function chooseTimeTickMinutes(windowMinutes, options = {}) {
  const safe = Math.max(1, windowMinutes);
  const tickOptions = Array.isArray(options.tickOptions)
    ? options.tickOptions
    : DEFAULT_TIME_TICK_OPTIONS_MIN;
  const target = Number.isFinite(options.target) ? options.target : DEFAULT_TIME_TICK_TARGET;
  let best = tickOptions[0];
  let bestDiff = Infinity;
  tickOptions.forEach((candidate) => {
    const count = Math.floor(safe / candidate) + 1;
    const diff = Math.abs(count - target);
    if (diff < bestDiff || (diff === bestDiff && candidate > best)) {
      bestDiff = diff;
      best = candidate;
    }
  });
  return best;
}

function formatTimeTickLabel(ts) {
  const date = new Date(ts);
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${hours}:${minutes}`;
}

function drawTimeTicks(ctx, rect, startTs, endTs, windowMinutes, options = {}) {
  if (!Number.isFinite(startTs) || !Number.isFinite(endTs)) return;
  const windowMs = endTs - startTs;
  if (!Number.isFinite(windowMs) || windowMs <= 0) return;

  const tickMinutes = chooseTimeTickMinutes(windowMinutes, options);
  const tickMs = tickMinutes * 60 * 1000;
  if (!Number.isFinite(tickMs) || tickMs <= 0) return;

  const firstTick = Math.ceil(startTs / tickMs) * tickMs;
  const width = rect.right - rect.left;
  if (width <= 0) return;

  ctx.save();
  ctx.strokeStyle = options.color || "#000000";
  ctx.lineWidth = Number.isFinite(options.lineWidth) ? options.lineWidth : 1;
  ctx.setLineDash(options.dash || [4, 6]);
  ctx.fillStyle = options.color || "#000000";
  ctx.font = options.font || "12px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "top";

  const labelOffset = Number.isFinite(options.labelOffset) ? options.labelOffset : 6;
  for (let ts = firstTick; ts <= endTs + 1; ts += tickMs) {
    const x = rect.left + ((ts - startTs) / windowMs) * width;
    if (!Number.isFinite(x)) continue;
    const label = formatTimeTickLabel(ts);
    const labelWidth = ctx.measureText(label).width || 0;
    const half = labelWidth / 2;
    if (x - half < rect.left || x + half > rect.right) {
      continue;
    }
    ctx.beginPath();
    ctx.moveTo(x, rect.top);
    ctx.lineTo(x, rect.bottom);
    ctx.stroke();
    ctx.fillText(label, x, rect.bottom + labelOffset);
  }
  ctx.restore();
}

function formatLagMinutes(minutes) {
  if (!Number.isFinite(minutes)) return "";
  if (minutes < 60) return `${Math.round(minutes)}m`;
  if (minutes % 60 === 0) return `${Math.round(minutes / 60)}h`;
  return `${Math.round(minutes)}m`;
}

function formatLagMinutesSigned(minutes) {
  if (!Number.isFinite(minutes)) return "";
  if (minutes === 0) return "0";
  const sign = minutes < 0 ? "-" : "";
  return `${sign}${formatLagMinutes(Math.abs(minutes))}`;
}

function drawLagTicks(ctx, rect, maxLagMs, maxLagMinutes, options = {}) {
  if (!Number.isFinite(maxLagMs) || maxLagMs <= 0) return;
  const tickMinutes = chooseTimeTickMinutes(maxLagMinutes, options);
  const tickMs = tickMinutes * 60 * 1000;
  if (!Number.isFinite(tickMs) || tickMs <= 0) return;

  const width = rect.right - rect.left;
  if (width <= 0) return;

  ctx.save();
  ctx.strokeStyle = options.color || "#000000";
  ctx.lineWidth = Number.isFinite(options.lineWidth) ? options.lineWidth : 1;
  ctx.setLineDash(options.dash || [4, 6]);
  ctx.fillStyle = options.color || "#000000";
  ctx.font = options.font || "12px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "top";

  const labelOffset = Number.isFinite(options.labelOffset) ? options.labelOffset : 6;
  for (let lag = tickMs; lag <= maxLagMs + 1; lag += tickMs) {
    const x = rect.left + (lag / maxLagMs) * width;
    if (!Number.isFinite(x)) continue;
    const label = formatLagMinutes(lag / (60 * 1000));
    const labelWidth = ctx.measureText(label).width || 0;
    const half = labelWidth / 2;
    if (x - half < rect.left || x + half > rect.right) {
      continue;
    }
    ctx.beginPath();
    ctx.moveTo(x, rect.top);
    ctx.lineTo(x, rect.bottom);
    ctx.stroke();
    ctx.fillText(label, x, rect.bottom + labelOffset);
  }
  ctx.restore();
}

function drawLagTicksCentered(ctx, rect, maxLagMs, maxLagMinutes, options = {}) {
  if (!Number.isFinite(maxLagMs) || maxLagMs <= 0) return;
  const tickMinutes = chooseTimeTickMinutes(maxLagMinutes * 2, options);
  const tickMs = tickMinutes * 60 * 1000;
  if (!Number.isFinite(tickMs) || tickMs <= 0) return;

  const width = rect.right - rect.left;
  if (width <= 0) return;

  ctx.save();
  ctx.strokeStyle = options.color || "#000000";
  ctx.lineWidth = Number.isFinite(options.lineWidth) ? options.lineWidth : 1;
  ctx.setLineDash(options.dash || [4, 6]);
  ctx.fillStyle = options.color || "#000000";
  ctx.font = options.font || "12px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "top";

  const labelOffset = Number.isFinite(options.labelOffset) ? options.labelOffset : 6;
  const firstTick = Math.ceil(-maxLagMs / tickMs) * tickMs;
  for (let lag = firstTick; lag <= maxLagMs + 1; lag += tickMs) {
    const x = rect.left + ((lag + maxLagMs) / (maxLagMs * 2)) * width;
    if (!Number.isFinite(x)) continue;
    const label = formatLagMinutesSigned(lag / (60 * 1000));
    const labelWidth = ctx.measureText(label).width || 0;
    const half = labelWidth / 2;
    if (x - half < rect.left || x + half > rect.right) {
      continue;
    }
    ctx.beginPath();
    ctx.moveTo(x, rect.top);
    ctx.lineTo(x, rect.bottom);
    ctx.stroke();
    ctx.fillText(label, x, rect.bottom + labelOffset);
  }
  ctx.restore();
}

function drawZeroLine(ctx, rect, min, max, options = {}) {
  if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) return;
  if (0 < min || 0 > max) return;
  const range = max - min;
  const y = rect.bottom - ((0 - min) / range) * (rect.bottom - rect.top);
  if (!Number.isFinite(y)) return;
  ctx.save();
  ctx.strokeStyle = options.color || "#000000";
  ctx.lineWidth = Number.isFinite(options.lineWidth) ? options.lineWidth : 1;
  ctx.setLineDash(options.dash || []);
  ctx.beginPath();
  ctx.moveTo(rect.left, y);
  ctx.lineTo(rect.right, y);
  ctx.stroke();
  ctx.restore();
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

  if (gridStep > 0) {
    ctx.save();
    ctx.strokeStyle = "#000000";
    ctx.lineWidth = 1;
    ctx.setLineDash(lineDash);
    for (let value = -maxGrid; value <= maxGrid + 1e-6; value += gridStep) {
      const xOffset = value * xScale;
      const xLeft = centerX - xOffset;
      const xRight = centerX + xOffset;
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
  const maxGrid = Math.floor(maxAbs / gridStep) * gridStep;

  if (showGrid && gridStep > 0) {
    ctx.save();
    ctx.strokeStyle = "#000000";
    ctx.lineWidth = 1;
    ctx.setLineDash(gridDash);
    for (let value = -maxGrid; value <= maxGrid + 1e-6; value += gridStep) {
      const delta = value * scale;
      const xLeft = centerX - delta;
      const xRight = centerX + delta;
      const yTop = centerY - delta;
      const yBottom = centerY + delta;
      if (orientation === "horizontal") {
        [yTop, yBottom].forEach((y) => {
          if (!Number.isFinite(y) || y < top || y > bottom) return;
          ctx.beginPath();
          ctx.moveTo(left, y);
          ctx.lineTo(right, y);
          ctx.stroke();
        });
      } else {
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

  const fg = options.color || "#000000";
  const posLine = options.posLineColor || fg;
  const negLine = options.negLineColor || fg;
  const posFill = options.posFillColor || fg;
  const negFill = options.negFillColor || fg;
  const lineWidth = Number.isFinite(options.lineWidth) ? options.lineWidth : 2;
  const pointSize = Number.isFinite(options.pointSize) ? options.pointSize : 4;

  const points = [];
  samples.forEach((sample) => {
    if (!sample || !Number.isFinite(sample.ts) || !Number.isFinite(sample.value)) return;
    const t = (sample.ts - startTs) / windowMs;
    if (!Number.isFinite(t)) return;
    const x = left + t * width;
    const yOffset = sample.value * scale;
    const y = orientation === "horizontal" ? centerY - yOffset : centerY + yOffset;
    points.push({ x, y, value: sample.value });
  });

  ctx.save();
  ctx.lineWidth = lineWidth;
  ctx.setLineDash([]);
  if (orientation === "horizontal") {
    for (let i = 0; i < points.length; i += 1) {
      const point = points[i];
      const prev = points[i - 1];
      if (!prev || !Number.isFinite(point.x) || !Number.isFinite(prev.x)) continue;
      const cross = (prev.value <= 0 && point.value >= 0) || (prev.value >= 0 && point.value <= 0);
      if (cross) {
        const t = Math.abs(prev.value) / (Math.abs(prev.value) + Math.abs(point.value));
        const xCross = prev.x + (point.x - prev.x) * t;
        const yCross = centerY;
        ctx.strokeStyle = prev.value >= 0 ? posLine : negLine;
        ctx.beginPath();
        ctx.moveTo(prev.x, prev.y);
        ctx.lineTo(xCross, yCross);
        ctx.stroke();
        ctx.strokeStyle = point.value >= 0 ? posLine : negLine;
        ctx.beginPath();
        ctx.moveTo(xCross, yCross);
        ctx.lineTo(point.x, point.y);
        ctx.stroke();
      }
    }
    points.forEach((point) => {
      if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return;
      ctx.fillStyle = point.value >= 0 ? posFill : negFill;
      const halfPoint = pointSize / 2;
      ctx.fillRect(point.x - halfPoint, point.y - halfPoint, pointSize, pointSize);
    });
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
  ctx.lineWidth = Number.isFinite(options.zeroLineWidth) ? options.zeroLineWidth : 1.5;
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
  computeTickStep,
  drawLine,
  drawStemPlot,
  drawYAxisGrid,
  drawTimeTicks,
  drawLagTicks,
  drawLagTicksCentered,
  drawZeroLine,
  renderDeviationBarPlot,
  renderSignedLinePlot,
};
