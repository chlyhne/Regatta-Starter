import { els } from "../../ui/dom.js";

let homeDeps = {
  setView: null,
  hardReload: null,
  getNoCacheQuery: null,
  startRecording: null,
  stopRecording: null,
  isRecordingEnabled: null,
};

function initHome(deps = {}) {
  homeDeps = { ...homeDeps, ...deps };
  syncRecordingUi();
}

function syncRecordingUi() {
  const active = homeDeps.isRecordingEnabled ? homeDeps.isRecordingEnabled() : false;
  if (els.recordToggle) {
    els.recordToggle.textContent = active ? "Stop recording" : "Record data";
    els.recordToggle.setAttribute("aria-pressed", active ? "true" : "false");
  }
  if (els.recordStatus) {
    els.recordStatus.textContent = active ? "Recording on" : "Recording off";
  }
}

function openRecordNoteModal() {
  if (els.recordNoteInput) {
    els.recordNoteInput.value = "";
  }
  document.body.classList.add("modal-open");
  if (els.recordNoteModal) {
    els.recordNoteModal.setAttribute("aria-hidden", "false");
  }
  if (els.recordNoteInput) {
    els.recordNoteInput.focus();
  }
}

function closeRecordNoteModal() {
  document.body.classList.remove("modal-open");
  if (els.recordNoteModal) {
    els.recordNoteModal.setAttribute("aria-hidden", "true");
  }
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

  if (els.recordToggle) {
    els.recordToggle.addEventListener("click", () => {
      const active = homeDeps.isRecordingEnabled ? homeDeps.isRecordingEnabled() : false;
      if (active) {
        if (homeDeps.stopRecording) {
          homeDeps.stopRecording();
        }
        syncRecordingUi();
        return;
      }
      openRecordNoteModal();
    });
  }

  if (els.recordNoteStart) {
    els.recordNoteStart.addEventListener("click", async () => {
      const note = els.recordNoteInput ? els.recordNoteInput.value.trim() : "";
      if (homeDeps.startRecording) {
        const result = await homeDeps.startRecording(note);
        if (result && result.ok === false) {
          window.alert(result.error || "Recording could not start.");
          closeRecordNoteModal();
          return;
        }
      }
      closeRecordNoteModal();
      syncRecordingUi();
    });
  }

  if (els.recordNoteCancel) {
    els.recordNoteCancel.addEventListener("click", () => {
      closeRecordNoteModal();
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
