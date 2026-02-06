import { loadSettings as loadSettingsFromStorage, saveSettings as saveSettingsToStorage } from "./core/settings.js";
import { toMeters, fromMeters } from "./core/geo.js";

const NO_CACHE_KEY = "racetimer-nocache";

const DEFAULT_CENTER = { lat: 55.0, lon: 12.0 };

function getMapMode() {
  const params = new URLSearchParams(window.location.search);
  const mode = params.get("mode");
  if (mode === "course") return "course";
  if (mode === "finish") return "finish";
  return "line";
}

const MAP_MODE = getMapMode();

const els = {
  mapTitle: document.getElementById("map-title"),
  setA: document.getElementById("set-map-a"),
  setB: document.getElementById("set-map-b"),
  swap: document.getElementById("swap-map"),
  addCourse: document.getElementById("add-course-mark"),
  undoCourse: document.getElementById("undo-course-mark"),
  clearCourse: document.getElementById("clear-course-marks"),
  closeMap: document.getElementById("close-map"),
  mapStatus: document.getElementById("map-status"),
  mapCaption: document.getElementById("map-caption"),
  courseMeta: document.getElementById("course-meta"),
  mapMarkName: document.getElementById("map-mark-name"),
  mapMarkDesc: document.getElementById("map-mark-desc"),
  mapCourseList: document.getElementById("map-course-list"),
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
  finishLine: {
    a: { lat: null, lon: null },
    b: { lat: null, lon: null },
  },
  sessionSet: {
    a: false,
    b: false,
  },
  finishSessionSet: {
    a: false,
    b: false,
  },
  course: {
    enabled: false,
    marks: [],
  },
  courseMarkers: [],
  courseLine: null,
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
  if (settings.course) {
    state.course.enabled = Boolean(settings.course.enabled);
    state.course.marks = Array.isArray(settings.course.marks)
      ? settings.course.marks.map((mark) => ({ ...mark }))
      : [];
    if (settings.course.finish) {
      state.finishLine = {
        a: { ...settings.course.finish.a },
        b: { ...settings.course.finish.b },
      };
    }
  }
}

function saveSettings() {
  const patch = {
    course: {
      enabled: Boolean(state.course.enabled),
      marks: state.course.marks,
    },
  };
  if (MAP_MODE === "finish") {
    const finish = {
      a: { ...state.finishLine.a },
      b: { ...state.finishLine.b },
    };
    const hasFinish =
      Number.isFinite(finish.a.lat) &&
      Number.isFinite(finish.a.lon) &&
      Number.isFinite(finish.b.lat) &&
      Number.isFinite(finish.b.lon);
    patch.course.finish = hasFinish ? { ...finish, useStartLine: false } : finish;
  }
  if (MAP_MODE !== "course") {
    patch.line = state.line;
    patch.lineMeta = { name: null, sourceId: null };
  }
  saveSettingsToStorage(patch);
}

function getNoCacheQuery() {
  const params = new URLSearchParams(window.location.search);
  const token = params.get("nocache") || sessionStorage.getItem(NO_CACHE_KEY);
  if (!token) return "";
  sessionStorage.setItem(NO_CACHE_KEY, token);
  return `?nocache=${encodeURIComponent(token)}`;
}

function getActiveLine() {
  return MAP_MODE === "finish" ? state.finishLine : state.line;
}

function getActiveSessionSet() {
  return MAP_MODE === "finish" ? state.finishSessionSet : state.sessionSet;
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

function setModeUi() {
  const isCourse = MAP_MODE === "course";
  const isFinish = MAP_MODE === "finish";
  const toggle = (el, show) => {
    if (!el) return;
    el.hidden = !show;
    el.setAttribute("aria-hidden", show ? "false" : "true");
  };
  toggle(els.setA, !isCourse);
  toggle(els.setB, !isCourse);
  toggle(els.swap, !isCourse);
  toggle(els.addCourse, isCourse);
  toggle(els.undoCourse, isCourse);
  toggle(els.clearCourse, isCourse);
  toggle(els.courseMeta, isCourse);
  if (els.mapTitle) {
    if (isCourse) {
      els.mapTitle.textContent = "Select course";
    } else if (isFinish) {
      els.mapTitle.textContent = "Select finish line";
    } else {
      els.mapTitle.textContent = "Select marks";
    }
  }
  if (els.mapCaption) {
    els.mapCaption.textContent = isCourse
      ? "Drag the map. Add marks in order."
      : "Drag the map. The crosshair is the exact point.";
  }
}

function updateSetButtons() {
  if (MAP_MODE === "course") {
    updateCourseButtons();
    return;
  }
  const sessionSet = getActiveSessionSet();
  const hasA = sessionSet.a;
  const hasB = sessionSet.b;
  if (els.setA) {
    els.setA.classList.toggle("set", hasA);
    els.setA.textContent = hasA ? "Set P ✓" : "Set P";
  }
  if (els.setB) {
    els.setB.classList.toggle("set", hasB);
    els.setB.textContent = hasB ? "Set SB ✓" : "Set SB";
  }
}

function updateCourseButtons() {
  const count = state.course.marks.length;
  if (els.addCourse) {
    els.addCourse.classList.toggle("set", count > 0);
  }
  if (els.undoCourse) {
    els.undoCourse.disabled = count === 0;
  }
  if (els.clearCourse) {
    els.clearCourse.disabled = count === 0;
  }
  if (els.mapStatus) {
    els.mapStatus.textContent = count
      ? `Marks: ${count}`
      : "Add the first mark, then press Done.";
  }
  updateCourseMeta();
}

function getDefaultMarkName() {
  return `Mark ${state.course.marks.length + 1}`;
}

function updateCourseMeta() {
  if (els.mapMarkName) {
    if (!els.mapMarkName.value) {
      els.mapMarkName.placeholder = getDefaultMarkName();
    }
  }
  if (!els.mapCourseList) return;
  els.mapCourseList.innerHTML = "";
  if (!state.course.marks.length) {
    els.mapCourseList.textContent = "No marks yet.";
    return;
  }
  state.course.marks.forEach((mark, index) => {
    const chip = document.createElement("span");
    const name = typeof mark.name === "string" && mark.name.trim()
      ? mark.name.trim()
      : `Mark ${index + 1}`;
    const side = mark.rounding === "starboard" ? "starboard" : "port";
    chip.className = `map-course-chip ${side}`;
    chip.textContent = name;
    els.mapCourseList.appendChild(chip);
  });
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

function applyCourseRoundingDefaults() {
  const marks = state.course.marks;
  marks.forEach((mark, index) => {
    if (!mark || mark.manual) return;
    const prev = index > 0 ? marks[index - 1] : null;
    const next = index < marks.length - 1 ? marks[index + 1] : null;
    const side = prev && next ? computeTurnSide(prev, mark, next) : null;
    mark.rounding = side || mark.rounding || "port";
  });
}

function updateCourseOverlays() {
  if (!state.map || typeof L === "undefined") return;
  if (state.courseLine) {
    state.map.removeLayer(state.courseLine);
    state.courseLine = null;
  }
  if (state.courseMarkers.length) {
    state.courseMarkers.forEach((marker) => state.map.removeLayer(marker));
    state.courseMarkers = [];
  }
  if (!state.course.marks.length) return;

  const markerStyle = {
    radius: 7,
    color: "#000000",
    weight: 2,
    fillColor: "#ffffff",
    fillOpacity: 1,
    interactive: false,
    pane: "markPane",
  };
  state.courseMarkers = state.course.marks.map((mark) =>
    L.circleMarker([mark.lat, mark.lon], markerStyle).addTo(state.map)
  );

  if (state.course.marks.length >= 2) {
    const latLngs = state.course.marks.map((mark) => [mark.lat, mark.lon]);
    state.courseLine = L.polyline(latLngs, {
      color: "#000000",
      weight: 3,
      opacity: 1,
      interactive: false,
      pane: "linePane",
    }).addTo(state.map);
  }
}

function updateMapOverlays() {
  if (!state.map) return;
  if (MAP_MODE === "course") {
    updateCourseOverlays();
    return;
  }
  const activeLine = getActiveLine();
  const hasA = Number.isFinite(activeLine.a.lat) && Number.isFinite(activeLine.a.lon);
  const hasB = Number.isFinite(activeLine.b.lat) && Number.isFinite(activeLine.b.lon);

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
        [activeLine.a.lat, activeLine.a.lon],
        portStyle
      ).addTo(state.map);
    } else {
      state.markerA.setLatLng([activeLine.a.lat, activeLine.a.lon]);
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
        [activeLine.b.lat, activeLine.b.lon],
        starboardStyle
      ).addTo(state.map);
    } else {
      state.markerB.setLatLng([activeLine.b.lat, activeLine.b.lon]);
      state.markerB.setStyle(starboardStyle);
    }
  } else if (state.markerB) {
    state.map.removeLayer(state.markerB);
    state.markerB = null;
  }

  if (hasA && hasB) {
    const origin = {
      lat: (activeLine.a.lat + activeLine.b.lat) / 2,
      lon: (activeLine.a.lon + activeLine.b.lon) / 2,
    };
    const pointA = toMeters(activeLine.a, origin);
    const pointB = toMeters(activeLine.b, origin);
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
      const outlineExtraPx = 6;
      const outlineColor = "#ffffff";
      const outlineWeight = arrowWeight + outlineExtraPx;
      const outlineHeadWeight = 1 + outlineExtraPx;
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
          weight: outlineHeadWeight,
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
      [activeLine.a.lat, activeLine.a.lon],
      [activeLine.b.lat, activeLine.b.lon],
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
  if (MAP_MODE === "course") {
    if (els.addCourse) {
      els.addCourse.addEventListener("click", () => {
        if (!state.map) return;
        const center = state.map.getCenter();
        const nameInput = els.mapMarkName ? els.mapMarkName.value : "";
        const descInput = els.mapMarkDesc ? els.mapMarkDesc.value : "";
        const name = (nameInput || "").trim() || getDefaultMarkName();
        const description = (descInput || "").trim();
        state.course.marks.push({
          lat: center.lat,
          lon: center.lng,
          name,
          description,
          rounding: null,
          manual: false,
        });
        if (els.mapMarkName) {
          els.mapMarkName.value = "";
          els.mapMarkName.placeholder = getDefaultMarkName();
        }
        if (els.mapMarkDesc) {
          els.mapMarkDesc.value = "";
        }
        applyCourseRoundingDefaults();
        saveSettings();
        updateSetButtons();
        updateMapOverlays();
      });
    }

    if (els.undoCourse) {
      els.undoCourse.addEventListener("click", () => {
        if (!state.course.marks.length) return;
        state.course.marks.pop();
        applyCourseRoundingDefaults();
        saveSettings();
        updateSetButtons();
        updateMapOverlays();
      });
    }

    if (els.clearCourse) {
      els.clearCourse.addEventListener("click", () => {
        if (!state.course.marks.length) return;
        const confirmed = window.confirm("Clear all course marks?");
        if (!confirmed) return;
        state.course.marks = [];
        saveSettings();
        updateSetButtons();
        updateMapOverlays();
      });
    }
  } else {
    if (els.setA) {
      els.setA.addEventListener("click", () => {
        if (!state.map) return;
        const center = state.map.getCenter();
        const activeLine = getActiveLine();
        const sessionSet = getActiveSessionSet();
        activeLine.a = { lat: center.lat, lon: center.lng };
        sessionSet.a = true;
        saveSettings();
        updateSetButtons();
        updateMapOverlays();
        if (els.mapStatus) {
          els.mapStatus.textContent = MAP_MODE === "finish"
            ? "Finish port mark set. You can now set starboard mark or press Done."
            : "Port mark set. You can now set starboard mark or press Done.";
        }
      });
    }

    if (els.setB) {
      els.setB.addEventListener("click", () => {
        if (!state.map) return;
        const center = state.map.getCenter();
        const activeLine = getActiveLine();
        const sessionSet = getActiveSessionSet();
        activeLine.b = { lat: center.lat, lon: center.lng };
        sessionSet.b = true;
        saveSettings();
        updateSetButtons();
        updateMapOverlays();
        if (els.mapStatus) {
          els.mapStatus.textContent = MAP_MODE === "finish"
            ? "Finish starboard mark set. You can now set port mark or press Done."
            : "Starboard mark set. You can now set port mark or press Done.";
        }
      });
    }
  }

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

  if (els.swap && MAP_MODE !== "course") {
    els.swap.addEventListener("click", () => {
      const activeLine = getActiveLine();
      const sessionSet = getActiveSessionSet();
      const nextA = { ...activeLine.b };
      const nextB = { ...activeLine.a };
      activeLine.a = nextA;
      activeLine.b = nextB;
      const nextSetA = sessionSet.b;
      const nextSetB = sessionSet.a;
      sessionSet.a = nextSetA;
      sessionSet.b = nextSetB;
      saveSettings();
      updateSetButtons();
      updateMapOverlays();
      if (els.mapStatus) {
        els.mapStatus.textContent = MAP_MODE === "finish" ? "Finish marks swapped." : "Marks swapped.";
      }
    });
  }
}

loadSettings();
setModeUi();
initMap();
updateSetButtons();
bindEvents();
