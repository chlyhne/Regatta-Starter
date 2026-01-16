import { state, TRACK_MAX_POINTS, TRACK_WINDOW_MS } from "./state.js";
import { els } from "./dom.js";
import { toMeters } from "./geo.js";
import { getKalmanPositionCovariance } from "./kalman.js";

const TRACK_PADDING = 16;
const MIN_SCALE = 0.05;
const MAX_SCALE = 50;
const viewState = {
  origin: null,
  center: null,
  scale: null,
  bound: false,
  pointers: new Map(),
  panStart: null,
  pinchStart: null,
};
const BOAT_SVG_PATH = "./boat.svg";
const boatSvg = {
  image: null,
  width: 0,
  height: 0,
  loading: false,
  ready: false,
};

function parseSvgLength(value) {
  if (!value) return Number.NaN;
  const parsed = Number.parseFloat(String(value));
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function loadBoatSvg() {
  if (boatSvg.loading || boatSvg.ready) return;
  boatSvg.loading = true;
  fetch(BOAT_SVG_PATH)
    .then((response) => {
      if (!response.ok) {
        throw new Error("Failed to load boat svg");
      }
      return response.text();
    })
    .then((text) => {
      const parser = new DOMParser();
      const doc = parser.parseFromString(text, "image/svg+xml");
      const svg = doc.querySelector("svg");
      if (!svg) {
        throw new Error("Invalid boat svg");
      }
      const viewBox = svg.getAttribute("viewBox");
      let width = Number.NaN;
      let height = Number.NaN;
      if (viewBox) {
        const parts = viewBox.split(/[\s,]+/).map(Number);
        if (parts.length >= 4) {
          width = parts[2];
          height = parts[3];
        }
      }
      if (!Number.isFinite(width) || !Number.isFinite(height)) {
        width = parseSvgLength(svg.getAttribute("width"));
        height = parseSvgLength(svg.getAttribute("height"));
      }
      boatSvg.width = Number.isFinite(width) && width > 0 ? width : 1;
      boatSvg.height = Number.isFinite(height) && height > 0 ? height : 1;

      const blob = new Blob([text], { type: "image/svg+xml" });
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => {
        boatSvg.image = img;
        boatSvg.ready = true;
        boatSvg.loading = false;
        URL.revokeObjectURL(url);
      };
      img.onerror = () => {
        boatSvg.loading = false;
        URL.revokeObjectURL(url);
      };
      img.src = url;
    })
    .catch(() => {
      boatSvg.loading = false;
    });
}

function appendTrackPoint(list, point) {
  list.push(point);
  if (list.length > TRACK_MAX_POINTS) {
    list.splice(0, list.length - TRACK_MAX_POINTS);
  }
}

function pruneTrackPoints(list, cutoff) {
  for (let i = list.length - 1; i >= 0; i -= 1) {
    if (list[i].ts < cutoff) {
      list.splice(0, i + 1);
      break;
    }
  }
}

function hasLine() {
  return (
    Number.isFinite(state.line.a.lat) &&
    Number.isFinite(state.line.a.lon) &&
    Number.isFinite(state.line.b.lat) &&
    Number.isFinite(state.line.b.lon)
  );
}

function distanceToSegment(point, pointA, pointB) {
  const abx = pointB.x - pointA.x;
  const aby = pointB.y - pointA.y;
  const apx = point.x - pointA.x;
  const apy = point.y - pointA.y;
  const abLenSq = abx * abx + aby * aby;
  let t = 0;
  if (abLenSq > 0) {
    t = (apx * abx + apy * aby) / abLenSq;
  }
  const clampedT = Math.min(1, Math.max(0, t));
  const closest = {
    x: pointA.x + abx * clampedT,
    y: pointA.y + aby * clampedT,
  };
  const dx = point.x - closest.x;
  const dy = point.y - closest.y;
  return { distance: Math.hypot(dx, dy), closest };
}

function normalizeVector(vec) {
  if (!vec || !Number.isFinite(vec.x) || !Number.isFinite(vec.y)) return null;
  const len = Math.hypot(vec.x, vec.y);
  if (len <= 0) return null;
  return { x: vec.x / len, y: vec.y / len, len };
}

function offsetPoint(point, unit, distance) {
  if (!point || !unit || !Number.isFinite(distance) || distance === 0) {
    return point;
  }
  return { x: point.x + unit.x * distance, y: point.y + unit.y * distance };
}

function covarianceToAxes(covariance) {
  if (!covariance) return null;
  const xx = covariance.xx;
  const xy = covariance.xy;
  const yy = covariance.yy;
  if (![xx, xy, yy].every(Number.isFinite)) return null;
  const diff = xx - yy;
  const term = Math.sqrt(Math.max(0, diff * diff + 4 * xy * xy));
  const lambdaMajor = 0.5 * (xx + yy + term);
  const lambdaMinor = 0.5 * (xx + yy - term);
  if (lambdaMajor <= 0 || lambdaMinor <= 0) return null;
  return {
    major: Math.sqrt(lambdaMajor),
    minor: Math.sqrt(lambdaMinor),
    angle: 0.5 * Math.atan2(2 * xy, diff),
  };
}

function scaleAxes(axes, factor) {
  if (!axes || !Number.isFinite(factor) || factor <= 0) return axes;
  return {
    major: axes.major * factor,
    minor: axes.minor * factor,
    angle: axes.angle,
  };
}

function axesEndpoints(center, axes) {
  if (!center || !axes) return null;
  const cos = Math.cos(axes.angle);
  const sin = Math.sin(axes.angle);
  const majorVec = { x: cos * axes.major, y: sin * axes.major };
  const minorVec = { x: -sin * axes.minor, y: cos * axes.minor };
  return {
    majorStart: { x: center.x - majorVec.x, y: center.y - majorVec.y },
    majorEnd: { x: center.x + majorVec.x, y: center.y + majorVec.y },
    minorStart: { x: center.x - minorVec.x, y: center.y - minorVec.y },
    minorEnd: { x: center.x + minorVec.x, y: center.y + minorVec.y },
  };
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function getCanvasSize(canvas) {
  const width = canvas.clientWidth || canvas.width || 300;
  const height = canvas.clientHeight || canvas.height || 300;
  return { width, height };
}

function getViewBounds(width, height, scale, center) {
  const viewWidth = Math.max(1, width - TRACK_PADDING * 2);
  const viewHeight = Math.max(1, height - TRACK_PADDING * 2);
  const viewWidthMeters = viewWidth / scale;
  const viewHeightMeters = viewHeight / scale;
  const minX = center.x - viewWidthMeters / 2;
  const maxY = center.y + viewHeightMeters / 2;
  return {
    minX,
    maxX: minX + viewWidthMeters,
    minY: maxY - viewHeightMeters,
    maxY,
  };
}

function screenToWorld(canvas, x, y) {
  if (!viewState.center || !viewState.scale) return null;
  const { width, height } = getCanvasSize(canvas);
  const bounds = getViewBounds(width, height, viewState.scale, viewState.center);
  return {
    x: bounds.minX + (x - TRACK_PADDING) / viewState.scale,
    y: bounds.maxY - (y - TRACK_PADDING) / viewState.scale,
  };
}

function zoomAt(canvas, nextScale, x, y) {
  if (!viewState.center || !viewState.scale) return;
  const before = screenToWorld(canvas, x, y);
  viewState.scale = clamp(nextScale, MIN_SCALE, MAX_SCALE);
  const after = screenToWorld(canvas, x, y);
  if (!before || !after) return;
  viewState.center.x += before.x - after.x;
  viewState.center.y += before.y - after.y;
}

function bindTrackControls() {
  if (!els.trackCanvas || viewState.bound) return;
  const canvas = els.trackCanvas;
  viewState.bound = true;

  canvas.addEventListener(
    "wheel",
    (event) => {
      if (!viewState.scale || !viewState.center) return;
      event.preventDefault();
      const zoomFactor = event.deltaY > 0 ? 0.9 : 1.1;
      zoomAt(canvas, viewState.scale * zoomFactor, event.offsetX, event.offsetY);
      renderTrack();
    },
    { passive: false }
  );

  if (!("PointerEvent" in window)) return;

  canvas.addEventListener("pointerdown", (event) => {
    canvas.setPointerCapture(event.pointerId);
    viewState.pointers.set(event.pointerId, { x: event.offsetX, y: event.offsetY });
    if (viewState.pointers.size === 1) {
      viewState.panStart = {
        x: event.offsetX,
        y: event.offsetY,
        center: { ...viewState.center },
      };
    }
    if (viewState.pointers.size === 2) {
      const [first, second] = Array.from(viewState.pointers.values());
      viewState.pinchStart = {
        distance: Math.hypot(second.x - first.x, second.y - first.y),
        scale: viewState.scale,
        centerX: (first.x + second.x) / 2,
        centerY: (first.y + second.y) / 2,
      };
      viewState.panStart = null;
    }
  });

  canvas.addEventListener("pointermove", (event) => {
    const existing = viewState.pointers.get(event.pointerId);
    if (!existing) return;
    existing.x = event.offsetX;
    existing.y = event.offsetY;
    if (viewState.pointers.size === 2 && viewState.pinchStart) {
      const [first, second] = Array.from(viewState.pointers.values());
      const distance = Math.hypot(second.x - first.x, second.y - first.y);
      if (viewState.pinchStart.distance > 0) {
        const nextScale = viewState.pinchStart.scale * (distance / viewState.pinchStart.distance);
        const centerX = (first.x + second.x) / 2;
        const centerY = (first.y + second.y) / 2;
        zoomAt(canvas, nextScale, centerX, centerY);
        renderTrack();
      }
      return;
    }
    if (viewState.panStart && viewState.center && viewState.scale) {
      const dx = event.offsetX - viewState.panStart.x;
      const dy = event.offsetY - viewState.panStart.y;
      viewState.center.x = viewState.panStart.center.x - dx / viewState.scale;
      viewState.center.y = viewState.panStart.center.y + dy / viewState.scale;
      renderTrack();
    }
  });

  const endPointer = (event) => {
    viewState.pointers.delete(event.pointerId);
    if (viewState.pointers.size < 2) {
      viewState.pinchStart = null;
    }
    if (viewState.pointers.size === 1) {
      const [remaining] = viewState.pointers.values();
      viewState.panStart = {
        x: remaining.x,
        y: remaining.y,
        center: { ...viewState.center },
      };
    } else {
      viewState.panStart = null;
    }
  };

  canvas.addEventListener("pointerup", endPointer);
  canvas.addEventListener("pointercancel", endPointer);
}

function renderTrack() {
  if (!els.trackCanvas) return;
  bindTrackControls();
  const canvas = els.trackCanvas;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  loadBoatSvg();

  const dpr = window.devicePixelRatio || 1;
  const { width, height } = getCanvasSize(canvas);
  canvas.width = Math.max(1, Math.round(width * dpr));
  canvas.height = Math.max(1, Math.round(height * dpr));
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.scale(dpr, dpr);

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);

  const rawPoints = state.gpsTrackRaw;
  const phonePoints = state.gpsTrackPhone || [];
  const bowPoints = state.gpsTrackFiltered;
  const hasLineData = hasLine();
  let basePoints = bowPoints.length ? bowPoints : phonePoints;
  if (!basePoints.length) {
    basePoints = rawPoints;
  }
  if (!basePoints.length && state.position) {
    basePoints = [
      {
        lat: state.position.coords.latitude,
        lon: state.position.coords.longitude,
      },
    ];
  }
  if (!basePoints.length && hasLineData) {
    basePoints = [
      {
        lat: (state.line.a.lat + state.line.b.lat) / 2,
        lon: (state.line.a.lon + state.line.b.lon) / 2,
      },
    ];
  }
  if (!basePoints.length) {
    ctx.fillStyle = "#666666";
    ctx.font = "14px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("No GPS data yet", width / 2, height / 2);
    return;
  }

  let origin = viewState.origin;
  if (!origin) {
    const meanLat =
      basePoints.reduce((sum, p) => sum + p.lat, 0) / basePoints.length;
    const meanLon =
      basePoints.reduce((sum, p) => sum + p.lon, 0) / basePoints.length;
    origin = { lat: meanLat, lon: meanLon };
    viewState.origin = origin;
  }

  const toXY = (point) => toMeters(point, origin);
  const bounds = {
    minX: Infinity,
    maxX: -Infinity,
    minY: Infinity,
    maxY: -Infinity,
  };
  const addBounds = (xy) => {
    bounds.minX = Math.min(bounds.minX, xy.x);
    bounds.maxX = Math.max(bounds.maxX, xy.x);
    bounds.minY = Math.min(bounds.minY, xy.y);
    bounds.maxY = Math.max(bounds.maxY, xy.y);
  };
  rawPoints.forEach((point) => addBounds(toXY(point)));
  phonePoints.forEach((point) => addBounds(toXY(point)));
  bowPoints.forEach((point) => addBounds(toXY(point)));

  let line = null;
  if (hasLineData) {
    const pointA = toMeters(state.line.a, origin);
    const pointB = toMeters(state.line.b, origin);
    const lineLen = Math.hypot(pointB.x - pointA.x, pointB.y - pointA.y);
    if (lineLen >= 1) {
      line = { pointA, pointB };
      addBounds(pointA);
      addBounds(pointB);
    }
  }

  // Prefer the latest state positions; fall back to the most recent tracks.
  // Phone position drives covariance; bow position is used for the boat icon.
  const phonePosition = state.position
    ? toMeters(
        {
          lat: state.position.coords.latitude,
          lon: state.position.coords.longitude,
        },
        origin
      )
    : null;
  const bowPosition = state.bowPosition
    ? toMeters(
        {
          lat: state.bowPosition.coords.latitude,
          lon: state.bowPosition.coords.longitude,
        },
        origin
      )
    : null;

  let boat = bowPosition || phonePosition || null;
  if (!boat && bowPoints.length) {
    boat = toXY(bowPoints[bowPoints.length - 1]);
  } else if (!boat && phonePoints.length) {
    boat = toXY(phonePoints[phonePoints.length - 1]);
  } else if (!boat && rawPoints.length) {
    boat = toXY(rawPoints[rawPoints.length - 1]);
  }
  if (boat) addBounds(boat);
  if (phonePosition) addBounds(phonePosition);

  // Covariance is for the phone estimate, not the bow.
  const positionAxes = scaleAxes(
    covarianceToAxes(getKalmanPositionCovariance()),
    20
  );
  if (phonePosition && positionAxes) {
    const endpoints = axesEndpoints(phonePosition, positionAxes);
    if (endpoints) {
      addBounds(endpoints.majorStart);
      addBounds(endpoints.majorEnd);
      addBounds(endpoints.minorStart);
      addBounds(endpoints.minorEnd);
    }
  }

  const timeToStart = state.start.startTs
    ? Math.max(0, (state.start.startTs - Date.now()) / 1000)
    : null;
  const speed = state.speed;
  const velocity = state.velocity;
  const bowOffsetMeters = Math.max(0, Number(state.bowOffsetMeters) || 0);
  // Mirror the race view logic: phone is base, bow is offset along heading or to line.
  const phoneForProjection = phonePosition || boat;
  const velocityUnit = normalizeVector(velocity);
  const bowHeading =
    phoneForProjection && velocityUnit
      ? offsetPoint(phoneForProjection, velocityUnit, bowOffsetMeters)
      : phoneForProjection;

  let projectedDirect = null;
  let projectedDirectFrom = null;
  if (
    line &&
    phoneForProjection &&
    Number.isFinite(speed) &&
    speed > 0 &&
    Number.isFinite(timeToStart) &&
    timeToStart > 0
  ) {
    const phoneSegment = distanceToSegment(phoneForProjection, line.pointA, line.pointB);
    if (phoneSegment.distance > 0) {
      const toLineUnit = {
        x: (phoneSegment.closest.x - phoneForProjection.x) / phoneSegment.distance,
        y: (phoneSegment.closest.y - phoneForProjection.y) / phoneSegment.distance,
      };
      projectedDirectFrom = offsetPoint(phoneForProjection, toLineUnit, bowOffsetMeters);
      projectedDirect = {
        x: projectedDirectFrom.x + toLineUnit.x * speed * timeToStart,
        y: projectedDirectFrom.y + toLineUnit.y * speed * timeToStart,
      };
      addBounds(projectedDirect);
    }
  }

  let projectedHeading = null;
  let projectedHeadingFrom = null;
  if (
    line &&
    bowHeading &&
    Number.isFinite(timeToStart) &&
    timeToStart > 0 &&
    Number.isFinite(velocity.x) &&
    Number.isFinite(velocity.y)
  ) {
    const velSpeed = Math.hypot(velocity.x, velocity.y);
    if (velSpeed > 0) {
      projectedHeadingFrom = bowHeading;
      projectedHeading = {
        x: bowHeading.x + velocity.x * timeToStart,
        y: bowHeading.y + velocity.y * timeToStart,
      };
      addBounds(projectedHeading);
    }
  }

  if (!Number.isFinite(bounds.minX)) {
    ctx.fillStyle = "#666666";
    ctx.font = "14px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("No GPS data yet", width / 2, height / 2);
    return;
  }

  if (!viewState.center) {
    viewState.center = {
      x: (bounds.minX + bounds.maxX) / 2,
      y: (bounds.minY + bounds.maxY) / 2,
    };
  }
  if (!viewState.scale) {
    const spanX = Math.max(1, bounds.maxX - bounds.minX);
    const spanY = Math.max(1, bounds.maxY - bounds.minY);
    const fitScale = Math.min(
      (width - TRACK_PADDING * 2) / spanX,
      (height - TRACK_PADDING * 2) / spanY
    );
    viewState.scale = clamp(fitScale, MIN_SCALE, MAX_SCALE);
  }
  const scale = viewState.scale;
  const viewBounds = getViewBounds(width, height, scale, viewState.center);

  const project = (point) => {
    const xy = toXY(point);
    const x = TRACK_PADDING + (xy.x - viewBounds.minX) * scale;
    const y = TRACK_PADDING + (viewBounds.maxY - xy.y) * scale;
    return { x, y };
  };
  const projectMeters = (xMeters, yMeters) => {
    const x = TRACK_PADDING + (xMeters - viewBounds.minX) * scale;
    const y = TRACK_PADDING + (viewBounds.maxY - yMeters) * scale;
    return { x, y };
  };
  let latestPoint = null;
  if (bowPoints.length) {
    latestPoint = bowPoints[bowPoints.length - 1];
  } else if (phonePoints.length) {
    latestPoint = phonePoints[phonePoints.length - 1];
  } else if (rawPoints.length) {
    latestPoint = rawPoints[rawPoints.length - 1];
  }
  let dot = null;
  if (latestPoint) {
    dot = project(latestPoint);
  } else if (boat) {
    dot = projectMeters(boat.x, boat.y);
  }

  const drawLine = (points, color, lineWidth) => {
    if (!points.length) return;
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.beginPath();
    points.forEach((point, index) => {
      const { x, y } = project(point);
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
  };
  const drawDots = (points, color, radius) => {
    if (!points.length) return;
    ctx.save();
    ctx.fillStyle = color;
    points.forEach((point) => {
      const { x, y } = project(point);
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.restore();
  };
  const drawSegment = (start, end, color, lineWidth, dash) => {
    if (!start || !end) return;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.setLineDash(dash || []);
    ctx.beginPath();
    const p1 = projectMeters(start.x, start.y);
    const p2 = projectMeters(end.x, end.y);
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.stroke();
    ctx.restore();
  };
  const drawCircle = (point, radius, fill, stroke) => {
    if (!point) return;
    const { x, y } = projectMeters(point.x, point.y);
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    if (fill) {
      ctx.fillStyle = fill;
      ctx.fill();
    }
    if (stroke) {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    ctx.restore();
  };
  const drawSquare = (point, size, fill, stroke) => {
    if (!point) return;
    const { x, y } = projectMeters(point.x, point.y);
    const half = size / 2;
    ctx.save();
    if (fill) {
      ctx.fillStyle = fill;
      ctx.fillRect(x - half, y - half, size, size);
    }
    if (stroke) {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 2;
      ctx.strokeRect(x - half, y - half, size, size);
    }
    ctx.restore();
  };
  const drawScreenSegment = (start, end, color, lineWidth) => {
    if (!start || !end) return;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.lineTo(end.x, end.y);
    ctx.stroke();
    ctx.restore();
  };
  const drawScreenDot = (center, radius, color) => {
    if (!center) return;
    ctx.save();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(center.x, center.y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  };
  const drawAxesAt = (center, axes, color, majorWidth, minorWidth) => {
    if (!center || !axes) return;
    const cos = Math.cos(axes.angle);
    const sin = Math.sin(axes.angle);
    const majorX = cos * axes.major * scale;
    const majorY = -sin * axes.major * scale;
    const minorX = -sin * axes.minor * scale;
    const minorY = -cos * axes.minor * scale;
    drawScreenSegment(
      { x: center.x - majorX, y: center.y - majorY },
      { x: center.x + majorX, y: center.y + majorY },
      color,
      majorWidth
    );
    drawScreenSegment(
      { x: center.x - minorX, y: center.y - minorY },
      { x: center.x + minorX, y: center.y + minorY },
      color,
      minorWidth
    );
  };

  const gridSpacing = 10;
  const gridStartX = Math.floor(viewBounds.minX / gridSpacing) * gridSpacing;
  const gridEndX = Math.ceil(viewBounds.maxX / gridSpacing) * gridSpacing;
  const gridStartY = Math.floor(viewBounds.minY / gridSpacing) * gridSpacing;
  const gridEndY = Math.ceil(viewBounds.maxY / gridSpacing) * gridSpacing;

  ctx.strokeStyle = "#e2e2e2";
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = gridStartX; x <= gridEndX; x += gridSpacing) {
    const p1 = projectMeters(x, viewBounds.minY);
    const p2 = projectMeters(x, viewBounds.maxY);
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
  }
  for (let y = gridStartY; y <= gridEndY; y += gridSpacing) {
    const p1 = projectMeters(viewBounds.minX, y);
    const p2 = projectMeters(viewBounds.maxX, y);
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
  }
  ctx.stroke();

  drawDots(rawPoints, "#ff00ff", 2.5);
  drawLine(phonePoints, "#000000", 2.5);
  drawLine(bowPoints, "#c00000", 2.5);

  if (line) {
    drawSegment(line.pointA, line.pointB, "#000000", 3);
    drawCircle(line.pointA, 4, "#ffffff", "#000000");
    drawCircle(line.pointB, 4, "#000000", "#ffffff");
  }

  if (projectedDirectFrom && projectedDirect) {
    drawSegment(projectedDirectFrom, projectedDirect, "#000000", 1.5, [6, 4]);
    drawSquare(projectedDirect, 10, "#ffffff", "#000000");
  }

  if (projectedHeadingFrom && projectedHeading) {
    drawSegment(projectedHeadingFrom, projectedHeading, "#666666", 1.5, [6, 4]);
    drawSquare(projectedHeading, 10, "#000000", "#ffffff");
  }

  const drawBoatWedge = (lengthMeters) => {
    const speedMetersPerSecond = Math.hypot(state.velocity.x, state.velocity.y);
    const ux = speedMetersPerSecond > 1e-6 ? state.velocity.x / speedMetersPerSecond : 0;
    const uy = speedMetersPerSecond > 1e-6 ? state.velocity.y / speedMetersPerSecond : 1;
    const bowOffsetMeters = Math.max(0, Number(state.bowOffsetMeters) || 0);
    const anchor = phonePosition || boat;
    if (!anchor) return;
    const bowMeters = phonePosition
      ? {
          x: anchor.x + ux * bowOffsetMeters,
          y: anchor.y + uy * bowOffsetMeters,
        }
      : anchor;

    const stern = {
      x: bowMeters.x - ux * lengthMeters,
      y: bowMeters.y - uy * lengthMeters,
    };
    const beamMeters = Math.max(0.5, lengthMeters * 0.32);
    const px = -uy;
    const py = ux;
    const left = {
      x: stern.x + (px * beamMeters) / 2,
      y: stern.y + (py * beamMeters) / 2,
    };
    const right = {
      x: stern.x - (px * beamMeters) / 2,
      y: stern.y - (py * beamMeters) / 2,
    };

    const bowScreen = projectMeters(bowMeters.x, bowMeters.y);
    const leftScreen = projectMeters(left.x, left.y);
    const rightScreen = projectMeters(right.x, right.y);

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(bowScreen.x, bowScreen.y);
    ctx.lineTo(leftScreen.x, leftScreen.y);
    ctx.lineTo(rightScreen.x, rightScreen.y);
    ctx.closePath();
    ctx.fillStyle = "rgba(0, 112, 255, 0.22)";
    ctx.strokeStyle = "#0070ff";
    ctx.lineWidth = 2;
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  };

  const drawBoatSvg = () => {
    const anchor = phonePosition || boat;
    if (!anchor) return;
    const lengthMeters = Number.isFinite(state.boatLengthMeters)
      ? state.boatLengthMeters
      : 0;
    if (!Number.isFinite(lengthMeters) || lengthMeters <= 0) return;
    if (!boatSvg.ready || !boatSvg.image) {
      drawBoatWedge(lengthMeters);
      return;
    }

    const lengthPx = lengthMeters * scale;
    if (!Number.isFinite(lengthPx) || lengthPx <= 0) return;
    const aspect = boatSvg.width > 0 && boatSvg.height > 0
      ? boatSvg.width / boatSvg.height
      : 0.3;
    const widthPx = lengthPx * aspect;
    const speedMetersPerSecond = Math.hypot(state.velocity.x, state.velocity.y);
    const angle = speedMetersPerSecond > 1e-6
      ? Math.atan2(state.velocity.x, state.velocity.y)
      : 0;
    const bowOffsetMeters = Math.max(0, Number(state.bowOffsetMeters) || 0);
    const bowOffsetPx = (phonePosition ? bowOffsetMeters : 0) * scale;
    const anchorScreen = projectMeters(anchor.x, anchor.y);

    ctx.save();
    ctx.translate(anchorScreen.x, anchorScreen.y);
    ctx.rotate(angle);
    ctx.drawImage(boatSvg.image, -widthPx / 2, -bowOffsetPx, widthPx, lengthPx);
    ctx.restore();
  };

  drawBoatSvg();

  const covarianceCenter = phonePosition || dot;
  if (positionAxes && covarianceCenter) {
    drawAxesAt(covarianceCenter, positionAxes, "#c00000", 2.5, 2);
  }
  if (dot) {
    drawScreenDot(dot, 3, "#c00000");
  } else if (boat) {
    drawCircle(boat, 3, "#000000");
  }
}

function recordTrackPoints(rawPosition, phonePosition, bowPosition) {
  const cutoff = Date.now() - TRACK_WINDOW_MS;
  if (rawPosition) {
    appendTrackPoint(state.gpsTrackRaw, {
      lat: rawPosition.coords.latitude,
      lon: rawPosition.coords.longitude,
      ts: rawPosition.timestamp || Date.now(),
    });
    pruneTrackPoints(state.gpsTrackRaw, cutoff);
  }
  if (phonePosition) {
    appendTrackPoint(state.gpsTrackPhone, {
      lat: phonePosition.coords.latitude,
      lon: phonePosition.coords.longitude,
      ts: phonePosition.timestamp || Date.now(),
    });
    pruneTrackPoints(state.gpsTrackPhone, cutoff);
  }
  if (bowPosition) {
    appendTrackPoint(state.gpsTrackFiltered, {
      lat: bowPosition.coords.latitude,
      lon: bowPosition.coords.longitude,
      ts: bowPosition.timestamp || Date.now(),
    });
    pruneTrackPoints(state.gpsTrackFiltered, cutoff);
  }
  if (document.body.classList.contains("track-mode")) {
    renderTrack();
  }
}

export { recordTrackPoints, renderTrack };
