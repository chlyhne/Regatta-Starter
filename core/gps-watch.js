import { state, GPS_RETRY_DELAY_MS, GPS_STALE_MS } from "./state.js";

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

function stopRealGps() {
  if (state.geoWatchId !== null && navigator.geolocation) {
    navigator.geolocation.clearWatch(state.geoWatchId);
  }
  state.geoWatchId = null;
  clearGpsRetryTimer();
}

function startRealGps(
  handlePosition,
  handlePositionError,
  options = GPS_OPTIONS_SETUP,
  onUnavailable
) {
  if (!navigator.geolocation) {
    if (typeof onUnavailable === "function") {
      onUnavailable();
    }
    return false;
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
  return true;
}

function isGpsStale() {
  if (state.geoWatchId === null) return false;
  if (!state.lastGpsFixAt) return true;
  return Date.now() - state.lastGpsFixAt > GPS_STALE_MS;
}

function scheduleGpsRetry(handlePosition, handlePositionError, onUnavailable) {
  if (state.gpsRetryTimer) return;
  state.gpsRetryTimer = setTimeout(() => {
    state.gpsRetryTimer = null;
    startRealGps(handlePosition, handlePositionError, GPS_OPTIONS_RACE, onUnavailable);
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
  startRealGps,
  isGpsStale,
  scheduleGpsRetry,
  requestHighPrecisionPosition,
};
