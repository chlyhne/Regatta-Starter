import { loadSettings as loadSettingsFromStorage, saveSettings as saveSettingsToStorage } from "./settings.js";
import { toMeters, fromMeters } from "./geo.js";

const DEFAULT_CENTER = { lat: 55.0, lon: 12.0 };

const els = {
  mapTitle: document.getElementById("map-title"),
  setA: document.getElementById("set-map-a"),
  setB: document.getElementById("set-map-b"),
  closeMap: document.getElementById("close-map"),
  mapStatus: document.getElementById("map-status"),
};

const state = {
  map: null,
  markerA: null,
  markerB: null,
  lineOverlay: null,
  arrowLine: null,
  arrowHead: null,
  portIcon: null,
  starboardIcon: null,
  line: {
    a: { lat: null, lon: null },
    b: { lat: null, lon: null },
  },
  sessionSet: {
    a: false,
    b: false,
  },
};

function loadSettings() {
  const settings = loadSettingsFromStorage();
  if (settings.line) {
    state.line = settings.line;
  }
}

function saveSettings() {
  saveSettingsToStorage({
    line: state.line,
    lineMeta: { name: null, sourceId: null },
  });
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

  state.portIcon = L.divIcon({
    className: "map-mark map-mark-port",
    iconSize: [20, 20],
    iconAnchor: [10, 10],
  });
  state.starboardIcon = L.divIcon({
    className: "map-mark map-mark-starboard",
    iconSize: [20, 20],
    iconAnchor: [10, 10],
  });

  const tiles = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "&copy; OpenStreetMap contributors",
    maxZoom: 19,
  }).addTo(state.map);

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

function updateSetButtons() {
  const hasA = state.sessionSet.a;
  const hasB = state.sessionSet.b;
  if (els.setA) {
    els.setA.classList.toggle("set", hasA);
    els.setA.textContent = hasA ? "Set P ✓" : "Set P";
  }
  if (els.setB) {
    els.setB.classList.toggle("set", hasB);
    els.setB.textContent = hasB ? "Set SB ✓" : "Set SB";
  }
}

function updateMapOverlays() {
  if (!state.map) return;
  const hasA = Number.isFinite(state.line.a.lat) && Number.isFinite(state.line.a.lon);
  const hasB = Number.isFinite(state.line.b.lat) && Number.isFinite(state.line.b.lon);

  if (hasA) {
    if (!state.markerA) {
      state.markerA = L.marker([state.line.a.lat, state.line.a.lon], {
        icon: state.portIcon,
        interactive: false,
      }).addTo(state.map);
    } else {
      state.markerA.setLatLng([state.line.a.lat, state.line.a.lon]);
      state.markerA.setIcon(state.portIcon);
    }
  } else if (state.markerA) {
    state.map.removeLayer(state.markerA);
    state.markerA = null;
  }

  if (hasB) {
    if (!state.markerB) {
      state.markerB = L.marker([state.line.b.lat, state.line.b.lon], {
        icon: state.starboardIcon,
        interactive: false,
      }).addTo(state.map);
    } else {
      state.markerB.setLatLng([state.line.b.lat, state.line.b.lon]);
      state.markerB.setIcon(state.starboardIcon);
    }
  } else if (state.markerB) {
    state.map.removeLayer(state.markerB);
    state.markerB = null;
  }

  if (hasA && hasB) {
    const origin = {
      lat: (state.line.a.lat + state.line.b.lat) / 2,
      lon: (state.line.a.lon + state.line.b.lon) / 2,
    };
    const pointA = toMeters(state.line.a, origin);
    const pointB = toMeters(state.line.b, origin);
    const lineVec = { x: pointB.x - pointA.x, y: pointB.y - pointA.y };
    const lineLen = Math.hypot(lineVec.x, lineVec.y);
    if (lineLen >= 1) {
      const normal = { x: -lineVec.y / lineLen, y: lineVec.x / lineLen };
      const tangent = { x: lineVec.x / lineLen, y: lineVec.y / lineLen };
      const mid = { x: (pointA.x + pointB.x) / 2, y: (pointA.y + pointB.y) / 2 };
      const arrowLength = Math.min(60, Math.max(15, lineLen * 0.25));
      const headLength = Math.min(18, Math.max(8, arrowLength * 0.4));
      const headWidth = headLength * 0.9;
      const tip = {
        x: mid.x + normal.x * arrowLength,
        y: mid.y + normal.y * arrowLength,
      };
      const base = {
        x: tip.x - normal.x * headLength,
        y: tip.y - normal.y * headLength,
      };
      const left = {
        x: base.x + tangent.x * (headWidth / 2),
        y: base.y + tangent.y * (headWidth / 2),
      };
      const right = {
        x: base.x - tangent.x * (headWidth / 2),
        y: base.y - tangent.y * (headWidth / 2),
      };
      const stemLatLngs = [
        fromMeters(mid, origin),
        fromMeters(base, origin),
      ];
      const headLatLngs = [
        fromMeters(tip, origin),
        fromMeters(left, origin),
        fromMeters(right, origin),
      ];
      if (!state.arrowLine) {
        state.arrowLine = L.polyline(stemLatLngs, {
          color: "#000000",
          weight: 3,
          opacity: 0.9,
        }).addTo(state.map);
      } else {
        state.arrowLine.setLatLngs(stemLatLngs);
      }
      if (!state.arrowHead) {
        state.arrowHead = L.polygon(headLatLngs, {
          color: "#000000",
          fillColor: "#000000",
          weight: 1,
          fillOpacity: 0.9,
        }).addTo(state.map);
      } else {
        state.arrowHead.setLatLngs(headLatLngs);
      }
    } else {
      if (state.arrowLine) {
        state.map.removeLayer(state.arrowLine);
        state.arrowLine = null;
      }
      if (state.arrowHead) {
        state.map.removeLayer(state.arrowHead);
        state.arrowHead = null;
      }
    }

    const latlngs = [
      [state.line.a.lat, state.line.a.lon],
      [state.line.b.lat, state.line.b.lon],
    ];
    if (!state.lineOverlay) {
      state.lineOverlay = L.polyline(latlngs, {
        color: "#0f6bff",
        weight: 4,
      }).addTo(state.map);
    } else {
      state.lineOverlay.setLatLngs(latlngs);
    }
  } else {
    if (state.lineOverlay) {
      state.map.removeLayer(state.lineOverlay);
      state.lineOverlay = null;
    }
    if (state.arrowLine) {
      state.map.removeLayer(state.arrowLine);
      state.arrowLine = null;
    }
    if (state.arrowHead) {
      state.map.removeLayer(state.arrowHead);
      state.arrowHead = null;
    }
  }
}

window.addEventListener("resize", () => {
  if (state.map) {
    state.map.invalidateSize();
  }
});

function bindEvents() {
  els.setA.addEventListener("click", () => {
    if (!state.map) return;
    const center = state.map.getCenter();
    state.line.a = { lat: center.lat, lon: center.lng };
    state.sessionSet.a = true;
    saveSettings();
    updateSetButtons();
    updateMapOverlays();
    if (els.mapStatus) {
      els.mapStatus.textContent =
        "Port mark set. You can now set starboard mark or press Done.";
    }
  });

  els.setB.addEventListener("click", () => {
    if (!state.map) return;
    const center = state.map.getCenter();
    state.line.b = { lat: center.lat, lon: center.lng };
    state.sessionSet.b = true;
    saveSettings();
    updateSetButtons();
    updateMapOverlays();
    if (els.mapStatus) {
      els.mapStatus.textContent =
        "Starboard mark set. You can now set port mark or press Done.";
    }
  });

  els.closeMap.addEventListener("click", () => {
    window.location.href = "index.html#setup";
  });
}

loadSettings();
initMap();
updateSetButtons();
bindEvents();
