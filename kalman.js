import { state } from "./state.js";
import { toMeters, fromMeters } from "./geo.js";
import { computeVelocityFromHeading } from "./velocity.js";

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function initKalmanState(position) {
  const origin = { lat: position.coords.latitude, lon: position.coords.longitude };
  const accuracy = clamp(position.coords.accuracy || 10, 3, 50);
  let vx = 0;
  let vy = 0;
  if (Number.isFinite(position.coords.speed) && Number.isFinite(position.coords.heading)) {
    const velocity = computeVelocityFromHeading(position.coords.speed, position.coords.heading);
    vx = velocity.x;
    vy = velocity.y;
  }
  const sigma2 = accuracy ** 2;
  return {
    origin,
    lastTs: position.timestamp || Date.now(),
    x: [0, 0, vx, vy],
    P: [
      sigma2, 0, 0, 0,
      0, sigma2, 0, 0,
      0, 0, 25, 0,
      0, 0, 0, 25,
    ],
  };
}

function applyKalmanFilter(position) {
  if (!position) return null;
  if (!state.kalman) {
    state.kalman = initKalmanState(position);
  }
  const filter = state.kalman;
  const timestamp = position.timestamp || Date.now();
  const dtRaw = (timestamp - filter.lastTs) / 1000;
  if (!Number.isFinite(dtRaw) || dtRaw <= 0) {
    const coords = fromMeters({ x: filter.x[0], y: filter.x[1] }, filter.origin);
    return {
      position: {
        coords: {
          latitude: coords.lat,
          longitude: coords.lon,
          accuracy: position.coords.accuracy,
        },
        timestamp,
      },
      velocity: { x: filter.x[2], y: filter.x[3] },
      speed: Math.hypot(filter.x[2], filter.x[3]),
    };
  }

  const dt = clamp(dtRaw, 0.2, 5);
  filter.lastTs = timestamp;

  const q = 0.8;
  const dt2 = dt * dt;
  const dt3 = dt2 * dt;
  const dt4 = dt2 * dt2;

  const F = [
    1, 0, dt, 0,
    0, 1, 0, dt,
    0, 0, 1, 0,
    0, 0, 0, 1,
  ];
  const Q = [
    q * dt4 / 4, 0, q * dt3 / 2, 0,
    0, q * dt4 / 4, 0, q * dt3 / 2,
    q * dt3 / 2, 0, q * dt2, 0,
    0, q * dt3 / 2, 0, q * dt2,
  ];

  const x = filter.x;
  const P = filter.P;

  const xPred = [
    x[0] + x[2] * dt,
    x[1] + x[3] * dt,
    x[2],
    x[3],
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

  const measurement = toMeters(
    { lat: position.coords.latitude, lon: position.coords.longitude },
    filter.origin
  );
  const z = [measurement.x, measurement.y];
  const accuracy = clamp(position.coords.accuracy || 10, 3, 50);
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

    const y0 = z[0] - xPred[0];
    const y1 = z[1] - xPred[1];

    xPred[0] += K[0] * y0 + K[1] * y1;
    xPred[1] += K[2] * y0 + K[3] * y1;
    xPred[2] += K[4] * y0 + K[5] * y1;
    xPred[3] += K[6] * y0 + K[7] * y1;

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

  const coords = fromMeters({ x: filter.x[0], y: filter.x[1] }, filter.origin);
  return {
    position: {
      coords: {
        latitude: coords.lat,
        longitude: coords.lon,
        accuracy: position.coords.accuracy,
      },
      timestamp,
    },
    velocity: { x: filter.x[2], y: filter.x[3] },
    speed: Math.hypot(filter.x[2], filter.x[3]),
  };
}

export { applyKalmanFilter };
