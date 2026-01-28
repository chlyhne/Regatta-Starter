import { state } from "../core/state.js";
import { els } from "./dom.js";
import { formatDistanceWithUnit } from "../core/format.js";

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

export { updateGPSDisplay };
