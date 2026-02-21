import { loadSettings as loadSettingsFromStorage } from "./core/settings.js";
import { getClosestPointOnSegment } from "./core/geo.js";
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
  getLineRoles,
  migrateLineSelections,
} from "./core/venues.js";

const NO_CACHE_KEY = "racetimer-nocache";
const DEFAULT_CENTER = { lat: 55.0, lon: 12.0 };

const MODES = {
  VENUE_MARKS: "venue-marks",
  VENUE_LINES: "venue-lines",
  VENUE_SETUP: "venue-setup",
  RACE_ROUTE: "race-route",
  RACE_START_LINE: "race-start-line",
  RACE_FINISH_LINE: "race-finish-line",
  RACE_VIEW: "race-view",
};

const VENUE_STEPS = {
  MARKS: "marks",
  LINES: "lines",
  ROUTE: "route",
};

const LINE_TYPES = {
  START: "start",
  FINISH: "finish",
};

const els = {
  mapTitle: document.getElementById("map-title"),
  mapTabs: document.getElementById("map-tabs"),
  tabMarks: document.getElementById("tab-marks"),
  tabLines: document.getElementById("tab-lines"),
  tabRoute: document.getElementById("tab-route"),
  addMark: document.getElementById("add-mark"),
  undoMark: document.getElementById("undo-mark"),
  clearMarks: document.getElementById("clear-marks"),
  openLineList: document.getElementById("open-line-list"),
  clearLineSelection: document.getElementById("clear-line-selection"),
  undoRoute: document.getElementById("undo-route-mark"),
  clearRoute: document.getElementById("clear-route"),
  openMarkList: document.getElementById("open-mark-list"),
  closeMap: document.getElementById("close-map"),
  mapStatus: document.getElementById("map-status"),
  mapCaption: document.getElementById("map-caption"),
  mapCrosshair: document.querySelector(".map-crosshair"),
  markListModal: document.getElementById("mark-list-modal"),
  markEditModal: document.getElementById("mark-edit-modal"),
  markEditTitle: document.getElementById("mark-edit-title"),
  markEditDetails: document.getElementById("mark-edit-details"),
  mapMarkName: document.getElementById("map-mark-name"),
  mapMarkDesc: document.getElementById("map-mark-desc"),
  deleteMark: document.getElementById("delete-mark"),
  mapMarkList: document.getElementById("map-mark-list"),
  routeMarkMenu: document.getElementById("route-mark-menu"),
  routeMarkList: document.getElementById("route-mark-list"),
  closeMarkList: document.getElementById("close-mark-list"),
  closeMarkEdit: document.getElementById("close-mark-edit"),
  markAddRoute: document.getElementById("mark-add-route"),
  mapToVenue: document.getElementById("map-to-venue"),
  lineListModal: document.getElementById("line-list-modal"),
  lineListTitle: document.getElementById("line-list-title"),
  mapLineList: document.getElementById("map-line-list"),
  closeLineList: document.getElementById("close-line-list"),
  lineEditModal: document.getElementById("line-edit-modal"),
  lineEditTitle: document.getElementById("line-edit-title"),
  lineName: document.getElementById("line-name"),
  lineDetails: document.getElementById("line-details"),
  lineRoleStart: document.getElementById("line-role-start"),
  lineRoleFinish: document.getElementById("line-role-finish"),
  swapLineDirection: document.getElementById("swap-line-direction"),
  trimLine: document.getElementById("trim-line"),
  swapTrimSide: document.getElementById("swap-trim-side"),
  deleteLine: document.getElementById("delete-line"),
  closeLineEdit: document.getElementById("close-line-edit"),
};

const state = {
  map: null,
  venues: [],
  races: [],
  venue: null,
  race: null,
  mode: MODES.VENUE_MARKS,
  selectedMarkId: null,
  selectedLineId: null,
  lineSelection: {
    starboardMarkId: null,
    portMarkId: null,
  },
  venueStep: VENUE_STEPS.MARKS,
  trimMode: false,
  trimContext: null,
  markMarkers: [],
  labelMarkers: [],
  lineOverlays: [],
  routeLine: null,
};

const ROUTE_DOUBLE_CLICK_MS = 350;
const ROUTE_LONG_PRESS_MS = 500;
let lastRouteClick = null;
let suppressRouteClickUntil = 0;
let suppressRouteClickId = null;
let routeLongPressTimer = null;

function getNoCacheQuery() {
  const params = new URLSearchParams(window.location.search);
  const token = params.get("nocache") || sessionStorage.getItem(NO_CACHE_KEY);
  if (!token) return "";
  sessionStorage.setItem(NO_CACHE_KEY, token);
  return `?nocache=${encodeURIComponent(token)}`;
}

function getReturnParams() {
  const params = new URLSearchParams(window.location.search);
  return {
    view: params.get("return") || "setup",
    modal: params.get("returnModal"),
    raceId: params.get("returnRaceId"),
  };
}

function applyReturnParams(targetParams, returnParams) {
  if (!returnParams) return;
  if (returnParams.view) {
    targetParams.set("return", returnParams.view);
  }
  if (returnParams.modal) {
    targetParams.set("returnModal", returnParams.modal);
  }
  if (returnParams.raceId) {
    targetParams.set("returnRaceId", returnParams.raceId);
  }
}

function getMapHref(mode) {
  const params = new URLSearchParams(getNoCacheQuery().replace(/^\?/, ""));
  params.set("mode", mode);
  applyReturnParams(params, getReturnParams());
  return `map.html?${params.toString()}`;
}

function buildReturnHref() {
  const returnParams = getReturnParams();
  const params = new URLSearchParams(getNoCacheQuery().replace(/^\?/, ""));
  if (returnParams.modal) {
    params.set("modal", returnParams.modal);
  }
  if (returnParams.raceId) {
    params.set("raceId", returnParams.raceId);
  }
  const query = params.toString();
  const view = returnParams.view || "setup";
  return `index.html${query ? `?${query}` : ""}#${view}`;
}

function normalizeMode(value) {
  const modes = Object.values(MODES);
  if (modes.includes(value)) return value;
  return MODES.VENUE_MARKS;
}

function getModeTitle(mode) {
  switch (mode) {
    case MODES.VENUE_MARKS:
      return "Venue marks";
    case MODES.VENUE_LINES:
      return "Lines";
    case MODES.VENUE_SETUP:
      return "Venue setup";
    case MODES.RACE_ROUTE:
      return "Race course";
    case MODES.RACE_START_LINE:
      return "Select start line";
    case MODES.RACE_FINISH_LINE:
      return "Select finish line";
    case MODES.RACE_VIEW:
      return "Race map";
    default:
      return "Map";
  }
}

function getModeCaption(mode) {
  switch (mode) {
    case MODES.VENUE_MARKS:
      return "Drag the map. Add marks on the crosshair, then tap a mark to edit.";
    case MODES.VENUE_LINES:
      return "Tap starboard mark, then port mark to define a line.";
    case MODES.VENUE_SETUP:
      if (getVenueStep() === VENUE_STEPS.MARKS) {
        return "Drag the map. Add marks on the crosshair, then tap a mark to edit.";
      }
      if (getVenueStep() === VENUE_STEPS.LINES) {
        return "Tap starboard mark, then port mark to define a line.";
      }
      if (!hasRouteStartLine()) {
        return "Select a start line first.";
      }
      return "Tap marks to add. Right click or hold to remove.";
    case MODES.RACE_ROUTE:
      if (!hasRouteStartLine()) {
        return "Select a start line first.";
      }
      return "Tap marks to add. Right click or hold to remove.";
    case MODES.RACE_START_LINE:
      return "Tap starboard mark, then port mark to select a start line.";
    case MODES.RACE_FINISH_LINE:
      return "Tap starboard mark, then port mark to select a finish line.";
    case MODES.RACE_VIEW:
      return "Read-only race view: start line, finish line, course.";
    default:
      return "";
  }
}

function isVenueMarksMode(mode = state.mode) {
  if (mode === MODES.VENUE_SETUP) {
    return getVenueStep() === VENUE_STEPS.MARKS;
  }
  return mode === MODES.VENUE_MARKS;
}

function isRouteMode(mode = state.mode) {
  if (mode === MODES.VENUE_SETUP) {
    return getVenueStep() === VENUE_STEPS.ROUTE;
  }
  return mode === MODES.RACE_ROUTE;
}

function isRaceViewMode(mode = state.mode) {
  return mode === MODES.RACE_VIEW;
}

function isVenueSetupMode(mode = state.mode) {
  return mode === MODES.VENUE_SETUP;
}

function isLineEditMode(mode = state.mode) {
  if (mode === MODES.VENUE_LINES) return true;
  if (mode === MODES.VENUE_SETUP) {
    return getVenueStep() === VENUE_STEPS.LINES;
  }
  return false;
}

function isLineSelectMode(mode = state.mode) {
  return mode === MODES.RACE_START_LINE || mode === MODES.RACE_FINISH_LINE;
}

function isLineMode(mode = state.mode) {
  return isLineEditMode(mode) || isLineSelectMode(mode);
}

function getLineTypeForMode(mode = state.mode) {
  if (mode === MODES.RACE_START_LINE) {
    return LINE_TYPES.START;
  }
  if (mode === MODES.RACE_FINISH_LINE) {
    return LINE_TYPES.FINISH;
  }
  return null;
}

function normalizeVenueStep(value) {
  if (value === VENUE_STEPS.MARKS) return VENUE_STEPS.MARKS;
  if (value === VENUE_STEPS.LINES) return VENUE_STEPS.LINES;
  if (value === VENUE_STEPS.ROUTE) return VENUE_STEPS.ROUTE;
  return null;
}

function getVenueStep() {
  if (!isVenueSetupMode()) return null;
  return normalizeVenueStep(state.venueStep) || VENUE_STEPS.MARKS;
}

function setVenueStep(step) {
  if (!isVenueSetupMode()) return;
  const normalized = normalizeVenueStep(step) || VENUE_STEPS.MARKS;
  if (state.venueStep === normalized) return;
  if (state.venueStep === VENUE_STEPS.LINES && normalized !== VENUE_STEPS.LINES) {
    if (state.trimMode) {
      setTrimMode(false);
    }
    clearLineSelection();
  }
  state.venueStep = normalized;
  updateMapOverlays();
  updateModeUi();
}

function formatLineRoleLabel(roles) {
  if (!roles) return "Start + Finish";
  if (roles.start && roles.finish) return "Start + Finish";
  if (roles.start) return "Start";
  if (roles.finish) return "Finish";
  return "Start + Finish";
}

function lineMatchesType(line, type) {
  if (!type) return true;
  const roles = getLineRoles(line);
  if (type === LINE_TYPES.START) return roles.start;
  if (type === LINE_TYPES.FINISH) return roles.finish;
  return true;
}

function setButtonVisible(button, visible) {
  if (!button) return;
  button.hidden = !visible;
}

function setModalOpen(modal, isOpen) {
  if (!modal) return;
  modal.setAttribute("aria-hidden", isOpen ? "false" : "true");
}

function loadData() {
  const settings = loadSettingsFromStorage();
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

  let venue = getVenueById(venues, settings.activeVenueId) || null;
  let race = getRaceById(races, settings.activeRaceId) || null;

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

  const params = new URLSearchParams(window.location.search);
  const mode = normalizeMode(params.get("mode"));
  const step = normalizeVenueStep(params.get("step"));

  state.venues = venues;
  state.races = races;
  state.venue = venue;
  state.race = race;
  state.mode = mode;
  if (mode === MODES.VENUE_SETUP) {
    state.venueStep = step || VENUE_STEPS.MARKS;
  }
  const synced = syncRaceLineState();
  if (synced) {
    saveRaces(state.races);
  }
  const lineType = getLineTypeForMode(mode);
  if (lineType === LINE_TYPES.START) {
    state.selectedLineId =
      race?.startLineId || venue?.defaultStartLineId || null;
  } else if (lineType === LINE_TYPES.FINISH) {
    state.selectedLineId =
      race?.finishLineId || venue?.defaultFinishLineId || null;
  }
}

function saveData() {
  if (state.venue) {
    state.venue.updatedAt = Date.now();
  }
  if (state.race) {
    state.race.updatedAt = Date.now();
  }
  saveVenues(state.venues);
  saveRaces(state.races);
}

function syncRaceLineState() {
  if (!state.race || !state.venue) return false;
  const lines = Array.isArray(state.venue.lines) ? state.venue.lines : [];
  const hasLine = (lineId) => Boolean(lineId && getLineById(lines, lineId));
  const resolveLineId = (primary, fallback) => {
    let lineId = primary || null;
    if (lineId && !hasLine(lineId)) lineId = null;
    if (!lineId && fallback) {
      lineId = fallback;
      if (lineId && !hasLine(lineId)) lineId = null;
    }
    return lineId;
  };
  let startLineId = resolveLineId(state.race.startLineId, state.venue.defaultStartLineId);
  let finishLineId = resolveLineId(
    state.race.finishLineId,
    state.venue.defaultFinishLineId
  );
  let routeStartLineId = resolveLineId(
    state.race.routeStartLineId,
    state.venue.defaultRouteStartLineId
  );
  let routeFinishLineId = resolveLineId(
    state.race.routeFinishLineId,
    state.venue.defaultRouteFinishLineId
  );

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

  return changed;
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

function getSelectedMark() {
  if (!state.venue || !state.selectedMarkId) return null;
  return state.venue.marks.find((mark) => mark.id === state.selectedMarkId) || null;
}

function getSelectedLine() {
  const type = getLineTypeForMode();
  const lines = getLinesForType(type);
  if (!lines.length || !state.selectedLineId) return null;
  return getLineById(lines, state.selectedLineId);
}

function routesMatch(left, right) {
  const leftRoute = Array.isArray(left)
    ? left.map(normalizeRouteEntry).filter(Boolean)
    : [];
  const rightRoute = Array.isArray(right)
    ? right.map(normalizeRouteEntry).filter(Boolean)
    : [];
  if (leftRoute.length !== rightRoute.length) return false;
  return leftRoute.every((entry, index) => {
    const compare = rightRoute[index];
    return (
      compare &&
      entry.markId === compare.markId &&
      entry.rounding === compare.rounding &&
      Boolean(entry.manual) === Boolean(compare.manual)
    );
  });
}

function shouldSyncRaceRouteFromDefault() {
  if (!isVenueSetupMode()) return false;
  if (!state.race || !state.venue) return false;
  if (state.race.venueId !== state.venue.id) return false;
  return routesMatch(state.race.route, state.venue.defaultRoute);
}

function syncRaceRouteFromDefault() {
  if (!state.race || !state.venue) return;
  state.race.route = (state.venue.defaultRoute || []).map((entry) => ({ ...entry }));
}

function getLinesForType(type) {
  if (!state.venue) return [];
  const lines = Array.isArray(state.venue.lines) ? state.venue.lines : [];
  if (!type) return lines;
  const selectedId = state.selectedLineId;
  return lines.filter(
    (line) => line.id === selectedId || lineMatchesType(line, type)
  );
}

function getActiveStartLineId() {
  if (!state.race || !state.venue) return null;
  if (state.race.routeEnabled) {
    return state.race.startLineId || null;
  }
  return state.race.startLineId || state.venue.defaultStartLineId || null;
}

function getActiveFinishLineId() {
  if (!state.race || !state.venue) return null;
  if (state.race.routeEnabled) {
    return state.race.finishLineId || null;
  }
  return state.race.finishLineId || state.venue.defaultFinishLineId || null;
}

function hasStartLine() {
  const lineId = getActiveStartLineId();
  if (!lineId) return false;
  return Boolean(getLineById(getLinesForType(), lineId));
}

function hasFinishLine() {
  const lineId = getActiveFinishLineId();
  if (!lineId) return false;
  return Boolean(getLineById(getLinesForType(), lineId));
}

function getRouteEntries() {
  if (isVenueSetupMode()) {
    return Array.isArray(state.venue?.defaultRoute) ? state.venue.defaultRoute : [];
  }
  return Array.isArray(state.race?.route) ? state.race.route : [];
}

function ensureRouteEntries() {
  if (isVenueSetupMode()) {
    if (!state.venue) return null;
    if (!Array.isArray(state.venue.defaultRoute)) {
      state.venue.defaultRoute = [];
    }
    return state.venue.defaultRoute;
  }
  if (!state.race) return null;
  if (!Array.isArray(state.race.route)) {
    state.race.route = [];
  }
  return state.race.route;
}

function hasRouteStartLine() {
  const { startLineId } = getRouteLineIds();
  return Boolean(startLineId);
}

function getLineName(line, type) {
  const lines = getLinesForType(type);
  const fallback = "Line";
  return getLineDisplayName(line, lines, fallback);
}

function getMarkName(markId) {
  if (!state.venue || !markId) return "--";
  const mark = state.venue.marks.find((entry) => entry.id === markId);
  return mark ? mark.name : "--";
}

function resolveLineLatLng(line) {
  if (!state.venue || !line) return null;
  const marksById = new Map(
    Array.isArray(state.venue.marks)
      ? state.venue.marks.map((mark) => [mark.id, mark])
      : []
  );
  const port = marksById.get(line.portMarkId);
  const starboard = marksById.get(line.starboardMarkId);
  if (!port || !starboard) return null;
  return {
    a: { lat: port.lat, lon: port.lon },
    b: { lat: starboard.lat, lon: starboard.lon },
  };
}

function shouldFitVenueMarks() {
  if (!state.venue) return false;
  if (!isVenueMarksMode() && !isLineEditMode()) return false;
  const marks = Array.isArray(state.venue.marks) ? state.venue.marks : [];
  return marks.some(
    (mark) => Number.isFinite(mark?.lat) && Number.isFinite(mark?.lon)
  );
}

function fitMapToVenueMarks() {
  if (!state.map || !state.venue) return false;
  const marks = Array.isArray(state.venue.marks) ? state.venue.marks : [];
  const points = marks
    .filter((mark) => Number.isFinite(mark?.lat) && Number.isFinite(mark?.lon))
    .map((mark) => [mark.lat, mark.lon]);
  if (!points.length) return false;
  const bounds = L.latLngBounds(points);
  if (!bounds.isValid()) return false;
  const maxZoom = points.length === 1 ? 16 : 17;
  state.map.fitBounds(bounds, { padding: [36, 36], maxZoom });
  return true;
}

function getRouteLineIds() {
  if (!state.venue) {
    return { startLineId: null, finishLineId: null };
  }
  const lines = getLinesForType();
  const hasLine = (lineId) => Boolean(lineId && getLineById(lines, lineId));
  const pickRole = (role) => {
    const candidates = lines.filter((line) => getLineRoles(line)[role]);
    if (candidates.length === 1) {
      return candidates[0].id;
    }
    return null;
  };
  const startRoleFallback = pickRole("start");
  const finishRoleFallback = pickRole("finish");
  if (isVenueSetupMode()) {
    const routeStartLineId = hasLine(state.venue.defaultRouteStartLineId)
      ? state.venue.defaultRouteStartLineId
      : null;
    const routeFinishLineId = hasLine(state.venue.defaultRouteFinishLineId)
      ? state.venue.defaultRouteFinishLineId
      : null;
    const startFallback = hasLine(state.venue.defaultStartLineId)
      ? state.venue.defaultStartLineId
      : null;
    const finishFallback = hasLine(state.venue.defaultFinishLineId)
      ? state.venue.defaultFinishLineId
      : null;
    return {
      startLineId: routeStartLineId || startFallback || startRoleFallback,
      finishLineId: routeFinishLineId || finishFallback || finishRoleFallback,
    };
  }
  if (!state.race) {
    return { startLineId: null, finishLineId: null };
  }
  const routeStartLineId = hasLine(state.race.routeStartLineId)
    ? state.race.routeStartLineId
    : hasLine(state.venue.defaultRouteStartLineId)
      ? state.venue.defaultRouteStartLineId
      : null;
  const routeFinishLineId = hasLine(state.race.routeFinishLineId)
    ? state.race.routeFinishLineId
    : hasLine(state.venue.defaultRouteFinishLineId)
      ? state.venue.defaultRouteFinishLineId
      : null;
  const startFallback = hasLine(state.race.startLineId)
    ? state.race.startLineId
    : hasLine(state.venue.defaultStartLineId)
      ? state.venue.defaultStartLineId
      : null;
  const finishFallback = hasLine(state.race.finishLineId)
    ? state.race.finishLineId
    : hasLine(state.venue.defaultFinishLineId)
      ? state.venue.defaultFinishLineId
      : null;
  return {
    startLineId: routeStartLineId || startFallback || startRoleFallback,
    finishLineId: routeFinishLineId || finishFallback || finishRoleFallback,
  };
}


function updateSelectionStatus() {
  if (!els.mapStatus) return;
  if (isLineMode()) {
    const starboard = state.lineSelection.starboardMarkId
      ? getMarkName(state.lineSelection.starboardMarkId)
      : "--";
    const port = state.lineSelection.portMarkId
      ? getMarkName(state.lineSelection.portMarkId)
      : "--";
    els.mapStatus.textContent = `Starboard: ${starboard} / Port: ${port}`;
    return;
  }
  if (isRouteMode()) {
    const routeLength = getRouteEntries().length;
    const { startLineId, finishLineId } = getRouteLineIds();
    const lines = getLinesForType();
    const startLine = getLineById(lines, startLineId);
    const finishLine = getLineById(lines, finishLineId);
    const startName = startLine ? getLineName(startLine) : "--";
    const finishName = finishLine ? getLineName(finishLine) : "--";
    els.mapStatus.textContent = `Course: ${routeLength} marks \u00b7 Start: ${startName} \u00b7 Finish: ${finishName}`;
  }
}

function clearLineSelection() {
  state.trimMode = false;
  state.lineSelection.starboardMarkId = null;
  state.lineSelection.portMarkId = null;
  updateSelectionStatus();
  updateMapOverlays();
  updateSelectionStatus();
}

function setTrimMode(active) {
  state.trimMode = Boolean(active);
  if (state.trimMode) {
    state.lineSelection.starboardMarkId = null;
    state.lineSelection.portMarkId = null;
    updateSelectionStatus();
  }
  updateModeUi();
}

function canSwapTrimSide() {
  if (!state.trimContext || !state.venue) return false;
  const line = getSelectedLine();
  if (!line || line.id !== state.trimContext.lineId) return false;
  const marks = state.venue.marks || [];
  const ids = new Set(marks.map((mark) => mark.id));
  return (
    ids.has(state.trimContext.trimMarkId) &&
    ids.has(state.trimContext.originalPortId) &&
    ids.has(state.trimContext.originalStarboardId)
  );
}

function applyTrimSegment(line, trimMarkId, keepSide, originalPortId, originalStarboardId) {
  if (!line) return;
  if (keepSide === "port") {
    line.portMarkId = originalPortId;
    line.starboardMarkId = trimMarkId;
  } else {
    line.portMarkId = trimMarkId;
    line.starboardMarkId = originalStarboardId;
  }
}

function setSelectedMark(markId) {
  state.selectedMarkId = markId;
  const mark = getSelectedMark();
  if (els.mapMarkName) {
    els.mapMarkName.value = mark ? mark.name : "";
  }
  if (els.mapMarkDesc) {
    els.mapMarkDesc.value = mark ? mark.description || "" : "";
  }
  renderMarkList();
  updateMarkEditUi();
  syncRouteButtons();
}

function setSelectedLine(lineId) {
  state.selectedLineId = lineId;
  renderLineList();
  updateLineEditUi();
  updateMapOverlays();
}

function openMarkListModal() {
  renderMarkList();
  setModalOpen(els.markListModal, true);
}

function closeMarkListModal() {
  setModalOpen(els.markListModal, false);
}

function openMarkEditModal(markId) {
  if (markId) {
    setSelectedMark(markId);
  }
  if (!getSelectedMark()) return;
  updateMarkEditUi();
  setModalOpen(els.markEditModal, true);
}

function closeMarkEditModal() {
  setModalOpen(els.markEditModal, false);
}

function openLineListModal() {
  renderLineList();
  setModalOpen(els.lineListModal, true);
}

function closeLineListModal() {
  setModalOpen(els.lineListModal, false);
}

function openLineEditModal(lineId) {
  if (lineId) {
    setSelectedLine(lineId);
  }
  if (!getSelectedLine()) return;
  if (state.trimMode) {
    setTrimMode(false);
  }
  if (state.trimContext && state.trimContext.lineId !== state.selectedLineId) {
    state.trimContext = null;
  }
  updateLineEditUi();
  setModalOpen(els.lineEditModal, true);
}

function closeLineEditModal() {
  if (state.trimMode) {
    setTrimMode(false);
  }
  setModalOpen(els.lineEditModal, false);
}

function updateMarkEditUi() {
  const mark = getSelectedMark();
  const editable = isVenueMarksMode();
  const isRoute = isRouteMode();
  if (els.mapMarkName) {
    els.mapMarkName.disabled = !editable || !mark;
  }
  if (els.mapMarkDesc) {
    els.mapMarkDesc.disabled = !editable || !mark;
  }
  if (els.markEditTitle) {
    if (!mark) {
      els.markEditTitle.textContent = "Edit mark";
    } else if (isRoute) {
      els.markEditTitle.textContent = `Course: ${mark.name}`;
    } else {
      els.markEditTitle.textContent = `Edit ${mark.name}`;
    }
  }
  if (els.markEditDetails) {
    els.markEditDetails.hidden = isRoute;
  }
  if (els.routeMarkMenu) {
    els.routeMarkMenu.hidden = !isRoute;
  }
  if (els.deleteMark) {
    els.deleteMark.hidden = !editable;
    els.deleteMark.disabled = !mark;
  }
  if (els.markAddRoute) {
    els.markAddRoute.hidden = !isRoute;
  }
  if (els.mapToVenue) {
    els.mapToVenue.hidden = editable;
  }
  renderRouteMarkMenu();
  syncRouteButtons();
}

function updateLineEditUi() {
  const line = getSelectedLine();
  const type = getLineTypeForMode();
  if (!line) {
    if (els.lineName) {
      els.lineName.value = "";
      els.lineName.placeholder = "Line";
      els.lineName.disabled = true;
    }
    if (els.lineDetails) {
      els.lineDetails.textContent = "";
    }
    if (els.lineRoleStart) {
      els.lineRoleStart.hidden = true;
      els.lineRoleStart.disabled = true;
      els.lineRoleStart.setAttribute("aria-pressed", "false");
    }
    if (els.lineRoleFinish) {
      els.lineRoleFinish.hidden = true;
      els.lineRoleFinish.disabled = true;
      els.lineRoleFinish.setAttribute("aria-pressed", "false");
    }
    if (els.swapLineDirection) {
      els.swapLineDirection.hidden = true;
      els.swapLineDirection.disabled = true;
    }
    if (els.trimLine) {
      els.trimLine.hidden = true;
      els.trimLine.setAttribute("aria-pressed", "false");
    }
    if (els.swapTrimSide) {
      els.swapTrimSide.hidden = true;
      els.swapTrimSide.disabled = true;
    }
    return;
  }
  if (els.lineEditTitle) {
    els.lineEditTitle.textContent = getLineName(line, type);
  }
  if (els.lineName) {
    els.lineName.value = line.name || "";
    els.lineName.placeholder = getLineName(line, type);
    els.lineName.disabled = !isLineEditMode();
  }
  if (els.lineDetails) {
    const starboard = getMarkName(line.starboardMarkId);
    const port = getMarkName(line.portMarkId);
    const roles = getLineRoles(line);
    const roleLabel = formatLineRoleLabel(roles);
    els.lineDetails.textContent = `Starboard: ${starboard} / Port: ${port}\nRole: ${roleLabel}`;
  }
  if (els.lineRoleStart) {
    const roles = getLineRoles(line);
    els.lineRoleStart.hidden = false;
    els.lineRoleStart.disabled = !isLineEditMode();
    els.lineRoleStart.setAttribute("aria-pressed", roles.start ? "true" : "false");
  }
  if (els.lineRoleFinish) {
    const roles = getLineRoles(line);
    els.lineRoleFinish.hidden = false;
    els.lineRoleFinish.disabled = !isLineEditMode();
    els.lineRoleFinish.setAttribute("aria-pressed", roles.finish ? "true" : "false");
  }
  if (els.swapLineDirection) {
    els.swapLineDirection.hidden = !isLineEditMode();
    els.swapLineDirection.disabled = !isLineEditMode();
  }
  if (els.trimLine) {
    els.trimLine.hidden = !isLineEditMode();
    els.trimLine.setAttribute("aria-pressed", state.trimMode ? "true" : "false");
    els.trimLine.disabled = !isLineEditMode();
  }
  if (els.swapTrimSide) {
    els.swapTrimSide.hidden = !isLineEditMode();
    els.swapTrimSide.disabled = !canSwapTrimSide();
  }
  if (els.deleteLine) {
    els.deleteLine.hidden = !isLineEditMode();
  }
}

function addRouteMark(mark, options = {}) {
  if (!mark || !isRouteMode()) return false;
  if (!hasRouteStartLine()) {
    window.alert("Select a start line first.");
    return false;
  }
  const syncRace = shouldSyncRaceRouteFromDefault();
  const route = ensureRouteEntries();
  if (!route) return false;
  route.push({
    markId: mark.id,
    rounding: "port",
    manual: false,
  });
  if (options.recordClick !== false) {
    lastRouteClick = {
      markId: mark.id,
      index: route.length - 1,
      ts: Date.now(),
    };
  } else {
    lastRouteClick = null;
  }
  if (!isVenueSetupMode()) {
    syncVenueDefaultRoute();
  } else if (syncRace) {
    syncRaceRouteFromDefault();
  }
  saveData();
  updateMapOverlays();
  syncRouteButtons();
  return true;
}

function removeRouteEntryAt(index) {
  if (!isRouteMode()) return false;
  const syncRace = shouldSyncRaceRouteFromDefault();
  const route = ensureRouteEntries();
  if (!route || !route.length) return false;
  if (!Number.isFinite(index) || index < 0 || index >= route.length) return false;
  route.splice(index, 1);
  lastRouteClick = null;
  if (!isVenueSetupMode()) {
    syncVenueDefaultRoute();
  } else if (syncRace) {
    syncRaceRouteFromDefault();
  }
  saveData();
  updateMapOverlays();
  syncRouteButtons();
  renderRouteMarkMenu();
  return true;
}

function renderRouteMarkMenu() {
  if (!els.routeMarkMenu || !els.routeMarkList) return;
  const mark = getSelectedMark();
  if (!mark || !isRouteMode()) {
    els.routeMarkList.innerHTML = "";
    return;
  }
  const route = getRouteEntries();
  const indices = [];
  route.forEach((entry, index) => {
    if (entry && entry.markId === mark.id) {
      indices.push(index);
    }
  });
  els.routeMarkList.innerHTML = "";
  if (!indices.length) {
    const empty = document.createElement("div");
    empty.className = "map-route-empty";
    empty.textContent = "No course entries.";
    els.routeMarkList.appendChild(empty);
    return;
  }
  indices.forEach((routeIndex) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "map-mark-item";
    button.textContent = `Delete entry ${routeIndex + 1}`;
    button.addEventListener("click", () => {
      removeRouteEntryAt(routeIndex);
    });
    els.routeMarkList.appendChild(button);
  });
}

function stopMapEvent(event) {
  const original = event?.originalEvent;
  if (!original) return;
  if (typeof original.preventDefault === "function") {
    original.preventDefault();
  }
  if (typeof original.stopPropagation === "function") {
    original.stopPropagation();
  }
}

function suppressRouteClick(markId, duration = ROUTE_DOUBLE_CLICK_MS) {
  suppressRouteClickId = markId || null;
  suppressRouteClickUntil = Date.now() + duration;
}

function shouldSuppressRouteClick(mark) {
  if (!mark || !suppressRouteClickId) return false;
  if (Date.now() > suppressRouteClickUntil) {
    suppressRouteClickId = null;
    return false;
  }
  return mark.id === suppressRouteClickId;
}

function undoLastRouteClick(mark) {
  if (!mark || !lastRouteClick) return false;
  const now = Date.now();
  if (now - lastRouteClick.ts > ROUTE_DOUBLE_CLICK_MS) return false;
  if (lastRouteClick.markId !== mark.id) return false;
  return removeRouteEntryAt(lastRouteClick.index);
}

function handleRouteMarkClick(mark, event) {
  if (!mark) return;
  if (shouldSuppressRouteClick(mark)) return;
  const original = event?.originalEvent;
  const detail =
    original && Number.isFinite(original.detail) ? original.detail : 1;
  if (detail > 1) {
    stopMapEvent(event);
    undoLastRouteClick(mark);
    suppressRouteClick(mark.id);
    openMarkEditModal(mark.id);
    return;
  }
  addRouteMark(mark);
}

function isTouchEvent(event) {
  const original = event?.originalEvent;
  if (!original) return false;
  if (typeof original.pointerType === "string") {
    return original.pointerType === "touch";
  }
  return Boolean(original.touches && original.touches.length);
}

function startRouteLongPress(mark, event) {
  if (!mark || !isRouteMode()) return;
  if (!isTouchEvent(event)) return;
  clearRouteLongPress();
  routeLongPressTimer = setTimeout(() => {
    routeLongPressTimer = null;
    suppressRouteClick(mark.id, ROUTE_LONG_PRESS_MS);
    openMarkEditModal(mark.id);
  }, ROUTE_LONG_PRESS_MS);
}

function clearRouteLongPress() {
  if (routeLongPressTimer) {
    clearTimeout(routeLongPressTimer);
    routeLongPressTimer = null;
  }
}

function trimLineToMark(mark) {
  if (!state.map || !state.venue) return;
  const line = getSelectedLine();
  if (!line) return;
  if (mark.id === line.portMarkId || mark.id === line.starboardMarkId) {
    window.alert("Pick a different mark to trim the line.");
    return;
  }
  const coords = resolveLineLatLng(line);
  if (!coords) return;
  const portPoint = state.map.latLngToLayerPoint([coords.a.lat, coords.a.lon]);
  const starboardPoint = state.map.latLngToLayerPoint([coords.b.lat, coords.b.lon]);
  const markPoint = state.map.latLngToLayerPoint([mark.lat, mark.lon]);
  const abx = starboardPoint.x - portPoint.x;
  const aby = starboardPoint.y - portPoint.y;
  const denom = abx * abx + aby * aby;
  if (denom <= 0) return;
  let t = ((markPoint.x - portPoint.x) * abx + (markPoint.y - portPoint.y) * aby) / denom;
  t = Math.min(1, Math.max(0, t));
  const projPoint = L.point(portPoint.x + t * abx, portPoint.y + t * aby);
  const projLatLng = state.map.layerPointToLatLng(projPoint);
  const distToPort = Math.hypot(projPoint.x - portPoint.x, projPoint.y - portPoint.y);
  const distToStarboard = Math.hypot(
    projPoint.x - starboardPoint.x,
    projPoint.y - starboardPoint.y
  );
  const keepSide = distToPort >= distToStarboard ? "port" : "starboard";
  const trimMark = {
    id: `mark-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    name: `Trim ${state.venue.marks.length + 1}`,
    description: "",
    lat: projLatLng.lat,
    lon: projLatLng.lng,
  };
  const originalPortId = line.portMarkId;
  const originalStarboardId = line.starboardMarkId;
  state.venue.marks.push(trimMark);
  applyTrimSegment(line, trimMark.id, keepSide, originalPortId, originalStarboardId);
  state.trimContext = {
    lineId: line.id,
    trimMarkId: trimMark.id,
    originalPortId,
    originalStarboardId,
    keepSide,
  };
  saveData();
  setTrimMode(false);
  updateMapOverlays();
  openLineEditModal(line.id);
}

function swapTrimSide() {
  if (!state.trimContext || !state.venue) return;
  const line = getSelectedLine();
  if (!line || line.id !== state.trimContext.lineId) return;
  const { trimMarkId, originalPortId, originalStarboardId } = state.trimContext;
  const marks = new Set((state.venue.marks || []).map((mark) => mark.id));
  if (!marks.has(trimMarkId) || !marks.has(originalPortId) || !marks.has(originalStarboardId)) {
    state.trimContext = null;
    updateLineEditUi();
    return;
  }
  const nextSide = state.trimContext.keepSide === "port" ? "starboard" : "port";
  applyTrimSegment(line, trimMarkId, nextSide, originalPortId, originalStarboardId);
  state.trimContext.keepSide = nextSide;
  saveData();
  updateMapOverlays();
  updateLineEditUi();
}

function swapLineDirection() {
  if (!state.venue) return;
  const line = getSelectedLine();
  if (!line) return;
  const nextPort = line.starboardMarkId;
  const nextStarboard = line.portMarkId;
  line.portMarkId = nextPort;
  line.starboardMarkId = nextStarboard;
  if (state.trimContext && state.trimContext.lineId === line.id) {
    state.trimContext = null;
  }
  saveData();
  updateMapOverlays();
  updateLineEditUi();
  renderLineList();
}

function syncRouteButtons() {
  const mark = getSelectedMark();
  if (els.markAddRoute) {
    const routeReady = hasRouteStartLine();
    const canAdd = isRouteMode() && routeReady && Boolean(mark);
    els.markAddRoute.disabled = !canAdd;
  }
  const routeLength = getRouteEntries().length;
  if (els.undoRoute) {
    els.undoRoute.disabled = !isRouteMode() || routeLength === 0 || !hasRouteStartLine();
  }
  if (els.clearRoute) {
    els.clearRoute.disabled = !isRouteMode() || routeLength === 0 || !hasRouteStartLine();
  }
}

function pruneRoutesForVenue(venueId, removedIds = new Set()) {
  if (!state.races.length) return;
  state.races.forEach((race) => {
    if (race.venueId !== venueId) return;
    if (!Array.isArray(race.route)) return;
    race.route = race.route.filter((entry) => !removedIds.has(entry.markId));
    if (!race.route.length) {
      race.routeEnabled = false;
    }
  });
  if (state.venue && state.venue.id === venueId) {
    const route = Array.isArray(state.venue.defaultRoute) ? state.venue.defaultRoute : [];
    state.venue.defaultRoute = route.filter((entry) => !removedIds.has(entry.markId));
  }
}

function pruneLinesForVenue(venueId, removedMarkIds = new Set()) {
  const venue = state.venues.find((entry) => entry.id === venueId);
  if (!venue) return;
  const removedLineIds = new Set();
  if (Array.isArray(venue.lines)) {
    venue.lines = venue.lines.filter((line) => {
      const remove =
        removedMarkIds.has(line.starboardMarkId) || removedMarkIds.has(line.portMarkId);
      if (remove) removedLineIds.add(line.id);
      return !remove;
    });
  } else {
    venue.lines = [];
  }

  if (removedLineIds.has(venue.defaultStartLineId)) {
    venue.defaultStartLineId = venue.lines?.[0]?.id || null;
  }
  if (removedLineIds.has(venue.defaultFinishLineId)) {
    venue.defaultFinishLineId = venue.lines?.[0]?.id || null;
  }
  if (removedLineIds.has(venue.defaultRouteStartLineId)) {
    venue.defaultRouteStartLineId = null;
  }
  if (removedLineIds.has(venue.defaultRouteFinishLineId)) {
    venue.defaultRouteFinishLineId = null;
  }

  state.races.forEach((race) => {
    if (race.venueId !== venueId) return;
    if (removedLineIds.has(race.startLineId)) {
      race.startLineId = venue.defaultStartLineId || null;
    }
    if (removedLineIds.has(race.finishLineId)) {
      race.finishLineId = venue.defaultFinishLineId || null;
    }
    if (removedLineIds.has(race.routeStartLineId)) {
      race.routeStartLineId = null;
    }
    if (removedLineIds.has(race.routeFinishLineId)) {
      race.routeFinishLineId = null;
    }
    if (race.routeEnabled) {
      if (!race.routeStartLineId) {
        race.routeEnabled = false;
      } else {
        race.startLineId = race.routeStartLineId;
        race.finishLineId = race.routeFinishLineId || null;
      }
    }
  });

  if (removedLineIds.has(state.selectedLineId)) {
    state.selectedLineId = null;
  }

  if (state.trimContext) {
    const trimHitsRemoved =
      removedMarkIds.has(state.trimContext.trimMarkId) ||
      removedMarkIds.has(state.trimContext.originalPortId) ||
      removedMarkIds.has(state.trimContext.originalStarboardId) ||
      removedLineIds.has(state.trimContext.lineId);
    if (trimHitsRemoved) {
      state.trimContext = null;
      state.trimMode = false;
    }
  }
}

function renderMarkList() {
  if (!els.mapMarkList) return;
  els.mapMarkList.innerHTML = "";
  const marks = state.venue?.marks || [];
  if (!marks.length) {
    els.mapMarkList.textContent = "No marks yet.";
    return;
  }
  marks.forEach((mark) => {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "map-mark-item";
    if (mark.id === state.selectedMarkId) {
      item.classList.add("selected");
    }
    const nameSpan = document.createElement("span");
    nameSpan.textContent = mark.name;
    item.appendChild(nameSpan);
    item.addEventListener("click", () => {
      if (isRouteMode()) {
        addRouteMark(mark, { recordClick: false });
        closeMarkListModal();
        return;
      }
      closeMarkListModal();
      openMarkEditModal(mark.id);
    });
    els.mapMarkList.appendChild(item);
  });
}

function renderLineList() {
  if (!els.mapLineList) return;
  els.mapLineList.innerHTML = "";
  const type = getLineTypeForMode();
  const lines = getLinesForType(type);
  const title = "Lines";
  if (els.lineListTitle) {
    els.lineListTitle.textContent = title;
  }
  if (!lines.length) {
    els.mapLineList.textContent = "No lines yet.";
    return;
  }
  lines.forEach((line) => {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "map-line-item";
    if (line.id === state.selectedLineId) {
      item.classList.add("selected");
    }
    const name = document.createElement("span");
    name.textContent = getLineName(line, type);
    const meta = document.createElement("span");
    meta.className = "map-line-meta";
    const roleLabel = formatLineRoleLabel(getLineRoles(line));
    meta.textContent = `SB: ${getMarkName(line.starboardMarkId)} / P: ${getMarkName(
      line.portMarkId
    )} \u2022 ${roleLabel}`;
    item.appendChild(name);
    item.appendChild(meta);
    item.addEventListener("click", () => {
      closeLineListModal();
      if (isLineEditMode()) {
        openLineEditModal(line.id);
      } else if (isLineSelectMode()) {
        applyLineSelection(line.id);
      }
    });
    els.mapLineList.appendChild(item);
  });
}

function updateModeUi() {
  if (els.mapTitle) {
    els.mapTitle.textContent = getModeTitle(state.mode);
  }
  if (els.mapCaption) {
    els.mapCaption.textContent = state.trimMode
      ? "Tap a mark to trim the line. Longest side kept by default."
      : getModeCaption(state.mode);
  }

  const readOnly = isRaceViewMode();
  const isSetup = isVenueSetupMode();
  const venueStep = getVenueStep();
  const markCount = state.venue?.marks?.length || 0;
  const hasMarks = markCount > 0;
  const hasRouteStart = hasRouteStartLine();
  const showMarkList = !readOnly && isVenueMarksMode();
  const showLineList = !readOnly && (isLineEditMode() || isLineSelectMode());

  if (els.mapTabs) {
    setButtonVisible(els.mapTabs, isSetup);
    if (isSetup) {
      if (els.tabMarks) {
        els.tabMarks.setAttribute(
          "aria-pressed",
          venueStep === VENUE_STEPS.MARKS ? "true" : "false"
        );
        els.tabMarks.disabled = false;
      }
      if (els.tabLines) {
        els.tabLines.setAttribute(
          "aria-pressed",
          venueStep === VENUE_STEPS.LINES ? "true" : "false"
        );
        els.tabLines.disabled = !hasMarks;
      }
      if (els.tabRoute) {
        els.tabRoute.setAttribute(
          "aria-pressed",
          venueStep === VENUE_STEPS.ROUTE ? "true" : "false"
        );
        els.tabRoute.disabled = !hasRouteStart;
      }
    }
  }

  setButtonVisible(els.addMark, !readOnly && isVenueMarksMode());
  setButtonVisible(els.undoMark, !readOnly && isVenueMarksMode() && !isSetup);
  setButtonVisible(els.clearMarks, !readOnly && isVenueMarksMode() && !isSetup);
  setButtonVisible(els.openMarkList, showMarkList);
  setButtonVisible(els.openLineList, showLineList);
  setButtonVisible(els.clearLineSelection, !readOnly && isLineMode());
  setButtonVisible(els.undoRoute, !readOnly && isRouteMode());
  setButtonVisible(els.clearRoute, !readOnly && isRouteMode());

  // No "Next" button; navigation uses tabs only.

  if (els.mapCrosshair) {
    els.mapCrosshair.style.display = isVenueMarksMode() ? "block" : "none";
  }

  updateSelectionStatus();
  updateMarkEditUi();
  updateLineEditUi();
  syncRouteButtons();
}

function addMarkAtCenter() {
  if (!state.map || !state.venue) return;
  const center = state.map.getCenter();
  const name = `Mark ${state.venue.marks.length + 1}`;
  const mark = {
    id: `mark-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    name,
    description: "",
    lat: center.lat,
    lon: center.lng,
  };
  state.venue.marks.push(mark);
  saveData();
  updateMapOverlays();
  updateModeUi();
}

function handleLineClick(lineId) {
  if (!lineId) return;
  if (isLineEditMode()) {
    openLineEditModal(lineId);
    return;
  }
  if (isLineSelectMode()) {
    const line = getLineById(getLinesForType(), lineId);
    const type = getLineTypeForMode();
    if (line && !lineMatchesType(line, type) && line.id !== state.selectedLineId) {
      const roleLabel = formatLineRoleLabel(getLineRoles(line));
      window.alert(`Line is marked ${roleLabel} only.`);
      return;
    }
    applyLineSelection(lineId);
  }
}

function applyLineSelection(lineId) {
  if (!state.race || !state.venue) return;
  const type = getLineTypeForMode();
  if (!type) return;
  if (type === LINE_TYPES.START) {
    state.race.startLineId = lineId;
    state.venue.defaultStartLineId = lineId;
    if (state.race.routeEnabled) {
      state.race.routeStartLineId = lineId;
      state.venue.defaultRouteStartLineId = lineId;
    }
  } else {
    state.race.finishLineId = lineId;
    state.venue.defaultFinishLineId = lineId;
    if (state.race.routeEnabled) {
      state.race.routeFinishLineId = lineId;
      state.venue.defaultRouteFinishLineId = lineId;
    }
  }
  syncRaceLineState();
  state.selectedLineId = lineId;
  saveData();
  updateMapOverlays();
  updateSelectionStatus();
}

function generateLineId() {
  return `line-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function finalizeLineSelection() {
  const type = getLineTypeForMode();
  if (!state.venue) return;
  const { starboardMarkId, portMarkId } = state.lineSelection;
  if (!starboardMarkId || !portMarkId) return;

  const lines = getLinesForType(type);
  let line = lines.find(
    (entry) =>
      entry.starboardMarkId === starboardMarkId && entry.portMarkId === portMarkId
  );

  if (isLineEditMode()) {
    if (!line) {
      line = {
        id: generateLineId(),
        name: "",
        starboardMarkId,
        portMarkId,
        roles: { start: true, finish: true },
      };
      lines.push(line);
    }
    if (isVenueSetupMode()) {
      if (!state.venue.defaultStartLineId) {
        state.venue.defaultStartLineId = line.id;
      }
      if (!state.venue.defaultRouteStartLineId) {
        state.venue.defaultRouteStartLineId = line.id;
      }
    }
    state.selectedLineId = line.id;
    saveData();
    updateMapOverlays();
    openLineEditModal(line.id);
  } else if (isLineSelectMode()) {
    if (!line) {
      window.alert("Line not defined. Edit lines in the venue first.");
    } else {
      applyLineSelection(line.id);
    }
  }

  clearLineSelection();
}

function handleLineMarkSelection(mark) {
  if (!mark) return;
  if (state.trimMode) {
    trimLineToMark(mark);
    return;
  }
  if (state.lineSelection.portMarkId) {
    state.lineSelection.starboardMarkId = mark.id;
    state.lineSelection.portMarkId = null;
    updateSelectionStatus();
    updateMapOverlays();
    return;
  }
  if (!state.lineSelection.starboardMarkId) {
    state.lineSelection.starboardMarkId = mark.id;
    updateSelectionStatus();
    updateMapOverlays();
    return;
  }
  if (state.lineSelection.starboardMarkId === mark.id) {
    state.lineSelection.starboardMarkId = null;
    state.lineSelection.portMarkId = null;
    updateSelectionStatus();
    updateMapOverlays();
    return;
  }
  state.lineSelection.portMarkId = mark.id;
  updateSelectionStatus();
  finalizeLineSelection();
}

function deleteSelectedLine() {
  if (!state.venue) return;
  const line = getSelectedLine();
  if (!line) return;
  const confirmed = window.confirm(`Delete \"${getLineName(line)}\"?`);
  if (!confirmed) return;

  state.venue.lines = getLinesForType().filter((entry) => entry.id !== line.id);
  if (state.venue.defaultStartLineId === line.id) {
    state.venue.defaultStartLineId = state.venue.lines[0]?.id || null;
  }
  if (state.venue.defaultFinishLineId === line.id) {
    state.venue.defaultFinishLineId = state.venue.lines[0]?.id || null;
  }
  if (state.venue.defaultRouteStartLineId === line.id) {
    state.venue.defaultRouteStartLineId = null;
  }
  if (state.venue.defaultRouteFinishLineId === line.id) {
    state.venue.defaultRouteFinishLineId = null;
  }

  state.races.forEach((race) => {
    if (race.venueId !== state.venue.id) return;
    if (race.startLineId === line.id) {
      race.startLineId = state.venue.defaultStartLineId || null;
    }
    if (race.finishLineId === line.id) {
      race.finishLineId = state.venue.defaultFinishLineId || null;
    }
    if (race.routeStartLineId === line.id) {
      race.routeStartLineId = null;
    }
    if (race.routeFinishLineId === line.id) {
      race.routeFinishLineId = null;
    }
    if (race.routeEnabled) {
      if (!race.routeStartLineId) {
        race.routeEnabled = false;
      } else {
        race.startLineId = race.routeStartLineId;
        race.finishLineId = race.routeFinishLineId || null;
      }
    }
  });

  if (state.trimContext && state.trimContext.lineId === line.id) {
    state.trimContext = null;
  }
  state.selectedLineId = null;
  saveData();
  closeLineEditModal();
  renderLineList();
  updateMapOverlays();
}

function updateMapOverlays() {
  if (!state.map || typeof L === "undefined") return;

  state.markMarkers.forEach((marker) => state.map.removeLayer(marker));
  state.labelMarkers.forEach((marker) => state.map.removeLayer(marker));
  state.lineOverlays.forEach((overlay) => {
    if (overlay.polyline) state.map.removeLayer(overlay.polyline);
    if (overlay.arrow) state.map.removeLayer(overlay.arrow);
    if (Array.isArray(overlay.arrows)) {
      overlay.arrows.forEach((marker) => {
        if (marker) state.map.removeLayer(marker);
      });
    }
  });
  state.markMarkers = [];
  state.labelMarkers = [];
  state.lineOverlays = [];

  if (state.routeLine) {
    state.map.removeLayer(state.routeLine);
    state.routeLine = null;
  }

  const marks = state.venue?.marks || [];
  const roundingMap = isRaceViewMode() ? getRouteRoundingMap() : null;
  marks.forEach((mark) => {
    const isStarboardPick = mark.id === state.lineSelection.starboardMarkId;
    const isPortPick = mark.id === state.lineSelection.portMarkId;
    let radius = isStarboardPick || isPortPick ? 9 : 7;
    let weight = isPortPick ? 3 : 2;
    let fillColor = isStarboardPick ? "#000000" : "#ffffff";
    if (isRaceViewMode()) {
      const rounding = roundingMap ? roundingMap.get(mark.id) : null;
      if (rounding === "starboard") {
        fillColor = "#1f9d3a";
      } else if (rounding === "port") {
        fillColor = "#d13a32";
      } else {
        fillColor = "#ffffff";
      }
      radius = 7;
      weight = 2;
    }
    const marker = L.circleMarker([mark.lat, mark.lon], {
      radius,
      color: "#000000",
      weight,
      fillColor,
      fillOpacity: 1,
      interactive: true,
      className: `map-mark map-mark-${mark.id}`,
      pane: "markPane",
    }).addTo(state.map);
    marker.on("click", (event) => {
      if (isRaceViewMode()) {
        return;
      }
      if (isLineMode()) {
        handleLineMarkSelection(mark);
        return;
      }
      if (isRouteMode()) {
        handleRouteMarkClick(mark, event);
        return;
      }
      openMarkEditModal(mark.id);
    });
    marker.on("contextmenu", (event) => {
      if (!isRouteMode()) return;
      stopMapEvent(event);
      suppressRouteClick(mark.id);
      openMarkEditModal(mark.id);
    });
    marker.on("dblclick", (event) => {
      if (!isRouteMode()) return;
      stopMapEvent(event);
    });
    marker.on("touchstart", (event) => {
      startRouteLongPress(mark, event);
    });
    marker.on("touchend", () => {
      clearRouteLongPress();
    });
    marker.on("touchcancel", () => {
      clearRouteLongPress();
    });
    marker.on("touchmove", () => {
      clearRouteLongPress();
    });
    state.markMarkers.push(marker);

    const label = L.marker([mark.lat, mark.lon], {
      icon: L.divIcon({
        className: "mark-label",
        html: `<span>${mark.name}</span>`,
      }),
      interactive: false,
      pane: "labelPane",
    }).addTo(state.map);
    state.labelMarkers.push(label);
  });

  const lines = getLinesForType();
  const startLineId = state.race?.startLineId || null;
  const finishLineId = state.race?.finishLineId || null;
  const showRaceLines = isRaceViewMode();
  lines.forEach((line) => {
    const coords = resolveLineLatLng(line);
    if (!coords) return;
    const isSelected = isLineMode() && line.id === state.selectedLineId;
    const isStart = line.id === startLineId;
    const isFinish = line.id === finishLineId;
    let color = "#000000";
    let weight = 3;
    let dashArray = null;
    if (showRaceLines) {
      if (isFinish && !isStart) {
        dashArray = "8 6";
      }
      if (isStart) {
        weight = 4;
      }
    }
    if (isSelected) {
      color = "#0f6bff";
      weight = 5;
      dashArray = null;
    }
    const polyline = L.polyline(
      [
        [coords.a.lat, coords.a.lon],
        [coords.b.lat, coords.b.lon],
      ],
      {
        color,
        weight,
        opacity: 1,
        dashArray,
        interactive: isLineMode(),
      }
    ).addTo(state.map);
    if (isLineMode()) {
      polyline.on("click", () => handleLineClick(line.id));
    }
    const arrows = createLineArrows(coords, { isSelected, isStart, isFinish });
    state.lineOverlays.push({ id: line.id, type: "line", polyline, arrows });
  });

  const route = getRouteLatLngs();
  const showRoute = !isRaceViewMode() || Boolean(state.race?.routeEnabled);
  if (showRoute && route.length >= 2) {
    state.routeLine = L.polyline(route, {
      color: "#0f6bff",
      weight: 3,
      opacity: 0.9,
      interactive: false,
    }).addTo(state.map);
  }
}

function createLineArrows(coords, options = {}) {
  const isSelected = Boolean(options.isSelected);
  const isStart = Boolean(options.isStart);
  const isFinish = Boolean(options.isFinish);
  if (isStart && isFinish) {
    return [
      createLineArrow(coords, {
        isSelected,
        role: "start",
        label: "Start",
        offsetPx: 18,
      }),
      createLineArrow(coords, {
        isSelected,
        reverse: true,
        role: "finish",
        label: "Finish",
        offsetPx: 18,
      }),
    ].filter(Boolean);
  }
  return [
    createLineArrow(coords, {
      isSelected,
      reverse: isFinish && !isStart,
      role: isFinish ? "finish" : "start",
    }),
  ].filter(Boolean);
}

function createLineArrow(coords, options = {}) {
  if (!state.map || !coords) return null;
  const { isSelected = false, reverse = false, role = "start", label = "", offsetPx = 0 } =
    options;
  const pointA = state.map.latLngToLayerPoint([coords.a.lat, coords.a.lon]);
  const pointB = state.map.latLngToLayerPoint([coords.b.lat, coords.b.lon]);
  const dx = pointB.x - pointA.x;
  const dy = pointB.y - pointA.y;
  const len = Math.hypot(dx, dy);
  if (len < 1) return null;
  const normalX = dy / len;
  const normalY = -dx / len;
  const dirX = reverse ? -normalX : normalX;
  const dirY = reverse ? -normalY : normalY;
  const angle = (Math.atan2(dirY, dirX) * 180) / Math.PI;
  const midPoint = L.point((pointA.x + pointB.x) / 2, (pointA.y + pointB.y) / 2);
  const arrowPoint = L.point(
    midPoint.x + dirX * offsetPx,
    midPoint.y + dirY * offsetPx
  );
  const mid = state.map.layerPointToLatLng(arrowPoint);
  const className = `map-line-arrow${isSelected ? " selected" : ""}${
    role === "finish" ? " role-finish" : " role-start"
  }${label ? " with-label" : ""}`;
  const labelHtml = label
    ? `<span class=\"map-line-arrow-role\">${label}</span>`
    : "";
  const icon = L.divIcon({
    className,
    html: `${labelHtml}<span class=\"map-line-arrow-glyph\" style=\"transform: rotate(${angle}deg);\">&#10148;</span>`,
  });
  return L.marker(mid, {
    icon,
    interactive: false,
    pane: "labelPane",
  }).addTo(state.map);
}

function getRouteLatLngs() {
  if (!state.venue) return [];
  const marksById = new Map(
    (state.venue.marks || []).map((mark) => [mark.id, mark])
  );
  const routeMarks = getRouteEntries()
    .map((entry) => marksById.get(entry.markId))
    .filter(Boolean);
  if (!routeMarks.length) return [];

  const points = routeMarks.map((mark) => ({ lat: mark.lat, lon: mark.lon }));
  const { startLineId, finishLineId } = getRouteLineIds();
  if (startLineId) {
    const line = getLineById(getLinesForType(), startLineId);
    const coords = resolveLineLatLng(line);
    const closest = coords
      ? getClosestPointOnSegment(points[0], coords.a, coords.b)
      : null;
    if (closest) {
      points.unshift({ lat: closest.lat, lon: closest.lon });
    }
  }
  if (finishLineId) {
    const line = getLineById(getLinesForType(), finishLineId);
    const coords = resolveLineLatLng(line);
    const closest = coords
      ? getClosestPointOnSegment(points[points.length - 1], coords.a, coords.b)
      : null;
    if (closest) {
      points.push({ lat: closest.lat, lon: closest.lon });
    }
  }
  return points.map((point) => [point.lat, point.lon]);
}

function getRouteRoundingMap() {
  if (!state.race || !Array.isArray(state.race.route)) return new Map();
  const roundingMap = new Map();
  state.race.route.forEach((entry) => {
    if (!entry || !entry.markId) return;
    const rounding = entry.rounding === "starboard" ? "starboard" : "port";
    roundingMap.set(entry.markId, rounding);
  });
  return roundingMap;
}

function initMap() {
  if (typeof L === "undefined") {
    if (els.mapStatus) {
      els.mapStatus.textContent = "Leaflet failed to load";
    }
    if (els.mapTitle) {
      els.mapTitle.textContent = "Map failed to load";
    }
    return;
  }

  state.map = L.map("map", {
    zoomControl: true,
    center: [DEFAULT_CENTER.lat, DEFAULT_CENTER.lon],
    zoom: 14,
  });
  state.map.on("zoomend", () => updateMapOverlays());
  state.map.on("movestart", () => clearRouteLongPress());
  state.map.on("dragstart", () => clearRouteLongPress());

  state.map.createPane("markPane");
  const markPane = state.map.getPane("markPane");
  if (markPane) {
    markPane.style.zIndex = "650";
  }
  state.map.createPane("labelPane");
  const labelPane = state.map.getPane("labelPane");
  if (labelPane) {
    labelPane.style.zIndex = "700";
    labelPane.style.pointerEvents = "none";
  }

  const tiles = L.tileLayer(
    "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    {
      attribution: "Tiles &copy; Esri",
      maxZoom: 19,
    }
  ).addTo(state.map);

  if (els.mapStatus) {
    const size = state.map.getSize();
    const online = navigator.onLine ? "online" : "offline";
    els.mapStatus.textContent = `Leaflet OK, size ${size.x}x${size.y}, ${online}`;
  }

  tiles.on("load", () => {
    if (els.mapStatus && !isLineMode()) {
      els.mapStatus.textContent = "Tiles loaded";
    }
  });

  tiles.on("tileerror", () => {
    if (els.mapStatus) {
      els.mapStatus.textContent = "Tile load error (check internet)";
    }
  });

  const didFit = shouldFitVenueMarks() ? fitMapToVenueMarks() : false;
  if (navigator.geolocation && !didFit) {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        state.map.setView([pos.coords.latitude, pos.coords.longitude], 15);
      },
      () => {},
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 1000 }
    );
  }

  setTimeout(() => {
    state.map.invalidateSize();
  }, 200);

  updateMapOverlays();
}

function bindEvents() {
  if (els.addMark) {
    els.addMark.addEventListener("click", () => {
      if (!isVenueMarksMode()) return;
      addMarkAtCenter();
    });
  }

  if (els.undoMark) {
    els.undoMark.addEventListener("click", () => {
      if (!isVenueMarksMode()) return;
      if (!state.venue || !state.venue.marks.length) return;
      const removed = state.venue.marks.pop();
      if (removed && removed.id === state.selectedMarkId) {
        state.selectedMarkId = null;
      }
      if (removed) {
        const removedIds = new Set([removed.id]);
        pruneRoutesForVenue(state.venue.id, removedIds);
        pruneLinesForVenue(state.venue.id, removedIds);
      }
      saveData();
      renderMarkList();
      renderLineList();
      updateMapOverlays();
    });
  }

  if (els.clearMarks) {
    els.clearMarks.addEventListener("click", () => {
      if (!isVenueMarksMode()) return;
      if (!state.venue || !state.venue.marks.length) return;
      const confirmed = window.confirm("Clear all marks?");
      if (!confirmed) return;
      const removedIds = new Set(state.venue.marks.map((mark) => mark.id));
      state.venue.marks = [];
      pruneRoutesForVenue(state.venue.id, removedIds);
      pruneLinesForVenue(state.venue.id, removedIds);
      saveData();
      state.selectedMarkId = null;
      state.selectedLineId = null;
      closeMarkEditModal();
      closeLineEditModal();
      closeMarkListModal();
      closeLineListModal();
      renderMarkList();
      renderLineList();
      updateMapOverlays();
    });
  }

  if (els.mapMarkName) {
    els.mapMarkName.addEventListener("input", () => {
      const mark = getSelectedMark();
      if (!mark || !isVenueMarksMode()) return;
      const name = els.mapMarkName.value.trim();
      mark.name = name || mark.name || "Mark";
      saveData();
      renderMarkList();
      updateMapOverlays();
    });
  }

  if (els.mapMarkDesc) {
    els.mapMarkDesc.addEventListener("input", () => {
      const mark = getSelectedMark();
      if (!mark || !isVenueMarksMode()) return;
      mark.description = els.mapMarkDesc.value.trim();
      saveData();
      renderMarkList();
      updateMapOverlays();
    });
  }

  if (els.deleteMark) {
    els.deleteMark.addEventListener("click", () => {
      if (!isVenueMarksMode()) return;
      const mark = getSelectedMark();
      if (!mark || !state.venue) return;
      const confirmed = window.confirm(`Delete \"${mark.name}\"?`);
      if (!confirmed) return;
      state.venue.marks = state.venue.marks.filter((item) => item.id !== mark.id);
      const removedIds = new Set([mark.id]);
      pruneRoutesForVenue(state.venue.id, removedIds);
      pruneLinesForVenue(state.venue.id, removedIds);
      saveData();
      state.selectedMarkId = null;
      closeMarkEditModal();
      renderMarkList();
      renderLineList();
      updateMapOverlays();
      updateModeUi();
    });
  }

  if (els.markAddRoute) {
    els.markAddRoute.addEventListener("click", () => {
      if (!isRouteMode()) return;
      if (!hasRouteStartLine()) {
        window.alert("Select a start line first.");
        return;
      }
      const mark = getSelectedMark();
      if (!mark) return;
      addRouteMark(mark, { recordClick: false });
    });
  }

  if (els.undoRoute) {
    els.undoRoute.addEventListener("click", () => {
      if (!isRouteMode()) return;
      const syncRace = shouldSyncRaceRouteFromDefault();
      const route = ensureRouteEntries();
      if (!route || !route.length) return;
      route.pop();
      lastRouteClick = null;
      if (!isVenueSetupMode()) {
        syncVenueDefaultRoute();
      } else if (syncRace) {
        syncRaceRouteFromDefault();
      }
      saveData();
      updateMapOverlays();
      syncRouteButtons();
    });
  }

  if (els.clearRoute) {
    els.clearRoute.addEventListener("click", () => {
      if (!isRouteMode()) return;
      const syncRace = shouldSyncRaceRouteFromDefault();
      const route = ensureRouteEntries();
      if (!route || !route.length) return;
      const confirmed = window.confirm("Clear course?");
      if (!confirmed) return;
      if (isVenueSetupMode()) {
        state.venue.defaultRoute = [];
      } else if (state.race) {
        state.race.route = [];
        syncVenueDefaultRoute();
      }
      lastRouteClick = null;
      if (isVenueSetupMode() && syncRace) {
        syncRaceRouteFromDefault();
      }
      saveData();
      updateMapOverlays();
      syncRouteButtons();
    });
  }

  if (els.openMarkList) {
    els.openMarkList.addEventListener("click", () => {
      openMarkListModal();
    });
  }

  if (els.openLineList) {
    els.openLineList.addEventListener("click", () => {
      openLineListModal();
    });
  }

  if (els.clearLineSelection) {
    els.clearLineSelection.addEventListener("click", () => {
      clearLineSelection();
    });
  }

  if (els.tabMarks) {
    els.tabMarks.addEventListener("click", () => {
      setVenueStep(VENUE_STEPS.MARKS);
    });
  }

  if (els.tabLines) {
    els.tabLines.addEventListener("click", () => {
      if (els.tabLines.disabled) return;
      setVenueStep(VENUE_STEPS.LINES);
    });
  }

  if (els.tabRoute) {
    els.tabRoute.addEventListener("click", () => {
      if (els.tabRoute.disabled) return;
      setVenueStep(VENUE_STEPS.ROUTE);
    });
  }

  if (els.closeMarkList) {
    els.closeMarkList.addEventListener("click", () => {
      closeMarkListModal();
    });
  }

  if (els.closeMarkEdit) {
    els.closeMarkEdit.addEventListener("click", () => {
      closeMarkEditModal();
    });
  }

  if (els.closeLineList) {
    els.closeLineList.addEventListener("click", () => {
      closeLineListModal();
    });
  }

  if (els.closeLineEdit) {
    els.closeLineEdit.addEventListener("click", () => {
      closeLineEditModal();
    });
  }

  if (els.lineName) {
    els.lineName.addEventListener("input", () => {
      if (!isLineEditMode()) return;
      const line = getSelectedLine();
      if (!line) return;
      line.name = els.lineName.value.trim();
      saveData();
      updateLineEditUi();
      renderLineList();
      updateMapOverlays();
    });
  }

  const toggleLineRole = (roleKey) => {
    if (!isLineEditMode()) return;
    const line = getSelectedLine();
    if (!line) return;
    const roles = getLineRoles(line);
    const next = { ...roles, [roleKey]: !roles[roleKey] };
    if (!next.start && !next.finish) return;
    line.roles = next;
    saveData();
    updateLineEditUi();
    renderLineList();
    updateMapOverlays();
  };

  if (els.lineRoleStart) {
    els.lineRoleStart.addEventListener("click", () => {
      toggleLineRole("start");
    });
  }

  if (els.lineRoleFinish) {
    els.lineRoleFinish.addEventListener("click", () => {
      toggleLineRole("finish");
    });
  }

  if (els.swapLineDirection) {
    els.swapLineDirection.addEventListener("click", () => {
      if (!isLineEditMode()) return;
      swapLineDirection();
    });
  }

  if (els.trimLine) {
    els.trimLine.addEventListener("click", () => {
      if (!isLineEditMode()) return;
      const line = getSelectedLine();
      if (!line) return;
      if (state.trimMode) {
        setTrimMode(false);
        updateLineEditUi();
        return;
      }
      closeLineEditModal();
      setTrimMode(true);
    });
  }

  if (els.swapTrimSide) {
    els.swapTrimSide.addEventListener("click", () => {
      if (!isLineEditMode()) return;
      swapTrimSide();
    });
  }

  if (els.deleteLine) {
    els.deleteLine.addEventListener("click", () => {
      if (!isLineEditMode()) return;
      deleteSelectedLine();
    });
  }

  if (els.mapToVenue) {
    els.mapToVenue.addEventListener("click", () => {
      window.location.href = getMapHref(MODES.VENUE_MARKS);
    });
  }

  if (els.markListModal) {
    els.markListModal.addEventListener("click", (event) => {
      if (event.target === els.markListModal) {
        closeMarkListModal();
      }
    });
  }

  if (els.markEditModal) {
    els.markEditModal.addEventListener("click", (event) => {
      if (event.target === els.markEditModal) {
        closeMarkEditModal();
      }
    });
  }

  if (els.lineListModal) {
    els.lineListModal.addEventListener("click", (event) => {
      if (event.target === els.lineListModal) {
        closeLineListModal();
      }
    });
  }

  if (els.lineEditModal) {
    els.lineEditModal.addEventListener("click", (event) => {
      if (event.target === els.lineEditModal) {
        closeLineEditModal();
      }
    });
  }

  if (els.closeMap) {
    els.closeMap.addEventListener("click", () => {
      window.location.href = buildReturnHref();
    });
  }

  const close = (event) => {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }
    window.location.href = buildReturnHref();
  };
  if (els.closeMap) {
    els.closeMap.addEventListener("touchend", close, { passive: false });
    els.closeMap.addEventListener("pointerup", close);
  }
}

const DEBUG = new URLSearchParams(window.location.search).get("debug") === "true";
if (DEBUG) {
  window.__raceTimerMap = {
    getRouteLineIds: () => getRouteLineIds(),
    getRouteLatLngs: () => getRouteLatLngs(),
  };
}

loadData();
updateModeUi();
initMap();
bindEvents();
