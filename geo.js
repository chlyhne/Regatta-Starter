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

export { toRadians, toMeters, fromMeters, applyForwardOffset };
