import { homeView } from "../features/home/home.view.js";
import { setupView } from "../features/starter/setup.view.js";
import { vmgView } from "../features/vmg/vmg.view.js";
import { lifterView } from "../features/lifter/lifter.view.js";
import { raceKblView } from "../features/racekbl/racekbl.view.js";
import { raceView } from "../features/starter/race.view.js";
import { coordsView } from "../features/starter/coords.view.js";
import { locationView } from "../features/starter/location.view.js";
import { settingsView } from "../features/settings/settings.view.js";
import { boatView } from "../features/settings/boat.view.js";
import { infoView } from "../features/settings/info.view.js";
import { trackView } from "../features/starter/track.view.js";
import { modalsView } from "./modals.view.js";

const appShell = [
  homeView,
  setupView,
  vmgView,
  lifterView,
  raceKblView,
  raceView,
  coordsView,
  locationView,
  settingsView,
  boatView,
  infoView,
  trackView,
  modalsView,
].join("\n");

function renderAppShell(container) {
  if (!container) return;
  container.innerHTML = appShell;
}

export { renderAppShell };
