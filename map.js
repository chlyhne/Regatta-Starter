const STORAGE_KEY = "racetimer-settings";
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
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (parsed.line) {
      state.line = parsed.line;
    }
  } catch (err) {
    console.warn("Failed to load settings", err);
  }
}

function saveSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    parsed.line = state.line;
    parsed.lineMeta = { name: null, sourceId: null };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed));
  } catch (err) {
    console.warn("Failed to save settings", err);
  }
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
      state.markerA = L.marker([state.line.a.lat, state.line.a.lon]).addTo(state.map);
    } else {
      state.markerA.setLatLng([state.line.a.lat, state.line.a.lon]);
    }
  } else if (state.markerA) {
    state.map.removeLayer(state.markerA);
    state.markerA = null;
  }

  if (hasB) {
    if (!state.markerB) {
      state.markerB = L.marker([state.line.b.lat, state.line.b.lon]).addTo(state.map);
    } else {
      state.markerB.setLatLng([state.line.b.lat, state.line.b.lon]);
    }
  } else if (state.markerB) {
    state.map.removeLayer(state.markerB);
    state.markerB = null;
  }

  if (hasA && hasB) {
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
  } else if (state.lineOverlay) {
    state.map.removeLayer(state.lineOverlay);
    state.lineOverlay = null;
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
