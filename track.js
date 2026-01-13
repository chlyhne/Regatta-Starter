import { state, TRACK_MAX_POINTS, TRACK_WINDOW_MS } from "./state.js";
import { els } from "./dom.js";
import { toMeters } from "./geo.js";

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

function renderTrack() {
  if (!els.trackCanvas) return;
  const canvas = els.trackCanvas;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const dpr = window.devicePixelRatio || 1;
  const width = canvas.clientWidth || 300;
  const height = canvas.clientHeight || 300;
  canvas.width = Math.max(1, Math.round(width * dpr));
  canvas.height = Math.max(1, Math.round(height * dpr));
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.scale(dpr, dpr);

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);

  const rawPoints = state.gpsTrackRaw;
  const filteredPoints = state.gpsTrackFiltered;
  const hasLineData = hasLine();
  let basePoints = rawPoints.length ? rawPoints : filteredPoints;
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

  const meanLat =
    basePoints.reduce((sum, p) => sum + p.lat, 0) / basePoints.length;
  const meanLon =
    basePoints.reduce((sum, p) => sum + p.lon, 0) / basePoints.length;
  const origin = { lat: meanLat, lon: meanLon };

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
  filteredPoints.forEach((point) => addBounds(toXY(point)));

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

  let boat = null;
  if (state.position) {
    boat = toMeters(
      {
        lat: state.position.coords.latitude,
        lon: state.position.coords.longitude,
      },
      origin
    );
  } else if (filteredPoints.length) {
    const last = filteredPoints[filteredPoints.length - 1];
    boat = toXY(last);
  } else if (rawPoints.length) {
    const last = rawPoints[rawPoints.length - 1];
    boat = toXY(last);
  }
  if (boat) {
    addBounds(boat);
  }

  const timeToStart = state.start.startTs
    ? Math.max(0, (state.start.startTs - Date.now()) / 1000)
    : null;
  const speed = state.speed;
  const velocity = state.velocity;
  const bowOffsetMeters = state.useKalman ? state.bowOffsetMeters : 0;

  let projectedDirect = null;
  let projectedDirectFrom = null;
  if (
    line &&
    boat &&
    Number.isFinite(speed) &&
    speed > 0 &&
    Number.isFinite(timeToStart) &&
    timeToStart > 0
  ) {
    const velSpeed = Math.hypot(velocity.x, velocity.y);
    let phone = boat;
    if (bowOffsetMeters > 0 && velSpeed > 0) {
      phone = {
        x: boat.x - (velocity.x / velSpeed) * bowOffsetMeters,
        y: boat.y - (velocity.y / velSpeed) * bowOffsetMeters,
      };
    }
    const phoneSegment = distanceToSegment(phone, line.pointA, line.pointB);
    if (phoneSegment.distance > 0) {
      const ux = (phoneSegment.closest.x - phone.x) / phoneSegment.distance;
      const uy = (phoneSegment.closest.y - phone.y) / phoneSegment.distance;
      projectedDirectFrom = phone;
      if (bowOffsetMeters > 0) {
        projectedDirectFrom = {
          x: phone.x + ux * bowOffsetMeters,
          y: phone.y + uy * bowOffsetMeters,
        };
      }
      projectedDirect = {
        x: projectedDirectFrom.x + ux * speed * timeToStart,
        y: projectedDirectFrom.y + uy * speed * timeToStart,
      };
      addBounds(projectedDirect);
    }
  }

  let projectedHeading = null;
  let projectedHeadingFrom = null;
  if (
    line &&
    boat &&
    Number.isFinite(timeToStart) &&
    timeToStart > 0 &&
    Number.isFinite(velocity.x) &&
    Number.isFinite(velocity.y)
  ) {
    const velSpeed = Math.hypot(velocity.x, velocity.y);
    if (velSpeed > 0) {
      projectedHeadingFrom = boat;
      projectedHeading = {
        x: boat.x + velocity.x * timeToStart,
        y: boat.y + velocity.y * timeToStart,
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

  const padding = 16;
  const spanX = Math.max(1, bounds.maxX - bounds.minX);
  const spanY = Math.max(1, bounds.maxY - bounds.minY);
  const scale = Math.min(
    (width - padding * 2) / spanX,
    (height - padding * 2) / spanY
  );

  const project = (point) => {
    const xy = toXY(point);
    const x = padding + (xy.x - bounds.minX) * scale;
    const y = padding + (bounds.maxY - xy.y) * scale;
    return { x, y };
  };
  const projectMeters = (xMeters, yMeters) => {
    const x = padding + (xMeters - bounds.minX) * scale;
    const y = padding + (bounds.maxY - yMeters) * scale;
    return { x, y };
  };

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

  const gridSpacing = 10;
  const gridStartX = Math.floor(bounds.minX / gridSpacing) * gridSpacing;
  const gridEndX = Math.ceil(bounds.maxX / gridSpacing) * gridSpacing;
  const gridStartY = Math.floor(bounds.minY / gridSpacing) * gridSpacing;
  const gridEndY = Math.ceil(bounds.maxY / gridSpacing) * gridSpacing;

  ctx.strokeStyle = "#e2e2e2";
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = gridStartX; x <= gridEndX; x += gridSpacing) {
    const p1 = projectMeters(x, bounds.minY);
    const p2 = projectMeters(x, bounds.maxY);
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
  }
  for (let y = gridStartY; y <= gridEndY; y += gridSpacing) {
    const p1 = projectMeters(bounds.minX, y);
    const p2 = projectMeters(bounds.maxX, y);
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
  }
  ctx.stroke();

  drawLine(rawPoints, "#9a9a9a", 2);
  drawLine(filteredPoints, "#000000", 2.5);

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

  const latest = (filteredPoints.length ? filteredPoints : rawPoints)[
    (filteredPoints.length ? filteredPoints : rawPoints).length - 1
  ];
  if (latest) {
    const { x, y } = project(latest);
    ctx.fillStyle = "#000000";
    ctx.beginPath();
    ctx.arc(x, y, 3, 0, Math.PI * 2);
    ctx.fill();
  } else if (boat) {
    drawCircle(boat, 3, "#000000");
  }
}

function recordTrackPoints(rawPosition, filteredPosition) {
  if (!rawPosition) return;
  const cutoff = Date.now() - TRACK_WINDOW_MS;
  appendTrackPoint(state.gpsTrackRaw, {
    lat: rawPosition.coords.latitude,
    lon: rawPosition.coords.longitude,
    ts: rawPosition.timestamp || Date.now(),
  });
  pruneTrackPoints(state.gpsTrackRaw, cutoff);
  if (filteredPosition) {
    appendTrackPoint(state.gpsTrackFiltered, {
      lat: filteredPosition.coords.latitude,
      lon: filteredPosition.coords.longitude,
      ts: filteredPosition.timestamp || Date.now(),
    });
    pruneTrackPoints(state.gpsTrackFiltered, cutoff);
  }
  if (document.body.classList.contains("track-mode")) {
    renderTrack();
  }
}

export { recordTrackPoints, renderTrack };
