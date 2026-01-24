import { enterVmgView, setVmgSettingsOpen } from "../features/vmg/vmg.js";
import { enterLifterView, leaveLifterView, setLifterSettingsOpen } from "../features/lifter/lifter.js";
import { renderTrack } from "../features/starter/track.js";
import { fitRaceText } from "../features/starter/race-fit.js";

let navDeps = {
  updateInputs: null,
  updateImuCalibrationUi: null,
  releaseWakeLock: null,
  requestWakeLock: null,
  setGpsMode: null,
};

function initNavigation(deps = {}) {
  navDeps = { ...navDeps, ...deps };
}

function setView(view) {
  const leavingLifter = document.body.classList.contains("lifter-mode") && view !== "lifter";
  if (leavingLifter) {
    leaveLifterView();
  }
  setVmgSettingsOpen(false);
  setLifterSettingsOpen(false);
  document.body.classList.remove(
    "home-mode",
    "vmg-mode",
    "lifter-mode",
    "race-mode",
    "coords-mode",
    "location-mode",
    "settings-mode",
    "boat-mode",
    "info-mode",
    "track-mode"
  );
  [
    "home-view",
    "vmg-view",
    "lifter-view",
    "race-view",
    "coords-view",
    "location-view",
    "settings-view",
    "boat-view",
    "info-view",
    "track-view",
    "setup-view",
  ].forEach((id) => {
    const section = document.getElementById(id);
    if (section) {
      section.setAttribute("aria-hidden", "true");
    }
  });

  if (view === "home") {
    if (navDeps.updateInputs) {
      navDeps.updateInputs();
    }
    if (navDeps.updateImuCalibrationUi) {
      navDeps.updateImuCalibrationUi();
    }
    document.body.classList.remove("race-mode");
    document.body.classList.remove("coords-mode");
    document.body.classList.remove("location-mode");
    document.body.classList.remove("info-mode");
    document.body.classList.remove("track-mode");
    document.body.classList.add("home-mode");
    document.getElementById("race-view").setAttribute("aria-hidden", "true");
    document.getElementById("coords-view").setAttribute("aria-hidden", "true");
    document.getElementById("location-view").setAttribute("aria-hidden", "true");
    document.getElementById("info-view").setAttribute("aria-hidden", "true");
    document.getElementById("track-view").setAttribute("aria-hidden", "true");
    document.getElementById("setup-view").setAttribute("aria-hidden", "true");
    document.getElementById("home-view").setAttribute("aria-hidden", "false");
    history.replaceState(null, "", "#home");
    window.scrollTo({ top: 0, behavior: "instant" });
    if (navDeps.releaseWakeLock) {
      navDeps.releaseWakeLock();
    }
    if (navDeps.setGpsMode) {
      navDeps.setGpsMode("setup");
    }
    return;
  }
  if (view === "vmg") {
    document.body.classList.remove("race-mode");
    document.body.classList.remove("coords-mode");
    document.body.classList.remove("location-mode");
    document.body.classList.remove("info-mode");
    document.body.classList.remove("track-mode");
    document.body.classList.add("vmg-mode");
    document.getElementById("race-view").setAttribute("aria-hidden", "true");
    document.getElementById("coords-view").setAttribute("aria-hidden", "true");
    document.getElementById("location-view").setAttribute("aria-hidden", "true");
    document.getElementById("info-view").setAttribute("aria-hidden", "true");
    document.getElementById("track-view").setAttribute("aria-hidden", "true");
    document.getElementById("setup-view").setAttribute("aria-hidden", "true");
    document.getElementById("vmg-view").setAttribute("aria-hidden", "false");
    history.replaceState(null, "", "#vmg");
    window.scrollTo({ top: 0, behavior: "instant" });
    if (navDeps.releaseWakeLock) {
      navDeps.releaseWakeLock();
    }
    if (navDeps.setGpsMode) {
      navDeps.setGpsMode("setup");
    }
    enterVmgView();
    return;
  }
  if (view === "lifter") {
    document.body.classList.remove("race-mode");
    document.body.classList.remove("coords-mode");
    document.body.classList.remove("location-mode");
    document.body.classList.remove("info-mode");
    document.body.classList.remove("track-mode");
    document.body.classList.add("lifter-mode");
    document.getElementById("race-view").setAttribute("aria-hidden", "true");
    document.getElementById("coords-view").setAttribute("aria-hidden", "true");
    document.getElementById("location-view").setAttribute("aria-hidden", "true");
    document.getElementById("info-view").setAttribute("aria-hidden", "true");
    document.getElementById("track-view").setAttribute("aria-hidden", "true");
    document.getElementById("setup-view").setAttribute("aria-hidden", "true");
    document.getElementById("lifter-view").setAttribute("aria-hidden", "false");
    history.replaceState(null, "", "#lifter");
    window.scrollTo({ top: 0, behavior: "instant" });
    if (navDeps.releaseWakeLock) {
      navDeps.releaseWakeLock();
    }
    if (navDeps.setGpsMode) {
      navDeps.setGpsMode("setup");
    }
    enterLifterView();
    return;
  }
  if (view === "race") {
    document.body.classList.add("race-mode");
    document.body.classList.remove("coords-mode");
    document.body.classList.remove("location-mode");
    document.body.classList.remove("info-mode");
    document.body.classList.remove("track-mode");
    document.getElementById("race-view").setAttribute("aria-hidden", "false");
    document.getElementById("coords-view").setAttribute("aria-hidden", "true");
    document.getElementById("info-view").setAttribute("aria-hidden", "true");
    document.getElementById("track-view").setAttribute("aria-hidden", "true");
    document.getElementById("setup-view").setAttribute("aria-hidden", "true");
    history.replaceState(null, "", "#race");
    window.scrollTo({ top: 0, behavior: "instant" });
    if (navDeps.requestWakeLock) {
      navDeps.requestWakeLock();
    }
    if (navDeps.setGpsMode) {
      navDeps.setGpsMode("race");
    }
    fitRaceText();
    return;
  }
  if (view === "coords") {
    if (navDeps.updateInputs) {
      navDeps.updateInputs();
    }
    document.body.classList.remove("race-mode");
    document.body.classList.add("coords-mode");
    document.body.classList.remove("location-mode");
    document.body.classList.remove("info-mode");
    document.body.classList.remove("track-mode");
    document.getElementById("race-view").setAttribute("aria-hidden", "true");
    document.getElementById("coords-view").setAttribute("aria-hidden", "false");
    document.getElementById("location-view").setAttribute("aria-hidden", "true");
    document.getElementById("info-view").setAttribute("aria-hidden", "true");
    document.getElementById("track-view").setAttribute("aria-hidden", "true");
    document.getElementById("setup-view").setAttribute("aria-hidden", "true");
    history.replaceState(null, "", "#coords");
    window.scrollTo({ top: 0, behavior: "instant" });
    if (navDeps.releaseWakeLock) {
      navDeps.releaseWakeLock();
    }
    if (navDeps.setGpsMode) {
      navDeps.setGpsMode("setup");
    }
    return;
  }
  if (view === "location") {
    document.body.classList.remove("race-mode");
    document.body.classList.remove("coords-mode");
    document.body.classList.add("location-mode");
    document.body.classList.remove("info-mode");
    document.body.classList.remove("track-mode");
    document.getElementById("race-view").setAttribute("aria-hidden", "true");
    document.getElementById("coords-view").setAttribute("aria-hidden", "true");
    document.getElementById("location-view").setAttribute("aria-hidden", "false");
    document.getElementById("info-view").setAttribute("aria-hidden", "true");
    document.getElementById("track-view").setAttribute("aria-hidden", "true");
    document.getElementById("setup-view").setAttribute("aria-hidden", "true");
    history.replaceState(null, "", "#location");
    if (navDeps.releaseWakeLock) {
      navDeps.releaseWakeLock();
    }
    if (navDeps.setGpsMode) {
      navDeps.setGpsMode("setup", { force: true, highAccuracy: true });
    }
    return;
  }
  if (view === "settings") {
    if (navDeps.updateInputs) {
      navDeps.updateInputs();
    }
    if (navDeps.updateImuCalibrationUi) {
      navDeps.updateImuCalibrationUi();
    }
    document.body.classList.remove("race-mode");
    document.body.classList.remove("coords-mode");
    document.body.classList.remove("location-mode");
    document.body.classList.add("settings-mode");
    document.body.classList.remove("info-mode");
    document.body.classList.remove("track-mode");
    document.getElementById("race-view").setAttribute("aria-hidden", "true");
    document.getElementById("coords-view").setAttribute("aria-hidden", "true");
    document.getElementById("location-view").setAttribute("aria-hidden", "true");
    document.getElementById("settings-view").setAttribute("aria-hidden", "false");
    document.getElementById("boat-view").setAttribute("aria-hidden", "true");
    document.getElementById("info-view").setAttribute("aria-hidden", "true");
    document.getElementById("track-view").setAttribute("aria-hidden", "true");
    document.getElementById("setup-view").setAttribute("aria-hidden", "true");
    history.replaceState(null, "", "#settings");
    window.scrollTo({ top: 0, behavior: "instant" });
    if (navDeps.releaseWakeLock) {
      navDeps.releaseWakeLock();
    }
    if (navDeps.setGpsMode) {
      navDeps.setGpsMode("setup");
    }
    return;
  }
  if (view === "boat") {
    if (navDeps.updateInputs) {
      navDeps.updateInputs();
    }
    document.body.classList.remove("race-mode");
    document.body.classList.remove("coords-mode");
    document.body.classList.remove("location-mode");
    document.body.classList.remove("settings-mode");
    document.body.classList.add("boat-mode");
    document.body.classList.remove("info-mode");
    document.body.classList.remove("track-mode");
    document.getElementById("race-view").setAttribute("aria-hidden", "true");
    document.getElementById("coords-view").setAttribute("aria-hidden", "true");
    document.getElementById("location-view").setAttribute("aria-hidden", "true");
    document.getElementById("settings-view").setAttribute("aria-hidden", "true");
    document.getElementById("boat-view").setAttribute("aria-hidden", "false");
    document.getElementById("info-view").setAttribute("aria-hidden", "true");
    document.getElementById("track-view").setAttribute("aria-hidden", "true");
    document.getElementById("setup-view").setAttribute("aria-hidden", "true");
    history.replaceState(null, "", "#boat");
    window.scrollTo({ top: 0, behavior: "instant" });
    if (navDeps.releaseWakeLock) {
      navDeps.releaseWakeLock();
    }
    if (navDeps.setGpsMode) {
      navDeps.setGpsMode("setup");
    }
    return;
  }
  if (view === "info") {
    document.body.classList.remove("race-mode");
    document.body.classList.remove("coords-mode");
    document.body.classList.remove("location-mode");
    document.body.classList.add("info-mode");
    document.body.classList.remove("track-mode");
    document.getElementById("race-view").setAttribute("aria-hidden", "true");
    document.getElementById("coords-view").setAttribute("aria-hidden", "true");
    document.getElementById("location-view").setAttribute("aria-hidden", "true");
    document.getElementById("info-view").setAttribute("aria-hidden", "false");
    document.getElementById("track-view").setAttribute("aria-hidden", "true");
    document.getElementById("setup-view").setAttribute("aria-hidden", "true");
    history.replaceState(null, "", "#info");
    window.scrollTo({ top: 0, behavior: "instant" });
    if (navDeps.releaseWakeLock) {
      navDeps.releaseWakeLock();
    }
    if (navDeps.setGpsMode) {
      navDeps.setGpsMode("setup");
    }
    return;
  }
  if (view === "track") {
    document.body.classList.remove("race-mode");
    document.body.classList.remove("coords-mode");
    document.body.classList.remove("location-mode");
    document.body.classList.remove("info-mode");
    document.body.classList.add("track-mode");
    document.getElementById("race-view").setAttribute("aria-hidden", "true");
    document.getElementById("coords-view").setAttribute("aria-hidden", "true");
    document.getElementById("location-view").setAttribute("aria-hidden", "true");
    document.getElementById("info-view").setAttribute("aria-hidden", "true");
    document.getElementById("track-view").setAttribute("aria-hidden", "false");
    document.getElementById("setup-view").setAttribute("aria-hidden", "true");
    history.replaceState(null, "", "#track");
    window.scrollTo({ top: 0, behavior: "instant" });
    if (navDeps.releaseWakeLock) {
      navDeps.releaseWakeLock();
    }
    if (navDeps.setGpsMode) {
      navDeps.setGpsMode("setup", { force: true, highAccuracy: true });
    }
    renderTrack();
    return;
  }
  document.body.classList.remove("race-mode");
  document.body.classList.remove("coords-mode");
  document.body.classList.remove("location-mode");
  document.body.classList.remove("info-mode");
  document.body.classList.remove("track-mode");
  document.getElementById("race-view").setAttribute("aria-hidden", "true");
  document.getElementById("coords-view").setAttribute("aria-hidden", "true");
  document.getElementById("location-view").setAttribute("aria-hidden", "true");
  document.getElementById("info-view").setAttribute("aria-hidden", "true");
  document.getElementById("track-view").setAttribute("aria-hidden", "true");
  document.getElementById("setup-view").setAttribute("aria-hidden", "false");
  history.replaceState(null, "", "#setup");
  if (navDeps.releaseWakeLock) {
    navDeps.releaseWakeLock();
  }
  if (navDeps.setGpsMode) {
    navDeps.setGpsMode("setup");
  }
}

function syncViewFromHash() {
  if (location.hash === "#home") {
    setView("home");
    return;
  }
  if (location.hash === "#vmg") {
    setView("vmg");
    return;
  }
  if (location.hash === "#lifter") {
    setView("lifter");
    return;
  }
  if (location.hash === "#race") {
    setView("race");
    return;
  }
  if (location.hash === "#coords") {
    setView("coords");
    return;
  }
  if (location.hash === "#location") {
    setView("location");
    return;
  }
  if (location.hash === "#info") {
    setView("info");
    return;
  }
  if (location.hash === "#track") {
    setView("track");
    return;
  }
  if (location.hash === "#settings") {
    setView("settings");
    return;
  }
  if (location.hash === "#boat") {
    setView("boat");
    return;
  }
  if (location.hash === "#setup") {
    setView("setup");
    return;
  }
  setView("home");
}

export { initNavigation, setView, syncViewFromHash };
