import { state } from "./state.js";
import { computeVelocityFromPositions } from "./velocity.js";
import { headingFromVelocity } from "./common.js";

function normalizeHeadingSource(source) {
  if (source === "gps") return "gps";
  return "kalman";
}

function getHeadingSourcePreference(mode) {
  if (!state.headingSourceByMode) return "kalman";
  return normalizeHeadingSource(state.headingSourceByMode[mode]);
}

function canUseKalmanHeading(position) {
  return (
    state.useKalman &&
    position === state.kalmanPosition &&
    state.velocity &&
    Number.isFinite(state.speed)
  );
}

function getHeadingSampleForMode(mode, position, previousPosition) {
  if (!position || !position.coords) return null;
  const preference = getHeadingSourcePreference(mode);
  const useKalman = preference === "kalman" && canUseKalmanHeading(position);

  let speed = null;
  let heading = null;
  if (useKalman) {
    speed = state.speed;
    heading = headingFromVelocity(state.velocity);
  } else {
    const coords = position.coords;
    speed = Number.isFinite(coords.speed) ? coords.speed : null;
    heading = Number.isFinite(coords.heading) ? coords.heading : null;
    if (!Number.isFinite(speed) || !Number.isFinite(heading)) {
      if (previousPosition) {
        const computed = computeVelocityFromPositions(position, previousPosition);
        if (!Number.isFinite(speed)) {
          speed = computed.speed;
        }
        if (!Number.isFinite(heading)) {
          heading = headingFromVelocity(computed);
        }
      }
    }
  }

  if (!Number.isFinite(speed)) return null;
  if (!Number.isFinite(heading)) {
    heading = null;
  }
  const ts = Number.isFinite(position.timestamp) ? position.timestamp : Date.now();
  return { speed, heading, ts, source: useKalman ? "kalman" : "gps" };
}

export {
  normalizeHeadingSource,
  getHeadingSourcePreference,
  getHeadingSampleForMode,
  canUseKalmanHeading,
};
