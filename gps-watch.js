import { state, GPS_RETRY_DELAY_MS, GPS_STALE_MS } from "./state.js";
import { els } from "./dom.js";

const GPS_OPTIONS_RACE = {
  enableHighAccuracy: true,
  maximumAge: 0,
  timeout: 5000,
};
const GPS_OPTIONS_SETUP = {
  enableHighAccuracy: false,
  maximumAge: 10000,
  timeout: 20000,
};

function getGpsOptionsForMode(mode) {
  return mode === "race" ? GPS_OPTIONS_RACE : GPS_OPTIONS_SETUP;
}

function clearGpsRetryTimer() {
  if (!state.gpsRetryTimer) return;
  clearTimeout(state.gpsRetryTimer);
  state.gpsRetryTimer = null;
}

function stopDebugGps() {
  if (!state.debugIntervalId) return;
  clearInterval(state.debugIntervalId);
  state.debugIntervalId = null;
}

function stopRealGps() {
  if (state.geoWatchId !== null && navigator.geolocation) {
    navigator.geolocation.clearWatch(state.geoWatchId);
  }
  state.geoWatchId = null;
  clearGpsRetryTimer();
}

function startDebugGps(handlePosition, createDebugPosition) {
  stopRealGps();
  if (state.debugIntervalId) return;
  handlePosition(createDebugPosition());
  state.debugIntervalId = setInterval(() => {
    handlePosition(createDebugPosition());
  }, 1000);
}

function startRealGps(handlePosition, handlePositionError, options = GPS_OPTIONS_SETUP) {
  stopDebugGps();
  if (!navigator.geolocation) {
    if (els.gpsIcon) {
      els.gpsIcon.classList.add("bad");
      els.gpsIcon.title = "Geolocation unavailable";
    }
    return;
  }
  if (state.geoWatchId !== null) {
    navigator.geolocation.clearWatch(state.geoWatchId);
    state.geoWatchId = null;
  }
  state.geoWatchId = navigator.geolocation.watchPosition(
    handlePosition,
    handlePositionError,
    options
  );
}

function isGpsStale() {
  if (state.debugGpsEnabled) return false;
  if (state.geoWatchId === null) return false;
  if (!state.lastGpsFixAt) return true;
  return Date.now() - state.lastGpsFixAt > GPS_STALE_MS;
}

function scheduleGpsRetry(handlePosition, handlePositionError) {
  if (state.debugGpsEnabled) return;
  if (state.gpsRetryTimer) return;
  state.gpsRetryTimer = setTimeout(() => {
    state.gpsRetryTimer = null;
    if (state.debugGpsEnabled) return;
    startRealGps(handlePosition, handlePositionError, GPS_OPTIONS_RACE);
  }, GPS_RETRY_DELAY_MS);
}

function requestHighPrecisionPosition(handlePosition, handlePositionError, callback) {
  if (!navigator.geolocation) {
    handlePositionError(new Error("Geolocation unavailable"));
    return;
  }
  navigator.geolocation.getCurrentPosition(
    (position) => {
      handlePosition(position);
      if (callback) callback(position);
    },
    handlePositionError,
    GPS_OPTIONS_RACE
  );
}

export {
  GPS_OPTIONS_RACE,
  getGpsOptionsForMode,
  clearGpsRetryTimer,
  stopDebugGps,
  startDebugGps,
  startRealGps,
  isGpsStale,
  scheduleGpsRetry,
  requestHighPrecisionPosition,
};
