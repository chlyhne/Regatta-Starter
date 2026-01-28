import { els } from "../../ui/dom.js";
import {
  state,
  hemisphereGroups,
  LINES_KEY,
  COORD_DECIMAL_DIGITS,
  COORD_DD_DIGITS,
  START_BEEP_DURATION_MS,
  START_BEEP_FREQUENCY,
} from "../../core/state.js";
import { unlockAudio, playBeep, handleCountdownBeeps, resetBeepState } from "../../core/audio.js";
import { requestHighPrecisionPosition } from "../../core/gps-watch.js";
import {
  hasLine,
  updateRaceHintUnits,
  setRaceMetric,
  updateLineProjection,
} from "./race.js";
import {
  formatClockTime,
  formatTimeInput,
  formatTimeRemainingHMSFull,
  splitDurationSeconds,
  formatTimeRemainingHMS,
} from "../../core/format.js";
import { fitRaceText } from "./race-fit.js";
import { MAX_COUNTDOWN_SECONDS } from "../../core/settings.js";
import { trimTrailingZeros } from "../../core/common.js";

let countdownPickerLive = false;
let starterDeps = {
  saveSettings: null,
  updateInputs: null,
  setView: null,
  setGpsMode: null,
  setImuEnabled: null,
  handlePosition: null,
  handlePositionError: null,
  openImuCalibrationModal: null,
  startImuCalibration: null,
  closeImuCalibrationModal: null,
};

function initStarter(deps = {}) {
  starterDeps = { ...starterDeps, ...deps };
}

function setRaceTimingControlsEnabled(enabled) {
  const disabled = !enabled;
  if (els.racePlus) els.racePlus.disabled = disabled;
  if (els.raceMinus) els.raceMinus.disabled = disabled;
  if (els.syncRace) els.syncRace.disabled = disabled;
}

function syncCountdownPicker(secondsOverride) {
  if (!els.countdownHours || !els.countdownMinutes || !els.countdownSeconds) return;
  const totalSeconds = Number.isFinite(secondsOverride)
    ? secondsOverride
    : state.start.countdownSeconds;
  const { hours, minutes, seconds } = splitDurationSeconds(totalSeconds);
  setNumberInputValue(els.countdownHours, hours);
  setNumberInputValue(els.countdownMinutes, minutes);
  setNumberInputValue(els.countdownSeconds, seconds);
}

function setCountdownPickerLive(active) {
  countdownPickerLive = Boolean(active);
}

function cancelActiveCountdown(options = {}) {
  const { force = false, clearAbsolute = false } = options;
  if (!force && state.start.mode !== "countdown") return;
  const hasStart = Boolean(state.start.startTs);
  if (!hasStart && !clearAbsolute) return;
  const remaining = hasStart
    ? Math.max(0, Math.round((state.start.startTs - Date.now()) / 1000))
    : null;
  if (hasStart) {
    state.start.countdownSeconds = remaining;
  }
  state.start.startTs = null;
  if (clearAbsolute) {
    state.start.absoluteTime = "";
  }
  state.start.freeze = null;
  state.start.crossedEarly = false;
  setCountdownPickerLive(false);
  resetBeepState();
  if (starterDeps.saveSettings) {
    starterDeps.saveSettings();
  }
  if (clearAbsolute && els.absoluteTime) {
    els.absoluteTime.value = "";
  }
  if (Number.isFinite(remaining)) {
    syncCountdownPicker(remaining);
  }
  updateStartDisplay();
  updateLineProjection();
}

function getCountdownSecondsFromPicker() {
  if (!els.countdownHours || !els.countdownMinutes || !els.countdownSeconds) {
    return state.start.countdownSeconds;
  }
  const hours = Number.parseInt(els.countdownHours.value, 10) || 0;
  const minutes = Number.parseInt(els.countdownMinutes.value, 10) || 0;
  const seconds = Number.parseInt(els.countdownSeconds.value, 10) || 0;
  const total = hours * 3600 + minutes * 60 + seconds;
  return Math.min(Math.max(total, 0), MAX_COUNTDOWN_SECONDS);
}

function updateStartModeToggle() {
  const isCountdown = state.start.mode === "countdown";
  if (els.startModeAbsolute) {
    els.startModeAbsolute.setAttribute("aria-pressed", isCountdown ? "false" : "true");
  }
  if (els.startModeCountdown) {
    els.startModeCountdown.setAttribute("aria-pressed", isCountdown ? "true" : "false");
  }
  if (els.startModeAbsolutePanel) {
    els.startModeAbsolutePanel.hidden = isCountdown;
  }
  if (els.startModeCountdownPanel) {
    els.startModeCountdownPanel.hidden = !isCountdown;
  }
  if (els.setStart) {
    els.setStart.textContent = isCountdown ? "Begin" : "Set";
  }
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

function hasStartLine() {
  return (
    Number.isFinite(state.line.a.lat) &&
    Number.isFinite(state.line.a.lon) &&
    Number.isFinite(state.line.b.lat) &&
    Number.isFinite(state.line.b.lon)
  );
}

function updateLineNameDisplay() {
  if (!els.statusLineName) return;
  if (!hasStartLine()) {
    els.statusLineName.textContent = "NO LINE";
    return;
  }
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
    if (starterDeps.saveSettings) {
      starterDeps.saveSettings();
    }
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

function swapStartLineMarks() {
  const nextA = { ...state.line.b };
  const nextB = { ...state.line.a };
  state.line.a = nextA;
  state.line.b = nextB;
  state.lineName = null;
  state.lineSourceId = null;
  if (starterDeps.saveSettings) {
    starterDeps.saveSettings();
  }
  updateLineNameDisplay();
  if (starterDeps.updateInputs) {
    starterDeps.updateInputs();
  }
  updateLineProjection();
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
  if (starterDeps.updateInputs) {
    starterDeps.updateInputs();
  }
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

  if (starterDeps.saveSettings) {
    starterDeps.saveSettings();
  }
  updateLineNameDisplay();
}

function computeStartTimestamp() {
  if (state.start.mode === "countdown") {
    const seconds = Math.min(
      Math.max(Number.parseInt(state.start.countdownSeconds, 10) || 0, 0),
      MAX_COUNTDOWN_SECONDS
    );
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
  if (starterDeps.saveSettings) {
    starterDeps.saveSettings();
  }
  if (options.goToRace && starterDeps.setView) {
    starterDeps.setView("race");
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
  if (starterDeps.saveSettings) {
    starterDeps.saveSettings();
  }
  updateStartDisplay();
  updateLineProjection();
}

function adjustStart(seconds) {
  if (!state.start.startTs) return;
  state.start.startTs += seconds * 1000;
  if (state.start.startTs > Date.now()) {
    resetBeepState();
  }
  if (starterDeps.saveSettings) {
    starterDeps.saveSettings();
  }
}

function updateStartDisplay() {
  const canAdjustStart = Boolean(state.start.startTs) && state.start.startTs > Date.now();
  setRaceTimingControlsEnabled(canAdjustStart);

  if (!state.start.startTs) {
    setCountdownPickerLive(false);
    if (els.statusTime) {
      els.statusTime.textContent = "NO TIME";
    }
    if (els.statusStartTime) {
      els.statusStartTime.textContent = "NO TIME";
    }
    els.raceCountdown.textContent = "NO TIME";
    state.start.freeze = null;
    document.body.classList.remove("race-success", "race-fail");
    resetBeepState();
    fitRaceText();
    return;
  }
  const now = Date.now();
  const delta = Math.max(0, (state.start.startTs - now) / 1000);
  if (state.start.mode === "countdown" && countdownPickerLive) {
    syncCountdownPicker(Math.max(0, Math.round(delta)));
    if (delta <= 0) {
      countdownPickerLive = false;
    }
  }
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
    if (starterDeps.setGpsMode) {
      starterDeps.setGpsMode("setup");
    }
    const outcomeText = state.start.crossedEarly ? "False\nStart" : "Good\nStart";
    if (!state.start.freeze) {
      state.start.freeze = {
        countdown: outcomeText,
      };
    }
    if (!state.start.freeze.countdown) {
      state.start.freeze.countdown = outcomeText;
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


function syncStarterInputs() {
  syncCoordinateInputs();
  syncCountdownPicker();
  updateStartModeToggle();
  updateRaceHintUnits();
  if (els.absoluteTime) {
    els.absoluteTime.value = state.start.absoluteTime || "";
  }
}

function initStarterUi() {
  initCoordinatePickers();
  initCountdownPicker();
  initHemisphereToggles();
}

function bindStarterEvents() {
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
      if (starterDeps.updateInputs) {
        starterDeps.updateInputs();
      }
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

  if (els.useA) {
    els.useA.addEventListener("click", () => {
      requestHighPrecisionPosition(
        starterDeps.handlePosition,
        starterDeps.handlePositionError,
        () => {
          const sourcePosition = state.kalmanPosition;
          if (!sourcePosition) {
            window.alert("Waiting for Kalman GPS fix. Try again in a moment.");
            return;
          }
          state.line.a = {
            lat: sourcePosition.coords.latitude,
            lon: sourcePosition.coords.longitude,
          };
          state.lineName = null;
          state.lineSourceId = null;
          if (starterDeps.saveSettings) {
            starterDeps.saveSettings();
          }
          updateLineNameDisplay();
          if (starterDeps.updateInputs) {
            starterDeps.updateInputs();
          }
          updateLineProjection();
        }
      );
    });
  }

  if (els.useB) {
    els.useB.addEventListener("click", () => {
      requestHighPrecisionPosition(
        starterDeps.handlePosition,
        starterDeps.handlePositionError,
        () => {
          const sourcePosition = state.kalmanPosition;
          if (!sourcePosition) {
            window.alert("Waiting for Kalman GPS fix. Try again in a moment.");
            return;
          }
          state.line.b = {
            lat: sourcePosition.coords.latitude,
            lon: sourcePosition.coords.longitude,
          };
          state.lineName = null;
          state.lineSourceId = null;
          if (starterDeps.saveSettings) {
            starterDeps.saveSettings();
          }
          updateLineNameDisplay();
          if (starterDeps.updateInputs) {
            starterDeps.updateInputs();
          }
          updateLineProjection();
        }
      );
    });
  }

  if (els.swapMarks) {
    els.swapMarks.addEventListener("click", () => {
      swapStartLineMarks();
    });
  }

  if (els.swapCoords) {
    els.swapCoords.addEventListener("click", () => {
      swapStartLineMarks();
    });
  }

  if (els.swapLocation) {
    els.swapLocation.addEventListener("click", () => {
      swapStartLineMarks();
    });
  }

  if (els.openCoords) {
    els.openCoords.addEventListener("click", () => {
      if (starterDeps.setView) {
        starterDeps.setView("coords");
      }
    });
  }

  if (els.coordsFormatBtn) {
    els.coordsFormatBtn.addEventListener("click", () => {
      const formats = ["dd", "ddm", "dms"];
      const current = normalizeCoordinateFormat(state.coordsFormat);
      const index = formats.indexOf(current);
      state.coordsFormat = formats[(index + 1) % formats.length];
      if (starterDeps.saveSettings) {
        starterDeps.saveSettings();
      }
      if (starterDeps.updateInputs) {
        starterDeps.updateInputs();
      }
    });
  }

  if (els.coordsDoneTop) {
    els.coordsDoneTop.addEventListener("click", () => {
      if (starterDeps.setView) {
        starterDeps.setView("setup");
      }
    });
  }

  if (els.openLocation) {
    els.openLocation.addEventListener("click", () => {
      if (starterDeps.setView) {
        starterDeps.setView("location");
      }
    });
  }

  if (els.saveLine) {
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
      state.lineName = entry.name || null;
      state.lineSourceId = entry.id;
      state.selectedLineId = entry.id;
      if (starterDeps.saveSettings) {
        starterDeps.saveSettings();
      }
      updateLineNameDisplay();
      updateLineProjection();
    });
  }

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
      if (starterDeps.updateInputs) {
        starterDeps.updateInputs();
      }
      updateLineProjection();
      if (starterDeps.saveSettings) {
        starterDeps.saveSettings();
      }
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
        if (starterDeps.saveSettings) {
          starterDeps.saveSettings();
        }
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
      input.addEventListener("focus", () => {
        cancelActiveCountdown({ force: true, clearAbsolute: true });
      });
      input.addEventListener("pointerdown", () => {
        cancelActiveCountdown({ force: true, clearAbsolute: true });
      });
      input.addEventListener("change", () => {
        setCountdownPickerLive(false);
        state.start.countdownSeconds = getCountdownSecondsFromPicker();
        if (starterDeps.saveSettings) {
          starterDeps.saveSettings();
        }
      });
    });
  }

  if (els.absoluteTime) {
    els.absoluteTime.addEventListener("change", () => {
      state.start.absoluteTime = els.absoluteTime.value;
      if (starterDeps.saveSettings) {
        starterDeps.saveSettings();
      }
    });
  }

  if (els.startModeAbsolute) {
    els.startModeAbsolute.addEventListener("click", () => {
      state.start.mode = "absolute";
      cancelActiveCountdown();
      if (starterDeps.saveSettings) {
        starterDeps.saveSettings();
      }
      updateStartModeToggle();
    });
  }

  if (els.startModeCountdown) {
    els.startModeCountdown.addEventListener("click", () => {
      state.start.mode = "countdown";
      const hasActiveStart = Boolean(state.start.startTs) && state.start.startTs > Date.now();
      if (hasActiveStart) {
        const remaining = Math.max(0, Math.round((state.start.startTs - Date.now()) / 1000));
        state.start.countdownSeconds = remaining;
        setCountdownPickerLive(true);
        syncCountdownPicker(remaining);
      } else {
        setCountdownPickerLive(false);
      }
      if (starterDeps.saveSettings) {
        starterDeps.saveSettings();
      }
      updateStartModeToggle();
      updateStartDisplay();
    });
  }

  if (els.setStart) {
    els.setStart.addEventListener("click", () => {
      unlockAudio();
      if (state.start.mode === "countdown") {
        state.start.countdownSeconds = getCountdownSecondsFromPicker();
        if (starterDeps.saveSettings) {
          starterDeps.saveSettings();
        }
        setCountdownPickerLive(true);
        setStart({ goToRace: false });
        if (state.start.startTs) {
          const startDate = new Date(state.start.startTs);
          const absoluteValue = formatTimeInput(startDate);
          state.start.absoluteTime = absoluteValue;
          if (els.absoluteTime) {
            els.absoluteTime.value = absoluteValue;
          }
          if (starterDeps.saveSettings) {
            starterDeps.saveSettings();
          }
        }
      } else {
        state.start.mode = "absolute";
        if (starterDeps.saveSettings) {
          starterDeps.saveSettings();
        }
        cancelActiveCountdown();
        setStart({ goToRace: false });
      }
      updateStartDisplay();
      updateLineProjection();
    });
  }

  if (els.goRace) {
    els.goRace.addEventListener("click", () => {
      unlockAudio();
      if (starterDeps.setView) {
        starterDeps.setView("race");
      }
    });
  }

  if (els.closeRace) {
    els.closeRace.addEventListener("click", () => {
      if (starterDeps.setView) {
        starterDeps.setView("setup");
      }
    });
  }

  if (els.closeCoords) {
    els.closeCoords.addEventListener("click", () => {
      if (starterDeps.setView) {
        starterDeps.setView("setup");
      }
    });
  }

  if (els.closeLocation) {
    els.closeLocation.addEventListener("click", () => {
      if (starterDeps.setView) {
        starterDeps.setView("setup");
      }
    });
  }

  if (els.closeTrack) {
    const closeTrack = (event) => {
      if (event) {
        event.preventDefault();
        event.stopPropagation();
      }
      if (starterDeps.setView) {
        starterDeps.setView("setup");
      }
    };
    els.closeTrack.addEventListener("click", closeTrack);
    els.closeTrack.addEventListener("touchend", closeTrack, { passive: false });
    els.closeTrack.addEventListener("pointerup", closeTrack);
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

  if (els.openImuCalibration) {
    els.openImuCalibration.addEventListener("click", () => {
      if (starterDeps.openImuCalibrationModal) {
        starterDeps.openImuCalibrationModal();
      }
    });
  }

  if (els.startImuCalibration) {
    els.startImuCalibration.addEventListener("click", () => {
      if (starterDeps.startImuCalibration) {
        starterDeps.startImuCalibration();
      }
    });
  }

  if (els.closeImuCalibration) {
    els.closeImuCalibration.addEventListener("click", () => {
      if (starterDeps.closeImuCalibrationModal) {
        starterDeps.closeImuCalibrationModal();
      }
    });
  }

}

export {
  initStarter,
  initStarterUi,
  bindStarterEvents,
  syncStarterInputs,
  loadSavedLines,
  syncLineNameWithSavedLines,
  updateStartDisplay,
};
