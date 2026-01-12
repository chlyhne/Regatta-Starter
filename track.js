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
  const allPoints = rawPoints.length ? rawPoints : filteredPoints;
  if (!allPoints.length) {
    ctx.fillStyle = "#666666";
    ctx.font = "14px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("No GPS data yet", width / 2, height / 2);
    return;
  }

  const meanLat =
    allPoints.reduce((sum, p) => sum + p.lat, 0) / allPoints.length;
  const meanLon =
    allPoints.reduce((sum, p) => sum + p.lon, 0) / allPoints.length;
  const origin = { lat: meanLat, lon: meanLon };

  const toXY = (point) => toMeters(point, origin);
  const collectBounds = (points) => {
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    points.forEach((point) => {
      const xy = toXY(point);
      minX = Math.min(minX, xy.x);
      maxX = Math.max(maxX, xy.x);
      minY = Math.min(minY, xy.y);
      maxY = Math.max(maxY, xy.y);
    });
    return { minX, maxX, minY, maxY };
  };

  let bounds = collectBounds(allPoints);
  if (filteredPoints.length) {
    const filteredBounds = collectBounds(filteredPoints);
    bounds = {
      minX: Math.min(bounds.minX, filteredBounds.minX),
      maxX: Math.max(bounds.maxX, filteredBounds.maxX),
      minY: Math.min(bounds.minY, filteredBounds.minY),
      maxY: Math.max(bounds.maxY, filteredBounds.maxY),
    };
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

  const latest = (filteredPoints.length ? filteredPoints : rawPoints)[
    (filteredPoints.length ? filteredPoints : rawPoints).length - 1
  ];
  if (latest) {
    const { x, y } = project(latest);
    ctx.fillStyle = "#000000";
    ctx.beginPath();
    ctx.arc(x, y, 3, 0, Math.PI * 2);
    ctx.fill();
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
