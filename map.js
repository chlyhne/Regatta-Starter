import { loadSettings as loadSettingsFromStorage } from "./core/settings.js";
import {
  loadVenues,
  saveVenues,
  loadRaces,
  saveRaces,
  createVenue,
  createRace,
  getVenueById,
  getRaceById,
  MARK_ROLES,
  getStartLineFromVenue,
  getFinishLineFromVenue,
} from "./core/venues.js";

const NO_CACHE_KEY = "racetimer-nocache";
const DEFAULT_CENTER = { lat: 55.0, lon: 12.0 };

const els = {
  mapTitle: document.getElementById("map-title"),
  mapModeVenue: document.getElementById("map-mode-venue"),
  mapModeRace: document.getElementById("map-mode-race"),
  mapToVenue: document.getElementById("map-to-venue"),
  openMarkList: document.getElementById("open-mark-list"),
  markListModal: document.getElementById("mark-list-modal"),
  closeMarkList: document.getElementById("close-mark-list"),
  markEditModal: document.getElementById("mark-edit-modal"),
  closeMarkEdit: document.getElementById("close-mark-edit"),
  markEditTitle: document.getElementById("mark-edit-title"),
  addMark: document.getElementById("add-course-mark"),
  undoMark: document.getElementById("undo-course-mark"),
  clearMarks: document.getElementById("clear-course-marks"),
  markAddRoute: document.getElementById("mark-add-route"),
  closeMap: document.getElementById("close-map"),
  mapStatus: document.getElementById("map-status"),
  mapCaption: document.getElementById("map-caption"),
  mapMarkName: document.getElementById("map-mark-name"),
  mapMarkDesc: document.getElementById("map-mark-desc"),
  mapRoleButtons: Array.from(document.querySelectorAll(".map-role")),
  deleteMark: document.getElementById("delete-mark"),
  mapMarkList: document.getElementById("map-mark-list"),
  undoRoute: document.getElementById("undo-route-mark"),
  clearRoute: document.getElementById("clear-route"),
};

const state = {
  map: null,
  venues: [],
  races: [],
  venue: null,
  race: null,
  editMode: "race",
  selectedMarkId: null,
  markMarkers: [],
  labelMarkers: [],
  startLine: null,
  finishLine: null,
  routeLine: null,
};

function getNoCacheQuery() {
  const params = new URLSearchParams(window.location.search);
  const token = params.get("nocache") || sessionStorage.getItem(NO_CACHE_KEY);
  if (!token) return "";
  sessionStorage.setItem(NO_CACHE_KEY, token);
  return `?nocache=${encodeURIComponent(token)}`;
}

function normalizeEditMode(value) {
  return value === "race" ? "race" : "venue";
}

function getInitialEditMode() {
  const params = new URLSearchParams(window.location.search);
  const queryMode = params.get("mode");
  if (queryMode) {
    return normalizeEditMode(queryMode);
  }
  return "race";
}

function loadData() {
  const settings = loadSettingsFromStorage();
  const venues = loadVenues();
  const races = loadRaces();

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

  state.venues = venues;
  state.races = races;
  state.venue = venue;
  state.race = race;
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

function syncVenueDefaultRoute() {
  if (!state.venue || !state.race) return;
  const route = Array.isArray(state.race.route) ? state.race.route : [];
  state.venue.defaultRoute = route.map((entry) => ({ ...entry }));
}

function getSelectedMark() {
  if (!state.venue || !state.selectedMarkId) return null;
  return state.venue.marks.find((mark) => mark.id === state.selectedMarkId) || null;
}

function roleLabel(role) {
  switch (role) {
    case MARK_ROLES.START_PORT:
      return "Start P";
    case MARK_ROLES.START_STARBOARD:
      return "Start SB";
    case MARK_ROLES.FINISH_PORT:
      return "Finish P";
    case MARK_ROLES.FINISH_STARBOARD:
      return "Finish SB";
    default:
      return "Mark";
  }
}

function setModalOpen(modal, isOpen) {
  if (!modal) return;
  modal.setAttribute("aria-hidden", isOpen ? "false" : "true");
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

function setEditMode(mode) {
  const normalized = normalizeEditMode(mode);
  state.editMode = normalized;
  document.body.dataset.mapMode = normalized;
  if (els.mapModeVenue) {
    els.mapModeVenue.setAttribute(
      "aria-pressed",
      normalized === "venue" ? "true" : "false"
    );
  }
  if (els.mapModeRace) {
    els.mapModeRace.setAttribute(
      "aria-pressed",
      normalized === "race" ? "true" : "false"
    );
  }
  if (els.mapTitle) {
    els.mapTitle.textContent = normalized === "race" ? "Race route" : "Venue marks";
  }
  if (els.mapCaption) {
    els.mapCaption.textContent =
      normalized === "race"
        ? "Tap a mark, then add it to the route."
        : "Drag the map. Add marks on the crosshair, then tap a mark to edit.";
  }
  syncRoleButtons();
  syncRouteButtons();
  updateMarkEditUi();
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
  syncRoleButtons();
  updateMarkEditUi();
  renderMarkList();
  syncRouteButtons();
}

function clearSelection() {
  state.selectedMarkId = null;
  if (els.mapMarkName) {
    els.mapMarkName.value = "";
    els.mapMarkName.placeholder = `Mark ${state.venue?.marks.length + 1 || 1}`;
  }
  if (els.mapMarkDesc) {
    els.mapMarkDesc.value = "";
  }
  syncRoleButtons();
  updateMarkEditUi();
  renderMarkList();
  syncRouteButtons();
}

function syncRoleButtons() {
  const mark = getSelectedMark();
  const role = mark ? mark.role : null;
  const isVenueMode = state.editMode === "venue";
  els.mapRoleButtons.forEach((button) => {
    const buttonRole = button.dataset.role || "none";
    const selected = role === buttonRole || (!role && buttonRole === "none");
    button.classList.toggle("selected", Boolean(mark) && selected);
    button.disabled = !mark || !isVenueMode;
  });
  if (els.deleteMark) {
    els.deleteMark.disabled = !mark || !isVenueMode;
  }
}

function syncRouteButtons() {
  const mark = getSelectedMark();
  if (els.markAddRoute) {
    const canAdd =
      state.editMode === "race" &&
      Boolean(mark) &&
      (!mark.role || mark.role === MARK_ROLES.NONE);
    els.markAddRoute.disabled = !canAdd;
  }
  const routeLength = state.race?.route?.length || 0;
  if (els.undoRoute) {
    els.undoRoute.disabled = state.editMode !== "race" || routeLength === 0;
  }
  if (els.clearRoute) {
    els.clearRoute.disabled = state.editMode !== "race" || routeLength === 0;
  }
}

function updateMarkEditUi() {
  const mark = getSelectedMark();
  const isVenueMode = state.editMode === "venue";
  if (els.mapMarkName) {
    els.mapMarkName.disabled = !isVenueMode || !mark;
  }
  if (els.mapMarkDesc) {
    els.mapMarkDesc.disabled = !isVenueMode || !mark;
  }
  if (els.markEditTitle) {
    els.markEditTitle.textContent = mark ? `Edit ${mark.name}` : "Edit mark";
  }
  if (els.mapToVenue) {
    els.mapToVenue.hidden = isVenueMode;
  }
  if (els.markAddRoute) {
    els.markAddRoute.hidden = isVenueMode;
  }
  if (els.deleteMark) {
    els.deleteMark.hidden = !isVenueMode;
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

function assignRole(mark, role) {
  if (!mark || !state.venue) return;
  const normalizedRole = role || MARK_ROLES.NONE;
  if (normalizedRole !== MARK_ROLES.NONE) {
    state.venue.marks.forEach((other) => {
      if (other.id !== mark.id && other.role === normalizedRole) {
        other.role = MARK_ROLES.NONE;
      }
    });
  }
  mark.role = normalizedRole;

  if (normalizedRole !== MARK_ROLES.NONE) {
    const removed = new Set([mark.id]);
    pruneRoutesForVenue(state.venue.id, removed);
  }
}

function updateSelectedMarkFromInputs() {
  const mark = getSelectedMark();
  if (state.editMode !== "venue") return;
  if (!mark) return;
  if (els.mapMarkName) {
    const name = els.mapMarkName.value.trim();
    mark.name = name || mark.name || "Mark";
  }
  if (els.mapMarkDesc) {
    mark.description = els.mapMarkDesc.value.trim();
  }
  saveData();
  updateMarkEditUi();
  renderMarkList();
  renderCourseList();
  updateMapOverlays();
}

function getRouteLatLngs() {
  if (!state.race) return [];
  const marksById = new Map(
    (state.venue?.marks || []).map((mark) => [mark.id, mark])
  );
  return (state.race.route || [])
    .map((entry) => marksById.get(entry.markId))
    .filter(Boolean)
    .map((mark) => [mark.lat, mark.lon]);
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
    const roleSpan = document.createElement("span");
    roleSpan.className = "map-mark-role";
    roleSpan.textContent = roleLabel(mark.role);
    item.appendChild(nameSpan);
    item.appendChild(roleSpan);
    item.addEventListener("click", () => {
      closeMarkListModal();
      openMarkEditModal(mark.id);
    });
    els.mapMarkList.appendChild(item);
  });
}

function renderCourseList() {
  if (!els.mapCourseList) return;
  els.mapCourseList.innerHTML = "";
  const route = state.race?.route || [];
  if (!route.length) {
    els.mapCourseList.textContent = "No course yet.";
    return;
  }
  const marksById = new Map(
    (state.venue?.marks || []).map((mark) => [mark.id, mark])
  );
  route.forEach((entry) => {
    const mark = marksById.get(entry.markId);
    if (!mark) return;
    const chip = document.createElement("span");
    chip.className = "map-course-chip";
    if (entry.rounding === "starboard") {
      chip.classList.add("starboard");
    } else if (entry.rounding === "port") {
      chip.classList.add("port");
    }
    chip.textContent = mark.name;
    els.mapCourseList.appendChild(chip);
  });
}

function updateMapOverlays() {
  if (!state.map || typeof L === "undefined") return;

  state.markMarkers.forEach((marker) => state.map.removeLayer(marker));
  state.labelMarkers.forEach((marker) => state.map.removeLayer(marker));
  state.markMarkers = [];
  state.labelMarkers = [];

  if (state.startLine) {
    state.map.removeLayer(state.startLine);
    state.startLine = null;
  }
  if (state.finishLine) {
    state.map.removeLayer(state.finishLine);
    state.finishLine = null;
  }
  if (state.routeLine) {
    state.map.removeLayer(state.routeLine);
    state.routeLine = null;
  }

  const marks = state.venue?.marks || [];
  marks.forEach((mark) => {
    const role = mark.role;
    const isPort = role === MARK_ROLES.START_PORT || role === MARK_ROLES.FINISH_PORT;
    const isStarboard =
      role === MARK_ROLES.START_STARBOARD || role === MARK_ROLES.FINISH_STARBOARD;
    const stroke = isPort ? "#d62828" : isStarboard ? "#1b7f3a" : "#000000";
    const fill = isPort ? "#ffffff" : isStarboard ? "#ffffff" : "#ffffff";
    const marker = L.circleMarker([mark.lat, mark.lon], {
      radius: 7,
      color: stroke,
      weight: 2,
      fillColor: fill,
      fillOpacity: 1,
      interactive: true,
      pane: "markPane",
    }).addTo(state.map);
    marker.on("click", () => {
      openMarkEditModal(mark.id);
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

  const startLine = getStartLineFromVenue(state.venue, state.race);
  if (startLine) {
    state.startLine = L.polyline(
      [
        [startLine.a.lat, startLine.a.lon],
        [startLine.b.lat, startLine.b.lon],
      ],
      { color: "#000000", weight: 4, opacity: 1, interactive: false }
    ).addTo(state.map);
  }

  const finishLine = getFinishLineFromVenue(state.venue, state.race);
  if (finishLine) {
    state.finishLine = L.polyline(
      [
        [finishLine.a.lat, finishLine.a.lon],
        [finishLine.b.lat, finishLine.b.lon],
      ],
      { color: "#000000", weight: 3, opacity: 1, dashArray: "8 6", interactive: false }
    ).addTo(state.map);
  }

  const route = getRouteLatLngs();
  if (route.length >= 2) {
    state.routeLine = L.polyline(route, {
      color: "#0f6bff",
      weight: 3,
      opacity: 0.9,
      interactive: false,
    }).addTo(state.map);
  }
}

function updateUi() {
  setEditMode(state.editMode);
  if (els.addMark) {
    els.addMark.hidden = false;
  }
  if (els.undoMark) {
    els.undoMark.hidden = false;
  }
  if (els.clearMarks) {
    els.clearMarks.hidden = false;
  }
  renderMarkList();
  renderCourseList();
  syncRoleButtons();
  syncRouteButtons();
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

  state.map.createPane("markPane");
  const markPane = state.map.getPane("markPane");
  if (markPane) {
    markPane.style.zIndex = "350";
  }
  state.map.createPane("labelPane");
  const labelPane = state.map.getPane("labelPane");
  if (labelPane) {
    labelPane.style.zIndex = "360";
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
    if (els.mapStatus) {
      els.mapStatus.textContent = "Tiles loaded";
    }
  });

  tiles.on("tileerror", () => {
    if (els.mapStatus) {
      els.mapStatus.textContent = "Tile load error (check internet)";
    }
  });

  if (navigator.geolocation) {
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
  if (els.mapModeVenue) {
    els.mapModeVenue.addEventListener("click", () => {
      setEditMode("venue");
    });
  }
  if (els.mapModeRace) {
    els.mapModeRace.addEventListener("click", () => {
      setEditMode("race");
    });
  }
  if (els.mapToVenue) {
    els.mapToVenue.addEventListener("click", () => {
      setEditMode("venue");
    });
  }
  if (els.openMarkList) {
    els.openMarkList.addEventListener("click", () => {
      openMarkListModal();
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

  if (els.addMark) {
    els.addMark.addEventListener("click", () => {
      if (!state.map || !state.venue) return;
      if (state.editMode !== "venue") return;
      const center = state.map.getCenter();
      const name = `Mark ${state.venue.marks.length + 1}`;
      const mark = {
        id: `mark-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        name,
        description: "",
        lat: center.lat,
        lon: center.lng,
        role: MARK_ROLES.NONE,
      };
      state.venue.marks.push(mark);
      saveData();
      clearSelection();
      updateMapOverlays();
    });
  }

  if (els.undoMark) {
    els.undoMark.addEventListener("click", () => {
      if (state.editMode !== "venue") return;
      if (!state.venue || !state.venue.marks.length) return;
      const removed = state.venue.marks.pop();
      if (removed && removed.id === state.selectedMarkId) {
        clearSelection();
      }
      pruneRoutesForVenue(state.venue.id, new Set([removed?.id]));
      saveData();
      renderMarkList();
      renderCourseList();
      updateMapOverlays();
    });
  }

  if (els.clearMarks) {
    els.clearMarks.addEventListener("click", () => {
      if (state.editMode !== "venue") return;
      if (!state.venue || !state.venue.marks.length) return;
      const confirmed = window.confirm("Clear all marks?");
      if (!confirmed) return;
      const removedIds = new Set(state.venue.marks.map((mark) => mark.id));
      state.venue.marks = [];
      pruneRoutesForVenue(state.venue.id, removedIds);
      saveData();
      clearSelection();
      closeMarkEditModal();
      closeMarkListModal();
      renderCourseList();
      updateMapOverlays();
    });
  }

  if (els.mapMarkName) {
    els.mapMarkName.addEventListener("input", () => {
      updateSelectedMarkFromInputs();
    });
  }

  if (els.mapMarkDesc) {
    els.mapMarkDesc.addEventListener("input", () => {
      updateSelectedMarkFromInputs();
    });
  }

  if (els.mapRoleButtons.length) {
    els.mapRoleButtons.forEach((button) => {
      button.addEventListener("click", () => {
        if (state.editMode !== "venue") return;
        const mark = getSelectedMark();
        if (!mark) return;
        const role = button.dataset.role || MARK_ROLES.NONE;
        assignRole(mark, role);
        saveData();
        renderMarkList();
        renderCourseList();
        syncRoleButtons();
        syncRouteButtons();
        updateMapOverlays();
      });
    });
  }

  if (els.deleteMark) {
    els.deleteMark.addEventListener("click", () => {
      if (state.editMode !== "venue") return;
      const mark = getSelectedMark();
      if (!mark || !state.venue) return;
      const confirmed = window.confirm(`Delete "${mark.name}"?`);
      if (!confirmed) return;
      state.venue.marks = state.venue.marks.filter((item) => item.id !== mark.id);
      pruneRoutesForVenue(state.venue.id, new Set([mark.id]));
      saveData();
      clearSelection();
      closeMarkEditModal();
      renderCourseList();
      updateMapOverlays();
    });
  }

  if (els.markAddRoute) {
    els.markAddRoute.addEventListener("click", () => {
      if (state.editMode !== "race") return;
      if (!state.race) return;
      const mark = getSelectedMark();
      if (!mark) return;
      if (mark.role && mark.role !== MARK_ROLES.NONE) {
        window.alert("Start/finish marks cannot be part of the route.");
        return;
      }
      if (!Array.isArray(state.race.route)) {
        state.race.route = [];
      }
      state.race.route.push({
        markId: mark.id,
        rounding: "port",
        manual: false,
      });
      syncVenueDefaultRoute();
      saveData();
      renderCourseList();
      updateMapOverlays();
      syncRouteButtons();
    });
  }

  if (els.undoRoute) {
    els.undoRoute.addEventListener("click", () => {
      if (state.editMode !== "race") return;
      if (!state.race || !Array.isArray(state.race.route) || !state.race.route.length) return;
      state.race.route.pop();
      syncVenueDefaultRoute();
      saveData();
      renderCourseList();
      updateMapOverlays();
      syncRouteButtons();
    });
  }

  if (els.clearRoute) {
    els.clearRoute.addEventListener("click", () => {
      if (state.editMode !== "race") return;
      if (!state.race || !Array.isArray(state.race.route) || !state.race.route.length) return;
      const confirmed = window.confirm("Clear route?");
      if (!confirmed) return;
      state.race.route = [];
      syncVenueDefaultRoute();
      saveData();
      renderCourseList();
      updateMapOverlays();
      syncRouteButtons();
    });
  }

  if (els.closeMap) {
    els.closeMap.addEventListener("click", () => {
      window.location.href = `index.html${getNoCacheQuery()}#setup`;
    });
  }

  const close = (event) => {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }
    window.location.href = `index.html${getNoCacheQuery()}#setup`;
  };
  if (els.closeMap) {
    els.closeMap.addEventListener("touchend", close, { passive: false });
    els.closeMap.addEventListener("pointerup", close);
  }
}

loadData();
state.editMode = getInitialEditMode();
updateUi();
initMap();
bindEvents();
