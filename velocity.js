import { toRadians, toMeters } from "./geo.js";

function computeVelocityFromHeading(speed, headingDegrees) {
  // Convert a course-over-ground heading (deg, 0 = north) into x/y velocity.
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
  // Estimate velocity using two GPS fixes projected into a local meter frame.
  if (!current || !previous) return { x: 0, y: 0, speed: 0 };
  const dt = (current.timestamp - previous.timestamp) / 1000;
  if (dt <= 0) return { x: 0, y: 0, speed: 0 };

  const origin = {
    lat: (current.coords.latitude + previous.coords.latitude) / 2,
    lon: (current.coords.longitude + previous.coords.longitude) / 2,
  };
  // Use the mid-point as origin to minimize projection distortion.
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
