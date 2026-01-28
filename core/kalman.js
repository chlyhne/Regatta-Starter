import { state } from "./state.js";
import { toMeters, fromMeters } from "./geo.js";
import { computeVelocityFromHeading } from "./velocity.js";
import { KALMAN_TUNING } from "./tuning.js";
import { clamp } from "./common.js";
import { getNowMs } from "./clock.js";

// State vector layout: [x, y, vx, vy] in meters and meters/second, relative to a local origin.
// Axes follow the local tangent plane: x = east, y = north (see geo.js).
// We keep the math explicit (no linear algebra helpers) so every step stays inspectable.

function clampDtSeconds(dtRaw) {
  // Clamp large dt spikes so a single stale GPS fix cannot explode covariance.
  if (!Number.isFinite(dtRaw) || dtRaw <= 0) return 0;
  const dtClamp = KALMAN_TUNING.timing.dtClampSeconds;
  return Math.min(dtRaw, dtClamp.max);
}

function normalizeAngleRad(angle) {
  // Keep heading in a stable range so delta computations stay small and well-behaved.
  if (!Number.isFinite(angle)) return 0;
  let wrapped = angle % (Math.PI * 2);
  if (wrapped <= -Math.PI) wrapped += Math.PI * 2;
  if (wrapped > Math.PI) wrapped -= Math.PI * 2;
  return wrapped;
}

function getVelocityHeadingRad(vx, vy) {
  // Heading is defined as atan2(east, north): 0 = north, +90° = east.
  if (!Number.isFinite(vx) || !Number.isFinite(vy)) return null;
  const speed = Math.hypot(vx, vy);
  if (!Number.isFinite(speed) || speed < 1e-6) return null;
  return Math.atan2(vx, vy);
}

function getCovarianceHeadingRad(vx, vy, fallbackRad) {
  // Prefer the velocity-derived heading; fall back to stored heading when nearly stopped.
  const velocityHeading = getVelocityHeadingRad(vx, vy);
  if (Number.isFinite(velocityHeading)) return velocityHeading;
  return Number.isFinite(fallbackRad) ? fallbackRad : 0;
}

function rotateVelocityCovariance(P, cos, sin) {
  // Rotate the velocity block (and cross terms) so covariance stays aligned with heading.
  if (!Array.isArray(P) || P.length < 16) return;
  const p00 = P[0];
  const p01 = P[1];
  const p02 = P[2];
  const p03 = P[3];
  const p10 = P[4];
  const p11 = P[5];
  const p12 = P[6];
  const p13 = P[7];
  const p20 = P[8];
  const p21 = P[9];
  const p22 = P[10];
  const p23 = P[11];
  const p30 = P[12];
  const p31 = P[13];
  const p32 = P[14];
  const p33 = P[15];

  const p02n = p02 * cos + p03 * sin;
  const p03n = -p02 * sin + p03 * cos;
  const p12n = p12 * cos + p13 * sin;
  const p13n = -p12 * sin + p13 * cos;

  const p20n = cos * p20 + sin * p30;
  const p21n = cos * p21 + sin * p31;
  const p30n = -sin * p20 + cos * p30;
  const p31n = -sin * p21 + cos * p31;

  const b00 = cos * p22 + sin * p32;
  const b01 = cos * p23 + sin * p33;
  const b10 = -sin * p22 + cos * p32;
  const b11 = -sin * p23 + cos * p33;

  const p22n = b00 * cos + b01 * sin;
  const p23n = -b00 * sin + b01 * cos;
  const p32n = b10 * cos + b11 * sin;
  const p33n = -b10 * sin + b11 * cos;

  P[0] = p00;
  P[1] = p01;
  P[2] = p02n;
  P[3] = p03n;
  P[4] = p10;
  P[5] = p11;
  P[6] = p12n;
  P[7] = p13n;
  P[8] = p20n;
  P[9] = p21n;
  P[10] = p22n;
  P[11] = p23n;
  P[12] = p30n;
  P[13] = p31n;
  P[14] = p32n;
  P[15] = p33n;
}

function rotateVelocityState(filter, deltaRad) {
  // Apply a yaw delta to the velocity state so heading and velocity stay consistent.
  if (!filter || !Array.isArray(filter.x) || filter.x.length < 4) return;
  if (!Number.isFinite(deltaRad) || deltaRad === 0) return;
  const cos = Math.cos(deltaRad);
  const sin = Math.sin(deltaRad);
  const vx = filter.x[2];
  const vy = filter.x[3];
  filter.x[2] = cos * vx + sin * vy;
  filter.x[3] = -sin * vx + cos * vy;
  rotateVelocityCovariance(filter.P, cos, sin);
}

function buildDirectionalCovariance(qForward, qLateral, headingRad) {
  // Convert forward/sideways variances into the global x/y frame via rotation.
  const heading = Number.isFinite(headingRad) ? headingRad : 0;
  const fx = Math.sin(heading);
  const fy = Math.cos(heading);
  const lx = Math.cos(heading);
  const ly = -Math.sin(heading);
  const xx = qForward * fx * fx + qLateral * lx * lx;
  const xy = qForward * fx * fy + qLateral * lx * ly;
  const yy = qForward * fy * fy + qLateral * ly * ly;
  return { xx, xy, yy };
}

function getProcessNoiseVariance() {
  // Scale acceleration variance by boat length (longer boats respond more slowly).
  const baseQ = KALMAN_TUNING.processNoise.baseAccelerationVariance;
  const baseLength = KALMAN_TUNING.processNoise.baseBoatLengthMeters;
  const boatLength = Number.isFinite(state.boatLengthMeters) ? state.boatLengthMeters : 0;
  const effectiveLength = Math.max(baseLength, boatLength);
  const ratio = baseLength / effectiveLength;
  return baseQ * ratio * ratio;
}

function getRecentMaxSpeed() {
  // Use max speed over the recent window as a proxy for potential acceleration.
  if (!Array.isArray(state.speedHistory) || !state.speedHistory.length) {
    return null;
  }
  let maxSpeed = 0;
  state.speedHistory.forEach((sample) => {
    if (Number.isFinite(sample.speed)) {
      maxSpeed = Math.max(maxSpeed, sample.speed);
    }
  });
  return maxSpeed > 0 ? maxSpeed : null;
}

function getSpeedScale(speed) {
  // Scale q by recent max speed so the filter remains responsive after fast maneuvers.
  const recentMaxSpeed = getRecentMaxSpeed();
  const speedSource = Number.isFinite(recentMaxSpeed) ? recentMaxSpeed : speed;
  const speedKnots = Number.isFinite(speedSource) ? speedSource * 1.943844 : 0;
  const minKnots = KALMAN_TUNING.processNoise.speedScale.minKnots;
  const anchorKnots = KALMAN_TUNING.processNoise.speedScale.anchorKnots;
  return Math.max(speedKnots, minKnots) / anchorKnots;
}

function initKalmanState(position) {
  // Initialize the filter at the first GPS fix, using accuracy as the initial position variance.
  // The origin anchors the local meter conversion so later math stays stable.
  const origin = { lat: position.coords.latitude, lon: position.coords.longitude };
  const accuracyDefault = KALMAN_TUNING.measurementNoise.accuracyDefaultMeters;
  const accuracyClamp = KALMAN_TUNING.measurementNoise.accuracyClampMeters;
  const accuracy = clamp(position.coords.accuracy || accuracyDefault, accuracyClamp.min, accuracyClamp.max);
  let vx = 0;
  let vy = 0;
  if (Number.isFinite(position.coords.speed) && Number.isFinite(position.coords.heading)) {
    const velocity = computeVelocityFromHeading(position.coords.speed, position.coords.heading);
    vx = velocity.x;
    vy = velocity.y;
  }
  const sigma2 = accuracy ** 2;
  const velVar = KALMAN_TUNING.init.velocityVariance;
  const headingRad = getVelocityHeadingRad(vx, vy) ?? 0;
  return {
    origin,
    lastTs: position.timestamp || getNowMs(),
    accuracy,
    headingRad,
    x: [0, 0, vx, vy],
    P: [
      sigma2, 0, 0, 0,
      0, sigma2, 0, 0,
      0, 0, velVar, 0,
      0, 0, 0, velVar,
    ],
  };
}

function buildPrediction(filter, dt) {
  // Constant-velocity model with tuned acceleration process noise.
  // This is the standard CV form with white acceleration noise mapped into x/y.
  const x = filter.x;
  const P = filter.P;
  if (!Number.isFinite(dt) || dt <= 0) {
    return { xPred: x.slice(), PPred: P.slice() };
  }
  const qBase = getProcessNoiseVariance();
  const speedScale = getSpeedScale(Math.hypot(x[2], x[3]));
  const lateralRatio = KALMAN_TUNING.imu.lateralVarianceRatio;
  // Position noise uses the base acceleration variance; velocity noise scales with speed.
  const qPosForward = qBase;
  const qPosLateral = qBase * lateralRatio;
  const qVelForward = qBase * speedScale;
  const qVelLateral = qVelForward * lateralRatio;
  const headingRad = getCovarianceHeadingRad(x[2], x[3], filter.headingRad);
  const posCov = buildDirectionalCovariance(qPosForward, qPosLateral, headingRad);
  const velCov = buildDirectionalCovariance(qVelForward, qVelLateral, headingRad);
  const dt2 = dt * dt;
  const dt3 = dt2 * dt;
  const dt4 = dt2 * dt2;

  // State transition for CV: x += v*dt, v constant over the step.
  const F = [
    1, 0, dt, 0,
    0, 1, 0, dt,
    0, 0, 1, 0,
    0, 0, 0, 1,
  ];
  // Process noise for CV with white acceleration: Q = G q G^T.
  const qPos00 = posCov.xx * dt4 / 4;
  const qPos01 = posCov.xy * dt4 / 4;
  const qPos11 = posCov.yy * dt4 / 4;
  const qVel00 = velCov.xx * dt3 / 2;
  const qVel01 = velCov.xy * dt3 / 2;
  const qVel11 = velCov.yy * dt3 / 2;
  const qVelV00 = velCov.xx * dt2;
  const qVelV01 = velCov.xy * dt2;
  const qVelV11 = velCov.yy * dt2;

  const Q = [
    qPos00, qPos01, qVel00, qVel01,
    qPos01, qPos11, qVel01, qVel11,
    qVel00, qVel01, qVelV00, qVelV01,
    qVel01, qVel11, qVelV01, qVelV11,
  ];

  // Predict state first so the measurement update has a clean prior.
  const xPred = [
    x[0] + x[2] * dt,
    x[1] + x[3] * dt,
    x[2],
    x[3],
  ];

  // Explicit 4x4 multiply (F * P * F^T + Q) to keep the math transparent.
  const FP = new Array(16).fill(0);
  for (let r = 0; r < 4; r += 1) {
    for (let c = 0; c < 4; c += 1) {
      FP[r * 4 + c] =
        F[r * 4 + 0] * P[0 * 4 + c] +
        F[r * 4 + 1] * P[1 * 4 + c] +
        F[r * 4 + 2] * P[2 * 4 + c] +
        F[r * 4 + 3] * P[3 * 4 + c];
    }
  }
  const PPred = new Array(16).fill(0);
  for (let r = 0; r < 4; r += 1) {
    for (let c = 0; c < 4; c += 1) {
      PPred[r * 4 + c] =
        FP[r * 4 + 0] * F[c * 4 + 0] +
        FP[r * 4 + 1] * F[c * 4 + 1] +
        FP[r * 4 + 2] * F[c * 4 + 2] +
        FP[r * 4 + 3] * F[c * 4 + 3] +
        Q[r * 4 + c];
    }
  }
  return { xPred, PPred };
}

function formatKalmanOutput(filter, timestamp) {
  // Convert back to lat/lon for UI while preserving velocity in meters/second.
  const coords = fromMeters({ x: filter.x[0], y: filter.x[1] }, filter.origin);
  return {
    position: {
      coords: {
        latitude: coords.lat,
        longitude: coords.lon,
        accuracy: filter.accuracy,
      },
      timestamp,
    },
    velocity: { x: filter.x[2], y: filter.x[3] },
    speed: Math.hypot(filter.x[2], filter.x[3]),
  };
}

function applyKalmanFilter(position) {
  // Measurement update with GPS accuracy feeding the R matrix (diagonal, same in x/y).
  if (!position) return null;
  if (!state.kalman) {
    state.kalman = initKalmanState(position);
  }
  const filter = state.kalman;
  const measurementTs = Number.isFinite(position.timestamp) ? position.timestamp : getNowMs();
  const timestamp = Math.max(getNowMs(), measurementTs, filter.lastTs);
  const dtRaw = (timestamp - filter.lastTs) / 1000;
  const dt = clampDtSeconds(dtRaw);
  filter.lastTs = timestamp;
  // Predict once to build the prior used by the GPS update.
  const predicted = buildPrediction(filter, dt);
  const xPred = predicted.xPred;
  const PPred = predicted.PPred;

  // Measurement z is GPS position in the same local meter frame.
  const measurement = toMeters(
    { lat: position.coords.latitude, lon: position.coords.longitude },
    filter.origin
  );
  const z = [measurement.x, measurement.y];
  const accuracyDefault = KALMAN_TUNING.measurementNoise.accuracyDefaultMeters;
  const accuracyClamp = KALMAN_TUNING.measurementNoise.accuracyClampMeters;
  const accuracy = clamp(position.coords.accuracy || accuracyDefault, accuracyClamp.min, accuracyClamp.max);
  filter.accuracy = accuracy;
  // Innovation covariance S = HPH^T + R (H selects position).
  const r = accuracy ** 2;
  const S00 = PPred[0] + r;
  const S01 = PPred[1];
  const S10 = PPred[4];
  const S11 = PPred[5] + r;
  const det = S00 * S11 - S01 * S10;
  if (!Number.isFinite(det) || det === 0) {
    filter.x = xPred;
    filter.P = PPred;
  } else {
    const invS00 = S11 / det;
    const invS01 = -S01 / det;
    const invS10 = -S10 / det;
    const invS11 = S00 / det;

    // Kalman gain K = P H^T S^-1, written out to stay legible.
    const PHt = [
      PPred[0], PPred[1],
      PPred[4], PPred[5],
      PPred[8], PPred[9],
      PPred[12], PPred[13],
    ];
    const K = [
      PHt[0] * invS00 + PHt[1] * invS10,
      PHt[0] * invS01 + PHt[1] * invS11,
      PHt[2] * invS00 + PHt[3] * invS10,
      PHt[2] * invS01 + PHt[3] * invS11,
      PHt[4] * invS00 + PHt[5] * invS10,
      PHt[4] * invS01 + PHt[5] * invS11,
      PHt[6] * invS00 + PHt[7] * invS10,
      PHt[6] * invS01 + PHt[7] * invS11,
    ];

    // Innovation y = z - H xPred.
    const y0 = z[0] - xPred[0];
    const y1 = z[1] - xPred[1];

    xPred[0] += K[0] * y0 + K[1] * y1;
    xPred[1] += K[2] * y0 + K[3] * y1;
    xPred[2] += K[4] * y0 + K[5] * y1;
    xPred[3] += K[6] * y0 + K[7] * y1;

    // Covariance update: P = P - K H P.
    const HP = [
      PPred[0], PPred[1], PPred[2], PPred[3],
      PPred[4], PPred[5], PPred[6], PPred[7],
    ];
    const KHP = new Array(16).fill(0);
    for (let rIdx = 0; rIdx < 4; rIdx += 1) {
      const k0 = K[rIdx * 2];
      const k1 = K[rIdx * 2 + 1];
      KHP[rIdx * 4 + 0] = k0 * HP[0] + k1 * HP[4];
      KHP[rIdx * 4 + 1] = k0 * HP[1] + k1 * HP[5];
      KHP[rIdx * 4 + 2] = k0 * HP[2] + k1 * HP[6];
      KHP[rIdx * 4 + 3] = k0 * HP[3] + k1 * HP[7];
    }
    for (let i = 0; i < 16; i += 1) {
      PPred[i] -= KHP[i];
    }

    filter.x = xPred;
    filter.P = PPred;
  }
  // Update heading from velocity when moving, and blend GPS heading into IMU heading.
  const speed = Math.hypot(filter.x[2], filter.x[3]);
  const minSpeed = KALMAN_TUNING.imu.gpsHeadingMinSpeed;
  if (Number.isFinite(speed) && speed >= minSpeed) {
    const gpsHeading = getVelocityHeadingRad(filter.x[2], filter.x[3]);
    if (Number.isFinite(gpsHeading)) {
      if (!Number.isFinite(filter.headingRad) || !state.imuEnabled) {
        filter.headingRad = gpsHeading;
      } else {
        const imuWeight = KALMAN_TUNING.imu.headingImuWeight;
        const gpsBlend = Math.max(0, Math.min(1, 1 - imuWeight));
        if (gpsBlend > 0) {
          const delta = normalizeAngleRad(gpsHeading - filter.headingRad);
          const applyDelta = delta * gpsBlend;
          filter.headingRad = normalizeAngleRad(filter.headingRad + applyDelta);
          rotateVelocityState(filter, applyDelta);
        }
      }
    }
  }
  return formatKalmanOutput(filter, timestamp);
}

function predictKalmanState(targetTimestamp) {
  // Pure prediction step used between GPS fixes to keep the UI moving smoothly.
  if (!state.kalman) return null;
  const filter = state.kalman;
  const timestamp = Math.max(
    Number.isFinite(targetTimestamp) ? targetTimestamp : getNowMs(),
    filter.lastTs
  );
  const dtRaw = (timestamp - filter.lastTs) / 1000;
  const dt = clampDtSeconds(dtRaw);
  if (dt <= 0) {
    return formatKalmanOutput(filter, timestamp);
  }
  const predicted = buildPrediction(filter, dt);
  filter.x = predicted.xPred;
  filter.P = predicted.PPred;
  filter.lastTs = timestamp;
  return formatKalmanOutput(filter, timestamp);
}

function applyImuHeadingDelta(deltaRad) {
  // Apply a pre-integrated heading delta and rotate velocity to match.
  if (!state.kalman) return;
  if (!Number.isFinite(deltaRad) || deltaRad === 0) return;
  const filter = state.kalman;
  if (!Number.isFinite(filter.headingRad)) {
    filter.headingRad = getVelocityHeadingRad(filter.x[2], filter.x[3]) ?? 0;
  }
  filter.headingRad = normalizeAngleRad(filter.headingRad + deltaRad);
  rotateVelocityState(filter, deltaRad);
}

function applyImuYawRate(yawRateRad, dtSeconds) {
  // Integrate yaw rate to keep heading responsive between GPS updates.
  if (!Number.isFinite(yawRateRad) || !Number.isFinite(dtSeconds) || dtSeconds <= 0) return;
  applyImuHeadingDelta(yawRateRad * dtSeconds);
}

function getKalmanPositionCovariance() {
  // Extract the symmetric 2x2 position block of P for debug use.
  if (!state.kalman || !Array.isArray(state.kalman.P)) return null;
  const covariance = state.kalman.P;
  const xx = covariance[0];
  const xy = (covariance[1] + covariance[4]) / 2;
  const yy = covariance[5];
  if (![xx, xy, yy].every(Number.isFinite)) return null;
  return { xx, xy, yy };
}

function getKalmanProcessPositionCovariance(dtSeconds) {
  // Return the position block of the process noise Q for a given dt.
  // This is used for the debug overlay to visualize anisotropy and rotation.
  if (!state.kalman) return null;
  const dt = Number.isFinite(dtSeconds) && dtSeconds > 0 ? dtSeconds : 1;
  const qBase = getProcessNoiseVariance();
  const lateralRatio = KALMAN_TUNING.imu.lateralVarianceRatio;
  const headingRad = getCovarianceHeadingRad(
    state.kalman.x[2],
    state.kalman.x[3],
    state.kalman.headingRad
  );
  const posCov = buildDirectionalCovariance(qBase, qBase * lateralRatio, headingRad);
  const dt4 = dt * dt * dt * dt;
  return {
    xx: (posCov.xx * dt4) / 4,
    xy: (posCov.xy * dt4) / 4,
    yy: (posCov.yy * dt4) / 4,
  };
}

function getKalmanPredictedPositionCovariance(seconds) {
  // Integrate covariance forward for the time-to-start projection.
  // This uses a repeated predict step so the intent is visible in code.
  if (!state.kalman || !Array.isArray(state.kalman.P)) return null;
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return getKalmanPositionCovariance();
  }
  const qBase = getProcessNoiseVariance();
  const speedScale = getSpeedScale(
    Math.hypot(state.kalman.x[2], state.kalman.x[3])
  );
  const lateralRatio = KALMAN_TUNING.imu.lateralVarianceRatio;
  const qPosForward = qBase;
  const qPosLateral = qBase * lateralRatio;
  const qVelForward = qBase * speedScale;
  const qVelLateral = qVelForward * lateralRatio;
  const headingRad = getCovarianceHeadingRad(
    state.kalman.x[2],
    state.kalman.x[3],
    state.kalman.headingRad
  );
  const posCov = buildDirectionalCovariance(qPosForward, qPosLateral, headingRad);
  const velCov = buildDirectionalCovariance(qVelForward, qVelLateral, headingRad);
  let remaining = seconds;
  let P = state.kalman.P.slice();
  const stepSeconds = KALMAN_TUNING.timing.covariancePredictStepSeconds;
  while (remaining > 0) {
    const dt = Math.min(stepSeconds, remaining);
    remaining -= dt;
    const dt2 = dt * dt;
    const dt3 = dt2 * dt;
    const dt4 = dt2 * dt2;

    const F = [
      1, 0, dt, 0,
      0, 1, 0, dt,
      0, 0, 1, 0,
      0, 0, 0, 1,
    ];
    const qPos00 = posCov.xx * dt4 / 4;
    const qPos01 = posCov.xy * dt4 / 4;
    const qPos11 = posCov.yy * dt4 / 4;
    const qVel00 = velCov.xx * dt3 / 2;
    const qVel01 = velCov.xy * dt3 / 2;
    const qVel11 = velCov.yy * dt3 / 2;
    const qVelV00 = velCov.xx * dt2;
    const qVelV01 = velCov.xy * dt2;
    const qVelV11 = velCov.yy * dt2;

    const Q = [
      qPos00, qPos01, qVel00, qVel01,
      qPos01, qPos11, qVel01, qVel11,
      qVel00, qVel01, qVelV00, qVelV01,
      qVel01, qVel11, qVelV01, qVelV11,
    ];

    const FP = new Array(16).fill(0);
    for (let r = 0; r < 4; r += 1) {
      for (let c = 0; c < 4; c += 1) {
        FP[r * 4 + c] =
          F[r * 4 + 0] * P[0 * 4 + c] +
          F[r * 4 + 1] * P[1 * 4 + c] +
          F[r * 4 + 2] * P[2 * 4 + c] +
          F[r * 4 + 3] * P[3 * 4 + c];
      }
    }
    const PPred = new Array(16).fill(0);
    for (let r = 0; r < 4; r += 1) {
      for (let c = 0; c < 4; c += 1) {
        PPred[r * 4 + c] =
          FP[r * 4 + 0] * F[c * 4 + 0] +
          FP[r * 4 + 1] * F[c * 4 + 1] +
          FP[r * 4 + 2] * F[c * 4 + 2] +
          FP[r * 4 + 3] * F[c * 4 + 3] +
          Q[r * 4 + c];
      }
    }
    P = PPred;
  }
  const xx = P[0];
  const xy = (P[1] + P[4]) / 2;
  const yy = P[5];
  if (![xx, xy, yy].every(Number.isFinite)) return null;
  return { xx, xy, yy };
}

export {
  applyKalmanFilter,
  applyImuYawRate,
  applyImuHeadingDelta,
  predictKalmanState,
  getKalmanPositionCovariance,
  getKalmanProcessPositionCovariance,
  getKalmanPredictedPositionCovariance,
};
