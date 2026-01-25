import { els } from "../../ui/dom.js";
import { state } from "../../core/state.js";
import {
  formatUnitLabel,
  normalizeTimeFormat,
  normalizeSpeedUnit,
  normalizeDistanceUnit,
  getDistanceUnitMeta,
} from "../../core/format.js";
import {
  updateStatusUnitLabels,
  updateRaceMetricLabels,
  updateRaceHintUnits,
  updateLineProjection,
} from "../starter/race.js";
import { updateGPSDisplay } from "../../ui/gps-ui.js";
import { trimTrailingZeros } from "../../core/common.js";

let settingsDeps = {
  saveSettings: null,
  setView: null,
  updateStartDisplay: null,
};

function initSettingsView(deps = {}) {
  settingsDeps = { ...settingsDeps, ...deps };
}

function formatBowOffsetValue(meters) {
  if (!Number.isFinite(meters)) return "";
  const { factor } = getDistanceUnitMeta();
  const value = meters * factor;
  const rounded = Math.round(value * 100) / 100;
  return trimTrailingZeros(rounded.toFixed(2));
}

function parseBowOffsetInput() {
  if (!els.bowOffset) return state.bowOffsetMeters;
  const raw = Number.parseFloat(String(els.bowOffset.value || "").replace(",", "."));
  if (!Number.isFinite(raw)) return 0;
  const safe = Math.max(0, raw);
  const { factor } = getDistanceUnitMeta();
  return safe / factor;
}

function syncBowOffsetInput() {
  if (els.bowOffset) {
    els.bowOffset.value = formatBowOffsetValue(state.bowOffsetMeters);
  }
  if (els.bowOffsetUnit) {
    els.bowOffsetUnit.textContent = formatUnitLabel(getDistanceUnitMeta().label);
  }
}

function formatBoatLengthValue(meters) {
  if (!Number.isFinite(meters)) return "";
  const { factor } = getDistanceUnitMeta();
  const value = meters * factor;
  const rounded = Math.round(value * 100) / 100;
  return trimTrailingZeros(rounded.toFixed(2));
}

function parseBoatLengthInput() {
  if (!els.boatLength) return state.boatLengthMeters;
  const raw = Number.parseFloat(String(els.boatLength.value || "").replace(",", "."));
  if (!Number.isFinite(raw)) return 0;
  const safe = Math.max(0, raw);
  const { factor } = getDistanceUnitMeta();
  return safe / factor;
}

function syncBoatLengthInput() {
  if (els.boatLength) {
    els.boatLength.value = formatBoatLengthValue(state.boatLengthMeters);
  }
  if (els.boatLengthUnit) {
    els.boatLengthUnit.textContent = formatUnitLabel(getDistanceUnitMeta().label);
  }
}

function formatBoatModelValue(value) {
  if (typeof value !== "string") return "";
  return value.trim();
}

function syncBoatModelInput() {
  if (els.boatModel) {
    els.boatModel.value = formatBoatModelValue(state.boatModel);
  }
}

function parseBoatShapeInput() {
  if (!els.boatShape) return state.boatShape;
  return String(els.boatShape.value || "").trim();
}

function syncBoatShapeInput() {
  if (els.boatShape) {
    els.boatShape.value = state.boatShape || "";
  }
}

function formatBoatWeightValue(kg) {
  if (!Number.isFinite(kg)) return "";
  const rounded = Math.round(kg * 10) / 10;
  return trimTrailingZeros(rounded.toFixed(1));
}

function parseBoatWeightInput() {
  if (!els.boatWeight) return state.boatWeightKg;
  const raw = Number.parseFloat(String(els.boatWeight.value || "").replace(",", "."));
  if (!Number.isFinite(raw)) return 0;
  return Math.max(0, raw);
}

function syncBoatWeightInput() {
  if (els.boatWeight) {
    els.boatWeight.value = formatBoatWeightValue(state.boatWeightKg);
  }
}

function commitBoatInputs() {
  let changed = false;
  if (els.boatModel) {
    const raw = String(els.boatModel.value || "").trim();
    state.boatModel = raw;
    changed = true;
  }
  if (els.boatShape) {
    state.boatShape = parseBoatShapeInput();
    changed = true;
  }
  if (els.boatLength) {
    const raw = String(els.boatLength.value || "").trim();
    if (raw) {
      state.boatLengthMeters = parseBoatLengthInput();
      changed = true;
    } else {
      syncBoatLengthInput();
    }
  }
  if (els.boatWeight) {
    const raw = String(els.boatWeight.value || "").trim();
    if (raw) {
      state.boatWeightKg = parseBoatWeightInput();
      changed = true;
    } else {
      syncBoatWeightInput();
    }
  }
  if (els.bowOffset) {
    const raw = String(els.bowOffset.value || "").trim();
    if (raw) {
      state.bowOffsetMeters = parseBowOffsetInput();
      changed = true;
    } else {
      syncBowOffsetInput();
    }
  }
  if (changed && settingsDeps.saveSettings) {
    settingsDeps.saveSettings();
  }
}

function updateSoundToggle() {
  if (els.soundOn) {
    els.soundOn.setAttribute("aria-pressed", state.soundEnabled ? "true" : "false");
  }
  if (els.soundOff) {
    els.soundOff.setAttribute("aria-pressed", state.soundEnabled ? "false" : "true");
  }
}

function updateTimeFormatToggle() {
  const format = normalizeTimeFormat(state.timeFormat);
  if (els.timeFormat24) {
    els.timeFormat24.setAttribute("aria-pressed", format === "24h" ? "true" : "false");
  }
  if (els.timeFormat12) {
    els.timeFormat12.setAttribute("aria-pressed", format === "12h" ? "true" : "false");
  }
}

function updateSpeedUnitToggle() {
  const unit = normalizeSpeedUnit(state.speedUnit);
  if (els.speedUnitMs) {
    els.speedUnitMs.setAttribute("aria-pressed", unit === "ms" ? "true" : "false");
  }
  if (els.speedUnitKn) {
    els.speedUnitKn.setAttribute("aria-pressed", unit === "kn" ? "true" : "false");
  }
  if (els.speedUnitMph) {
    els.speedUnitMph.setAttribute("aria-pressed", unit === "mph" ? "true" : "false");
  }
}

function updateDistanceUnitToggle() {
  const unit = normalizeDistanceUnit(state.distanceUnit);
  if (els.distanceUnitM) {
    els.distanceUnitM.setAttribute("aria-pressed", unit === "m" ? "true" : "false");
  }
  if (els.distanceUnitFt) {
    els.distanceUnitFt.setAttribute("aria-pressed", unit === "ft" ? "true" : "false");
  }
  if (els.distanceUnitYd) {
    els.distanceUnitYd.setAttribute("aria-pressed", unit === "yd" ? "true" : "false");
  }
}

function syncUploadTokenInput() {
  if (els.diagUploadToken) {
    els.diagUploadToken.value = state.diagUploadToken || "";
  }
}

function setSoundEnabled(enabled) {
  state.soundEnabled = Boolean(enabled);
  if (settingsDeps.saveSettings) {
    settingsDeps.saveSettings();
  }
  updateSoundToggle();
}

function setTimeFormat(format) {
  state.timeFormat = normalizeTimeFormat(format);
  if (settingsDeps.saveSettings) {
    settingsDeps.saveSettings();
  }
  updateTimeFormatToggle();
  if (settingsDeps.updateStartDisplay) {
    settingsDeps.updateStartDisplay();
  }
}

function setSpeedUnit(unit) {
  state.speedUnit = normalizeSpeedUnit(unit);
  if (settingsDeps.saveSettings) {
    settingsDeps.saveSettings();
  }
  updateSpeedUnitToggle();
  updateLineProjection();
  updateGPSDisplay();
}

function setDistanceUnit(unit) {
  state.distanceUnit = normalizeDistanceUnit(unit);
  if (settingsDeps.saveSettings) {
    settingsDeps.saveSettings();
  }
  updateDistanceUnitToggle();
  updateStatusUnitLabels();
  updateRaceMetricLabels();
  updateRaceHintUnits();
  syncBowOffsetInput();
  syncBoatLengthInput();
  updateLineProjection();
  updateGPSDisplay();
}

function syncSettingsInputs() {
  syncBoatModelInput();
  syncBoatShapeInput();
  syncBowOffsetInput();
  syncBoatLengthInput();
  syncBoatWeightInput();
  syncUploadTokenInput();
  updateSoundToggle();
  updateTimeFormatToggle();
  updateSpeedUnitToggle();
  updateDistanceUnitToggle();
}

function bindSettingsEvents() {
  if (els.closeSettings) {
    els.closeSettings.addEventListener("click", () => {
      if (settingsDeps.setView) {
        settingsDeps.setView("home");
      }
    });
  }

  if (els.closeBoat) {
    els.closeBoat.addEventListener("click", () => {
      commitBoatInputs();
      if (settingsDeps.setView) {
        settingsDeps.setView("home");
      }
    });
  }

  if (els.bowOffset) {
    els.bowOffset.addEventListener("change", () => {
      state.bowOffsetMeters = parseBowOffsetInput();
      if (settingsDeps.saveSettings) {
        settingsDeps.saveSettings();
      }
    });
    els.bowOffset.addEventListener("focus", () => {
      els.bowOffset.value = "";
    });
  }

  if (els.boatModel) {
    els.boatModel.addEventListener("change", () => {
      state.boatModel = String(els.boatModel.value || "").trim();
      if (settingsDeps.saveSettings) {
        settingsDeps.saveSettings();
      }
      syncBoatModelInput();
    });
  }

  if (els.boatShape) {
    els.boatShape.addEventListener("change", () => {
      state.boatShape = parseBoatShapeInput();
      if (settingsDeps.saveSettings) {
        settingsDeps.saveSettings();
      }
      syncBoatShapeInput();
    });
  }

  if (els.diagUploadToken) {
    els.diagUploadToken.addEventListener("change", () => {
      state.diagUploadToken = String(els.diagUploadToken.value || "").trim();
      if (settingsDeps.saveSettings) {
        settingsDeps.saveSettings();
      }
      syncUploadTokenInput();
    });
  }

  if (els.boatLength) {
    els.boatLength.addEventListener("change", () => {
      state.boatLengthMeters = parseBoatLengthInput();
      if (settingsDeps.saveSettings) {
        settingsDeps.saveSettings();
      }
      syncBoatLengthInput();
    });
    els.boatLength.addEventListener("focus", () => {
      els.boatLength.value = "";
    });
  }

  if (els.boatWeight) {
    els.boatWeight.addEventListener("change", () => {
      state.boatWeightKg = parseBoatWeightInput();
      if (settingsDeps.saveSettings) {
        settingsDeps.saveSettings();
      }
      syncBoatWeightInput();
    });
    els.boatWeight.addEventListener("focus", () => {
      els.boatWeight.value = "";
    });
  }

  if (els.soundOn) {
    els.soundOn.addEventListener("click", () => {
      setSoundEnabled(true);
    });
  }

  if (els.soundOff) {
    els.soundOff.addEventListener("click", () => {
      setSoundEnabled(false);
    });
  }

  if (els.timeFormat24) {
    els.timeFormat24.addEventListener("click", () => {
      setTimeFormat("24h");
    });
  }

  if (els.timeFormat12) {
    els.timeFormat12.addEventListener("click", () => {
      setTimeFormat("12h");
    });
  }

  if (els.speedUnitMs) {
    els.speedUnitMs.addEventListener("click", () => {
      setSpeedUnit("ms");
    });
  }

  if (els.speedUnitKn) {
    els.speedUnitKn.addEventListener("click", () => {
      setSpeedUnit("kn");
    });
  }

  if (els.speedUnitMph) {
    els.speedUnitMph.addEventListener("click", () => {
      setSpeedUnit("mph");
    });
  }

  if (els.distanceUnitM) {
    els.distanceUnitM.addEventListener("click", () => {
      setDistanceUnit("m");
    });
  }

  if (els.distanceUnitFt) {
    els.distanceUnitFt.addEventListener("click", () => {
      setDistanceUnit("ft");
    });
  }

  if (els.distanceUnitYd) {
    els.distanceUnitYd.addEventListener("click", () => {
      setDistanceUnit("yd");
    });
  }
}

export {
  initSettingsView,
  bindSettingsEvents,
  commitBoatInputs,
  syncSettingsInputs,
  updateSoundToggle,
  updateTimeFormatToggle,
  updateSpeedUnitToggle,
  updateDistanceUnitToggle,
  setSoundEnabled,
  setTimeFormat,
  setSpeedUnit,
  setDistanceUnit,
  syncBowOffsetInput,
  syncBoatLengthInput,
  syncUploadTokenInput,
};
