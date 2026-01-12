import { toRadians, toMeters } from "./geo.js";

function computeVelocityFromHeading(speed, headingDegrees) {
  if (!Number.isFinite(speed) || !Number.isFinite(headingDegrees)) {
    return { x: 0, y: 0 };
  }
  const headingRad = toRadians(headingDegrees);
  return {
    x: speed * Math.sin(headingRad),
    y: speed * Math.cos(headingRad),
  };
}

function computeVelocityFromPositions(current, previous) {
  if (!current || !previous) return { x: 0, y: 0, speed: 0 };
  const dt = (current.timestamp - previous.timestamp) / 1000;
  if (dt <= 0) return { x: 0, y: 0, speed: 0 };

  const origin = {
    lat: (current.coords.latitude + previous.coords.latitude) / 2,
    lon: (current.coords.longitude + previous.coords.longitude) / 2,
  };
  const currentM = toMeters(
    { lat: current.coords.latitude, lon: current.coords.longitude },
    origin
  );
  const previousM = toMeters(
    { lat: previous.coords.latitude, lon: previous.coords.longitude },
    origin
  );
  const dx = currentM.x - previousM.x;
  const dy = currentM.y - previousM.y;
  const speed = Math.hypot(dx, dy) / dt;
  return { x: dx / dt, y: dy / dt, speed };
}

export { computeVelocityFromHeading, computeVelocityFromPositions };
