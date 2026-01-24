import { els } from "../../ui/dom.js";

let homeDeps = {
  setView: null,
  hardReload: null,
  getNoCacheQuery: null,
  startRecording: null,
  stopRecording: null,
  isRecordingEnabled: null,
  sendDiagnostics: null,
  getReplayState: null,
  loadReplayEntries: null,
  startReplay: null,
  stopReplay: null,
  setReplaySpeed: null,
  formatReplaySpeed: null,
};

let replayEntries = [];
let replaySelectedId = null;

function initHome(deps = {}) {
  homeDeps = { ...homeDeps, ...deps };
  syncRecordingUi();
  syncSendUi();
  syncReplayUi();
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

function syncSendUi(message) {
  if (els.sendStatus) {
    if (message) {
      els.sendStatus.textContent = message;
    }
  }
}

function openSendDiagModal() {
  document.body.classList.add("modal-open");
  if (els.sendDiagModal) {
    els.sendDiagModal.setAttribute("aria-hidden", "false");
  }
  if (els.sendDiagConfirm) {
    els.sendDiagConfirm.focus();
  }
}

function closeSendDiagModal() {
  document.body.classList.remove("modal-open");
  if (els.sendDiagModal) {
    els.sendDiagModal.setAttribute("aria-hidden", "true");
  }
}

function syncReplaySpeedUi(speed) {
  if (els.replaySpeedValue) {
    if (homeDeps.formatReplaySpeed) {
      els.replaySpeedValue.textContent = homeDeps.formatReplaySpeed(speed);
    } else {
      els.replaySpeedValue.textContent = `${speed}x`;
    }
  }
  if (els.replaySpeed) {
    els.replaySpeed.value = String(speed);
  }
}

function syncReplayUi() {
  if (!homeDeps.getReplayState) return;
  const replay = homeDeps.getReplayState();
  if (!replay) return;
  if (els.replayStatus) {
    let status = "Replay off";
    if (replay.loading) {
      status = "Replay loading";
    } else if (replay.active && replay.file) {
      status = `Replay: ${replay.file.label || replay.file.id || "active"}`;
    } else if (replay.error) {
      status = `Replay error: ${replay.error}`;
    }
    els.replayStatus.textContent = status;
  }
  if (els.replayOpen) {
    els.replayOpen.disabled = replay.loading;
  }
  if (els.replayStop) {
    els.replayStop.disabled = !replay.active && !replay.loading;
  }
  if (els.replaySpeed) {
    els.replaySpeed.disabled = replay.loading;
  }
  syncReplaySpeedUi(replay.speed);
}

function renderReplayList() {
  if (!els.replayList) return;
  els.replayList.innerHTML = "";
  if (!replayEntries.length) {
    const empty = document.createElement("div");
    empty.className = "hint";
    empty.textContent = "No replay files found.";
    els.replayList.appendChild(empty);
    return;
  }
  replayEntries.forEach((entry) => {
    const row = document.createElement("div");
    row.className = "modal-item";
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = entry.label || entry.id || "Replay";
    if (replaySelectedId === entry.id) {
      button.classList.add("selected");
    }
    button.addEventListener("click", () => {
      replaySelectedId = entry.id;
      renderReplayList();
    });
    row.appendChild(button);
    els.replayList.appendChild(row);
  });
}

async function openReplayModal() {
  document.body.classList.add("modal-open");
  if (els.replayModal) {
    els.replayModal.setAttribute("aria-hidden", "false");
  }
  if (els.replayList) {
    els.replayList.innerHTML = "";
    const loading = document.createElement("div");
    loading.className = "hint";
    loading.textContent = "Loading replay files...";
    els.replayList.appendChild(loading);
  }
  if (!homeDeps.loadReplayEntries) return;
  try {
    replayEntries = await homeDeps.loadReplayEntries();
    const current = homeDeps.getReplayState ? homeDeps.getReplayState() : null;
    if (!replaySelectedId && current?.file?.id) {
      replaySelectedId = current.file.id;
    }
    if (!replaySelectedId && replayEntries.length) {
      replaySelectedId = replayEntries[0].id;
    }
    renderReplayList();
  } catch (err) {
    if (els.replayList) {
      els.replayList.innerHTML = "";
      const message = document.createElement("div");
      message.className = "hint";
      message.textContent = err instanceof Error ? err.message : String(err);
      els.replayList.appendChild(message);
    }
  }
  if (els.replayConfirm) {
    els.replayConfirm.focus();
  }
}

function closeReplayModal() {
  document.body.classList.remove("modal-open");
  if (els.replayModal) {
    els.replayModal.setAttribute("aria-hidden", "true");
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

  if (els.sendDiagnostics) {
    els.sendDiagnostics.addEventListener("click", () => {
      openSendDiagModal();
    });
  }

  if (els.sendDiagCancel) {
    els.sendDiagCancel.addEventListener("click", () => {
      closeSendDiagModal();
    });
  }

  if (els.sendDiagConfirm) {
    els.sendDiagConfirm.addEventListener("click", async () => {
      if (!homeDeps.sendDiagnostics) return;
      if (els.sendDiagConfirm) {
        els.sendDiagConfirm.disabled = true;
      }
      syncSendUi("Sending diagnostics...");
      const result = await homeDeps.sendDiagnostics();
      if (els.sendDiagConfirm) {
        els.sendDiagConfirm.disabled = false;
      }
      closeSendDiagModal();
      if (result && result.ok === false) {
        const message = result.error || "Diagnostics upload failed.";
        syncSendUi(`Upload failed: ${message}`);
        return;
      }
      const time = new Date().toLocaleTimeString("en-GB", {
        hour: "2-digit",
        minute: "2-digit",
      });
      syncSendUi(`Uploaded ${time}`);
    });
  }

  if (els.replayOpen) {
    els.replayOpen.addEventListener("click", () => {
      openReplayModal();
    });
  }

  if (els.replayCancel) {
    els.replayCancel.addEventListener("click", () => {
      closeReplayModal();
    });
  }

  if (els.replayConfirm) {
    els.replayConfirm.addEventListener("click", async () => {
      if (!homeDeps.startReplay) return;
      const entry = replayEntries.find((item) => item.id === replaySelectedId);
      if (!entry) {
        window.alert("Pick a replay file first.");
        return;
      }
      await homeDeps.startReplay(entry);
      closeReplayModal();
      syncReplayUi();
    });
  }

  if (els.replayStop) {
    els.replayStop.addEventListener("click", () => {
      if (homeDeps.stopReplay) {
        homeDeps.stopReplay();
      }
      syncReplayUi();
    });
  }

  if (els.replaySpeed) {
    const onSpeedChange = () => {
      if (homeDeps.setReplaySpeed) {
        homeDeps.setReplaySpeed(els.replaySpeed.value);
      }
      const replay = homeDeps.getReplayState ? homeDeps.getReplayState() : null;
      if (replay) {
        syncReplaySpeedUi(replay.speed);
      }
    };
    onSpeedChange();
    els.replaySpeed.addEventListener("input", onSpeedChange);
    els.replaySpeed.addEventListener("change", onSpeedChange);
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

export { initHome, bindHomeEvents, syncReplayUi };
