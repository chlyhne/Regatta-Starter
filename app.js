import { els } from "./ui/dom.js";
import { state } from "./core/state.js";
import { unlockAudio } from "./core/audio.js";
import { applyForwardOffset, toRadians } from "./core/geo.js";
import { applyKalmanFilter, applyImuHeadingDelta, predictKalmanState } from "./core/kalman.js";
import { recordTrackPoints, renderTrack } from "./features/starter/track.js";
import { updateGPSDisplay, updateImuDisplay } from "./ui/gps-ui.js";
import {
  updateStatusUnitLabels,
  updateRaceMetricLabels,
  updateLineProjection,
} from "./features/starter/race.js";
import * as gpsWatch from "./core/gps-watch.js";
import {
  computeVelocityFromHeading,
  computeVelocityFromPositions,
} from "./core/velocity.js";
import {
  loadSettings as loadSettingsFromStorage,
  saveSettings as saveSettingsToStorage,
} from "./core/settings.js";
import { KALMAN_TUNING } from "./core/tuning.js";
import { getNowMs } from "./core/clock.js";
import {
  applyVmgSettings,
  bindVmgEvents,
  getVmgPersistedSettings,
  getVmgSettingsSnapshot,
  initVmg,
  resetVmgEstimator,
  syncVmgWindowUi,
  updateVmgEstimate,
  updateVmgGpsState,
  updateVmgImuToggle,
  updateVmgSmoothToggle,
  updateVmgCapToggle,
} from "./features/vmg/vmg.js";
import {
  bindLifterEvents,
  getLifterSettingsSnapshot,
  initLifter,
  updateLifterImuToggle,
  resetLifterHistory,
  recordLifterHeadingFromPosition,
  requestLifterRender,
} from "./features/lifter/lifter.js";
import { clamp, headingFromVelocity } from "./core/common.js";
import {
  initReplay,
  loadReplayEntries,
  startReplay,
  stopReplay,
  setReplaySpeed,
  setReplayLoop,
  getReplayState,
  formatReplaySpeed,
} from "./core/replay.js";
import {
  initStarter,
  initStarterUi,
  bindStarterEvents,
  syncStarterInputs,
  loadSavedLines,
  syncLineNameWithSavedLines,
  updateStartDisplay,
} from "./features/starter/starter.js";
import {
  initHome,
  bindHomeEvents,
  syncReplayUi,
  syncRecordingUi,
} from "./features/home/home.js";
import {
  initSettingsView,
  bindSettingsEvents,
  syncSettingsInputs,
} from "./features/settings/settings-view.js";
import { initNavigation, setView, syncViewFromHash } from "./ui/navigation.js";
import {
  isRecordingEnabled,
  startRecording,
  stopRecording,
  recordSample,
  configureRecordingUpload,
  resumeUploadQueue,
} from "./core/recording.js";
import { BUILD_STAMP } from "./build.js";

const NO_CACHE_KEY = "racetimer-nocache";
const DIAG_ENDPOINT_URL = "https://racetimer-upload.hummesse.workers.dev";
const SPEED_HISTORY_WINDOW_MS =
  KALMAN_TUNING.processNoise.speedScale.recentMaxSpeedWindowSeconds * 1000;
const KALMAN_PREDICT_HZ = 5;
const KALMAN_PREDICT_INTERVAL_MS = Math.round(1000 / KALMAN_PREDICT_HZ);
const IMU_MAPPING_DEFAULT = { axes: ["alpha", "beta", "gamma"], signs: [1, 1, 1] };
const IMU_MAPPING_CANDIDATES = buildImuMappingCandidates();
const {
  GPS_OPTIONS_RACE,
  getGpsOptionsForMode,
  clearGpsRetryTimer,
  startRealGps,
  isGpsStale,
  scheduleGpsRetry,
} = gpsWatch;
const stopRealGps =
  typeof gpsWatch.stopRealGps === "function" ? gpsWatch.stopRealGps : () => {};
let kalmanPredictTimer = null;
let lastKalmanPredictionTs = 0;
let imuListening = false;
let imuCalibrationActive = false;
let imuCalibrationSamples = [];
let imuCalibrationTimer = null;
let imuCalibrationError = "";
let replayPrevImuEnabled = false;

function updateViewportHeight() {
  const height = window.visualViewport?.height || window.innerHeight;
  if (!Number.isFinite(height)) return;
  document.documentElement.style.setProperty("--app-height", `${height}px`);
}

function updateSensorToggleButtons() {
  const gpsButtons = Array.from(els.gpsStatusToggles || []);
  const imuButtons = Array.from(els.imuStatusToggles || []);
  const disable = state.replay.active || state.replay.loading;
  gpsButtons.forEach((button) => {
    button.setAttribute("aria-pressed", state.gpsEnabled ? "true" : "false");
    button.disabled = disable;
  });
  imuButtons.forEach((button) => {
    button.setAttribute("aria-pressed", state.imuEnabled ? "true" : "false");
    button.disabled = disable;
  });
}

function bindSensorStatusEvents() {
  const gpsButtons = Array.from(els.gpsStatusToggles || []);
  const imuButtons = Array.from(els.imuStatusToggles || []);
  gpsButtons.forEach((button) => {
    button.addEventListener("click", () => {
      if (state.replay.active || state.replay.loading) return;
      setGpsEnabled(!state.gpsEnabled);
    });
  });
  imuButtons.forEach((button) => {
    button.addEventListener("click", async () => {
      if (state.replay.active || state.replay.loading) return;
      await setImuEnabled(!state.imuEnabled);
      updateSensorToggleButtons();
    });
  });
}

function markGpsUnavailable() {
  if (!state.gpsEnabled) {
    updateGPSDisplay();
    return;
  }
  const icons = [els.gpsIcon, els.vmgGpsIcon, els.lifterGpsIcon].filter(Boolean);
  if (!icons.length) return;
  icons.forEach((icon) => {
    icon.classList.add("bad");
    icon.classList.remove("ok", "warn");
    icon.title = "Geolocation unavailable";
  });
}

function getDeviceInfoSnapshot() {
  return {
    userAgent: navigator.userAgent || "",
    platform: navigator.platform || "",
    language: navigator.language || "",
    hardwareConcurrency: navigator.hardwareConcurrency || null,
    deviceMemory: navigator.deviceMemory || null,
    screen: {
      width: window.screen?.width || null,
      height: window.screen?.height || null,
      availWidth: window.screen?.availWidth || null,
      availHeight: window.screen?.availHeight || null,
      pixelRatio: window.devicePixelRatio || 1,
    },
  };
}

function getSettingsSnapshot() {
  return {
    line: {
      a: { ...state.line.a },
      b: { ...state.line.b },
    },
    lineMeta: {
      name: state.lineName,
      sourceId: state.lineSourceId,
    },
    coordsFormat: state.coordsFormat,
    headingSourceByMode: state.headingSourceByMode,
    soundEnabled: state.soundEnabled,
    timeFormat: state.timeFormat,
    speedUnit: state.speedUnit,
    distanceUnit: state.distanceUnit,
    bowOffsetMeters: state.bowOffsetMeters,
    boatLengthMeters: state.boatLengthMeters,
    boatModel: state.boatModel,
    boatShape: state.boatShape,
    boatWeightKg: state.boatWeightKg,
    imuCalibration: state.imuCalibration,
    replayLoop: state.replay?.loop,
    start: { ...state.start },
    vmg: getVmgSettingsSnapshot(),
    lifter: getLifterSettingsSnapshot(),
  };
}

async function startRecordingSession(note) {
  if (state.replay?.active || state.replay?.loading) {
    return { ok: false, error: "Stop replay before recording." };
  }
  const result = await startRecording({
    note: note || "",
    settings: getSettingsSnapshot(),
    device: getDeviceInfoSnapshot(),
    app: { build: BUILD_STAMP },
  });
  if (result && result.ok) {
    setGpsMode(state.gpsMode, { force: true, highAccuracy: true });
  }
  return result;
}

function stopRecordingSession() {
  stopRecording();
  setGpsMode(state.gpsMode, { force: true });
  syncRecordingUi();
}

async function startReplaySession(entry) {
  if (isRecordingEnabled()) {
    stopRecordingSession();
  }
  return await startReplay(entry);
}

function extractPositionPayload(position) {
  if (!position || !position.coords) return null;
  const coords = position.coords;
  return {
    lat: Number.isFinite(coords.latitude) ? coords.latitude : null,
    lon: Number.isFinite(coords.longitude) ? coords.longitude : null,
    accuracy: Number.isFinite(coords.accuracy) ? coords.accuracy : null,
    speed: Number.isFinite(coords.speed) ? coords.speed : null,
    heading: Number.isFinite(coords.heading) ? coords.heading : null,
    altitude: Number.isFinite(coords.altitude) ? coords.altitude : null,
    altitudeAccuracy: Number.isFinite(coords.altitudeAccuracy) ? coords.altitudeAccuracy : null,
    speedAccuracy: Number.isFinite(coords.speedAccuracy) ? coords.speedAccuracy : null,
    headingAccuracy: Number.isFinite(coords.headingAccuracy) ? coords.headingAccuracy : null,
  };
}

function recordGpsSample(position) {
  if (!isRecordingEnabled()) return;
  const coords = extractPositionPayload(position);
  if (!coords) return;
  const gpsTimeMs = Number.isFinite(position.timestamp) ? position.timestamp : null;
  const deviceTimeMs = Date.now();
  const payload = {
    ...coords,
    coords,
    gpsTimeMs,
    deviceTimeMs,
  };
  recordSample("gps", payload, deviceTimeMs);
}

function toFiniteNumber(value) {
  if (value === null || value === undefined) return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function buildReplayPosition(coords, timestamp) {
  if (!coords) return null;
  const lat = toFiniteNumber(coords.latitude ?? coords.lat);
  const lon = toFiniteNumber(coords.longitude ?? coords.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const position = {
    coords: {
      latitude: lat,
      longitude: lon,
      accuracy: toFiniteNumber(coords.accuracy),
      speed: toFiniteNumber(coords.speed),
      heading: toFiniteNumber(coords.heading),
      altitude: toFiniteNumber(coords.altitude),
      altitudeAccuracy: toFiniteNumber(coords.altitudeAccuracy),
      speedAccuracy: toFiniteNumber(coords.speedAccuracy),
      headingAccuracy: toFiniteNumber(coords.headingAccuracy),
    },
    timestamp,
  };
  return position;
}

function applyDerivedReplaySample(sample, timestamp) {
  if (!sample || !sample.position) return;
  const position = buildReplayPosition(sample.position, timestamp);
  if (!position) return;

  let velocity = null;
  if (sample.velocity && Number.isFinite(sample.velocity.x) && Number.isFinite(sample.velocity.y)) {
    velocity = { x: sample.velocity.x, y: sample.velocity.y };
  }
  let speed = Number.isFinite(sample.speed) ? sample.speed : null;
  if (!velocity) {
    const coords = position.coords;
    if (Number.isFinite(coords.speed) && Number.isFinite(coords.heading)) {
      velocity = computeVelocityFromHeading(coords.speed, coords.heading);
      speed = Number.isFinite(speed) ? speed : coords.speed;
    } else {
      const computed = computeVelocityFromPositions(position, state.lastPosition);
      velocity = { x: computed.x, y: computed.y };
      speed = Number.isFinite(speed) ? speed : computed.speed;
    }
  }
  if (!Number.isFinite(speed)) {
    speed = Math.hypot(velocity.x, velocity.y);
  }

  const bowPosition = sample.bowPosition
    ? buildReplayPosition(sample.bowPosition, timestamp)
    : applyForwardOffset(position, velocity, state.bowOffsetMeters);

  state.velocity = velocity;
  state.speed = speed;
  state.position = position;
  state.bowPosition = bowPosition;
  state.kalmanPosition = sample.source === "kalman" ? position : null;
  state.lastGpsFixAt = timestamp;
  recordLifterHeadingFromPosition(position);
  recordTrackPoints(position, position, bowPosition);
  recordSpeedSample(speed, timestamp);
  state.lastPosition = position;
  updateGPSDisplay();
  updateLineProjection();
  updateVmgEstimate(position);
}

function applyReplayEvent(sample, playback = {}) {
  if (!sample) return;
  if (sample.type === "gps") {
    const timestamp = Number.isFinite(playback.gpsTimeMs)
      ? playback.gpsTimeMs
      : playback.deviceTimeMs;
    const position = buildReplayPosition(sample.coords, timestamp);
    if (!position) return;
    handlePosition(position, { source: "replay" });
    return;
  }
  if (sample.type === "imu-delta") {
    const delta = Number(sample.deltaHeadingRad);
    if (Number.isFinite(delta)) {
      queueImuHeadingDelta(delta);
    }
    return;
  }
  if (sample.type === "imu") {
    return;
  }
  if (sample.type === "derived") {
    const timestamp = Number.isFinite(playback.deviceTimeMs)
      ? playback.deviceTimeMs
      : sample.ts;
    applyDerivedReplaySample(sample, timestamp);
  }
}

function readDebugFlagFromUrl() {
  const params = new URLSearchParams(window.location.search);
  let raw = params.get("debug");
  if (raw === null) {
    const hash = window.location.hash || "";
    const trimmed = hash.startsWith("#") ? hash.slice(1) : hash;
    let query = "";
    if (trimmed.includes("?")) {
      query = trimmed.split("?")[1];
    } else if (trimmed.includes("&")) {
      query = trimmed.split("&").slice(1).join("&");
    } else if (trimmed.startsWith("debug=")) {
      query = trimmed;
    }
    if (query) {
      raw = new URLSearchParams(query).get("debug");
    }
  }
  if (raw === null) return null;
  const normalized = raw.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return null;
}

function applyDebugFlagFromUrl() {
  const flag = readDebugFlagFromUrl();
  if (flag === null) return;
  document.body.classList.toggle("debug-mode", flag === true);
}

function syncNoCacheToken() {
  const url = new URL(window.location.href);
  const token = url.searchParams.get("nocache");
  if (token) {
    sessionStorage.setItem(NO_CACHE_KEY, token);
  }
}

function getNoCacheQuery() {
  const token = sessionStorage.getItem(NO_CACHE_KEY);
  if (!token) return "";
  return `?nocache=${encodeURIComponent(token)}`;
}

async function hardReload() {
  const url = new URL(window.location.href);
  const token = String(Date.now());
  sessionStorage.setItem(NO_CACHE_KEY, token);
  url.searchParams.set("nocache", token);

  try {
    if ("serviceWorker" in navigator) {
      const registration = await navigator.serviceWorker.getRegistration();
      if (registration) {
        await registration.update();
        if (registration.waiting) {
          registration.waiting.postMessage({ type: "SKIP_WAITING" });
        }
      }
    }
  } catch {
    // Ignore update errors; the reload still bypasses caches via nocache.
  }

  window.location.replace(url.toString());
}

function clearNoCacheParam() {
  const url = new URL(window.location.href);
  const token = url.searchParams.get("nocache");
  if (!token) return;
  sessionStorage.setItem(NO_CACHE_KEY, token);
}

function buildImuMappingCandidates() {
  const permutations = [
    ["alpha", "beta", "gamma"],
    ["alpha", "gamma", "beta"],
    ["beta", "alpha", "gamma"],
    ["beta", "gamma", "alpha"],
    ["gamma", "alpha", "beta"],
    ["gamma", "beta", "alpha"],
  ];
  const candidates = [];
  permutations.forEach((axes) => {
    for (const sx of [-1, 1]) {
      for (const sy of [-1, 1]) {
        for (const sz of [-1, 1]) {
          candidates.push({ axes, signs: [sx, sy, sz] });
        }
      }
    }
  });
  return candidates;
}

function isImuCalibrated() {
  const calibration = state.imuCalibration;
  return (
    calibration &&
    Array.isArray(calibration.axes) &&
    calibration.axes.length === 3 &&
    Array.isArray(calibration.signs) &&
    calibration.signs.length === 3
  );
}

function getImuMapping() {
  return isImuCalibrated() ? state.imuCalibration : IMU_MAPPING_DEFAULT;
}

function mapRotationToVector(rotation, mapping) {
  if (!rotation) return { x: 0, y: 0, z: 0 };
  const axes = mapping?.axes || IMU_MAPPING_DEFAULT.axes;
  const signs = mapping?.signs || IMU_MAPPING_DEFAULT.signs;
  const values = {
    alpha: Number.isFinite(rotation.alpha) ? rotation.alpha : 0,
    beta: Number.isFinite(rotation.beta) ? rotation.beta : 0,
    gamma: Number.isFinite(rotation.gamma) ? rotation.gamma : 0,
  };
  return {
    x: (values[axes[0]] || 0) * (signs[0] || 1),
    y: (values[axes[1]] || 0) * (signs[1] || 1),
    z: (values[axes[2]] || 0) * (signs[2] || 1),
  };
}

function getImuGravityAlpha() {
  const config = KALMAN_TUNING.imu.gravityLowPass;
  const baseLength = config.baseBoatLengthMeters;
  const boatLength = Number.isFinite(state.boatLengthMeters) ? state.boatLengthMeters : baseLength;
  const effectiveLength = Math.max(baseLength, boatLength);
  const scale = Math.sqrt(baseLength / effectiveLength);
  return clamp(config.baseAlpha * scale, config.minAlpha, config.maxAlpha);
}

function updateGravityFromEvent(accel, linear) {
  if (!accel) return null;
  const raw = {
    x: Number(accel.x) || 0,
    y: Number(accel.y) || 0,
    z: Number(accel.z) || 0,
  };
  let next = raw;
  if (linear) {
    const lx = Number(linear.x) || 0;
    const ly = Number(linear.y) || 0;
    const lz = Number(linear.z) || 0;
    const candidate = { x: raw.x - lx, y: raw.y - ly, z: raw.z - lz };
    const candidateMag = Math.hypot(candidate.x, candidate.y, candidate.z);
    if (Number.isFinite(candidateMag) && candidateMag > 0.1) {
      next = candidate;
    }
  }
  if (!state.imu.gravity) {
    state.imu.gravity = { ...next };
  } else {
    const alpha = getImuGravityAlpha();
    state.imu.gravity.x += alpha * (next.x - state.imu.gravity.x);
    state.imu.gravity.y += alpha * (next.y - state.imu.gravity.y);
    state.imu.gravity.z += alpha * (next.z - state.imu.gravity.z);
  }
  return state.imu.gravity;
}

function readImuSample(event) {
  const accel = event.accelerationIncludingGravity;
  const gravity = updateGravityFromEvent(accel, event.acceleration);
  if (!gravity) return null;
  const rotation = event.rotationRate;
  if (!rotation) return null;
  const alpha = Number(rotation.alpha);
  const beta = Number(rotation.beta);
  const gamma = Number(rotation.gamma);
  state.imu.lastRotation = {
    alpha: Number.isFinite(alpha) ? alpha : 0,
    beta: Number.isFinite(beta) ? beta : 0,
    gamma: Number.isFinite(gamma) ? gamma : 0,
  };
  return {
    rotation: { alpha, beta, gamma },
    gravity: { ...gravity },
  };
}

function resetImuState() {
  state.imu.gravity = null;
  state.imu.lastTimestamp = null;
  state.imu.lastRotation = null;
  state.imu.lastYawRate = null;
  state.imu.pendingHeadingDeltaRad = 0;
}

function queueImuHeadingDelta(deltaRad) {
  if (!Number.isFinite(deltaRad) || deltaRad === 0) return;
  const current = Number.isFinite(state.imu.pendingHeadingDeltaRad)
    ? state.imu.pendingHeadingDeltaRad
    : 0;
  state.imu.pendingHeadingDeltaRad = current + deltaRad;
}

function processImuEvent(event, options = {}) {
  const force = options.force === true;
  if (!state.imuEnabled && !force) return;
  const sample = readImuSample(event);
  if (!sample) return;
  const mapping = options.mapping || getImuMapping();
  const omegaDeg = mapRotationToVector(sample.rotation, mapping);
  const omegaX = toRadians(omegaDeg.x);
  const omegaY = toRadians(omegaDeg.y);
  const omegaZ = toRadians(omegaDeg.z);
  const g = sample.gravity;
  const gMag = Math.hypot(g.x, g.y, g.z);
  if (!Number.isFinite(gMag) || gMag <= 0) return;
  const gx = g.x / gMag;
  const gy = g.y / gMag;
  const gz = g.z / gMag;
  const yawRate = -(omegaX * gx + omegaY * gy + omegaZ * gz);
  state.imu.lastYawRate = yawRate;

  const timestamp = Number.isFinite(event.timeStamp) ? event.timeStamp : Date.now();
  if (!Number.isFinite(state.imu.lastTimestamp)) {
    state.imu.lastTimestamp = timestamp;
    return;
  }
  const dtRaw = (timestamp - state.imu.lastTimestamp) / 1000;
  state.imu.lastTimestamp = timestamp;
  const dtClamp = KALMAN_TUNING.imu.dtClampSeconds;
  const dt = clamp(dtRaw, dtClamp.min, dtClamp.max);
  if (dt <= 0) return;
  queueImuHeadingDelta(yawRate * dt);
}

function handleDeviceMotion(event) {
  if (state.replay?.active || state.replay?.loading) {
    return;
  }
  processImuEvent(event);
}

async function requestImuPermission() {
  if (typeof DeviceMotionEvent === "undefined") return false;
  if (typeof DeviceMotionEvent.requestPermission !== "function") return true;
  try {
    const result = await DeviceMotionEvent.requestPermission();
    return result === "granted";
  } catch (err) {
    return false;
  }
}

function stopImu() {
  if (imuListening) {
    window.removeEventListener("devicemotion", handleDeviceMotion);
    imuListening = false;
  }
  state.imuEnabled = false;
  resetImuState();
}

async function startImu() {
  if (imuListening) return true;
  if (typeof DeviceMotionEvent === "undefined") return false;
  const granted = await requestImuPermission();
  if (!granted) return false;
  window.addEventListener("devicemotion", handleDeviceMotion, { passive: true });
  imuListening = true;
  state.imuEnabled = true;
  resetImuState();
  if (state.kalman) {
    const vx = state.kalman.x[2];
    const vy = state.kalman.x[3];
    const heading = Math.atan2(vx, vy);
    if (Number.isFinite(heading)) {
      state.kalman.headingRad = heading;
    }
  }
  return true;
}

async function setImuEnabled(enabled) {
  const next = Boolean(enabled);
  if (next === state.imuEnabled) return;
  if (!next) {
    stopImu();
    updateVmgImuToggle();
    updateLifterImuToggle();
    updateImuDisplay();
    updateSensorToggleButtons();
    return;
  }
  if (!isImuCalibrated()) {
    const goToSettings = window.confirm(
      "IMU needs calibration before use. Open Settings to calibrate now?"
    );
    if (goToSettings) {
      setView("settings");
      openImuCalibrationModal();
    }
    return;
  }
  const started = await startImu();
  if (!started) {
    window.alert("IMU permission was not granted on this device.");
  }
  updateVmgImuToggle();
  updateLifterImuToggle();
  updateImuDisplay();
  updateSensorToggleButtons();
}

function updateImuCalibrationUi() {
  const calibrated = isImuCalibrated();
  if (els.openImuCalibration) {
    els.openImuCalibration.textContent = calibrated ? "Recalibrate IMU" : "Calibrate IMU";
  }
  if (els.imuCalibrationStatus) {
    els.imuCalibrationStatus.textContent = calibrated
      ? "IMU: calibrated"
      : "IMU: not calibrated";
  }
  if (els.startImuCalibration) {
    els.startImuCalibration.disabled = imuCalibrationActive;
  }
  if (els.imuCalibrationProgress) {
    let text = "Ready.";
    if (imuCalibrationError) {
      text = imuCalibrationError;
    } else if (imuCalibrationActive) {
      text = "Rotating... keep clockwise.";
    } else if (calibrated) {
      text = "Calibration saved.";
    } else {
      text = "Not calibrated.";
    }
    els.imuCalibrationProgress.textContent = text;
  }
}

function openImuCalibrationModal() {
  document.body.classList.add("imu-calibration-open");
  if (els.imuCalibrationModal) {
    els.imuCalibrationModal.setAttribute("aria-hidden", "false");
  }
  updateImuCalibrationUi();
}

function closeImuCalibrationModal() {
  stopImuCalibration();
  document.body.classList.remove("imu-calibration-open");
  if (els.imuCalibrationModal) {
    els.imuCalibrationModal.setAttribute("aria-hidden", "true");
  }
}

function computeImuCalibrationMapping(samples) {
  const minRotation = KALMAN_TUNING.imu.calibration.minRotationDegPerSec;
  const minSamples = KALMAN_TUNING.imu.calibration.minSamples;
  const minYawMean = KALMAN_TUNING.imu.calibration.minYawMeanDegPerSec;
  const minPositiveFraction = KALMAN_TUNING.imu.calibration.minPositiveFraction;
  const valid = samples.filter((sample) => {
    const rotation = sample.rotation;
    if (!rotation) return false;
    const mag = Math.hypot(
      Number(rotation.alpha) || 0,
      Number(rotation.beta) || 0,
      Number(rotation.gamma) || 0
    );
    return Number.isFinite(mag) && mag >= minRotation;
  });
  if (valid.length < minSamples) {
    return null;
  }

  let best = null;
  let bestScore = -Infinity;
  let bestStats = null;
  IMU_MAPPING_CANDIDATES.forEach((candidate) => {
    let sum = 0;
    let count = 0;
    let positive = 0;
    valid.forEach((sample) => {
      const g = sample.gravity;
      const gMag = Math.hypot(g.x, g.y, g.z);
      if (!Number.isFinite(gMag) || gMag <= 0) return;
      const ghat = { x: g.x / gMag, y: g.y / gMag, z: g.z / gMag };
      const omegaDeg = mapRotationToVector(sample.rotation, candidate);
      const dot = omegaDeg.x * ghat.x + omegaDeg.y * ghat.y + omegaDeg.z * ghat.z;
      const yawRate = -dot;
      if (!Number.isFinite(yawRate)) return;
      sum += yawRate;
      if (yawRate > 0) {
        positive += 1;
      }
      count += 1;
    });
    if (!count) return;
    const score = sum / count;
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
      bestStats = {
        meanYaw: score,
        positiveFraction: positive / count,
      };
    }
  });

  if (
    !best ||
    !Number.isFinite(bestScore) ||
    bestScore <= 0 ||
    !bestStats ||
    bestStats.meanYaw < minYawMean ||
    bestStats.positiveFraction < minPositiveFraction
  ) {
    return null;
  }
  return {
    axes: [...best.axes],
    signs: [...best.signs],
    calibratedAt: Date.now(),
  };
}

function handleImuCalibrationMotion(event) {
  const sample = readImuSample(event);
  if (!sample) return;
  imuCalibrationSamples.push(sample);
}

function stopImuCalibration() {
  if (imuCalibrationTimer) {
    clearTimeout(imuCalibrationTimer);
    imuCalibrationTimer = null;
  }
  window.removeEventListener("devicemotion", handleImuCalibrationMotion);
  imuCalibrationActive = false;
}

async function startImuCalibration() {
  if (imuCalibrationActive) return;
  imuCalibrationError = "";
  if (state.imuEnabled) {
    stopImu();
    updateVmgImuToggle();
    updateLifterImuToggle();
  }
  const granted = await requestImuPermission();
  if (!granted) {
    imuCalibrationError = "IMU permission not granted.";
    updateImuCalibrationUi();
    return;
  }
  imuCalibrationSamples = [];
  resetImuState();
  imuCalibrationActive = true;
  updateImuCalibrationUi();
  window.addEventListener("devicemotion", handleImuCalibrationMotion, { passive: true });
  const durationMs = KALMAN_TUNING.imu.calibration.durationSeconds * 1000;
  imuCalibrationTimer = setTimeout(() => {
    stopImuCalibration();
    const mapping = computeImuCalibrationMapping(imuCalibrationSamples);
    if (!mapping) {
      imuCalibrationError = "Calibration failed. Rotate clockwise and try again.";
      updateImuCalibrationUi();
      return;
    }
    state.imuCalibration = mapping;
    saveSettings();
    updateImuCalibrationUi();
  }, durationMs);
}

async function requestWakeLock() {
  if (!("wakeLock" in navigator)) return;
  try {
    if (state.wakeLock) return;
    state.wakeLock = await navigator.wakeLock.request("screen");
  } catch (err) {
    console.warn("Wake lock failed", err);
  }
}

function releaseWakeLock() {
  if (!state.wakeLock) return;
  state.wakeLock.release().catch(() => {});
  state.wakeLock = null;
}

function loadSettings() {
  const settings = loadSettingsFromStorage();
  state.line = settings.line;
  state.coordsFormat = settings.coordsFormat;
  state.lineName = settings.lineMeta?.name || null;
  state.lineSourceId = settings.lineMeta?.sourceId || null;
  state.useKalman = true;
  state.headingSourceByMode = settings.headingSourceByMode;
  state.bowOffsetMeters = settings.bowOffsetMeters;
  state.boatLengthMeters = settings.boatLengthMeters;
  state.boatModel = settings.boatModel || "";
  state.boatShape = settings.boatShape || "";
  state.boatWeightKg = settings.boatWeightKg || 0;
  state.imuCalibration = settings.imuCalibration || null;
  state.diagUploadToken = settings.diagUploadToken || "";
  state.replay.loop = Boolean(settings.replayLoop);
  state.soundEnabled = settings.soundEnabled;
  state.timeFormat = settings.timeFormat;
  state.speedUnit = settings.speedUnit;
  state.distanceUnit = settings.distanceUnit;
  state.start = { ...state.start, ...settings.start };
  applyVmgSettings(settings.vmg || {});
  delete state.start.preStartSign;
}

function saveSettings() {
  saveSettingsToStorage({
    line: state.line,
    lineMeta: {
      name: state.lineName,
      sourceId: state.lineSourceId,
    },
    coordsFormat: state.coordsFormat,
    useKalman: true,
    headingSourceByMode: state.headingSourceByMode,
    bowOffsetMeters: state.bowOffsetMeters,
    boatLengthMeters: state.boatLengthMeters,
    boatModel: state.boatModel,
    boatShape: state.boatShape,
    boatWeightKg: state.boatWeightKg,
    imuCalibration: state.imuCalibration,
    diagUploadToken: state.diagUploadToken,
    replayLoop: Boolean(state.replay?.loop),
    soundEnabled: state.soundEnabled,
    timeFormat: state.timeFormat,
    speedUnit: state.speedUnit,
    distanceUnit: state.distanceUnit,
    vmg: getVmgPersistedSettings(),
    start: {
      mode: state.start.mode,
      countdownSeconds: state.start.countdownSeconds,
      absoluteTime: state.start.absoluteTime,
      startTs: state.start.startTs,
      crossedEarly: state.start.crossedEarly,
    },
  });
}

function updateInputs() {
  syncStarterInputs();
  syncSettingsInputs();
  syncVmgWindowUi();
  updateVmgImuToggle();
  updateLifterImuToggle();
  updateVmgSmoothToggle();
  updateVmgCapToggle();
  updateStatusUnitLabels();
}

function handleReplayStatus() {
  syncReplayUi();
}

function resetPositionState() {
  state.position = null;
  state.bowPosition = null;
  state.kalmanPosition = null;
  state.lastPosition = null;
  state.velocity = { x: 0, y: 0 };
  state.speed = 0;
  state.speedHistory = [];
  state.kalman = null;
  lastKalmanPredictionTs = 0;
  resetVmgEstimator();
  state.gpsTrackRaw = [];
  state.gpsTrackDevice = [];
  state.gpsTrackFiltered = [];
  state.lastGpsFixAt = null;
  updateGPSDisplay();
  updateLineProjection();
}

function prepareReplaySession(info = {}) {
  replayPrevImuEnabled = state.imuEnabled;
  stopRealGps();
  if (replayPrevImuEnabled) {
    stopImu();
  }
  state.imuEnabled = Boolean(info.hasImu);
  resetImuState();
  resetPositionState();
  resetLifterHistory();
  requestLifterRender({ force: true });
  updateVmgImuToggle();
  updateLifterImuToggle();
  updateImuDisplay();
  updateSensorToggleButtons();
}

function resumeFromReplay() {
  if (replayPrevImuEnabled) {
    startImu();
  } else {
    stopImu();
  }
  setGpsMode(state.gpsMode, { force: true });
  replayPrevImuEnabled = false;
  updateVmgImuToggle();
  updateLifterImuToggle();
  updateImuDisplay();
  updateSensorToggleButtons();
}

function recordSpeedSample(speed, timestamp) {
  if (!Number.isFinite(speed)) return;
  const ts = Number.isFinite(timestamp) ? timestamp : Date.now();
  state.speedHistory.push({ ts, speed });
  const cutoff = ts - SPEED_HISTORY_WINDOW_MS;
  while (state.speedHistory.length && state.speedHistory[0].ts < cutoff) {
    state.speedHistory.shift();
  }
}

function setGpsEnabled(enabled) {
  const next = Boolean(enabled);
  if (next === state.gpsEnabled) return;
  state.gpsEnabled = next;
  if (!next) {
    stopRealGps();
    clearGpsRetryTimer();
    updateGPSDisplay();
    updateSensorToggleButtons();
    return;
  }
  if (state.replay.active || state.replay.loading) {
    updateGPSDisplay();
    updateSensorToggleButtons();
    return;
  }
  setGpsMode(state.gpsMode, { force: true });
  updateGPSDisplay();
  updateSensorToggleButtons();
}

function setGpsMode(mode, options = {}) {
  const prev = state.gpsMode;
  const next = mode === "race" ? "race" : "setup";
  const force = Boolean(options.force);
  const highAccuracy = Boolean(options.highAccuracy);
  const recordingHighAccuracy = isRecordingEnabled();
  const wantsHighAccuracy = highAccuracy || recordingHighAccuracy;
  state.gpsMode = next;
  if (!state.gpsEnabled) {
    stopRealGps();
    clearGpsRetryTimer();
    updateGPSDisplay();
    return;
  }
  if (state.replay.active) {
    return;
  }
  if (!force && state.geoWatchId !== null && prev === next && !wantsHighAccuracy && !isGpsStale()) {
    return;
  }
  const gpsOptions = wantsHighAccuracy ? GPS_OPTIONS_RACE : getGpsOptionsForMode(state.gpsMode);
  startRealGps(handlePosition, handlePositionError, gpsOptions, markGpsUnavailable);
}

function applyKalmanEstimate(result, options = {}) {
  if (!result) return;
  const rawPosition = options.rawPosition || null;
  const recordTrack = options.recordTrack !== false;
  const source = options.source || "update";
  // Keep device position/velocity as the canonical state; compute bow separately.
  const bowPosition = applyForwardOffset(
    result.position,
    result.velocity,
    state.bowOffsetMeters
  );
  state.kalmanPosition = result.position;
  state.position = result.position;
  state.bowPosition = bowPosition;
  state.velocity = result.velocity;
  state.speed = result.speed;
  recordLifterHeadingFromPosition(result.position);
  if (recordTrack) {
    recordTrackPoints(rawPosition, result.position, bowPosition);
  }
  updateGPSDisplay();
  updateLineProjection();
  updateVmgEstimate(result.position);
}

function startKalmanPredictionLoop() {
  if (kalmanPredictTimer) return;
  kalmanPredictTimer = setInterval(() => {
    if (!state.kalman) return;
    const now = getNowMs();
    if (!Number.isFinite(now)) return;
    if (now <= state.kalman.lastTs || now <= lastKalmanPredictionTs) {
      return;
    }
    const pendingDelta = Number.isFinite(state.imu.pendingHeadingDeltaRad)
      ? state.imu.pendingHeadingDeltaRad
      : 0;
    state.imu.pendingHeadingDeltaRad = 0;
    if (pendingDelta !== 0) {
      applyImuHeadingDelta(pendingDelta);
    }
    const prediction = predictKalmanState(now);
    if (!prediction) return;
    const ts = prediction.position?.timestamp || now;
    lastKalmanPredictionTs = ts;
    if (isRecordingEnabled() && state.imuEnabled) {
      recordSample("imu-delta", { deltaHeadingRad: pendingDelta }, ts);
    }
    applyKalmanEstimate(prediction, { source: "predict" });
  }, KALMAN_PREDICT_INTERVAL_MS);
}

function handlePosition(position, options = {}) {
  if ((state.replay?.active || state.replay?.loading) && options.source !== "replay") {
    return;
  }
  recordGpsSample(position);
  const filtered = applyKalmanFilter(position);
  state.lastGpsFixAt = position.timestamp || Date.now();
  clearGpsRetryTimer();
  if (filtered) {
    applyKalmanEstimate(filtered, { rawPosition: position, source: "update" });
    recordSpeedSample(filtered.speed, position.timestamp || Date.now());
    state.lastPosition = state.position;
    return;
  }
  const coords = position.coords;
  if (Number.isFinite(coords.speed) && Number.isFinite(coords.heading)) {
    state.speed = coords.speed;
    state.velocity = computeVelocityFromHeading(coords.speed, coords.heading);
  } else {
    const computed = computeVelocityFromPositions(position, state.lastPosition);
    state.speed = computed.speed;
    state.velocity = { x: computed.x, y: computed.y };
  }
  state.position = position;
  state.bowPosition = applyForwardOffset(
    position,
    state.velocity,
    state.bowOffsetMeters
  );
  recordLifterHeadingFromPosition(position);
  // Raw fallback: track device and bow separately, consistent with Kalman path.
  state.kalmanPosition = null;
  recordTrackPoints(position, position, state.bowPosition);
  recordSpeedSample(state.speed, position.timestamp || Date.now());
  state.lastPosition = state.position;
  updateGPSDisplay();
  updateLineProjection();
  updateVmgEstimate(position);
}

function handlePositionError(err) {
  if (!state.gpsEnabled) {
    updateGPSDisplay();
    return;
  }
  const icons = [els.gpsIcon, els.vmgGpsIcon, els.lifterGpsIcon].filter(Boolean);
  if (!icons.length) return;
  icons.forEach((icon) => {
    icon.classList.add("bad");
    icon.classList.remove("ok", "warn");
    icon.title = `GPS error: ${err.message}`;
  });
  if (err && (err.code === 2 || err.code === 3)) {
    scheduleGpsRetry(handlePosition, handlePositionError, markGpsUnavailable);
  }
}

function initGeolocation() {
  if (state.replay.active || !state.gpsEnabled) {
    return;
  }
  setGpsMode(state.gpsMode, { force: true });
}

function registerServiceWorker() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch((err) => {
      console.warn("Service worker failed", err);
    });
  }
}

function bindEvents() {
  bindHomeEvents();
  bindStarterEvents();
  bindSettingsEvents();
  bindVmgEvents();
  bindLifterEvents();
  bindSensorStatusEvents();
  window.addEventListener("hashchange", syncViewFromHash);
}

function tick() {
  updateLineProjection();
  updateStartDisplay();
  updateVmgGpsState();
  if (document.body.classList.contains("track-mode")) {
    renderTrack();
  }
  if (state.gpsEnabled && isGpsStale()) {
    scheduleGpsRetry(handlePosition, handlePositionError, markGpsUnavailable);
  }
  requestAnimationFrame(() => {
    setTimeout(tick, 1000);
  });
}

loadSettings();
configureRecordingUpload({
  endpoint: DIAG_ENDPOINT_URL,
  getToken: () => state.diagUploadToken || "",
  maxQueueBytes: 5 * 1024 * 1024,
  chunkTargetBytes: 512 * 1024 * 16,
});
resumeUploadQueue();
window.addEventListener("online", resumeUploadQueue);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    resumeUploadQueue();
  }
});
applyDebugFlagFromUrl();
syncNoCacheToken();
initStarterUi();
loadSavedLines();
syncLineNameWithSavedLines();
updateInputs();
updateRaceMetricLabels();
initHome({
  setView,
  getNoCacheQuery,
  startRecording: startRecordingSession,
  stopRecording: stopRecordingSession,
  isRecordingEnabled,
  getReplayState,
  loadReplayEntries,
  startReplay: startReplaySession,
  stopReplay,
  setReplaySpeed,
  setReplayLoop,
  formatReplaySpeed,
});
initReplay({
  onSample: applyReplayEvent,
  onReset: prepareReplaySession,
  onStop: resumeFromReplay,
  onStatus: handleReplayStatus,
});
initSettingsView({ saveSettings, setView, updateStartDisplay });
initStarter({
  saveSettings,
  updateInputs,
  setView,
  setGpsMode,
  setImuEnabled,
  handlePosition,
  handlePositionError,
  openImuCalibrationModal,
  startImuCalibration,
  closeImuCalibrationModal,
});
initNavigation({
  updateInputs,
  updateImuCalibrationUi,
  releaseWakeLock,
  requestWakeLock,
  setGpsMode,
});
initVmg({
  setImuEnabled,
  hardReload,
  saveSettings,
});
initLifter({
  setImuEnabled,
});
bindEvents();
initGeolocation();
startKalmanPredictionLoop();
registerServiceWorker();
clearNoCacheParam();
updateStartDisplay();
updateGPSDisplay();
updateImuDisplay();
updateImuCalibrationUi();
updateSensorToggleButtons();
syncViewFromHash();
tick();
updateViewportHeight();

window.addEventListener("resize", () => {
  updateViewportHeight();
  if (document.body.classList.contains("lifter-mode")) {
    requestLifterRender({ force: true });
  }
  if (document.body.classList.contains("track-mode")) {
    renderTrack();
  }
});

if (window.visualViewport) {
  window.visualViewport.addEventListener("resize", updateViewportHeight);
}

document.addEventListener("click", unlockAudio, { once: true });
document.addEventListener("touchstart", unlockAudio, { once: true });
document.addEventListener("pointerdown", unlockAudio, { once: true });

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && document.body.classList.contains("race-mode")) {
    requestWakeLock();
  }
});
