import { state } from "./state.js";
import { els } from "./dom.js";
import { toMeters } from "./geo.js";
import { formatDistanceWithUnit } from "./format.js";
import { BUILD_STAMP } from "./build.js";

function updateGPSDisplay() {
  if (!els.gpsIcon) return;
  if (!state.position) {
    els.gpsIcon.classList.remove("ok", "bad", "warn");
    els.gpsIcon.classList.add("bad");
    els.gpsIcon.title = "GPS waiting";
    return;
  }
  const accuracy = state.position.coords.accuracy;
  if (accuracy <= 10) {
    els.gpsIcon.classList.add("ok");
    els.gpsIcon.classList.remove("bad", "warn");
  } else if (accuracy <= 25) {
    els.gpsIcon.classList.add("warn");
    els.gpsIcon.classList.remove("ok", "bad");
  } else {
    els.gpsIcon.classList.add("bad");
    els.gpsIcon.classList.remove("ok", "warn");
  }
  els.gpsIcon.title = `GPS accuracy ${formatDistanceWithUnit(accuracy)}`;
}

function updateDebugControls() {
  if (els.debugGpsToggle) {
    const label = state.debugGpsEnabled ? "Simulate GPS: on" : "Simulate GPS: off";
    els.debugGpsToggle.textContent = label;
    els.debugGpsToggle.setAttribute(
      "aria-pressed",
      state.debugGpsEnabled ? "true" : "false"
    );
  }
  const imuLabel = state.imuEnabled ? "IMU: on" : "IMU: off";
  if (els.debugImuToggle) {
    els.debugImuToggle.textContent = imuLabel;
    els.debugImuToggle.setAttribute(
      "aria-pressed",
      state.imuEnabled ? "true" : "false"
    );
  }
  if (els.raceImuToggle) {
    els.raceImuToggle.textContent = imuLabel;
    els.raceImuToggle.setAttribute(
      "aria-pressed",
      state.imuEnabled ? "true" : "false"
    );
  }
  if (els.debugGpsStatus) {
    let status = "GPS: --";
    if (state.debugGpsEnabled) {
      status = "GPS: debug";
    } else if (!navigator.geolocation) {
      status = "GPS: unavailable";
    } else if (state.geoWatchId === null) {
      status = "GPS: idle";
    } else if (!state.lastGpsFixAt) {
      status = "GPS: waiting";
    } else {
      const ageSec = Math.max(0, Math.round((Date.now() - state.lastGpsFixAt) / 1000));
      status = `GPS: ${ageSec}s ago`;
    }
    els.debugGpsStatus.textContent = `${status} (build ${BUILD_STAMP})`;
  }
  if (els.debugGpsDelta) {
    let deltaText = "Δ: --";
    if (state.gpsTrackRaw.length >= 2) {
      const current = state.gpsTrackRaw[state.gpsTrackRaw.length - 1];
      const previous = state.gpsTrackRaw[state.gpsTrackRaw.length - 2];
      const origin = { lat: previous.lat, lon: previous.lon };
      const delta = toMeters(current, origin);
      const deltaMeters = Math.hypot(delta.x, delta.y);
      const accuracy = state.position?.coords?.accuracy;
      const accuracyText = Number.isFinite(accuracy)
        ? ` ±${formatDistanceWithUnit(accuracy)}`
        : "";
      deltaText = `Δ: ${formatDistanceWithUnit(deltaMeters)}${accuracyText}`;
    }
    els.debugGpsDelta.textContent = deltaText;
  }
}

export { updateGPSDisplay, updateDebugControls };
