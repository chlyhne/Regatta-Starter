import { loadSettings as loadSettingsFromStorage, saveSettings as saveSettingsToStorage } from "./core/settings.js";
import { toMeters, fromMeters } from "./core/geo.js";

const NO_CACHE_KEY = "racetimer-nocache";

const DEFAULT_CENTER = { lat: 55.0, lon: 12.0 };

const els = {
  mapTitle: document.getElementById("map-title"),
  setA: document.getElementById("set-map-a"),
  setB: document.getElementById("set-map-b"),
  swap: document.getElementById("swap-map"),
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
  arrowOutlineLine: null,
  arrowOutlineHead: null,
  arrowLabel: null,
  arrowLabelHalfDiagonalPx: null,
  line: {
    a: { lat: null, lon: null },
    b: { lat: null, lon: null },
  },
  sessionSet: {
    a: false,
    b: false,
  },
};

function getArrowLabelHalfDiagonalPx() {
  if (Number.isFinite(state.arrowLabelHalfDiagonalPx)) {
    return state.arrowLabelHalfDiagonalPx;
  }
  const probe = document.createElement("div");
  probe.className = "map-arrow-label";
  probe.textContent = "Sail this way";
  probe.style.position = "absolute";
  probe.style.left = "-9999px";
  probe.style.top = "-9999px";
  probe.style.visibility = "hidden";
  document.body.appendChild(probe);
  const rect = probe.getBoundingClientRect();
  probe.remove();
  const halfDiag = Math.hypot(rect.width / 2, rect.height / 2);
  state.arrowLabelHalfDiagonalPx = halfDiag;
  return halfDiag;
}

function getMetersPerPixel(latlng) {
  if (!state.map || typeof L === "undefined") return null;
  const point = state.map.latLngToContainerPoint(latlng);
  const deltaPx = 50;
  const point2 = L.point(point.x + deltaPx, point.y);
  const latlng2 = state.map.containerPointToLatLng(point2);
  const meters = state.map.distance(latlng, latlng2);
  if (!Number.isFinite(meters) || meters <= 0) return null;
  return meters / deltaPx;
}

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

function getNoCacheQuery() {
  const params = new URLSearchParams(window.location.search);
  const token = params.get("nocache") || sessionStorage.getItem(NO_CACHE_KEY);
  if (!token) return "";
  sessionStorage.setItem(NO_CACHE_KEY, token);
  return `?nocache=${encodeURIComponent(token)}`;
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

  state.map.createPane("arrowPane");
  state.map.createPane("linePane");
  state.map.createPane("markPane");
  state.map.getPane("arrowPane").style.zIndex = "380";
  state.map.getPane("linePane").style.zIndex = "390";
  state.map.getPane("markPane").style.zIndex = "400";
  state.map.getPane("arrowPane").style.pointerEvents = "none";
  state.map.getPane("linePane").style.pointerEvents = "none";
  state.map.getPane("markPane").style.pointerEvents = "none";

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
    const portStyle = {
      radius: 8,
      color: "#000000",
      weight: 2,
      fillColor: "#d62020",
      fillOpacity: 1,
      interactive: false,
      pane: "markPane",
    };
    if (!state.markerA) {
      state.markerA = L.circleMarker(
        [state.line.a.lat, state.line.a.lon],
        portStyle
      ).addTo(state.map);
    } else {
      state.markerA.setLatLng([state.line.a.lat, state.line.a.lon]);
      state.markerA.setStyle(portStyle);
    }
  } else if (state.markerA) {
    state.map.removeLayer(state.markerA);
    state.markerA = null;
  }

  if (hasB) {
    const starboardStyle = {
      radius: 8,
      color: "#000000",
      weight: 2,
      fillColor: "#10a64a",
      fillOpacity: 1,
      interactive: false,
      pane: "markPane",
    };
    if (!state.markerB) {
      state.markerB = L.circleMarker(
        [state.line.b.lat, state.line.b.lon],
        starboardStyle
      ).addTo(state.map);
    } else {
      state.markerB.setLatLng([state.line.b.lat, state.line.b.lon]);
      state.markerB.setStyle(starboardStyle);
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
      const arrowLength = Math.min(180, Math.max(45, lineLen * 0.75));
      const headLength = Math.min(54, Math.max(24, arrowLength * 0.4));
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
      const labelPoint = {
        x: tip.x + normal.x * (headLength * 0.9),
        y: tip.y + normal.y * (headLength * 0.9),
      };
      const midLatLng = fromMeters(mid, origin);
      const metersPerPixel = getMetersPerPixel(L.latLng(midLatLng.lat, midLatLng.lon));
      const halfDiagPx = getArrowLabelHalfDiagonalPx();
      const marginPx = 8;
      const extraMeters =
        Number.isFinite(metersPerPixel) && Number.isFinite(halfDiagPx)
          ? metersPerPixel * (halfDiagPx + marginPx)
          : 6;
      const safeLabelPoint = {
        x: labelPoint.x + normal.x * extraMeters,
        y: labelPoint.y + normal.y * extraMeters,
      };
      const labelLatLng = fromMeters(safeLabelPoint, origin);
      const arrowWeight = 6;
      const outlineColor = "#ffffff";
      const outlineWeight = arrowWeight + 2;
      const outlineOpacity = 1;
      if (!state.arrowOutlineLine) {
        state.arrowOutlineLine = L.polyline(stemLatLngs, {
          color: outlineColor,
          weight: outlineWeight,
          opacity: outlineOpacity,
          pane: "arrowPane",
        }).addTo(state.map);
      } else {
        state.arrowOutlineLine.setLatLngs(stemLatLngs);
      }
      if (!state.arrowOutlineHead) {
        state.arrowOutlineHead = L.polygon(headLatLngs, {
          color: outlineColor,
          fillColor: outlineColor,
          weight: 2,
          fillOpacity: outlineOpacity,
          pane: "arrowPane",
        }).addTo(state.map);
      } else {
        state.arrowOutlineHead.setLatLngs(headLatLngs);
      }
      if (!state.arrowLine) {
        state.arrowLine = L.polyline(stemLatLngs, {
          color: "#000000",
          weight: arrowWeight,
          opacity: 0.9,
          pane: "arrowPane",
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
          pane: "arrowPane",
        }).addTo(state.map);
      } else {
        state.arrowHead.setLatLngs(headLatLngs);
      }
      if (!state.arrowLabel) {
        state.arrowLabel = L.marker([labelLatLng.lat, labelLatLng.lon], {
          icon: L.divIcon({
            className: "map-arrow-label",
            html: "Sail this way",
            iconSize: [1, 1],
            iconAnchor: [0, 0],
          }),
          pane: "arrowPane",
          interactive: false,
        }).addTo(state.map);
      } else {
        state.arrowLabel.setLatLng([labelLatLng.lat, labelLatLng.lon]);
      }
    } else {
      if (state.arrowOutlineLine) {
        state.map.removeLayer(state.arrowOutlineLine);
        state.arrowOutlineLine = null;
      }
      if (state.arrowOutlineHead) {
        state.map.removeLayer(state.arrowOutlineHead);
        state.arrowOutlineHead = null;
      }
      if (state.arrowLine) {
        state.map.removeLayer(state.arrowLine);
        state.arrowLine = null;
      }
      if (state.arrowHead) {
        state.map.removeLayer(state.arrowHead);
        state.arrowHead = null;
      }
      if (state.arrowLabel) {
        state.map.removeLayer(state.arrowLabel);
        state.arrowLabel = null;
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
        pane: "linePane",
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
    if (state.arrowOutlineLine) {
      state.map.removeLayer(state.arrowOutlineLine);
      state.arrowOutlineLine = null;
    }
    if (state.arrowOutlineHead) {
      state.map.removeLayer(state.arrowOutlineHead);
      state.arrowOutlineHead = null;
    }
    if (state.arrowHead) {
      state.map.removeLayer(state.arrowHead);
      state.arrowHead = null;
    }
    if (state.arrowLabel) {
      state.map.removeLayer(state.arrowLabel);
      state.arrowLabel = null;
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
    window.location.href = `index.html${getNoCacheQuery()}#setup`;
  });

  const close = (event) => {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }
    window.location.href = `index.html${getNoCacheQuery()}#setup`;
  };
  els.closeMap.addEventListener("touchend", close, { passive: false });
  els.closeMap.addEventListener("pointerup", close);

  if (els.swap) {
    els.swap.addEventListener("click", () => {
      const nextA = { ...state.line.b };
      const nextB = { ...state.line.a };
      state.line.a = nextA;
      state.line.b = nextB;
      const nextSetA = state.sessionSet.b;
      const nextSetB = state.sessionSet.a;
      state.sessionSet.a = nextSetA;
      state.sessionSet.b = nextSetB;
      saveSettings();
      updateSetButtons();
      updateMapOverlays();
      if (els.mapStatus) {
        els.mapStatus.textContent = "Marks swapped.";
      }
    });
  }
}

loadSettings();
initMap();
updateSetButtons();
bindEvents();
