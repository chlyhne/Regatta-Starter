// RaceTimer tuning constants.
//
// This file holds the "magic numbers" used to tune the Kalman filter.
// The goal is to keep the filter stable on slow boats and responsive on fast boats,
// while adapting to GPS accuracy automatically.
//
// Notes:
// - We use a constant-velocity (CV) model with continuous white acceleration noise.
// - `q` below is the acceleration variance (units ~ (m/s²)²). Larger `q` lets the
//   velocity estimate change faster (more responsive, more noise).
// - Boat length scaling: for similar displacement boats, typical acceleration scales
//   roughly as 1/L, so acceleration variance scales as 1/L^2. We reduce `q` with L^2
//   above an anchor length (capped at the anchor so smaller boats don't increase `q`).
// - Speed scaling: for very low speeds, GPS headings/velocities are unreliable, so
//   we keep a minimum responsiveness. Above 1 knot we scale linearly with speed,
//   anchored so the historical/static tuning corresponds to 3 knots. We use the
//   recent max speed (instead of current speed) as a proxy for potential acceleration.
//
// Full math + physical arguments: docs/kalman.md

const KALMAN_TUNING = {
  processNoise: {
    baseAccelerationVariance: 3.2,
    baseBoatLengthMeters: 3,
    speedScale: {
      minKnots: 1,
      anchorKnots: 3,
      recentMaxSpeedWindowSeconds: 300,
    },
  },
  measurementNoise: {
    // iOS reports `coords.accuracy` as a 1-sigma radius in meters (roughly).
    // We clamp it to avoid absurdly low/high values from destabilizing the filter.
    accuracyDefaultMeters: 10,
    accuracyClampMeters: { min: 3, max: 50 },
  },
  timing: {
    // GPS update intervals can jitter; clamping dt prevents single weird updates from
    // dominating the filter.
    dtClampSeconds: { min: 0.2, max: 5 },
    // For "predict covariance to start time", we run multiple predict steps to keep it simple.
    covariancePredictStepSeconds: 0.5,
  },
  init: {
    // Initial velocity uncertainty (m/s)^2. This gives the filter freedom to learn vx/vy quickly
    // from early measurements.
    velocityVariance: 25,
  },
  imu: {
    // IMU heading fusion: IMU dominates, GPS nudges toward its heading when moving fast enough.
    headingImuWeight: 0.9,
    gpsHeadingMinSpeed: 0.8,
    // Process noise anisotropy: sideways acceleration variance as a fraction of forward.
    lateralVarianceRatio: 0.1,
    dtClampSeconds: {
      min: 0.005,
      max: 0.25,
    },
    gravityLowPass: {
      baseAlpha: 0.12,
      baseBoatLengthMeters: 3,
      minAlpha: 0.04,
      maxAlpha: 0.3,
    },
    calibration: {
      durationSeconds: 3,
      minRotationDegPerSec: 8,
      minSamples: 20,
      minYawMeanDegPerSec: 6,
      minPositiveFraction: 0.7,
    },
  },
};

export { KALMAN_TUNING };
