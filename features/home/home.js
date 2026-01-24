import { els } from "../../ui/dom.js";

let homeDeps = {
  setView: null,
  hardReload: null,
  getNoCacheQuery: null,
};

function initHome(deps = {}) {
  homeDeps = { ...homeDeps, ...deps };
}

function bindHomeEvents() {
  if (els.openSetup) {
    els.openSetup.addEventListener("click", () => {
      if (homeDeps.setView) {
        homeDeps.setView("setup");
      }
    });
  }

  if (els.openVmg) {
    els.openVmg.addEventListener("click", () => {
      if (homeDeps.setView) {
        homeDeps.setView("vmg");
      }
    });
  }

  if (els.openLifter) {
    els.openLifter.addEventListener("click", () => {
      if (homeDeps.setView) {
        homeDeps.setView("lifter");
      }
    });
  }

  if (els.openHomeButtons && els.openHomeButtons.length) {
    els.openHomeButtons.forEach((button) => {
      button.addEventListener("click", () => {
        if (homeDeps.setView) {
          homeDeps.setView("home");
        }
      });
    });
  }

  if (els.openMap) {
    els.openMap.addEventListener("click", () => {
      const suffix = homeDeps.getNoCacheQuery ? homeDeps.getNoCacheQuery() : "";
      window.location.href = `map.html${suffix}`;
    });
  }

  if (els.openSettings) {
    els.openSettings.addEventListener("click", () => {
      if (homeDeps.setView) {
        homeDeps.setView("settings");
      }
    });
  }

  if (els.openBoat) {
    els.openBoat.addEventListener("click", () => {
      if (homeDeps.setView) {
        homeDeps.setView("boat");
      }
    });
  }

  if (els.homeRefresh) {
    els.homeRefresh.addEventListener("click", () => {
      if (homeDeps.hardReload) {
        homeDeps.hardReload();
      }
    });
  }

  const openInfoButton = els.openInfo || document.getElementById("open-info");
  if (openInfoButton) {
    openInfoButton.addEventListener("click", (event) => {
      event.preventDefault();
      if (homeDeps.setView) {
        homeDeps.setView("info");
      }
    });
  }

  if (els.openTrack) {
    els.openTrack.addEventListener("click", () => {
      if (homeDeps.setView) {
        homeDeps.setView("track");
      }
    });
  }

  const closeInfoButton = els.closeInfo || document.getElementById("close-info");
  if (closeInfoButton) {
    closeInfoButton.addEventListener("click", (event) => {
      event.preventDefault();
      if (homeDeps.setView) {
        homeDeps.setView("home");
      }
    });
  }
}

export { initHome, bindHomeEvents };
