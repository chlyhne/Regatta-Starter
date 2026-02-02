import { enterVmgView, setVmgSettingsOpen } from "../features/vmg/vmg.js";
import {
  enterLifterView,
  leaveLifterView,
  setLifterSettingsOpen,
} from "../features/lifter/lifter.js";
import {
  enterRaceWindView,
  leaveRaceWindView,
  setRaceWindSettingsOpen,
} from "../features/racewind/racewind.js";
import { renderTrack } from "../features/starter/track.js";
import { fitRaceText } from "../features/starter/race-fit.js";

let navDeps = {
  updateInputs: null,
  updateImuCalibrationUi: null,
  releaseWakeLock: null,
  requestWakeLock: null,
  setGpsMode: null,
};

const VIEW_CONFIG = {
  home: {
    id: "home-view",
    hash: "#home",
    bodyClass: "home-mode",
    scrollTop: true,
    gpsMode: "setup",
    releaseWakeLock: true,
    updateInputs: true,
    updateImuCalibrationUi: true,
  },
  vmg: {
    id: "vmg-view",
    hash: "#vmg",
    bodyClass: "vmg-mode",
    scrollTop: true,
    gpsMode: "race",
    releaseWakeLock: true,
    onEnter: enterVmgView,
  },
  lifter: {
    id: "lifter-view",
    hash: "#lifter",
    bodyClass: "lifter-mode",
    scrollTop: true,
    gpsMode: "race",
    releaseWakeLock: true,
    onEnter: enterLifterView,
    onLeave: leaveLifterView,
  },
  racewind: {
    id: "racewind-view",
    hash: "#racewind",
    bodyClass: "racewind-mode",
    scrollTop: true,
    gpsMode: "setup",
    releaseWakeLock: true,
    onEnter: enterRaceWindView,
    onLeave: leaveRaceWindView,
  },
  race: {
    id: "race-view",
    hash: "#race",
    bodyClass: "race-mode",
    scrollTop: true,
    gpsMode: "race",
    requestWakeLock: true,
    onEnter: fitRaceText,
  },
  coords: {
    id: "coords-view",
    hash: "#coords",
    bodyClass: "coords-mode",
    scrollTop: true,
    gpsMode: "setup",
    releaseWakeLock: true,
    updateInputs: true,
  },
  location: {
    id: "location-view",
    hash: "#location",
    bodyClass: "location-mode",
    scrollTop: false,
    gpsMode: "setup",
    gpsOptions: { force: true, highAccuracy: true },
    releaseWakeLock: true,
  },
  settings: {
    id: "settings-view",
    hash: "#settings",
    bodyClass: "settings-mode",
    scrollTop: true,
    gpsMode: "setup",
    releaseWakeLock: true,
    updateInputs: true,
    updateImuCalibrationUi: true,
  },
  boat: {
    id: "boat-view",
    hash: "#boat",
    bodyClass: "boat-mode",
    scrollTop: true,
    gpsMode: "setup",
    releaseWakeLock: true,
    updateInputs: true,
  },
  info: {
    id: "info-view",
    hash: "#info",
    bodyClass: "info-mode",
    scrollTop: true,
    gpsMode: "setup",
    releaseWakeLock: true,
  },
  track: {
    id: "track-view",
    hash: "#track",
    bodyClass: "track-mode",
    scrollTop: true,
    gpsMode: "setup",
    gpsOptions: { force: true, highAccuracy: true },
    releaseWakeLock: true,
    onEnter: renderTrack,
  },
  setup: {
    id: "setup-view",
    hash: "#setup",
    bodyClass: null,
    scrollTop: false,
    gpsMode: "setup",
    releaseWakeLock: true,
  },
};

const BODY_CLASSES = Object.values(VIEW_CONFIG)
  .map((config) => config.bodyClass)
  .filter(Boolean);

const VIEW_IDS = Object.values(VIEW_CONFIG)
  .map((config) => config.id)
  .filter(Boolean);

const HASH_TO_VIEW = Object.entries(VIEW_CONFIG).reduce((acc, [key, config]) => {
  if (config.hash) {
    acc[config.hash] = key;
  }
  return acc;
}, {});

let currentView = null;

function initNavigation(deps = {}) {
  navDeps = { ...navDeps, ...deps };
}

function setView(view) {
  const targetKey = VIEW_CONFIG[view] ? view : "home";
  const target = VIEW_CONFIG[targetKey];
  if (!target) return;

  if (currentView && currentView !== targetKey) {
    const previous = VIEW_CONFIG[currentView];
    if (previous && typeof previous.onLeave === "function") {
      previous.onLeave();
    }
  }

  setVmgSettingsOpen(false);
  setLifterSettingsOpen(false);
  setRaceWindSettingsOpen(false);

  BODY_CLASSES.forEach((name) => document.body.classList.remove(name));
  VIEW_IDS.forEach((id) => {
    const section = document.getElementById(id);
    if (section) {
      section.setAttribute("aria-hidden", "true");
    }
  });

  if (target.bodyClass) {
    document.body.classList.add(target.bodyClass);
  }
  const activeSection = document.getElementById(target.id);
  if (activeSection) {
    activeSection.setAttribute("aria-hidden", "false");
  }
  if (target.hash) {
    history.replaceState(null, "", target.hash);
  }
  if (target.scrollTop) {
    window.scrollTo({ top: 0, behavior: "instant" });
  }

  if (target.updateInputs && navDeps.updateInputs) {
    navDeps.updateInputs();
  }
  if (target.updateImuCalibrationUi && navDeps.updateImuCalibrationUi) {
    navDeps.updateImuCalibrationUi();
  }

  if (target.requestWakeLock && navDeps.requestWakeLock) {
    navDeps.requestWakeLock();
  } else if (navDeps.releaseWakeLock) {
    navDeps.releaseWakeLock();
  }

  if (target.gpsMode && navDeps.setGpsMode) {
    navDeps.setGpsMode(target.gpsMode, target.gpsOptions);
  }

  if (typeof target.onEnter === "function") {
    target.onEnter();
  }

  currentView = targetKey;
}

function syncViewFromHash() {
  const view = HASH_TO_VIEW[location.hash];
  if (view) {
    setView(view);
    return;
  }
  setView("home");
}

export { initNavigation, setView, syncViewFromHash };
