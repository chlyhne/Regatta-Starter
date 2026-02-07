import { EARTH_RADIUS } from "./state.js";

function toRadians(deg) {
  return (deg * Math.PI) / 180;
}

function toMeters(point, origin) {
  // Local tangent-plane projection (equirectangular) around the origin.
  // Accurate enough for short race-course distances and fast to compute.
  const latRad = toRadians(point.lat);
  const lonRad = toRadians(point.lon);
  const originLatRad = toRadians(origin.lat);
  const originLonRad = toRadians(origin.lon);
  const x = (lonRad - originLonRad) * Math.cos(originLatRad) * EARTH_RADIUS;
  const y = (latRad - originLatRad) * EARTH_RADIUS;
  return { x, y };
}

function fromMeters(point, origin) {
  // Inverse of the local tangent-plane approximation in toMeters().
  const originLatRad = toRadians(origin.lat);
  const lat = origin.lat + (point.y / EARTH_RADIUS) * (180 / Math.PI);
  const lon =
    origin.lon +
    (point.x / (EARTH_RADIUS * Math.cos(originLatRad))) * (180 / Math.PI);
  return { lat, lon };
}

function applyForwardOffset(position, velocity, offsetMeters) {
  // Shift a GPS position forward along the current velocity direction.
  // Used to estimate bow position from the device position.
  if (!position || !velocity) return position;
  if (!Number.isFinite(offsetMeters) || offsetMeters <= 0) return position;
  const speed = Math.hypot(velocity.x, velocity.y);
  if (!Number.isFinite(speed) || speed <= 0) return position;
  const unit = { x: velocity.x / speed, y: velocity.y / speed };
  const origin = { lat: position.coords.latitude, lon: position.coords.longitude };
  const coords = fromMeters(
    { x: unit.x * offsetMeters, y: unit.y * offsetMeters },
    origin
  );
  return {
    coords: {
      latitude: coords.lat,
      longitude: coords.lon,
      accuracy: position.coords.accuracy,
    },
    timestamp: position.timestamp,
  };
}

function getClosestPointOnSegment(point, start, end) {
  if (!point || !start || !end) return null;
  if (!Number.isFinite(point.lat) || !Number.isFinite(point.lon)) return null;
  if (!Number.isFinite(start.lat) || !Number.isFinite(start.lon)) return null;
  if (!Number.isFinite(end.lat) || !Number.isFinite(end.lon)) return null;
  const origin = {
    lat: (start.lat + end.lat) / 2,
    lon: (start.lon + end.lon) / 2,
  };
  const pointA = toMeters(start, origin);
  const pointB = toMeters(end, origin);
  const pointP = toMeters(point, origin);
  const abx = pointB.x - pointA.x;
  const aby = pointB.y - pointA.y;
  const abLenSq = abx * abx + aby * aby;
  if (!Number.isFinite(abLenSq) || abLenSq <= 0) {
    return { lat: start.lat, lon: start.lon };
  }
  const t = ((pointP.x - pointA.x) * abx + (pointP.y - pointA.y) * aby) / abLenSq;
  const clamped = Math.min(1, Math.max(0, t));
  const closest = {
    x: pointA.x + abx * clamped,
    y: pointA.y + aby * clamped,
  };
  return fromMeters(closest, origin);
}

export { toRadians, toMeters, fromMeters, applyForwardOffset, getClosestPointOnSegment };
