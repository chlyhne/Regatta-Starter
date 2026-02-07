import { els } from "../../ui/dom.js";
import {
  state,
  hemisphereGroups,
  COORD_DECIMAL_DIGITS,
  COORD_DD_DIGITS,
  START_BEEP_DURATION_MS,
  START_BEEP_FREQUENCY,
} from "../../core/state.js";
import {
  loadVenues,
  saveVenues,
  loadRaces,
  saveRaces,
  createVenue,
  createRace,
  getVenueById,
  getRaceById,
  normalizeRouteEntry,
  getLineById,
  getLineDisplayName,
  getStartLineFromVenue,
  getFinishLineFromVenue,
  migrateLineSelections,
  buildCourseMarksFromRace,
} from "../../core/venues.js";
import { unlockAudio, playBeep, handleCountdownBeeps, resetBeepState } from "../../core/audio.js";
import { requestHighPrecisionPosition } from "../../core/gps-watch.js";
import { toMeters, getClosestPointOnSegment } from "../../core/geo.js";
import {
  hasLine,
  updateRaceHintUnits,
  setRaceMetric,
  updateLineProjection,
} from "./race.js";
import {
  formatClockTime,
  formatUnitLabel,
  formatSignificant,
  formatTimeInput,
  formatTimeRemainingHMSFull,
  splitDurationSeconds,
  formatTimeRemainingHMS,
} from "../../core/format.js";
import { fitRaceText } from "./race-fit.js";
import { MAX_COUNTDOWN_SECONDS } from "../../core/settings.js";
import { trimTrailingZeros } from "../../core/common.js";
import { setTrackMode } from "./track.js";

let countdownPickerLive = false;
let venueSelectionTargetRaceId = null;
let venueSelectionReturnToRace = false;
let startLineReturnModal = null;
let startLineReturnRaceId = null;
let finishLineReturnModal = null;
let finishLineReturnRaceId = null;
const NAUTICAL_MILE_METERS = 1852;
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
  getNoCacheQuery: null,
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

function getMapHref(mode, options = {}) {
  const {
    returnView = "setup",
    returnModal = null,
    returnRaceId = null,
  } = options;
  const suffix = starterDeps.getNoCacheQuery ? starterDeps.getNoCacheQuery() : "";
  const params = new URLSearchParams(suffix.replace(/^\?/, ""));
  params.set("mode", mode);
  if (returnView) {
    params.set("return", returnView);
  }
  if (returnModal) {
    params.set("returnModal", returnModal);
  }
  if (returnRaceId) {
    params.set("returnRaceId", returnRaceId);
  }
  return `map.html?${params.toString()}`;
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

function normalizeMarkName(name, fallback) {
  const trimmed = typeof name === "string" ? name.trim() : "";
  if (trimmed) return trimmed;
  return fallback || "Mark";
}

function normalizeMarkDescription(description) {
  return typeof description === "string" ? description.trim() : "";
}

function normalizeCourseMark(mark, index) {
  if (!mark) return null;
  const lat = Number.parseFloat(mark.lat);
  const lon = Number.parseFloat(mark.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return {
    lat,
    lon,
    name: normalizeMarkName(mark.name, `Mark ${index + 1}`),
    description: normalizeMarkDescription(mark.description),
    rounding: mark.rounding === "starboard" ? "starboard" : "port",
    manual: Boolean(mark.manual),
  };
}

function normalizeCourseMarks(marks) {
  if (!Array.isArray(marks)) return [];
  return marks
    .map((mark, index) => normalizeCourseMark(mark, index))
    .filter(Boolean);
}

function getDefaultStartState() {
  const defaults = state.startDefaults || {};
  return {
    mode: defaults.mode === "absolute" ? "absolute" : "countdown",
    countdownSeconds: Number.isFinite(defaults.countdownSeconds)
      ? defaults.countdownSeconds
      : 300,
    absoluteTime: typeof defaults.absoluteTime === "string" ? defaults.absoluteTime : "",
    startTs: null,
    crossedEarly: false,
  };
}

function syncStartFromRace() {
  if (!state.race) return;
  const raceStart = state.race.start;
  if (!raceStart || typeof raceStart !== "object") {
    const defaults = getDefaultStartState();
    state.start = { ...state.start, ...defaults, freeze: null };
    state.race.start = { ...defaults };
    state.race.updatedAt = Date.now();
    saveRaces(state.races);
    return;
  }
  state.start = { ...state.start, ...raceStart, freeze: null };
}

function persistVenueAndRace(options = {}) {
  if (!state.venue || !state.race) return;
  state.venue.updatedAt = Date.now();
  state.race.updatedAt = Date.now();
  saveVenues(state.venues);
  saveRaces(state.races);
  if (options.saveSettings !== false && starterDeps.saveSettings) {
    starterDeps.saveSettings();
  }
}

function syncVenueDefaultRoute() {
  if (!state.venue || !state.race) return;
  const route = Array.isArray(state.race.route) ? state.race.route : [];
  state.venue.defaultRoute = route.map((entry) => ({ ...entry }));
  const lines = Array.isArray(state.venue.lines) ? state.venue.lines : [];
  const hasLine = (lineId) => Boolean(lineId && getLineById(lines, lineId));
  state.venue.defaultRouteStartLineId = hasLine(state.race.routeStartLineId)
    ? state.race.routeStartLineId
    : null;
  state.venue.defaultRouteFinishLineId = hasLine(state.race.routeFinishLineId)
    ? state.race.routeFinishLineId
    : null;
}

function pruneRouteEntries() {
  if (!state.race || !state.venue) return false;
  const marks = Array.isArray(state.venue.marks) ? state.venue.marks : [];
  const markIds = new Set(marks.map((mark) => mark.id));
  const original = Array.isArray(state.race.route) ? state.race.route : [];
  const normalized = original.map(normalizeRouteEntry).filter(Boolean);
  const filtered = normalized.filter((entry) => markIds.has(entry.markId));
  const changed =
    filtered.length !== original.length ||
    filtered.some((entry, index) => {
      const prev = original[index];
      return (
        !prev ||
        prev.markId !== entry.markId ||
        prev.rounding !== entry.rounding ||
        Boolean(prev.manual) !== Boolean(entry.manual)
      );
    });
  if (changed) {
    state.race.route = filtered;
    if (!filtered.length) {
      state.race.routeEnabled = false;
    }
  }
  return changed;
}

function getRouteEntries() {
  if (!state.race || !Array.isArray(state.race.route)) return [];
  return state.race.route;
}

function getRouteMarks() {
  if (!state.venue) return [];
  const marksById = new Map(
    Array.isArray(state.venue.marks)
      ? state.venue.marks.map((mark) => [mark.id, mark])
      : []
  );
  return getRouteEntries()
    .map((entry) => marksById.get(entry.markId))
    .filter(Boolean);
}

function getSelectedStartLine() {
  if (!state.venue || !state.race) return null;
  const lineId = state.race.startLineId || state.venue.defaultStartLineId;
  if (!lineId) return null;
  return getLineById(state.venue.lines, lineId);
}

function syncStartLineMarksFromState() {
  if (!state.venue) return;
  const line = getSelectedStartLine();
  if (!line) return;
  const portMark = state.venue.marks.find((mark) => mark.id === line.portMarkId);
  const starboardMark = state.venue.marks.find(
    (mark) => mark.id === line.starboardMarkId
  );
  let changed = false;
  const hasA = Number.isFinite(state.line.a.lat) && Number.isFinite(state.line.a.lon);
  const hasB = Number.isFinite(state.line.b.lat) && Number.isFinite(state.line.b.lon);
  if (portMark && hasA) {
    if (portMark.lat !== state.line.a.lat || portMark.lon !== state.line.a.lon) {
      portMark.lat = state.line.a.lat;
      portMark.lon = state.line.a.lon;
      changed = true;
    }
  }
  if (starboardMark && hasB) {
    if (
      starboardMark.lat !== state.line.b.lat ||
      starboardMark.lon !== state.line.b.lon
    ) {
      starboardMark.lat = state.line.b.lat;
      starboardMark.lon = state.line.b.lon;
      changed = true;
    }
  }
  if (changed) {
    persistVenueAndRace();
    syncDerivedRaceState();
  }
}

function refreshVenueRaceState() {
  const venues = loadVenues();
  const races = loadRaces();
  const migrated = migrateLineSelections(venues, races);
  if (migrated) {
    saveVenues(venues);
    saveRaces(races);
  }
  if (!venues.length) {
    venues.push(createVenue("Local venue"));
    saveVenues(venues);
  }
  let venue = getVenueById(venues, state.activeVenueId) || null;
  let race = getRaceById(races, state.activeRaceId) || null;

  if (race && race.venueId) {
    venue = getVenueById(venues, race.venueId) || venue;
  }
  if (!venue) {
    venue = venues[0];
  }
  if (!race || race.venueId !== venue.id) {
    race = createRace(`Race ${races.length + 1}`, venue);
    races.unshift(race);
    saveRaces(races);
  }

  state.venues = venues;
  state.races = races;
  state.venue = venue;
  state.race = race;
  state.activeVenueId = venue.id;
  state.activeRaceId = race.id;
  pruneRouteEntries();
  syncDerivedRaceState();
  syncStartFromRace();
}

function syncDerivedRaceState() {
  if (!state.venue || !state.race) return;
  const lines = Array.isArray(state.venue.lines) ? state.venue.lines : [];
  const hasLine = (lineId) => Boolean(lineId && getLineById(lines, lineId));

  let startLineId = state.race.startLineId || state.venue.defaultStartLineId || null;
  if (startLineId && !hasLine(startLineId)) startLineId = null;
  let finishLineId = state.race.finishLineId || state.venue.defaultFinishLineId || null;
  if (finishLineId && !hasLine(finishLineId)) finishLineId = null;
  let routeStartLineId =
    state.race.routeStartLineId || state.venue.defaultRouteStartLineId || null;
  if (routeStartLineId && !hasLine(routeStartLineId)) routeStartLineId = null;
  let routeFinishLineId =
    state.race.routeFinishLineId || state.venue.defaultRouteFinishLineId || null;
  if (routeFinishLineId && !hasLine(routeFinishLineId)) routeFinishLineId = null;

  let routeEnabled = Boolean(state.race.routeEnabled);
  if (routeEnabled) {
    if (!routeStartLineId && startLineId) {
      routeStartLineId = startLineId;
    }
    if (!routeFinishLineId && finishLineId) {
      routeFinishLineId = finishLineId;
    }
    if (!routeStartLineId) {
      routeEnabled = false;
    } else {
      startLineId = routeStartLineId;
      finishLineId = routeFinishLineId || null;
    }
  }

  let changed = false;
  if (state.race.routeEnabled !== routeEnabled) {
    state.race.routeEnabled = routeEnabled;
    changed = true;
  }
  if (state.race.startLineId !== startLineId) {
    state.race.startLineId = startLineId;
    changed = true;
  }
  if (state.race.finishLineId !== finishLineId) {
    state.race.finishLineId = finishLineId;
    changed = true;
  }
  if (state.race.routeStartLineId !== routeStartLineId) {
    state.race.routeStartLineId = routeStartLineId;
    changed = true;
  }
  if (state.race.routeFinishLineId !== routeFinishLineId) {
    state.race.routeFinishLineId = routeFinishLineId;
    changed = true;
  }
  if (changed) {
    persistVenueAndRace();
  }

  const startLine = getStartLineFromVenue(state.venue, state.race);
  const finishLine = getFinishLineFromVenue(state.venue, state.race);
  const courseMarks = buildCourseMarksFromRace(state.venue, state.race);

  state.line = startLine
    ? { a: { ...startLine.a }, b: { ...startLine.b } }
    : { a: { lat: null, lon: null }, b: { lat: null, lon: null } };

  state.course = {
    enabled: routeEnabled,
    marks: courseMarks,
    finish: finishLine
      ? {
          useStartLine: false,
          reverse: false,
          a: { ...finishLine.a },
          b: { ...finishLine.b },
        }
      : {
          useStartLine: false,
          reverse: false,
          a: { lat: null, lon: null },
          b: { lat: null, lon: null },
        },
    version: Date.now(),
  };
}

function hasStartLine() {
  return (
    Number.isFinite(state.line.a.lat) &&
    Number.isFinite(state.line.a.lon) &&
    Number.isFinite(state.line.b.lat) &&
    Number.isFinite(state.line.b.lon)
  );
}

function getCourseMarks() {
  const marks = Array.isArray(state.course?.marks) ? state.course.marks : [];
  marks.forEach((mark, index) => {
    if (!mark) return;
    mark.name = normalizeMarkName(mark.name, `Mark ${index + 1}`);
    if (typeof mark.description !== "string") {
      mark.description = "";
    }
  });
  return marks;
}

function getCoursePointCount() {
  return getCourseMarks().length;
}

function getStartLineMidpoint() {
  if (!hasStartLine()) return null;
  return {
    lat: (state.line.a.lat + state.line.b.lat) / 2,
    lon: (state.line.a.lon + state.line.b.lon) / 2,
  };
}

function getFinishLine() {
  const finish = state.course?.finish;
  if (!finish) return null;
  if (finish.useStartLine) {
    if (!hasStartLine()) return null;
    const reverse = Boolean(finish.reverse);
    return {
      a: reverse ? { ...state.line.b } : { ...state.line.a },
      b: reverse ? { ...state.line.a } : { ...state.line.b },
    };
  }
  if (
    Number.isFinite(finish.a?.lat) &&
    Number.isFinite(finish.a?.lon) &&
    Number.isFinite(finish.b?.lat) &&
    Number.isFinite(finish.b?.lon)
  ) {
    return { a: { ...finish.a }, b: { ...finish.b } };
  }
  return null;
}

function getFinishLineMidpoint() {
  const finish = getFinishLine();
  if (!finish) return null;
  return {
    lat: (finish.a.lat + finish.b.lat) / 2,
    lon: (finish.a.lon + finish.b.lon) / 2,
  };
}

function hasFinishLine() {
  return Boolean(getFinishLine());
}

function ensureRouteLinesForRoute() {
  if (hasStartLine()) {
    if (state.race) {
      let changed = false;
      if (!state.race.routeStartLineId && state.race.startLineId) {
        state.race.routeStartLineId = state.race.startLineId;
        changed = true;
      }
      if (!state.race.routeFinishLineId && state.race.finishLineId) {
        state.race.routeFinishLineId = state.race.finishLineId;
        changed = true;
      }
      if (changed) {
        syncVenueDefaultRoute();
        persistVenueAndRace();
      }
    }
    return true;
  }
  window.alert("Select a start line first.");
  return false;
}

function getStartLineDisplayName() {
  const venue = state.venue;
  if (!venue) return null;
  const lines = Array.isArray(venue.lines) ? venue.lines : [];
  const lineId = state.race?.startLineId || venue.defaultStartLineId;
  const line = getLineById(lines, lineId);
  if (!line) return null;
  return getLineDisplayName(line, lines, "Line");
}

function getFinishLineDisplayName() {
  const venue = state.venue;
  if (!venue) return null;
  const lines = Array.isArray(venue.lines) ? venue.lines : [];
  const lineId = state.race?.finishLineId || venue.defaultFinishLineId;
  const line = getLineById(lines, lineId);
  if (!line) return null;
  return getLineDisplayName(line, lines, "Line");
}

function getStartLineStatusText() {
  const name = getStartLineDisplayName();
  return name || "NO LINE";
}

function getFinishLineStatusText() {
  const name = getFinishLineDisplayName();
  return name || "NO LINE";
}

function getNearestVenueMark(venue, position) {
  if (!venue || !position) return null;
  const lat = position.coords?.latitude;
  const lon = position.coords?.longitude;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const origin = { lat, lon };
  let nearest = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  (venue.marks || []).forEach((mark) => {
    if (!Number.isFinite(mark?.lat) || !Number.isFinite(mark?.lon)) return;
    const delta = toMeters(mark, origin);
    if (!Number.isFinite(delta.x) || !Number.isFinite(delta.y)) return;
    const distance = Math.hypot(delta.x, delta.y);
    if (distance < bestDistance) {
      bestDistance = distance;
      nearest = mark;
    }
  });
  if (!nearest) return null;
  return { mark: nearest, distance: bestDistance };
}

function getCourseLengthStatus() {
  const startMid = getStartLineMidpoint();
  if (!startMid) {
    return { value: null, text: "NO LINE" };
  }
  const marks = getCourseMarks()
    .map((mark) => ({ lat: mark.lat, lon: mark.lon }))
    .filter(
      (mark) => Number.isFinite(mark.lat) && Number.isFinite(mark.lon)
    );
  const finishLine = getFinishLine();
  const points = [];
  const startLine = { a: { ...state.line.a }, b: { ...state.line.b } };
  const startAnchor =
    marks.length > 0
      ? getClosestPointOnSegment(marks[0], startLine.a, startLine.b)
      : startMid;
  if (!startAnchor) {
    return { value: null, text: "NO LINE" };
  }
  points.push(startAnchor);
  marks.forEach((mark) => points.push(mark));
  if (finishLine) {
    const finishMid = getFinishLineMidpoint();
    const finishAnchor =
      marks.length > 0
        ? getClosestPointOnSegment(
            marks[marks.length - 1],
            finishLine.a,
            finishLine.b
          )
        : finishMid;
    if (finishAnchor) {
      points.push(finishAnchor);
    }
  }
  if (points.length < 2) {
    return { value: null, text: "NO ROUTE" };
  }
  const origin = points[0];
  let total = 0;
  let prev = toMeters(origin, origin);
  for (let i = 1; i < points.length; i += 1) {
    const next = toMeters(points[i], origin);
    if (
      !Number.isFinite(prev.x) ||
      !Number.isFinite(prev.y) ||
      !Number.isFinite(next.x) ||
      !Number.isFinite(next.y)
    ) {
      return { value: null, text: "--" };
    }
    total += Math.hypot(next.x - prev.x, next.y - prev.y);
    prev = next;
  }
  if (!Number.isFinite(total)) {
    return { value: null, text: "--" };
  }
  return { value: total, text: null };
}

function formatCourseLength(lengthMeters) {
  if (!Number.isFinite(lengthMeters)) {
    return { value: "--", unit: "" };
  }
  if (lengthMeters > 1000) {
    const nauticalMiles = lengthMeters / NAUTICAL_MILE_METERS;
    return {
      value: formatSignificant(nauticalMiles, 3),
      unit: formatUnitLabel("nm"),
    };
  }
  return {
    value: String(Math.round(lengthMeters)),
    unit: formatUnitLabel("m"),
  };
}

function computeTurnSide(prev, current, next) {
  if (!prev || !current || !next) return null;
  const origin = { lat: current.lat, lon: current.lon };
  const prevMeters = toMeters(prev, origin);
  const nextMeters = toMeters(next, origin);
  const v1 = { x: -prevMeters.x, y: -prevMeters.y };
  const v2 = { x: nextMeters.x, y: nextMeters.y };
  const cross = v1.x * v2.y - v1.y * v2.x;
  if (!Number.isFinite(cross) || Math.abs(cross) < 1e-6) return null;
  return cross > 0 ? "port" : "starboard";
}

function syncCourseRoundingDefaults(options = {}) {
  const { persist = false } = options;
  const marks = getCourseMarks();
  const entries = getRouteEntries();
  if (!marks.length || !entries.length) return false;
  const startMid = getStartLineMidpoint();
  const finishLine = getFinishLine();
  const finishMid = finishLine
    ? {
        lat: (finishLine.a.lat + finishLine.b.lat) / 2,
        lon: (finishLine.a.lon + finishLine.b.lon) / 2,
      }
    : null;
  let changed = false;
  entries.forEach((entry, index) => {
    const mark = marks[index];
    if (!entry || !mark || entry.manual) return;
    const prev = index === 0 ? startMid : marks[index - 1];
    const next = index === marks.length - 1 ? finishMid : marks[index + 1];
    const side = prev && next ? computeTurnSide(prev, mark, next) : null;
    const nextSide = side || entry.rounding || "port";
    if (entry.rounding !== nextSide) {
      entry.rounding = nextSide;
      changed = true;
    }
    if (mark.rounding !== nextSide) {
      mark.rounding = nextSide;
    }
  });
  if (changed && persist) {
    syncVenueDefaultRoute();
    persistVenueAndRace();
  }
  return changed;
}

function updateCourseUi() {
  syncCourseRoundingDefaults();
  const routeEnabled = Boolean(state.race?.routeEnabled);
  const markCount = state.venue?.marks?.length || 0;
  const routeCount = getRouteEntries().length;
  const routeLinesReady = hasStartLine();

  if (els.courseToggle) {
    els.courseToggle.setAttribute("aria-pressed", routeEnabled ? "true" : "false");
  }
  if (els.raceName) {
    els.raceName.textContent = state.race?.name || "--";
  }
  if (els.venueName) {
    els.venueName.textContent = state.venue?.name || "--";
  }
  if (els.markCount) {
    els.markCount.textContent = String(markCount || 0);
  }
  if (els.routeCount) {
    els.routeCount.textContent = routeCount ? String(routeCount) : "NO ROUTE";
  }
  if (els.startLineStatus) {
    els.startLineStatus.textContent = getStartLineStatusText();
  }
  if (els.finishStatus) {
    els.finishStatus.textContent = getFinishLineStatusText();
  }
  if (els.statusCourseLength) {
    const lengthStatus = getCourseLengthStatus();
    const hasLength = Number.isFinite(lengthStatus.value);
    const formatted = hasLength
      ? formatCourseLength(lengthStatus.value)
      : { value: lengthStatus.text || "--", unit: "" };
    if (els.statusCourseLengthValue) {
      els.statusCourseLengthValue.textContent = formatted.value;
    } else {
      els.statusCourseLength.textContent = formatted.value;
    }
    if (els.statusCourseLengthUnit) {
      els.statusCourseLengthUnit.textContent = hasLength ? formatted.unit : "";
    }
  }
  if (els.openRoute) {
    els.openRoute.disabled = markCount === 0 || !routeLinesReady;
  }
  if (els.openRouteMap) {
    els.openRouteMap.disabled = markCount === 0 || !routeLinesReady;
  }
  if (els.openRaceMap) {
    els.openRaceMap.disabled = !hasStartLine();
  }
  if (els.openRounding) {
    els.openRounding.disabled = routeCount === 0 || !routeLinesReady;
  }
  if (els.clearRoute) {
    els.clearRoute.disabled = routeCount === 0 || !routeLinesReady;
  }
  updateLineNameDisplay();
  if (els.courseKeyboardModal) {
    const open = els.courseKeyboardModal.getAttribute("aria-hidden") === "false";
    if (open) {
      renderRouteSequence();
    }
  }
}

function bumpCourseVersion() {
  if (!state.course) return;
  state.course.version = Date.now();
}

function updateLineNameDisplay() {
  if (!els.statusLineName) return;
  els.statusLineName.textContent = getStartLineDisplayName() || "--";
}

function formatRoundingSide(side) {
  return side === "starboard" ? "Starboard" : "Port";
}

function renderCourseMarksList() {
  if (!els.courseMarksList) return;
  els.courseMarksList.innerHTML = "";
  syncCourseRoundingDefaults();
  const marks = getCourseMarks();
  const entries = getRouteEntries();
  if (!marks.length) {
    const empty = document.createElement("div");
    empty.className = "hint";
    empty.textContent = "No route yet.";
    els.courseMarksList.appendChild(empty);
    return;
  }
  marks.forEach((mark, index) => {
    const entry = entries[index];
    if (!entry) return;
    const row = document.createElement("div");
    row.className = "modal-item mark-row";
    const button = document.createElement("button");
    button.type = "button";
    const side = entry.rounding || "port";
    const name = normalizeMarkName(mark.name, `Mark ${index + 1}`);
    button.className = `course-mark-btn ${side}`;
    const nameSpan = document.createElement("span");
    nameSpan.className = "mark-name";
    nameSpan.textContent = name;
    const sideSpan = document.createElement("span");
    sideSpan.className = "mark-side";
    sideSpan.textContent = formatRoundingSide(side);
    button.appendChild(nameSpan);
    button.appendChild(sideSpan);
    button.addEventListener("click", () => {
      const nextSide = side === "port" ? "starboard" : "port";
      entry.rounding = nextSide;
      entry.manual = true;
      mark.rounding = nextSide;
      mark.manual = true;
      bumpCourseVersion();
      syncVenueDefaultRoute();
      persistVenueAndRace();
      renderCourseMarksList();
      renderRouteSequence();
    });
    row.appendChild(button);
    if (mark.description) {
      const desc = document.createElement("div");
      desc.className = "mark-desc";
      desc.textContent = mark.description;
      row.appendChild(desc);
    }
    els.courseMarksList.appendChild(row);
  });
}

function openCourseMarksModal() {
  renderCourseMarksList();
  document.body.classList.add("modal-open");
  if (els.courseMarksModal) {
    els.courseMarksModal.setAttribute("aria-hidden", "false");
  }
}

function closeCourseMarksModal() {
  document.body.classList.remove("modal-open");
  if (els.courseMarksModal) {
    els.courseMarksModal.setAttribute("aria-hidden", "true");
  }
}

function getVenueMarksForRoute() {
  return (state.venue?.marks || [])
    .filter((mark) => mark && typeof mark.name === "string")
    .sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
    );
}

function renderRouteSequence() {
  if (!els.courseSequence) return;
  els.courseSequence.innerHTML = "";
  syncCourseRoundingDefaults();
  const marks = getCourseMarks();
  if (!marks.length) {
    const empty = document.createElement("div");
    empty.className = "hint";
    empty.textContent = "No route yet.";
    els.courseSequence.appendChild(empty);
    return;
  }
  marks.forEach((mark, index) => {
    const chip = document.createElement("span");
    const side = mark.rounding || "port";
    chip.className = `course-chip ${side}`;
    chip.textContent = normalizeMarkName(mark.name, `Mark ${index + 1}`);
    els.courseSequence.appendChild(chip);
  });
}

function renderCourseKeyboard() {
  if (!els.courseKeyboard) return;
  els.courseKeyboard.innerHTML = "";
  const marks = getVenueMarksForRoute();
  if (!marks.length) {
    const empty = document.createElement("div");
    empty.className = "hint";
    empty.textContent = "No marks yet.";
    els.courseKeyboard.appendChild(empty);
    return;
  }
  const addRouteMark = (mark, side) => {
    if (!state.race) return;
    if (!Array.isArray(state.race.route)) {
      state.race.route = [];
    }
    state.race.route.push({
      markId: mark.id,
      rounding: side,
      manual: true,
    });
    syncVenueDefaultRoute();
    persistVenueAndRace();
    syncDerivedRaceState();
    syncCourseRoundingDefaults();
    bumpCourseVersion();
    updateCourseUi();
    renderRouteSequence();
  };
  marks.forEach((mark) => {
    const name = normalizeMarkName(mark.name, "Mark");
    ["port", "starboard"].forEach((side) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `course-key ${side}`;
      button.textContent = name;
      button.setAttribute(
        "aria-label",
        `Add ${name} (${side === "port" ? "port" : "starboard"})`
      );
      if (mark.description) {
        button.title = mark.description;
      }
      button.addEventListener("click", () => {
        addRouteMark(mark, side);
      });
      els.courseKeyboard.appendChild(button);
    });
  });
}

function openCourseKeyboardModal() {
  renderCourseKeyboard();
  renderRouteSequence();
  document.body.classList.add("modal-open");
  if (els.courseKeyboardModal) {
    els.courseKeyboardModal.setAttribute("aria-hidden", "false");
  }
}

function closeCourseKeyboardModal() {
  document.body.classList.remove("modal-open");
  if (els.courseKeyboardModal) {
    els.courseKeyboardModal.setAttribute("aria-hidden", "true");
  }
}

function getSelectedRace() {
  if (!state.selectedRaceId) return null;
  return getRaceById(state.races, state.selectedRaceId);
}

function activateRaceSelection(race) {
  if (!race) return false;
  const venue = getVenueById(state.venues, race.venueId) || state.venue;
  if (!venue) return false;
  state.race = race;
  state.venue = venue;
  state.activeRaceId = race.id;
  state.activeVenueId = venue.id;
  state.selectedRaceId = race.id;
  syncDerivedRaceState();
  syncStartFromRace();
  syncStartUi();
  persistVenueAndRace();
  updateCourseUi();
  return true;
}

function assignVenueToRace(race, venue) {
  if (!race || !venue) return false;
  race.venueId = venue.id;
  state.race = race;
  state.venue = venue;
  state.activeRaceId = race.id;
  state.activeVenueId = venue.id;
  state.selectedRaceId = race.id;
  migrateLineSelections(state.venues, state.races);
  pruneRouteEntries();
  syncDerivedRaceState();
  syncStartFromRace();
  syncStartUi();
  persistVenueAndRace();
  updateCourseUi();
  return true;
}

function openRaceModal(selectedRaceId = state.activeRaceId) {
  const races = Array.isArray(state.races) ? state.races : [];
  const hasSelected = races.some((race) => race.id === selectedRaceId);
  state.selectedRaceId = hasSelected ? selectedRaceId : state.activeRaceId;
  renderRaceList();
  document.body.classList.add("modal-open");
  if (els.raceModal) {
    els.raceModal.setAttribute("aria-hidden", "false");
  }
}

function closeRaceModal() {
  document.body.classList.remove("modal-open");
  if (els.raceModal) {
    els.raceModal.setAttribute("aria-hidden", "true");
  }
}

function openVenueModal(options = {}) {
  const {
    raceId = null,
    selectedVenueId = state.activeVenueId,
    returnToRaceModal = false,
  } = options;
  venueSelectionTargetRaceId = raceId;
  venueSelectionReturnToRace = returnToRaceModal;
  state.selectedVenueId = selectedVenueId || state.activeVenueId;
  renderVenueList();
  document.body.classList.add("modal-open");
  if (els.venueModal) {
    els.venueModal.setAttribute("aria-hidden", "false");
  }
}

function closeVenueModal() {
  document.body.classList.remove("modal-open");
  if (els.venueModal) {
    els.venueModal.setAttribute("aria-hidden", "true");
  }
}

function openCourseModal() {
  updateCourseUi();
  document.body.classList.add("modal-open");
  if (els.courseModal) {
    els.courseModal.setAttribute("aria-hidden", "false");
  }
}

function closeCourseModal() {
  document.body.classList.remove("modal-open");
  if (els.courseModal) {
    els.courseModal.setAttribute("aria-hidden", "true");
  }
}

function openStartLineModal(options = {}) {
  const { returnModal = null, returnRaceId = null } = options;
  if (!state.venue) return;
  startLineReturnModal = returnModal;
  startLineReturnRaceId = returnRaceId;
  state.selectedStartLineId =
    state.race?.startLineId || state.venue.defaultStartLineId || null;
  renderStartLineList();
  document.body.classList.add("modal-open");
  if (els.startLineModal) {
    els.startLineModal.setAttribute("aria-hidden", "false");
  }
}

function closeStartLineModal() {
  document.body.classList.remove("modal-open");
  if (els.startLineModal) {
    els.startLineModal.setAttribute("aria-hidden", "true");
  }
  const returnModal = startLineReturnModal;
  const returnRaceId = startLineReturnRaceId;
  startLineReturnModal = null;
  startLineReturnRaceId = null;
  if (returnModal) {
    openSetupModal(returnModal, { raceId: returnRaceId });
  }
}

function openFinishLineModal(options = {}) {
  const { returnModal = null, returnRaceId = null } = options;
  if (!state.venue) return;
  finishLineReturnModal = returnModal;
  finishLineReturnRaceId = returnRaceId;
  state.selectedFinishLineId =
    state.race?.finishLineId || state.venue.defaultFinishLineId || null;
  renderFinishLineList();
  document.body.classList.add("modal-open");
  if (els.finishLineModal) {
    els.finishLineModal.setAttribute("aria-hidden", "false");
  }
}

function closeFinishLineModal() {
  document.body.classList.remove("modal-open");
  if (els.finishLineModal) {
    els.finishLineModal.setAttribute("aria-hidden", "true");
  }
  const returnModal = finishLineReturnModal;
  const returnRaceId = finishLineReturnRaceId;
  finishLineReturnModal = null;
  finishLineReturnRaceId = null;
  if (returnModal) {
    openSetupModal(returnModal, { raceId: returnRaceId });
  }
}

function openSetupModal(modal, options = {}) {
  const key = String(modal || "").toLowerCase();
  if (key === "race") {
    openRaceModal(options.raceId);
    return true;
  }
  if (key === "venue") {
    openVenueModal();
    return true;
  }
  if (key === "course") {
    openCourseModal();
    return true;
  }
  return false;
}

function renderRaceList() {
  if (!els.raceList) return;
  els.raceList.innerHTML = "";
  const races = Array.isArray(state.races) ? [...state.races] : [];
  if (!races.length) {
    const empty = document.createElement("div");
    empty.className = "hint";
    empty.textContent = "No races yet.";
    els.raceList.appendChild(empty);
    if (els.confirmRace) els.confirmRace.disabled = true;
    if (els.deleteRace) els.deleteRace.disabled = true;
    if (els.editRaceVenue) els.editRaceVenue.disabled = true;
    if (els.editRaceStartLine) els.editRaceStartLine.disabled = true;
    if (els.editRaceCourse) els.editRaceCourse.disabled = true;
    return;
  }
  races.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  races.forEach((race) => {
    const row = document.createElement("div");
    row.className = "modal-item";
    const button = document.createElement("button");
    button.type = "button";
    const venue = getVenueById(state.venues, race.venueId);
    button.textContent = venue ? `${race.name} · ${venue.name}` : race.name;
    if (state.selectedRaceId === race.id) {
      button.classList.add("selected");
    }
    button.addEventListener("click", () => {
      state.selectedRaceId = race.id;
      renderRaceList();
    });
    row.appendChild(button);
    els.raceList.appendChild(row);
  });
  if (els.confirmRace) els.confirmRace.disabled = !state.selectedRaceId;
  if (els.deleteRace) els.deleteRace.disabled = !state.selectedRaceId;
  if (els.editRaceVenue) els.editRaceVenue.disabled = !state.selectedRaceId;
  if (els.editRaceStartLine) els.editRaceStartLine.disabled = !state.selectedRaceId;
  if (els.editRaceCourse) els.editRaceCourse.disabled = !state.selectedRaceId;
}

function renderVenueList() {
  if (!els.venueList) return;
  els.venueList.innerHTML = "";
  const venues = Array.isArray(state.venues) ? [...state.venues] : [];
  if (!venues.length) {
    const empty = document.createElement("div");
    empty.className = "hint";
    empty.textContent = "No venues yet.";
    els.venueList.appendChild(empty);
    if (els.confirmVenue) els.confirmVenue.disabled = true;
    if (els.deleteVenue) els.deleteVenue.disabled = true;
    if (els.renameVenue) els.renameVenue.disabled = true;
    if (els.calibrateMark) els.calibrateMark.disabled = true;
    return;
  }

  const addNewRow = document.createElement("div");
  addNewRow.className = "modal-item";
  const addNewButton = document.createElement("button");
  addNewButton.type = "button";
  addNewButton.textContent = "New venue";
  addNewButton.addEventListener("click", () => {
    const nameInput = window.prompt("Venue name:");
    if (nameInput === null) return;
    const name = normalizeMarkName(nameInput, "New venue");
    const venue = createVenue(name);
    state.venues.unshift(venue);
    const race = createRace(`Race ${state.races.length + 1}`, venue);
    state.races.unshift(race);
    state.venue = venue;
    state.race = race;
    state.activeVenueId = venue.id;
    state.activeRaceId = race.id;
    syncDerivedRaceState();
    syncVenueDefaultRoute();
    persistVenueAndRace();
    updateCourseUi();
    closeVenueModal();
  });
  addNewRow.appendChild(addNewButton);
  els.venueList.appendChild(addNewRow);

  venues.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  venues.forEach((venue) => {
    const row = document.createElement("div");
    row.className = "modal-item";
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = venue.name;
    if (state.selectedVenueId === venue.id) {
      button.classList.add("selected");
    }
    button.addEventListener("click", () => {
      state.selectedVenueId = venue.id;
      renderVenueList();
    });
    row.appendChild(button);
    els.venueList.appendChild(row);
  });
  if (els.confirmVenue) els.confirmVenue.disabled = !state.selectedVenueId;
  if (els.deleteVenue) els.deleteVenue.disabled = !state.selectedVenueId;
  if (els.renameVenue) els.renameVenue.disabled = !state.selectedVenueId;
  if (els.calibrateMark) {
    const selected = state.selectedVenueId
      ? getVenueById(state.venues, state.selectedVenueId)
      : null;
    const hasMarks = Boolean(selected?.marks?.length);
    els.calibrateMark.disabled = !state.selectedVenueId || !hasMarks;
  }
}

function renderStartLineList() {
  if (!els.startLineList) return;
  els.startLineList.innerHTML = "";
  const lines = Array.isArray(state.venue?.lines) ? state.venue.lines : [];
  if (!lines.length) {
    const empty = document.createElement("div");
    empty.className = "hint";
    empty.textContent = "No lines yet.";
    els.startLineList.appendChild(empty);
    if (els.confirmStartLine) els.confirmStartLine.disabled = true;
    return;
  }
  const lineIds = new Set(lines.map((line) => line.id));
  if (!lineIds.has(state.selectedStartLineId)) {
    state.selectedStartLineId = null;
  }
  lines.forEach((line) => {
    const row = document.createElement("div");
    row.className = "modal-item";
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = getLineDisplayName(line, lines, "Line");
    if (state.selectedStartLineId === line.id) {
      button.classList.add("selected");
    }
    button.addEventListener("click", () => {
      state.selectedStartLineId = line.id;
      renderStartLineList();
    });
    row.appendChild(button);
    els.startLineList.appendChild(row);
  });
  if (els.confirmStartLine) {
    els.confirmStartLine.disabled = !state.selectedStartLineId;
  }
}

function renderFinishLineList() {
  if (!els.finishLineList) return;
  els.finishLineList.innerHTML = "";
  const lines = Array.isArray(state.venue?.lines) ? state.venue.lines : [];
  if (!lines.length) {
    const empty = document.createElement("div");
    empty.className = "hint";
    empty.textContent = "No lines yet.";
    els.finishLineList.appendChild(empty);
    if (els.confirmFinishLine) els.confirmFinishLine.disabled = true;
    return;
  }
  const lineIds = new Set(lines.map((line) => line.id));
  if (!lineIds.has(state.selectedFinishLineId)) {
    state.selectedFinishLineId = null;
  }
  lines.forEach((line) => {
    const row = document.createElement("div");
    row.className = "modal-item";
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = getLineDisplayName(line, lines, "Line");
    if (state.selectedFinishLineId === line.id) {
      button.classList.add("selected");
    }
    button.addEventListener("click", () => {
      state.selectedFinishLineId = line.id;
      renderFinishLineList();
    });
    row.appendChild(button);
    els.finishLineList.appendChild(row);
  });
  if (els.confirmFinishLine) {
    els.confirmFinishLine.disabled = !state.selectedFinishLineId;
  }
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
  const line = getSelectedStartLine();
  if (state.venue && line) {
    const nextStarboard = line.portMarkId;
    const nextPort = line.starboardMarkId;
    line.starboardMarkId = nextStarboard;
    line.portMarkId = nextPort;
    persistVenueAndRace();
    syncDerivedRaceState();
    updateLineNameDisplay();
    if (starterDeps.updateInputs) {
      starterDeps.updateInputs();
    }
    updateLineProjection();
    return;
  }

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

  if (changed) {
    syncStartLineMarksFromState();
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
    state.courseTrackActive = false;
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
  const rawDelta = (state.start.startTs - now) / 1000;
  const delta = Math.max(0, rawDelta);
  const courseEnabled = Boolean(state.course?.enabled);
  const courseReady =
    courseEnabled && (getCoursePointCount() === 0 || hasFinishLine());
  if (courseReady) {
    if (rawDelta > 0) {
      state.courseTrackActive = false;
    } else if (!state.courseTrackActive) {
      state.courseTrackActive = true;
      state.courseTrack = [];
      setTrackMode("course");
      if (starterDeps.setView && !document.body.classList.contains("track-mode")) {
        starterDeps.setView("track");
      }
    }
  } else if (state.courseTrackActive) {
    state.courseTrackActive = false;
  }
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

function syncStartUi() {
  syncCountdownPicker();
  updateStartModeToggle();
  if (els.absoluteTime) {
    els.absoluteTime.value = state.start.absoluteTime || "";
  }
  updateStartDisplay();
}

function syncStarterInputs() {
  refreshVenueRaceState();
  syncCoordinateInputs();
  syncStartUi();
  updateRaceHintUnits();
  updateCourseUi();
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
          syncStartLineMarksFromState();
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
          syncStartLineMarksFromState();
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

  if (els.newRace) {
    els.newRace.addEventListener("click", () => {
      if (!state.venue) return;
      const fallback = `Race ${state.races.length + 1}`;
      const nameInput = window.prompt("Race name:", fallback);
      if (nameInput === null) return;
      const name = normalizeMarkName(nameInput, fallback);
      const race = createRace(name, state.venue, {
        startLineId: state.race?.startLineId,
        finishLineId: state.race?.finishLineId,
      });
      state.races.unshift(race);
      state.race = race;
      state.activeRaceId = race.id;
      state.activeVenueId = state.venue.id;
      syncDerivedRaceState();
      syncStartFromRace();
      syncStartUi();
      syncVenueDefaultRoute();
      persistVenueAndRace();
      updateCourseUi();
      closeRaceModal();
    });
  }

  if (els.selectRace) {
    els.selectRace.addEventListener("click", () => {
      openRaceModal();
    });
  }

  if (els.selectVenue) {
    els.selectVenue.addEventListener("click", () => {
      openVenueModal();
    });
  }

  if (els.editRaceVenue) {
    els.editRaceVenue.addEventListener("click", () => {
      const race = getSelectedRace();
      if (!race) return;
      closeRaceModal();
      openVenueModal({
        raceId: race.id,
        selectedVenueId: race.venueId,
        returnToRaceModal: true,
      });
    });
  }

  if (els.editRaceStartLine) {
    els.editRaceStartLine.addEventListener("click", () => {
      const race = getSelectedRace();
      if (!race) return;
      if (!activateRaceSelection(race)) return;
      closeRaceModal();
      openStartLineModal({ returnModal: "race", returnRaceId: race.id });
    });
  }

  if (els.editRaceCourse) {
    els.editRaceCourse.addEventListener("click", () => {
      const race = getSelectedRace();
      if (!race) return;
      if (!activateRaceSelection(race)) return;
      closeRaceModal();
      openCourseModal();
    });
  }

  if (els.openCourse) {
    els.openCourse.addEventListener("click", () => {
      openCourseModal();
    });
  }

  if (els.confirmRace) {
    els.confirmRace.addEventListener("click", () => {
      if (!state.selectedRaceId) return;
      const race = getRaceById(state.races, state.selectedRaceId);
      if (!race) return;
      if (!activateRaceSelection(race)) return;
      closeRaceModal();
    });
  }

  if (els.deleteRace) {
    els.deleteRace.addEventListener("click", () => {
      if (!state.selectedRaceId) return;
      const race = getRaceById(state.races, state.selectedRaceId);
      if (!race) return;
      const confirmed = window.confirm(`Delete "${race.name}"?`);
      if (!confirmed) return;
      state.races = state.races.filter((entry) => entry.id !== race.id);
      if (!state.races.length) {
        const venue = state.venue || createVenue("Local venue");
        if (!state.venues.find((entry) => entry.id === venue.id)) {
          state.venues.unshift(venue);
        }
        const freshRace = createRace("Race 1", venue);
        state.races.unshift(freshRace);
        state.race = freshRace;
        state.venue = venue;
        state.activeRaceId = freshRace.id;
        state.activeVenueId = venue.id;
      } else if (state.activeRaceId === race.id) {
        const nextRace = state.races[0];
        const nextVenue = getVenueById(state.venues, nextRace.venueId) || state.venue;
        state.race = nextRace;
        state.venue = nextVenue;
        state.activeRaceId = nextRace.id;
        if (nextVenue) {
          state.activeVenueId = nextVenue.id;
        }
      }
      syncDerivedRaceState();
      syncStartFromRace();
      syncStartUi();
      persistVenueAndRace();
      updateCourseUi();
      closeRaceModal();
    });
  }

  if (els.closeRaceModal) {
    els.closeRaceModal.addEventListener("click", () => {
      closeRaceModal();
    });
  }

  if (els.confirmVenue) {
    els.confirmVenue.addEventListener("click", () => {
      if (!state.selectedVenueId) return;
      const venue = getVenueById(state.venues, state.selectedVenueId);
      if (!venue) return;
      if (venueSelectionTargetRaceId) {
        const raceId = venueSelectionTargetRaceId;
        const returnToRace = venueSelectionReturnToRace;
        venueSelectionTargetRaceId = null;
        venueSelectionReturnToRace = false;
        const race = getRaceById(state.races, raceId);
        if (race) {
          assignVenueToRace(race, venue);
        }
        closeVenueModal();
        if (returnToRace) {
          openRaceModal(raceId);
        }
        return;
      }
      const racesForVenue = state.races.filter((race) => race.venueId === venue.id);
      racesForVenue.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
      let race = racesForVenue[0];
      if (!race) {
        race = createRace(`Race ${state.races.length + 1}`, venue);
        state.races.unshift(race);
      }
      state.venue = venue;
      state.race = race;
      state.activeVenueId = venue.id;
      state.activeRaceId = race.id;
      syncDerivedRaceState();
      syncStartFromRace();
      syncStartUi();
      persistVenueAndRace();
      updateCourseUi();
      const returnToRace = venueSelectionReturnToRace;
      const returnRaceId = venueSelectionTargetRaceId;
      venueSelectionTargetRaceId = null;
      venueSelectionReturnToRace = false;
      closeVenueModal();
      if (returnToRace) {
        openRaceModal(returnRaceId);
      }
    });
  }

  if (els.deleteVenue) {
    els.deleteVenue.addEventListener("click", () => {
      if (!state.selectedVenueId) return;
      const venue = getVenueById(state.venues, state.selectedVenueId);
      if (!venue) return;
      const confirmed = window.confirm(`Delete "${venue.name}"?`);
      if (!confirmed) return;
      state.venues = state.venues.filter((entry) => entry.id !== venue.id);
      state.races = state.races.filter((race) => race.venueId !== venue.id);
      if (!state.venues.length) {
        const freshVenue = createVenue("Local venue");
        state.venues.unshift(freshVenue);
      }
      if (!state.races.length) {
        const activeVenue = state.venues[0];
        const race = createRace("Race 1", activeVenue);
        state.races.unshift(race);
      }
      const nextVenue =
        getVenueById(state.venues, state.activeVenueId) || state.venues[0] || null;
      const racesForVenue = nextVenue
        ? state.races.filter((race) => race.venueId === nextVenue.id)
        : [];
      racesForVenue.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
      const nextRace = racesForVenue[0] || state.races[0] || null;
      state.venue = nextVenue;
      state.race = nextRace;
      if (nextVenue) state.activeVenueId = nextVenue.id;
      if (nextRace) state.activeRaceId = nextRace.id;
      syncDerivedRaceState();
      syncStartFromRace();
      syncStartUi();
      persistVenueAndRace();
      updateCourseUi();
      const returnToRace = venueSelectionReturnToRace;
      const returnRaceId = venueSelectionTargetRaceId;
      venueSelectionTargetRaceId = null;
      venueSelectionReturnToRace = false;
      closeVenueModal();
      if (returnToRace) {
        openRaceModal(returnRaceId);
      }
    });
  }

  if (els.renameVenue) {
    els.renameVenue.addEventListener("click", () => {
      if (!state.selectedVenueId) return;
      const venue = getVenueById(state.venues, state.selectedVenueId);
      if (!venue) return;
      const fallback = venue.name || "Venue";
      const nameInput = window.prompt("Venue name:", fallback);
      if (nameInput === null) return;
      const name = normalizeMarkName(nameInput, fallback);
      if (name === venue.name) return;
      venue.name = name;
      venue.updatedAt = Date.now();
      saveVenues(state.venues);
      if (state.venue && state.venue.id === venue.id) {
        updateCourseUi();
      }
      renderVenueList();
    });
  }

  if (els.calibrateMark) {
    els.calibrateMark.addEventListener("click", () => {
      if (!state.selectedVenueId) return;
      const venue = getVenueById(state.venues, state.selectedVenueId);
      if (!venue) return;
      if (!Array.isArray(venue.marks) || !venue.marks.length) {
        window.alert("No marks yet.");
        return;
      }
      requestHighPrecisionPosition(
        starterDeps.handlePosition,
        starterDeps.handlePositionError,
        () => {
          const sourcePosition = state.kalmanPosition;
          if (!sourcePosition) {
            window.alert("Waiting for Kalman GPS fix. Try again in a moment.");
            return;
          }
          const nearest = getNearestVenueMark(venue, sourcePosition);
          if (!nearest) {
            window.alert("No marks to calibrate.");
            return;
          }
          nearest.mark.lat = sourcePosition.coords.latitude;
          nearest.mark.lon = sourcePosition.coords.longitude;
          venue.updatedAt = Date.now();
          saveVenues(state.venues);
          if (state.venue && state.venue.id === venue.id) {
            syncDerivedRaceState();
            syncStartFromRace();
            updateCourseUi();
            updateLineProjection();
          }
          renderVenueList();
        }
      );
    });
  }

  if (els.closeVenueModal) {
    els.closeVenueModal.addEventListener("click", () => {
      const returnToRace = venueSelectionReturnToRace;
      const returnRaceId = venueSelectionTargetRaceId;
      venueSelectionTargetRaceId = null;
      venueSelectionReturnToRace = false;
      closeVenueModal();
      if (returnToRace) {
        openRaceModal(returnRaceId);
      }
    });
  }

  if (els.closeCourseModal) {
    els.closeCourseModal.addEventListener("click", () => {
      closeCourseModal();
    });
  }

  if (els.confirmStartLine) {
    els.confirmStartLine.addEventListener("click", () => {
      if (!state.race || !state.selectedStartLineId) return;
      state.race.startLineId = state.selectedStartLineId;
      state.race.routeStartLineId = state.selectedStartLineId;
      syncDerivedRaceState();
      persistVenueAndRace();
      updateCourseUi();
      closeStartLineModal();
    });
  }

  if (els.confirmFinishLine) {
    els.confirmFinishLine.addEventListener("click", () => {
      if (!state.race || !state.selectedFinishLineId) return;
      state.race.finishLineId = state.selectedFinishLineId;
      state.race.routeFinishLineId = state.selectedFinishLineId;
      syncDerivedRaceState();
      persistVenueAndRace();
      updateCourseUi();
      closeFinishLineModal();
    });
  }

  if (els.closeStartLine) {
    els.closeStartLine.addEventListener("click", () => {
      closeStartLineModal();
    });
  }

  if (els.closeFinishLine) {
    els.closeFinishLine.addEventListener("click", () => {
      closeFinishLineModal();
    });
  }

  if (els.openVenueMarks) {
    els.openVenueMarks.addEventListener("click", () => {
      closeVenueModal();
      window.location.href = getMapHref("venue-marks", { returnModal: "venue" });
    });
  }

  if (els.openLines) {
    els.openLines.addEventListener("click", () => {
      closeVenueModal();
      window.location.href = getMapHref("venue-lines", { returnModal: "venue" });
    });
  }

  if (els.selectStartLine) {
    els.selectStartLine.addEventListener("click", () => {
      closeCourseModal();
      openStartLineModal({ returnModal: "course" });
    });
  }

  if (els.selectFinishLine) {
    els.selectFinishLine.addEventListener("click", () => {
      closeCourseModal();
      openFinishLineModal({ returnModal: "course" });
    });
  }

  if (els.openRouteMap) {
    els.openRouteMap.addEventListener("click", () => {
      if (!ensureRouteLinesForRoute()) return;
      closeCourseModal();
      window.location.href = getMapHref("race-route", { returnModal: "course" });
    });
  }

  if (els.openRaceMap) {
    els.openRaceMap.addEventListener("click", () => {
      closeCourseModal();
      window.location.href = getMapHref("race-view", { returnModal: "course" });
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

  if (els.courseToggle) {
    els.courseToggle.addEventListener("click", () => {
      if (!state.race) return;
      const next = !state.race.routeEnabled;
      if (next && !ensureRouteLinesForRoute()) return;
      state.race.routeEnabled = next;
      if (!next) {
        state.courseTrackActive = false;
      }
      persistVenueAndRace();
      syncDerivedRaceState();
      updateCourseUi();
    });
  }

  if (els.openRoute) {
    els.openRoute.addEventListener("click", () => {
      if (!ensureRouteLinesForRoute()) return;
      closeCourseModal();
      openCourseKeyboardModal();
    });
  }

  if (els.openRounding) {
    els.openRounding.addEventListener("click", () => {
      if (!ensureRouteLinesForRoute()) return;
      closeCourseModal();
      openCourseMarksModal();
    });
  }

  if (els.clearRoute) {
    els.clearRoute.addEventListener("click", () => {
      if (!ensureRouteLinesForRoute()) return;
      if (!state.race || !getRouteEntries().length) return;
      const confirmed = window.confirm("Clear route?");
      if (!confirmed) return;
      state.race.route = [];
      syncVenueDefaultRoute();
      persistVenueAndRace();
      syncDerivedRaceState();
      updateCourseUi();
      renderRouteSequence();
    });
  }

  if (els.courseKeyboardUndo) {
    els.courseKeyboardUndo.addEventListener("click", () => {
      if (!state.race || !getRouteEntries().length) return;
      state.race.route.pop();
      syncVenueDefaultRoute();
      persistVenueAndRace();
      syncDerivedRaceState();
      syncCourseRoundingDefaults();
      updateCourseUi();
      renderRouteSequence();
    });
  }

  if (els.courseKeyboardClear) {
    els.courseKeyboardClear.addEventListener("click", () => {
      if (!state.race || !getRouteEntries().length) return;
      const confirmed = window.confirm("Clear route?");
      if (!confirmed) return;
      state.race.route = [];
      syncVenueDefaultRoute();
      persistVenueAndRace();
      syncDerivedRaceState();
      updateCourseUi();
      renderRouteSequence();
    });
  }

  if (els.courseKeyboardClose) {
    els.courseKeyboardClose.addEventListener("click", () => {
      closeCourseKeyboardModal();
    });
  }

  if (els.closeCourseMarks) {
    els.closeCourseMarks.addEventListener("click", () => {
      closeCourseMarksModal();
    });
  }

}

export {
  initStarter,
  initStarterUi,
  bindStarterEvents,
  syncStarterInputs,
  updateCourseUi,
  updateStartDisplay,
  openSetupModal,
};
