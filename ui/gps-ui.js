import { state } from "../core/state.js";
import { els } from "./dom.js";
import { formatDistanceWithUnit } from "../core/format.js";

function updateGPSDisplay() {
  const icons = [els.gpsIcon, els.vmgGpsIcon, els.lifterGpsIcon].filter(Boolean);
  if (!icons.length) return;
  if (!state.gpsEnabled) {
    icons.forEach((icon) => {
      icon.classList.remove("ok", "bad", "warn");
      icon.classList.add("off");
      icon.title = "GPS off";
    });
    return;
  }
  if (!state.position) {
    icons.forEach((icon) => {
      icon.classList.remove("ok", "bad", "warn", "off");
      icon.classList.add("bad");
      icon.title = "GPS waiting";
    });
    return;
  }
  const accuracy = state.position.coords.accuracy;
  icons.forEach((icon) => {
    icon.classList.remove("off");
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

function updateImuDisplay() {
  const icons = [els.imuIcon, els.vmgImuIcon, els.lifterImuIcon].filter(Boolean);
  if (!icons.length) return;
  icons.forEach((icon) => {
    icon.classList.remove("ok", "warn", "bad", "off");
    if (state.imuEnabled) {
      icon.classList.add("ok");
      icon.title = "IMU on";
    } else {
      icon.classList.add("off");
      icon.title = "IMU off";
    }
  });
}

export { updateGPSDisplay, updateImuDisplay };
