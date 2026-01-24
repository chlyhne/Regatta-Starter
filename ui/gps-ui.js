import { state } from "../core/state.js";
import { els } from "./dom.js";
import { toMeters } from "../core/geo.js";
import { formatDistanceWithUnit } from "../core/format.js";
import { BUILD_STAMP } from "../build.js";

function updateGPSDisplay() {
  const icons = [els.gpsIcon, els.vmgGpsIcon, els.lifterGpsIcon].filter(Boolean);
  if (!icons.length) return;
  if (!state.position) {
    icons.forEach((icon) => {
      icon.classList.remove("ok", "bad", "warn");
      icon.classList.add("bad");
      icon.title = "GPS waiting";
    });
    return;
  }
  const accuracy = state.position.coords.accuracy;
  icons.forEach((icon) => {
    if (accuracy <= 10) {
      icon.classList.add("ok");
      icon.classList.remove("bad", "warn");
    } else if (accuracy <= 25) {
      icon.classList.add("warn");
      icon.classList.remove("ok", "bad");
    } else {
      icon.classList.add("bad");
      icon.classList.remove("ok", "warn");
    }
    icon.title = `GPS accuracy ${formatDistanceWithUnit(accuracy)}`;
  });
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
  const imuLabel = state.imuEnabled ? "IMU: ON" : "IMU: OFF";
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
  if (els.debugImuRotation) {
    const rot = state.imu?.lastRotation;
    if (rot) {
      const a = rot.alpha.toFixed(1);
      const b = rot.beta.toFixed(1);
      const g = rot.gamma.toFixed(1);
      els.debugImuRotation.textContent = `IMU rot: a ${a} b ${b} g ${g} deg/s`;
    } else {
      els.debugImuRotation.textContent = "IMU rot: --";
    }
  }
  if (els.debugImuYaw) {
    const yawRate = state.imu?.lastYawRate;
    const gravity = state.imu?.gravity;
    if (Number.isFinite(yawRate)) {
      const yawDeg = (yawRate * 180) / Math.PI;
      let gravityText = "";
      if (gravity) {
        const gx = gravity.x.toFixed(2);
        const gy = gravity.y.toFixed(2);
        const gz = gravity.z.toFixed(2);
        gravityText = ` g ${gx},${gy},${gz}`;
      }
      els.debugImuYaw.textContent = `IMU yaw: ${yawDeg.toFixed(1)} deg/s${gravityText}`;
    } else {
      els.debugImuYaw.textContent = "IMU yaw: --";
    }
  }
}

export { updateGPSDisplay, updateDebugControls };
