import { els } from "./dom.js";
import {
  state,
  hemisphereGroups,
  LINES_KEY,
  DEBUG_COORDS,
  COORD_DECIMAL_DIGITS,
  COORD_DD_DIGITS,
  DEBUG_SPEED,
  DEBUG_HEADING,
  START_BEEP_DURATION_MS,
  START_BEEP_FREQUENCY,
} from "./state.js";
import { unlockAudio, playBeep, handleCountdownBeeps, resetBeepState } from "./audio.js";
import { applyForwardOffset } from "./geo.js";
import { applyKalmanFilter } from "./kalman.js";
import { recordTrackPoints, renderTrack } from "./track.js";
import { fitRaceText } from "./race-fit.js";
import { updateGPSDisplay, updateDebugControls } from "./gps-ui.js";
import {
  hasLine,
  updateLineStatus,
  updateStatusUnitLabels,
  updateRaceHintUnits,
  updateRaceMetricLabels,
  setRaceMetric,
  updateLineProjection,
} from "./race.js";
import {
  GPS_OPTIONS_RACE,
  getGpsOptionsForMode,
  clearGpsRetryTimer,
  stopDebugGps,
  startDebugGps,
  startRealGps,
  isGpsStale,
  scheduleGpsRetry,
  requestHighPrecisionPosition,
} from "./gps-watch.js";
import {
  computeVelocityFromHeading,
  computeVelocityFromPositions,
} from "./velocity.js";
import {
  loadSettings as loadSettingsFromStorage,
  saveSettings as saveSettingsToStorage,
} from "./settings.js";
import {
  formatUnitLabel,
  normalizeTimeFormat,
  normalizeSpeedUnit,
  normalizeDistanceUnit,
  getDistanceUnitMeta,
  formatClockTime,
  formatTimeInput,
  formatTimeRemainingHMSFull,
  splitDurationSeconds,
  formatTimeRemainingHMS,
} from "./format.js";

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

function commitBoatInputs() {
  let changed = false;
  if (els.boatLength) {
    const raw = String(els.boatLength.value || "").trim();
    if (raw) {
      state.boatLengthMeters = parseBoatLengthInput();
      changed = true;
    } else {
      syncBoatLengthInput();
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
  if (changed) {
    saveSettings();
  }
}

function createDebugPosition() {
  return {
    coords: {
      latitude: DEBUG_COORDS.lat,
      longitude: DEBUG_COORDS.lon,
      accuracy: 3,
      speed: DEBUG_SPEED,
      heading: DEBUG_HEADING,
    },
    timestamp: Date.now(),
  };
}

function readDebugFlagFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const raw = params.get("debug");
  if (raw === null) return null;
  const normalized = raw.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return null;
}

function applyDebugFlagFromUrl() {
  const flag = readDebugFlagFromUrl();
  if (flag === null) return;
  state.debugGpsEnabled = flag;
}

function hardReload() {
  const url = new URL(window.location.href);
  url.searchParams.set("nocache", String(Date.now()));
  window.location.replace(url.toString());
}

function clearNoCacheParam() {
  const url = new URL(window.location.href);
  if (!url.searchParams.has("nocache")) return;
  url.searchParams.delete("nocache");
  history.replaceState(null, "", url.toString());
}

function setRaceTimingControlsEnabled(enabled) {
  const disabled = !enabled;
  if (els.racePlus) els.racePlus.disabled = disabled;
  if (els.raceMinus) els.raceMinus.disabled = disabled;
  if (els.syncRace) els.syncRace.disabled = disabled;
}

async function requestWakeLock() {
  if (!("wakeLock" in navigator)) return;
  try {
    if (state.wakeLock) return;
    state.wakeLock = await navigator.wakeLock.request("screen");
  } catch (err) {
    console.warn("Wake lock failed", err);
  }
}

function releaseWakeLock() {
  if (!state.wakeLock) return;
  state.wakeLock.release().catch(() => {});
  state.wakeLock = null;
}

function syncCountdownPicker() {
  if (!els.countdownHours || !els.countdownMinutes || !els.countdownSeconds) return;
  const { hours, minutes, seconds } = splitDurationSeconds(state.start.countdownSeconds);
  setNumberInputValue(els.countdownHours, hours);
  setNumberInputValue(els.countdownMinutes, minutes);
  setNumberInputValue(els.countdownSeconds, seconds);
}

function getCountdownSecondsFromPicker() {
  if (!els.countdownHours || !els.countdownMinutes || !els.countdownSeconds) {
    return state.start.countdownSeconds;
  }
  const hours = Number.parseInt(els.countdownHours.value, 10) || 0;
  const minutes = Number.parseInt(els.countdownMinutes.value, 10) || 0;
  const seconds = Number.parseInt(els.countdownSeconds.value, 10) || 0;
  return hours * 3600 + minutes * 60 + seconds;
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

function setSoundEnabled(enabled) {
  state.soundEnabled = Boolean(enabled);
  saveSettings();
  updateSoundToggle();
}

function setTimeFormat(format) {
  state.timeFormat = normalizeTimeFormat(format);
  saveSettings();
  updateTimeFormatToggle();
  updateCurrentTime();
  updateStartDisplay();
}

function setSpeedUnit(unit) {
  state.speedUnit = normalizeSpeedUnit(unit);
  saveSettings();
  updateSpeedUnitToggle();
  updateLineProjection();
  updateGPSDisplay();
}

function setDistanceUnit(unit) {
  state.distanceUnit = normalizeDistanceUnit(unit);
  saveSettings();
  updateDistanceUnitToggle();
  updateStatusUnitLabels();
  updateRaceHintUnits();
  syncBowOffsetInput();
  syncBoatLengthInput();
  updateLineProjection();
  updateGPSDisplay();
}

function loadSettings() {
  const settings = loadSettingsFromStorage();
  state.line = settings.line;
  state.coordsFormat = settings.coordsFormat;
  state.lineName = settings.lineMeta?.name || null;
  state.lineSourceId = settings.lineMeta?.sourceId || null;
  state.debugGpsEnabled = settings.debugGpsEnabled;
  state.useKalman = true;
  state.bowOffsetMeters = settings.bowOffsetMeters;
  state.boatLengthMeters = settings.boatLengthMeters;
  state.soundEnabled = settings.soundEnabled;
  state.timeFormat = settings.timeFormat;
  state.speedUnit = settings.speedUnit;
  state.distanceUnit = settings.distanceUnit;
  state.start = { ...state.start, ...settings.start };
  delete state.start.preStartSign;
}

function saveSettings() {
  saveSettingsToStorage({
    line: state.line,
    lineMeta: {
      name: state.lineName,
      sourceId: state.lineSourceId,
    },
    coordsFormat: state.coordsFormat,
    debugGpsEnabled: state.debugGpsEnabled,
    useKalman: true,
    bowOffsetMeters: state.bowOffsetMeters,
    boatLengthMeters: state.boatLengthMeters,
    soundEnabled: state.soundEnabled,
    timeFormat: state.timeFormat,
    speedUnit: state.speedUnit,
    distanceUnit: state.distanceUnit,
    start: {
      mode: state.start.mode,
      countdownSeconds: state.start.countdownSeconds,
      absoluteTime: state.start.absoluteTime,
      startTs: state.start.startTs,
      crossedEarly: state.start.crossedEarly,
    },
  });
}

function loadSavedLines() {
  try {
    const raw = localStorage.getItem(LINES_KEY);
    state.savedLines = raw ? JSON.parse(raw) : [];
  } catch (err) {
    console.warn("Failed to load saved lines", err);
    state.savedLines = [];
  }
}

function updateLineNameDisplay() {
  if (!els.statusLineName) return;
  els.statusLineName.textContent = state.lineName || "--";
}

function syncLineNameWithSavedLines() {
  if (!state.lineSourceId) {
    updateLineNameDisplay();
    return;
  }
  const exists = state.savedLines.some((line) => line.id === state.lineSourceId);
  if (!exists) {
    state.lineName = null;
    state.lineSourceId = null;
    saveSettings();
  }
  updateLineNameDisplay();
}

function saveSavedLines() {
  localStorage.setItem(LINES_KEY, JSON.stringify(state.savedLines));
}

function openLoadModal() {
  if (!els.savedLinesList) return;
  state.selectedLineId = null;
  renderSavedLinesList();
  document.body.classList.add("modal-open");
  if (els.loadModal) {
    els.loadModal.setAttribute("aria-hidden", "false");
  }
}

function closeLoadModal() {
  document.body.classList.remove("modal-open");
  if (els.loadModal) {
    els.loadModal.setAttribute("aria-hidden", "true");
  }
}

function renderSavedLinesList() {
  if (!els.savedLinesList) return;
  els.savedLinesList.innerHTML = "";
  if (!state.savedLines.length) {
    const empty = document.createElement("div");
    empty.className = "hint";
    empty.textContent = "No saved lines yet.";
    els.savedLinesList.appendChild(empty);
    updateModalButtons();
    return;
  }
  state.savedLines.forEach((line) => {
    const row = document.createElement("div");
    row.className = "modal-item";
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = line.name;
    if (state.selectedLineId === line.id) {
      button.classList.add("selected");
    }
    button.addEventListener("click", () => {
      state.selectedLineId = line.id;
      renderSavedLinesList();
    });
    row.appendChild(button);
    els.savedLinesList.appendChild(row);
  });
  updateModalButtons();
}

function updateModalButtons() {
  const hasSelection = Boolean(state.selectedLineId);
  if (els.confirmLoad) {
    els.confirmLoad.disabled = !hasSelection;
  }
  if (els.confirmDelete) {
    els.confirmDelete.disabled = !hasSelection;
  }
}

function updateInputs() {
  syncCoordinateInputs();
  syncCountdownPicker();
  syncBowOffsetInput();
  syncBoatLengthInput();
  updateSoundToggle();
  updateTimeFormatToggle();
  updateSpeedUnitToggle();
  updateDistanceUnitToggle();
  updateStatusUnitLabels();
  updateRaceHintUnits();
  els.absoluteTime.value = state.start.absoluteTime || "";
}

function normalizeCoordinateFormat(format) {
  if (format === "dd" || format === "ddm" || format === "dms") return format;
  return "dd";
}

function getCoordinateFormatLabel(format) {
  const normalized = normalizeCoordinateFormat(format);
  if (normalized === "ddm") return "Deg+Min";
  if (normalized === "dms") return "DMS";
  return "Decimal";
}

function syncCoordinateFormatUI() {
  const format = normalizeCoordinateFormat(state.coordsFormat);
  if (els.coordsFormatBtn) {
    els.coordsFormatBtn.textContent = `Format: ${getCoordinateFormatLabel(format)}`;
  }
  if (els.coordsDoneTop) {
    els.coordsDoneTop.hidden = format === "dd";
  }
  if (els.coordsFormatDD) els.coordsFormatDD.hidden = format !== "dd";
  if (els.coordsFormatDDM) els.coordsFormatDDM.hidden = format !== "ddm";
  if (els.coordsFormatDMS) els.coordsFormatDMS.hidden = format !== "dms";
}

function trimTrailingZeros(value) {
  if (!value.includes(".")) return value;
  return value.replace(/\.?0+$/, "");
}

function formatCoordinateValue(value, digits) {
  const fixed = value.toFixed(digits);
  const trimmed = trimTrailingZeros(fixed);
  return trimmed === "-0" ? "0" : trimmed;
}

function roundFraction(value, digits) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function formatFractionDigits(value, digits) {
  if (!Number.isFinite(value) || value <= 0) return "";
  const fixed = value.toFixed(digits);
  const parts = fixed.split(".");
  if (parts.length < 2) return "";
  return parts[1].replace(/0+$/, "");
}

function splitDecimalToDDM(value, kind) {
  const abs = Math.abs(value);
  let deg = Math.floor(abs);
  const minTotal = (abs - deg) * 60;
  let min = Math.floor(minTotal);
  let minFraction = roundFraction(minTotal - min, COORD_DECIMAL_DIGITS);
  if (minFraction >= 1) {
    min += 1;
    minFraction = 0;
  }
  if (min >= 60) {
    min = 0;
    deg += 1;
  }
  const hemi = kind === "lon" ? (value < 0 ? "W" : "E") : value < 0 ? "S" : "N";
  return { deg, min, minDec: formatFractionDigits(minFraction, COORD_DECIMAL_DIGITS), hemi };
}

function splitDecimalToDMS(value, kind) {
  const abs = Math.abs(value);
  let deg = Math.floor(abs);
  const minTotal = (abs - deg) * 60;
  let min = Math.floor(minTotal);
  const secTotal = (minTotal - min) * 60;
  let sec = Math.floor(secTotal);
  let secFraction = roundFraction(secTotal - sec, COORD_DECIMAL_DIGITS);
  if (secFraction >= 1) {
    sec += 1;
    secFraction = 0;
  }
  if (sec >= 60) {
    sec = 0;
    min += 1;
  }
  if (min >= 60) {
    min = 0;
    deg += 1;
  }
  const hemi = kind === "lon" ? (value < 0 ? "W" : "E") : value < 0 ? "S" : "N";
  return { deg, min, sec, secDec: formatFractionDigits(secFraction, COORD_DECIMAL_DIGITS), hemi };
}

function setNumberInputValue(input, value) {
  if (!input) return;
  if (!Number.isFinite(value)) {
    input.value = "";
    return;
  }
  input.value = String(value);
}

function setFixedInputValue(input, value, digits) {
  if (!input) return;
  if (!Number.isFinite(value)) {
    input.value = "";
    return;
  }
  input.value = formatCoordinateValue(value, digits);
}

function setDigitsInputValue(input, value) {
  if (!input) return;
  if (typeof value === "string") {
    input.value = value;
    return;
  }
  if (!Number.isFinite(value)) {
    input.value = "";
    return;
  }
  input.value = String(value);
}

function populateNumberSelect(select, options = {}) {
  if (!select) return;
  const min = Number.isFinite(options.min) ? options.min : 0;
  const max = Number.isFinite(options.max) ? options.max : 0;
  const pad = Number.isFinite(options.pad) ? options.pad : 0;
  const includePlaceholder = options.placeholder !== false;
  const previous = select.value;
  select.innerHTML = "";

  if (includePlaceholder) {
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "--";
    select.appendChild(placeholder);
  }

  for (let value = min; value <= max; value += 1) {
    const option = document.createElement("option");
    option.value = String(value);
    option.textContent = pad ? String(value).padStart(pad, "0") : String(value);
    select.appendChild(option);
  }

  if (previous !== "") {
    select.value = previous;
  }
}

function initCoordinatePickers() {
  const latDegreeSelects = [
    els.ddm.latA.deg,
    els.ddm.latB.deg,
    els.dms.latA.deg,
    els.dms.latB.deg,
  ].filter(Boolean);
  latDegreeSelects.forEach((select) => populateNumberSelect(select, { max: 90 }));

  const lonDegreeSelects = [
    els.ddm.lonA.deg,
    els.ddm.lonB.deg,
    els.dms.lonA.deg,
    els.dms.lonB.deg,
  ].filter(Boolean);
  lonDegreeSelects.forEach((select) => populateNumberSelect(select, { max: 180 }));

  const minuteSelects = [
    els.ddm.latA.min,
    els.ddm.lonA.min,
    els.ddm.latB.min,
    els.ddm.lonB.min,
    els.dms.latA.min,
    els.dms.lonA.min,
    els.dms.latB.min,
    els.dms.lonB.min,
  ].filter(Boolean);
  minuteSelects.forEach((select) => populateNumberSelect(select, { max: 59, pad: 2 }));

  const secondSelects = [
    els.dms.latA.sec,
    els.dms.lonA.sec,
    els.dms.latB.sec,
    els.dms.lonB.sec,
  ].filter(Boolean);
  secondSelects.forEach((select) => populateNumberSelect(select, { max: 59, pad: 2 }));
}

function initCountdownPicker() {
  populateNumberSelect(els.countdownHours, { max: 23, pad: 2, placeholder: false });
  populateNumberSelect(els.countdownMinutes, { max: 59, pad: 2, placeholder: false });
  populateNumberSelect(els.countdownSeconds, { max: 59, pad: 2, placeholder: false });
}


function applyDDMDegreeLimit(group, maxDegrees) {
  if (!group || !group.deg || !group.min || !group.minDec) return;
  const degrees = Number.parseInt(group.deg.value, 10);
  const limitHit = Number.isFinite(degrees) && degrees === maxDegrees;
  if (limitHit) {
    group.min.value = "0";
    group.minDec.value = "";
  }
  group.min.disabled = limitHit;
  group.minDec.disabled = limitHit;
}

function applyDMSDegreeLimit(group, maxDegrees) {
  if (!group || !group.deg || !group.min || !group.sec || !group.secDec) return;
  const degrees = Number.parseInt(group.deg.value, 10);
  const limitHit = Number.isFinite(degrees) && degrees === maxDegrees;
  if (limitHit) {
    group.min.value = "0";
    group.sec.value = "0";
    group.secDec.value = "";
  }
  group.min.disabled = limitHit;
  group.sec.disabled = limitHit;
  group.secDec.disabled = limitHit;
}

function applyCoordinatePickerConstraints() {
  applyDDMDegreeLimit(els.ddm.latA, 90);
  applyDDMDegreeLimit(els.ddm.lonA, 180);
  applyDDMDegreeLimit(els.ddm.latB, 90);
  applyDDMDegreeLimit(els.ddm.lonB, 180);
  applyDMSDegreeLimit(els.dms.latA, 90);
  applyDMSDegreeLimit(els.dms.lonA, 180);
  applyDMSDegreeLimit(els.dms.latB, 90);
  applyDMSDegreeLimit(els.dms.lonB, 180);
}

function handleCoordinateInputsChanged() {
  applyCoordinatePickerConstraints();
  parseLineInputs();
  updateInputs();
  updateLineStatus();
  updateLineProjection();
  refreshHemisphereButtons();
}

function refreshHemisphereButtons() {
  Object.values(hemisphereGroups).forEach(({ input, buttons }) => {
    const value = input.value || "";
    buttons.forEach((button) => {
      const isActive = button.dataset.value === value;
      button.classList.toggle("active", isActive);
      button.setAttribute("aria-pressed", isActive ? "true" : "false");
    });
  });
}

function initHemisphereToggles() {
  document.querySelectorAll(".coords-hemis").forEach((container) => {
    const target = container.dataset.target;
    const input = document.getElementById(target);
    if (!input) return;
    const buttons = Array.from(container.querySelectorAll(".coords-hemisphere"));
    if (!buttons.length) return;
    hemisphereGroups[target] = { input, buttons };
    buttons.forEach((button) => {
      button.addEventListener("click", () => {
        const next = button.dataset.value;
        if (input.value === next) return;
        input.value = next;
        handleCoordinateInputsChanged();
      });
    });
  });
}

function syncCoordinateInputs() {
  const activeFormat = normalizeCoordinateFormat(state.coordsFormat);
  syncCoordinateFormatUI();

  syncCoordinateField({
    value: state.line.a.lat,
    kind: "lat",
    activeFormat,
    dd: els.latA,
    ddm: els.ddm.latA,
    dms: els.dms.latA,
  });
  syncCoordinateField({
    value: state.line.a.lon,
    kind: "lon",
    activeFormat,
    dd: els.lonA,
    ddm: els.ddm.lonA,
    dms: els.dms.lonA,
  });
  syncCoordinateField({
    value: state.line.b.lat,
    kind: "lat",
    activeFormat,
    dd: els.latB,
    ddm: els.ddm.latB,
    dms: els.dms.latB,
  });
  syncCoordinateField({
    value: state.line.b.lon,
    kind: "lon",
    activeFormat,
    dd: els.lonB,
    ddm: els.ddm.lonB,
    dms: els.dms.lonB,
  });

  applyCoordinatePickerConstraints();
  refreshHemisphereButtons();
}

function syncCoordinateField({ value, kind, activeFormat, dd, ddm, dms }) {
  if (Number.isFinite(value)) {
    if (dd) setFixedInputValue(dd, value, COORD_DD_DIGITS);
    if (ddm && ddm.deg && ddm.min && ddm.minDec && ddm.hemi) {
      const parts = splitDecimalToDDM(value, kind);
      setNumberInputValue(ddm.deg, parts.deg);
      setNumberInputValue(ddm.min, parts.min);
      setDigitsInputValue(ddm.minDec, parts.minDec);
      ddm.hemi.value = parts.hemi;
    }
    if (dms && dms.deg && dms.min && dms.sec && dms.secDec && dms.hemi) {
      const parts = splitDecimalToDMS(value, kind);
      setNumberInputValue(dms.deg, parts.deg);
      setNumberInputValue(dms.min, parts.min);
      setNumberInputValue(dms.sec, parts.sec);
      setDigitsInputValue(dms.secDec, parts.secDec);
      dms.hemi.value = parts.hemi;
    }
    return;
  }

  if (activeFormat !== "dd" && dd) dd.value = "";
  if (activeFormat !== "ddm" && ddm) {
    if (ddm.deg) ddm.deg.value = "";
    if (ddm.min) ddm.min.value = "";
    if (ddm.minDec) ddm.minDec.value = "";
  }
  if (activeFormat !== "dms" && dms) {
    if (dms.deg) dms.deg.value = "";
    if (dms.min) dms.min.value = "";
    if (dms.sec) dms.sec.value = "";
    if (dms.secDec) dms.secDec.value = "";
  }
}

function parseDecimalDegreesInput(input) {
  if (!input) return null;
  const parsed = Number.parseFloat(input.value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseDigitFraction(input, maxDigits) {
  if (!input) return null;
  const raw = String(input.value || "").trim();
  if (!raw) return 0;
  if (raw.length > maxDigits) return null;
  if (!/^\d+$/.test(raw)) return null;
  const digits = Number.parseInt(raw, 10);
  if (!Number.isFinite(digits)) return null;
  return digits / 10 ** raw.length;
}

function parseDDMInput(group, kind) {
  if (!group || !group.deg || !group.min || !group.minDec || !group.hemi) return null;
  if (!group.deg.value || !group.min.value) return null;
  const deg = Number.parseInt(group.deg.value, 10);
  const minInt = Number.parseInt(group.min.value, 10);
  if (!Number.isFinite(deg) || !Number.isFinite(minInt)) return null;
  if (minInt < 0 || minInt >= 60) return null;
  const maxDeg = kind === "lon" ? 180 : 90;
  if (deg < 0 || deg > maxDeg) return null;
  const minFraction = parseDigitFraction(group.minDec, COORD_DECIMAL_DIGITS);
  if (minFraction === null) return null;
  const minutes = minInt + minFraction;
  if (minutes < 0 || minutes >= 60) return null;
  if (deg === maxDeg && minutes > 0) return null;
  const hemi = group.hemi.value;
  const sign =
    kind === "lon" ? (hemi === "W" ? -1 : hemi === "E" ? 1 : null) : hemi === "S" ? -1 : hemi === "N" ? 1 : null;
  if (sign === null) return null;
  return sign * (deg + minutes / 60);
}

function parseDMSInput(group, kind) {
  if (!group || !group.deg || !group.min || !group.sec || !group.secDec || !group.hemi) return null;
  if (!group.deg.value || !group.min.value || !group.sec.value) return null;
  const deg = Number.parseInt(group.deg.value, 10);
  const min = Number.parseInt(group.min.value, 10);
  const secInt = Number.parseInt(group.sec.value, 10);
  if (!Number.isFinite(deg) || !Number.isFinite(min) || !Number.isFinite(secInt)) return null;
  if (min < 0 || min >= 60) return null;
  if (secInt < 0 || secInt >= 60) return null;
  const maxDeg = kind === "lon" ? 180 : 90;
  if (deg < 0 || deg > maxDeg) return null;
  const secFraction = parseDigitFraction(group.secDec, COORD_DECIMAL_DIGITS);
  if (secFraction === null) return null;
  const sec = secInt + secFraction;
  if (sec < 0 || sec >= 60) return null;
  if (deg === maxDeg && (min > 0 || sec > 0)) return null;
  const hemi = group.hemi.value;
  const sign =
    kind === "lon" ? (hemi === "W" ? -1 : hemi === "E" ? 1 : null) : hemi === "S" ? -1 : hemi === "N" ? 1 : null;
  if (sign === null) return null;
  return sign * (deg + min / 60 + sec / 3600);
}

function parseLineInputs(options = {}) {
  const preserveLineMeta = Boolean(options.preserveLineMeta);
  const format = normalizeCoordinateFormat(state.coordsFormat);
  const previous = {
    a: { ...state.line.a },
    b: { ...state.line.b },
  };

  let aLat = null;
  let aLon = null;
  let bLat = null;
  let bLon = null;

  if (format === "ddm") {
    aLat = parseDDMInput(els.ddm.latA, "lat");
    aLon = parseDDMInput(els.ddm.lonA, "lon");
    bLat = parseDDMInput(els.ddm.latB, "lat");
    bLon = parseDDMInput(els.ddm.lonB, "lon");
  } else if (format === "dms") {
    aLat = parseDMSInput(els.dms.latA, "lat");
    aLon = parseDMSInput(els.dms.lonA, "lon");
    bLat = parseDMSInput(els.dms.latB, "lat");
    bLon = parseDMSInput(els.dms.lonB, "lon");
  } else {
    aLat = parseDecimalDegreesInput(els.latA);
    aLon = parseDecimalDegreesInput(els.lonA);
    bLat = parseDecimalDegreesInput(els.latB);
    bLon = parseDecimalDegreesInput(els.lonB);
  }

  state.line.a.lat = Number.isFinite(aLat) ? aLat : null;
  state.line.a.lon = Number.isFinite(aLon) ? aLon : null;
  state.line.b.lat = Number.isFinite(bLat) ? bLat : null;
  state.line.b.lon = Number.isFinite(bLon) ? bLon : null;

  const changed =
    state.line.a.lat !== previous.a.lat ||
    state.line.a.lon !== previous.a.lon ||
    state.line.b.lat !== previous.b.lat ||
    state.line.b.lon !== previous.b.lon;

  if (changed && !preserveLineMeta) {
    state.lineName = null;
    state.lineSourceId = null;
  }

  saveSettings();
  updateLineNameDisplay();
}

function computeStartTimestamp() {
  if (state.start.mode === "countdown") {
    const seconds = Number.parseInt(state.start.countdownSeconds, 10) || 0;
    return Date.now() + seconds * 1000;
  }
  if (!state.start.absoluteTime) return null;
  const parts = state.start.absoluteTime.split(":").map(Number);
  const [hours, minutes, seconds = 0] = parts;
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  const now = new Date();
  const target = new Date(now);
  target.setHours(hours, minutes, seconds, 0);
  if (target.getTime() <= now.getTime()) {
    target.setDate(target.getDate() + 1);
  }
  return target.getTime();
}

function setStart(options = {}) {
  state.start.startTs = computeStartTimestamp();
  state.start.crossedEarly = false;
  state.start.freeze = null;
  resetBeepState();
  saveSettings();
  if (options.goToRace) {
    setView("race");
  }
}

function syncStartToMinute() {
  if (!state.start.startTs) return;
  const now = Date.now();
  const deltaMs = state.start.startTs - now;
  if (deltaMs <= 0) return;
  if (deltaMs < 60000) {
    state.start.startTs = now + 60000;
  } else {
    const roundedMs = Math.round(deltaMs / 60000) * 60000;
    state.start.startTs = now + roundedMs;
  }
  resetBeepState();
  saveSettings();
  updateStartDisplay();
  updateLineProjection();
}

function adjustStart(seconds) {
  if (!state.start.startTs) return;
  state.start.startTs += seconds * 1000;
  if (state.start.startTs > Date.now()) {
    resetBeepState();
  }
  saveSettings();
}

function updateStartDisplay() {
  const canAdjustStart =
    Boolean(state.start.startTs) && state.start.startTs > Date.now();
  setRaceTimingControlsEnabled(canAdjustStart);

  if (!state.start.startTs) {
    if (els.statusTime) {
      els.statusTime.textContent = "--";
    }
    if (els.statusStartTime) {
      els.statusStartTime.textContent = "--";
    }
    els.raceCountdown.textContent = "--";
    if (els.raceStartClock) {
      els.raceStartClock.textContent = "Start not set";
    }
    state.start.freeze = null;
    document.body.classList.remove("race-success", "race-fail");
    resetBeepState();
    fitRaceText();
    return;
  }
  const now = Date.now();
  const delta = Math.max(0, (state.start.startTs - now) / 1000);
  if (els.statusTime) {
    els.statusTime.textContent = formatTimeRemainingHMSFull(delta);
  }
  if (delta > 0) {
    if (state.start.freeze) {
      state.start.freeze = null;
    }
    document.body.classList.remove("race-success", "race-fail");
    els.raceCountdown.textContent = formatTimeRemainingHMS(delta);
    handleCountdownBeeps(delta);
  }
  const startDate = new Date(state.start.startTs);
  const formattedTime = formatClockTime(startDate, false);
  if (els.raceStartClock) {
    els.raceStartClock.textContent = `Start at ${formattedTime}`;
  }
  if (els.statusStartTime) {
    els.statusStartTime.textContent = formatClockTime(startDate, true);
  }
  if (delta <= 0) {
    if (!state.audio.startBeeped) {
      if (document.body.classList.contains("race-mode")) {
        playBeep(START_BEEP_DURATION_MS, START_BEEP_FREQUENCY);
      }
      state.audio.startBeeped = true;
    }
    setGpsMode("setup");
    if (!state.start.freeze) {
      state.start.freeze = {
        countdown: state.start.crossedEarly ? "False Start" : "Good Start",
      };
    }
    if (!state.start.freeze.countdown) {
      state.start.freeze.countdown = state.start.crossedEarly ? "False Start" : "Good Start";
    }
    els.raceCountdown.textContent = state.start.freeze.countdown;
    if (state.start.crossedEarly) {
      document.body.classList.add("race-fail");
      document.body.classList.remove("race-success");
    } else {
      document.body.classList.add("race-success");
      document.body.classList.remove("race-fail");
    }
    state.audio.lastBeepSecond = null;
  }
  fitRaceText();
}

function updateCurrentTime() {
  if (!els.currentTime) return;
  const now = new Date();
  els.currentTime.textContent = formatClockTime(now, true);
}

function resetPositionState() {
  state.position = null;
  state.lastPosition = null;
  state.velocity = { x: 0, y: 0 };
  state.speed = 0;
  state.kalman = null;
  state.gpsTrackRaw = [];
  state.gpsTrackFiltered = [];
  state.lastGpsFixAt = null;
  updateGPSDisplay();
  updateLineProjection();
}

function setDebugGpsEnabled(enabled) {
  const next = Boolean(enabled);
  if (state.debugGpsEnabled === next) {
    updateDebugControls();
    return;
  }
  state.debugGpsEnabled = next;
  saveSettings();
  state.kalman = null;
  if (state.debugGpsEnabled) {
    startDebugGps(handlePosition, createDebugPosition);
  } else {
    stopDebugGps();
    resetPositionState();
    startRealGps(handlePosition, handlePositionError, getGpsOptionsForMode(state.gpsMode));
  }
  updateDebugControls();
}

function setGpsMode(mode, options = {}) {
  const prev = state.gpsMode;
  const next = mode === "race" ? "race" : "setup";
  const force = Boolean(options.force);
  const highAccuracy = Boolean(options.highAccuracy);
  state.gpsMode = next;
  if (state.debugGpsEnabled) {
    return;
  }
  if (!force && state.geoWatchId !== null && prev === next && !highAccuracy && !isGpsStale()) {
    return;
  }
  const gpsOptions = highAccuracy ? GPS_OPTIONS_RACE : getGpsOptionsForMode(state.gpsMode);
  startRealGps(handlePosition, handlePositionError, gpsOptions);
}

function handlePosition(position) {
  const filtered = applyKalmanFilter(position);
  state.lastGpsFixAt = position.timestamp || Date.now();
  clearGpsRetryTimer();
  let activePosition = position;
  if (filtered) {
    filtered.position = applyForwardOffset(
      filtered.position,
      filtered.velocity,
      state.bowOffsetMeters
    );
    activePosition = filtered.position;
  }
  state.position = activePosition;
  recordTrackPoints(position, filtered ? filtered.position : null);
  if (filtered) {
    state.speed = filtered.speed;
    state.velocity = filtered.velocity;
  } else {
    const coords = position.coords;
    if (Number.isFinite(coords.speed) && Number.isFinite(coords.heading)) {
      state.speed = coords.speed;
      state.velocity = computeVelocityFromHeading(coords.speed, coords.heading);
    } else {
      const computed = computeVelocityFromPositions(position, state.lastPosition);
      state.speed = computed.speed;
      state.velocity = { x: computed.x, y: computed.y };
    }
  }

  state.lastPosition = activePosition;
  updateGPSDisplay();
  updateLineProjection();
}

function handlePositionError(err) {
  if (!els.gpsIcon) return;
  els.gpsIcon.classList.add("bad");
  els.gpsIcon.classList.remove("ok");
  els.gpsIcon.title = `GPS error: ${err.message}`;
  if (!state.debugGpsEnabled && err && (err.code === 2 || err.code === 3)) {
    scheduleGpsRetry(handlePosition, handlePositionError);
  }
}

function initGeolocation() {
  if (state.debugGpsEnabled) {
    startDebugGps(handlePosition, createDebugPosition);
    return;
  }
  setGpsMode(state.gpsMode, { force: true });
}

function registerServiceWorker() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch((err) => {
      console.warn("Service worker failed", err);
    });
  }
}

function bindEvents() {
  const coordinateInputs = [
    els.latA,
    els.lonA,
    els.latB,
    els.lonB,
    els.ddm.latA.deg,
    els.ddm.latA.min,
    els.ddm.latA.minDec,
    els.ddm.latA.hemi,
    els.ddm.lonA.deg,
    els.ddm.lonA.min,
    els.ddm.lonA.minDec,
    els.ddm.lonA.hemi,
    els.ddm.latB.deg,
    els.ddm.latB.min,
    els.ddm.latB.minDec,
    els.ddm.latB.hemi,
    els.ddm.lonB.deg,
    els.ddm.lonB.min,
    els.ddm.lonB.minDec,
    els.ddm.lonB.hemi,
    els.dms.latA.deg,
    els.dms.latA.min,
    els.dms.latA.sec,
    els.dms.latA.secDec,
    els.dms.latA.hemi,
    els.dms.lonA.deg,
    els.dms.lonA.min,
    els.dms.lonA.sec,
    els.dms.lonA.secDec,
    els.dms.lonA.hemi,
    els.dms.latB.deg,
    els.dms.latB.min,
    els.dms.latB.sec,
    els.dms.latB.secDec,
    els.dms.latB.hemi,
    els.dms.lonB.deg,
    els.dms.lonB.min,
    els.dms.lonB.sec,
    els.dms.lonB.secDec,
    els.dms.lonB.hemi,
  ].filter(Boolean);

  coordinateInputs.forEach((input) => {
    input.addEventListener("change", () => {
      applyCoordinatePickerConstraints();
      parseLineInputs();
      updateInputs();
      updateLineStatus();
      updateLineProjection();
    });
  });

  const digitInputs = [
    { input: els.ddm.latA.minDec, maxDigits: COORD_DECIMAL_DIGITS },
    { input: els.ddm.lonA.minDec, maxDigits: COORD_DECIMAL_DIGITS },
    { input: els.ddm.latB.minDec, maxDigits: COORD_DECIMAL_DIGITS },
    { input: els.ddm.lonB.minDec, maxDigits: COORD_DECIMAL_DIGITS },
    { input: els.dms.latA.secDec, maxDigits: COORD_DECIMAL_DIGITS },
    { input: els.dms.lonA.secDec, maxDigits: COORD_DECIMAL_DIGITS },
    { input: els.dms.latB.secDec, maxDigits: COORD_DECIMAL_DIGITS },
    { input: els.dms.lonB.secDec, maxDigits: COORD_DECIMAL_DIGITS },
  ].filter(({ input }) => Boolean(input));

  digitInputs.forEach(({ input, maxDigits }) => {
    input.addEventListener("input", () => {
      const sanitized = String(input.value || "")
        .replace(/\D/g, "")
        .slice(0, maxDigits);
      if (sanitized !== input.value) {
        input.value = sanitized;
      }
    });
  });

  els.useA.addEventListener("click", () => {
    requestHighPrecisionPosition(handlePosition, handlePositionError, (position) => {
      state.line.a = {
        lat: position.coords.latitude,
        lon: position.coords.longitude,
      };
      state.lineName = null;
      state.lineSourceId = null;
      saveSettings();
      updateLineNameDisplay();
      updateInputs();
      updateLineStatus();
      updateLineProjection();
    });
  });

  els.useB.addEventListener("click", () => {
    requestHighPrecisionPosition(handlePosition, handlePositionError, (position) => {
      state.line.b = {
        lat: position.coords.latitude,
        lon: position.coords.longitude,
      };
      state.lineName = null;
      state.lineSourceId = null;
      saveSettings();
      updateLineNameDisplay();
      updateInputs();
      updateLineStatus();
      updateLineProjection();
    });
  });

  els.openMap.addEventListener("click", () => {
    window.location.href = "map.html";
  });

  els.openCoords.addEventListener("click", () => {
    setView("coords");
  });

  if (els.coordsFormatBtn) {
    els.coordsFormatBtn.addEventListener("click", () => {
      const formats = ["dd", "ddm", "dms"];
      const current = normalizeCoordinateFormat(state.coordsFormat);
      const index = formats.indexOf(current);
      state.coordsFormat = formats[(index + 1) % formats.length];
      saveSettings();
      updateInputs();
    });
  }

  if (els.coordsDoneTop) {
    els.coordsDoneTop.addEventListener("click", () => {
      setView("setup");
    });
  }

  els.openLocation.addEventListener("click", () => {
    setView("location");
  });

  if (els.openSettings) {
    els.openSettings.addEventListener("click", () => {
      setView("settings");
    });
  }
  const openBoatButton = els.openBoat || document.getElementById("open-boat");
  if (openBoatButton) {
    openBoatButton.addEventListener("click", (event) => {
      event.preventDefault();
      setView("boat");
    });
  }

  if (els.openTrack) {
    els.openTrack.addEventListener("click", () => {
      setView("track");
    });
  }

  els.saveLine.addEventListener("click", () => {
    if (!hasLine()) {
      window.alert("No start line defined. Set port and starboard marks first.");
      return;
    }
    const nameInput = window.prompt("Name this start line:");
    const timestamp = new Date().toLocaleString("en-GB", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    const name = (nameInput || "").trim() || `Line ${state.savedLines.length + 1} (${timestamp})`;
    const entry = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      name,
      line: {
        a: { ...state.line.a },
        b: { ...state.line.b },
      },
    };
    state.savedLines.unshift(entry);
    saveSavedLines();
  });

  if (els.loadLine) {
    els.loadLine.addEventListener("click", () => {
      openLoadModal();
    });
  }

  if (els.confirmLoad) {
    els.confirmLoad.addEventListener("click", () => {
      if (!state.selectedLineId) return;
      const entry = state.savedLines.find((line) => line.id === state.selectedLineId);
      if (!entry) return;
      state.line = {
        a: { ...entry.line.a },
        b: { ...entry.line.b },
      };
      state.lineName = entry.name || null;
      state.lineSourceId = entry.id || null;
      updateInputs();
      updateLineStatus();
      updateLineProjection();
      saveSettings();
      updateLineNameDisplay();
      closeLoadModal();
    });
  }

  if (els.confirmDelete) {
    els.confirmDelete.addEventListener("click", () => {
      if (!state.selectedLineId) return;
      const entry = state.savedLines.find((line) => line.id === state.selectedLineId);
      if (!entry) return;
      const confirmed = window.confirm(`Delete "${entry.name}"?`);
      if (!confirmed) return;
      state.savedLines = state.savedLines.filter((line) => line.id !== entry.id);
      if (state.lineSourceId === entry.id) {
        state.lineName = null;
        state.lineSourceId = null;
        saveSettings();
        updateLineNameDisplay();
      }
      saveSavedLines();
      state.selectedLineId = null;
      renderSavedLinesList();
    });
  }

  if (els.closeLoad) {
    els.closeLoad.addEventListener("click", () => {
      closeLoadModal();
    });
  }

  const countdownInputs = [
    els.countdownHours,
    els.countdownMinutes,
    els.countdownSeconds,
  ].filter(Boolean);

  if (countdownInputs.length) {
    countdownInputs.forEach((input) => {
      input.addEventListener("change", () => {
        state.start.countdownSeconds = getCountdownSecondsFromPicker();
        saveSettings();
      });
    });
  }

  if (els.absoluteTime) {
    els.absoluteTime.addEventListener("change", () => {
      state.start.absoluteTime = els.absoluteTime.value;
      saveSettings();
    });
  }

  els.setCountdown.addEventListener("click", () => {
    unlockAudio();
    state.start.mode = "countdown";
    state.start.countdownSeconds = getCountdownSecondsFromPicker();
    saveSettings();
    setStart({ goToRace: false });
    if (state.start.startTs) {
      const startDate = new Date(state.start.startTs);
      const absoluteValue = formatTimeInput(startDate);
      state.start.absoluteTime = absoluteValue;
      if (els.absoluteTime) {
        els.absoluteTime.value = absoluteValue;
      }
      saveSettings();
    }
    updateStartDisplay();
    updateLineProjection();
  });

  els.setAbsolute.addEventListener("click", () => {
    unlockAudio();
    state.start.mode = "absolute";
    saveSettings();
    setStart({ goToRace: false });
    updateStartDisplay();
    updateLineProjection();
  });

  els.goRace.addEventListener("click", () => {
    unlockAudio();
    setView("race");
  });

  els.closeRace.addEventListener("click", () => {
    setView("setup");
  });


  els.closeCoords.addEventListener("click", () => {
    setView("setup");
  });

  els.closeLocation.addEventListener("click", () => {
    setView("setup");
  });

  if (els.closeSettings) {
    els.closeSettings.addEventListener("click", () => {
      setView("setup");
    });
  }
  const closeBoatButton = els.closeBoat || document.getElementById("close-boat");
  if (closeBoatButton) {
    closeBoatButton.addEventListener("click", (event) => {
      event.preventDefault();
      commitBoatInputs();
      setView("setup");
    });
  }

  if (els.closeTrack) {
    els.closeTrack.addEventListener("click", () => {
      setView("setup");
    });
  }

  if (els.bowOffset) {
    els.bowOffset.addEventListener("change", () => {
      state.bowOffsetMeters = parseBowOffsetInput();
      saveSettings();
    });
    els.bowOffset.addEventListener("focus", () => {
      els.bowOffset.value = "";
    });
  }
  if (els.boatLength) {
    els.boatLength.addEventListener("change", () => {
      state.boatLengthMeters = parseBoatLengthInput();
      saveSettings();
    });
    els.boatLength.addEventListener("focus", () => {
      els.boatLength.value = "";
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

  if (els.syncRace) {
    els.syncRace.addEventListener("click", () => {
      if (!state.start.startTs || state.start.startTs <= Date.now()) return;
      unlockAudio();
      syncStartToMinute();
    });
  }

  if (els.raceMetricDistance) {
    els.raceMetricDistance.addEventListener("click", () => {
      setRaceMetric("distance");
    });
  }

  if (els.raceMetricTime) {
    els.raceMetricTime.addEventListener("click", () => {
      setRaceMetric("time");
    });
  }

  if (els.racePlus) {
    els.racePlus.addEventListener("click", () => {
      if (!state.start.startTs || state.start.startTs <= Date.now()) return;
      unlockAudio();
      adjustStart(1);
      updateStartDisplay();
      updateLineProjection();
    });
  }

  if (els.raceMinus) {
    els.raceMinus.addEventListener("click", () => {
      if (!state.start.startTs || state.start.startTs <= Date.now()) return;
      unlockAudio();
      adjustStart(-1);
      updateStartDisplay();
      updateLineProjection();
    });
  }

  if (els.debugGpsToggle) {
    els.debugGpsToggle.addEventListener("click", () => {
      setDebugGpsEnabled(!state.debugGpsEnabled);
    });
  }

  if (els.debugRefresh) {
    els.debugRefresh.addEventListener("click", () => {
      hardReload();
    });
  }


  window.addEventListener("hashchange", syncViewFromHash);
}

function setView(view) {
  if (view === "race") {
    document.body.classList.add("race-mode");
    document.body.classList.remove("coords-mode");
    document.body.classList.remove("location-mode");
    document.body.classList.remove("settings-mode");
    document.body.classList.remove("boat-mode");
    document.body.classList.remove("track-mode");
    document.getElementById("race-view").setAttribute("aria-hidden", "false");
    document.getElementById("coords-view").setAttribute("aria-hidden", "true");
    document.getElementById("settings-view").setAttribute("aria-hidden", "true");
    document.getElementById("boat-view").setAttribute("aria-hidden", "true");
    document.getElementById("track-view").setAttribute("aria-hidden", "true");
    document.getElementById("setup-view").setAttribute("aria-hidden", "true");
    history.replaceState(null, "", "#race");
    window.scrollTo({ top: 0, behavior: "instant" });
    requestWakeLock();
    setGpsMode("race");
    fitRaceText();
    return;
  }
  if (view === "coords") {
    updateInputs();
    document.body.classList.remove("race-mode");
    document.body.classList.add("coords-mode");
    document.body.classList.remove("location-mode");
    document.body.classList.remove("settings-mode");
    document.body.classList.remove("boat-mode");
    document.body.classList.remove("track-mode");
    document.getElementById("race-view").setAttribute("aria-hidden", "true");
    document.getElementById("coords-view").setAttribute("aria-hidden", "false");
    document.getElementById("location-view").setAttribute("aria-hidden", "true");
    document.getElementById("settings-view").setAttribute("aria-hidden", "true");
    document.getElementById("boat-view").setAttribute("aria-hidden", "true");
    document.getElementById("track-view").setAttribute("aria-hidden", "true");
    document.getElementById("setup-view").setAttribute("aria-hidden", "true");
    history.replaceState(null, "", "#coords");
    window.scrollTo({ top: 0, behavior: "instant" });
    releaseWakeLock();
    setGpsMode("setup");
    return;
  }
  if (view === "location") {
    document.body.classList.remove("race-mode");
    document.body.classList.remove("coords-mode");
    document.body.classList.add("location-mode");
    document.body.classList.remove("settings-mode");
    document.body.classList.remove("boat-mode");
    document.body.classList.remove("track-mode");
    document.getElementById("race-view").setAttribute("aria-hidden", "true");
    document.getElementById("coords-view").setAttribute("aria-hidden", "true");
    document.getElementById("location-view").setAttribute("aria-hidden", "false");
    document.getElementById("settings-view").setAttribute("aria-hidden", "true");
    document.getElementById("boat-view").setAttribute("aria-hidden", "true");
    document.getElementById("track-view").setAttribute("aria-hidden", "true");
    document.getElementById("setup-view").setAttribute("aria-hidden", "true");
    history.replaceState(null, "", "#location");
    releaseWakeLock();
    setGpsMode("setup", { force: true, highAccuracy: true });
    return;
  }
  if (view === "settings") {
    updateInputs();
    document.body.classList.remove("race-mode");
    document.body.classList.remove("coords-mode");
    document.body.classList.remove("location-mode");
    document.body.classList.add("settings-mode");
    document.body.classList.remove("boat-mode");
    document.body.classList.remove("track-mode");
    document.getElementById("race-view").setAttribute("aria-hidden", "true");
    document.getElementById("coords-view").setAttribute("aria-hidden", "true");
    document.getElementById("location-view").setAttribute("aria-hidden", "true");
    document.getElementById("settings-view").setAttribute("aria-hidden", "false");
    document.getElementById("boat-view").setAttribute("aria-hidden", "true");
    document.getElementById("track-view").setAttribute("aria-hidden", "true");
    document.getElementById("setup-view").setAttribute("aria-hidden", "true");
    history.replaceState(null, "", "#settings");
    window.scrollTo({ top: 0, behavior: "instant" });
    releaseWakeLock();
    setGpsMode("setup");
    return;
  }
  if (view === "boat") {
    updateInputs();
    document.body.classList.remove("race-mode");
    document.body.classList.remove("coords-mode");
    document.body.classList.remove("location-mode");
    document.body.classList.remove("settings-mode");
    document.body.classList.add("boat-mode");
    document.body.classList.remove("track-mode");
    document.getElementById("race-view").setAttribute("aria-hidden", "true");
    document.getElementById("coords-view").setAttribute("aria-hidden", "true");
    document.getElementById("location-view").setAttribute("aria-hidden", "true");
    document.getElementById("settings-view").setAttribute("aria-hidden", "true");
    document.getElementById("boat-view").setAttribute("aria-hidden", "false");
    document.getElementById("track-view").setAttribute("aria-hidden", "true");
    document.getElementById("setup-view").setAttribute("aria-hidden", "true");
    history.replaceState(null, "", "#boat");
    window.scrollTo({ top: 0, behavior: "instant" });
    releaseWakeLock();
    setGpsMode("setup");
    return;
  }
  if (view === "track") {
    document.body.classList.remove("race-mode");
    document.body.classList.remove("coords-mode");
    document.body.classList.remove("location-mode");
    document.body.classList.remove("settings-mode");
    document.body.classList.remove("boat-mode");
    document.body.classList.add("track-mode");
    document.getElementById("race-view").setAttribute("aria-hidden", "true");
    document.getElementById("coords-view").setAttribute("aria-hidden", "true");
    document.getElementById("location-view").setAttribute("aria-hidden", "true");
    document.getElementById("settings-view").setAttribute("aria-hidden", "true");
    document.getElementById("boat-view").setAttribute("aria-hidden", "true");
    document.getElementById("track-view").setAttribute("aria-hidden", "false");
    document.getElementById("setup-view").setAttribute("aria-hidden", "true");
    history.replaceState(null, "", "#track");
    window.scrollTo({ top: 0, behavior: "instant" });
    releaseWakeLock();
    setGpsMode("setup", { force: true, highAccuracy: true });
    renderTrack();
    return;
  }
  document.body.classList.remove("race-mode");
  document.body.classList.remove("coords-mode");
  document.body.classList.remove("location-mode");
  document.body.classList.remove("settings-mode");
  document.body.classList.remove("boat-mode");
  document.body.classList.remove("track-mode");
  document.getElementById("race-view").setAttribute("aria-hidden", "true");
  document.getElementById("coords-view").setAttribute("aria-hidden", "true");
  document.getElementById("location-view").setAttribute("aria-hidden", "true");
  document.getElementById("settings-view").setAttribute("aria-hidden", "true");
  document.getElementById("boat-view").setAttribute("aria-hidden", "true");
  document.getElementById("track-view").setAttribute("aria-hidden", "true");
  document.getElementById("setup-view").setAttribute("aria-hidden", "false");
  history.replaceState(null, "", "#setup");
  releaseWakeLock();
  setGpsMode("setup");
}

function syncViewFromHash() {
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
  if (location.hash === "#settings") {
    setView("settings");
    return;
  }
  if (location.hash === "#boat") {
    setView("boat");
    return;
  }
  if (location.hash === "#track") {
    setView("track");
    return;
  }
  setView("setup");
}

function tick() {
  updateLineProjection();
  updateStartDisplay();
  updateCurrentTime();
  updateDebugControls();
  if (document.body.classList.contains("track-mode")) {
    renderTrack();
  }
  if (isGpsStale()) {
    scheduleGpsRetry(handlePosition, handlePositionError);
  }
  requestAnimationFrame(() => {
    setTimeout(tick, 1000);
  });
}

loadSettings();
applyDebugFlagFromUrl();
initCoordinatePickers();
initCountdownPicker();
initHemisphereToggles();
loadSavedLines();
syncLineNameWithSavedLines();
updateInputs();
updateLineStatus();
updateRaceMetricLabels();
bindEvents();
initGeolocation();
registerServiceWorker();
clearNoCacheParam();
updateStartDisplay();
updateGPSDisplay();
updateCurrentTime();
syncViewFromHash();
tick();

window.addEventListener("resize", () => {
  if (document.body.classList.contains("track-mode")) {
    renderTrack();
  }
});

document.addEventListener("click", unlockAudio, { once: true });
document.addEventListener("touchstart", unlockAudio, { once: true });
document.addEventListener("pointerdown", unlockAudio, { once: true });
updateDebugControls();

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && document.body.classList.contains("race-mode")) {
    requestWakeLock();
  }
});
