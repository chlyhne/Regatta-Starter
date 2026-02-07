const VENUES_KEY = "racetimer-venues";
const RACES_KEY = "racetimer-races";
const MAX_COUNTDOWN_SECONDS = 24 * 60 * 60 - 1;

function generateId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function normalizeId(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeName(value, fallback) {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (trimmed) return trimmed;
  return fallback || "Untitled";
}

function normalizeOptionalName(value) {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed || "";
}

function normalizeDescription(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeStartMode(mode) {
  return mode === "absolute" ? "absolute" : "countdown";
}

function normalizeCountdownSeconds(value, fallback = 300) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, 0), MAX_COUNTDOWN_SECONDS);
}

function normalizeTimeString(value) {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (!trimmed) return "";
  const parts = trimmed.split(":").map((part) => Number.parseInt(part, 10));
  if (parts.length < 2 || parts.length > 3) return "";
  const [hours, minutes, seconds = 0] = parts;
  if (!Number.isFinite(hours) || !Number.isFinite(minutes) || !Number.isFinite(seconds)) {
    return "";
  }
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59 || seconds < 0 || seconds > 59) {
    return "";
  }
  const hh = String(hours).padStart(2, "0");
  const mm = String(minutes).padStart(2, "0");
  const ss = String(seconds).padStart(2, "0");
  return parts.length === 2 ? `${hh}:${mm}` : `${hh}:${mm}:${ss}`;
}

function normalizeRaceStart(start) {
  const payload = start && typeof start === "object" ? start : {};
  return {
    mode: normalizeStartMode(payload.mode),
    countdownSeconds: normalizeCountdownSeconds(payload.countdownSeconds, 300),
    absoluteTime: normalizeTimeString(payload.absoluteTime),
    startTs: Number.isFinite(payload.startTs) ? payload.startTs : null,
    crossedEarly: Boolean(payload.crossedEarly),
  };
}

function normalizeRounding(value) {
  return value === "starboard" ? "starboard" : "port";
}

function normalizeMark(mark, index = 0) {
  if (!mark || typeof mark !== "object") return null;
  const lat = Number.parseFloat(mark.lat);
  const lon = Number.parseFloat(mark.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const name = normalizeName(mark.name, `Mark ${index + 1}`);
  return {
    id: normalizeId(mark.id) || generateId("mark"),
    name,
    description: normalizeDescription(mark.description),
    lat,
    lon,
  };
}

function normalizeRouteEntry(entry) {
  if (!entry || typeof entry !== "object") return null;
  const markId = normalizeId(entry.markId || entry.id);
  if (!markId) return null;
  return {
    markId,
    rounding: normalizeRounding(entry.rounding),
    manual: Boolean(entry.manual),
  };
}

function normalizeLine(line, marksById) {
  if (!line || typeof line !== "object") return null;
  const starboardMarkId = normalizeId(
    line.starboardMarkId || line.starboardId || line.starboardMark || line.bMarkId
  );
  const portMarkId = normalizeId(
    line.portMarkId || line.portId || line.portMark || line.aMarkId
  );
  if (!starboardMarkId || !portMarkId) return null;
  if (starboardMarkId === portMarkId) return null;
  if (!marksById.has(starboardMarkId) || !marksById.has(portMarkId)) return null;
  return {
    id: normalizeId(line.id) || generateId("line"),
    name: normalizeOptionalName(line.name),
    starboardMarkId,
    portMarkId,
  };
}

function normalizeLineList(lines, marksById) {
  if (!Array.isArray(lines)) return [];
  return lines.map((line) => normalizeLine(line, marksById)).filter(Boolean);
}

function getLineDisplayName(line, lines, fallback) {
  if (!line) return fallback;
  if (line.name) return line.name;
  if (!Array.isArray(lines) || lines.length <= 1) return fallback;
  const index = lines.findIndex((entry) => entry.id === line.id);
  if (index < 0) return fallback;
  return `${fallback} ${index + 1}`;
}

function normalizeVenue(venue) {
  if (!venue || typeof venue !== "object") return null;
  const marks = [];
  if (Array.isArray(venue.marks)) {
    venue.marks.forEach((mark, index) => {
      const normalized = normalizeMark(mark, index);
      if (!normalized) return;
      marks.push(normalized);
    });
  }
  const marksById = new Map(marks.map((mark) => [mark.id, mark]));
  const lines = normalizeLineList(venue.lines, marksById);

  let defaultStartLineId = normalizeId(venue.defaultStartLineId);
  if (!defaultStartLineId || !lines.some((line) => line.id === defaultStartLineId)) {
    defaultStartLineId = null;
  }

  let defaultFinishLineId = normalizeId(venue.defaultFinishLineId);
  if (!defaultFinishLineId || !lines.some((line) => line.id === defaultFinishLineId)) {
    defaultFinishLineId = null;
  }

  let defaultRouteStartLineId = normalizeId(venue.defaultRouteStartLineId);
  if (!defaultRouteStartLineId || !lines.some((line) => line.id === defaultRouteStartLineId)) {
    defaultRouteStartLineId = null;
  }

  let defaultRouteFinishLineId = normalizeId(venue.defaultRouteFinishLineId);
  if (
    !defaultRouteFinishLineId ||
    !lines.some((line) => line.id === defaultRouteFinishLineId)
  ) {
    defaultRouteFinishLineId = null;
  }

  const defaultRoute = Array.isArray(venue.defaultRoute)
    ? venue.defaultRoute.map(normalizeRouteEntry).filter(Boolean)
    : [];

  return {
    id: normalizeId(venue.id) || generateId("venue"),
    name: normalizeName(venue.name, "Local venue"),
    marks,
    lines,
    defaultStartLineId,
    defaultFinishLineId,
    defaultRouteStartLineId,
    defaultRouteFinishLineId,
    defaultRoute,
    updatedAt: Number.isFinite(venue.updatedAt) ? venue.updatedAt : Date.now(),
  };
}

function normalizeRace(race) {
  if (!race || typeof race !== "object") return null;
  const route = Array.isArray(race.route)
    ? race.route.map(normalizeRouteEntry).filter(Boolean)
    : [];
  const legacy = {
    startEnabled: race.startEnabled,
    finishEnabled: race.finishEnabled,
    finishUseStartLine: race.finishUseStartLine,
    finishReverse: race.finishReverse,
  };
  const hasLegacy = Object.values(legacy).some((value) => value !== undefined);
  return {
    id: normalizeId(race.id) || generateId("race"),
    name: normalizeName(race.name, "Race"),
    venueId: normalizeId(race.venueId),
    isPlan: Boolean(race.isPlan),
    startLineId: normalizeId(race.startLineId),
    finishLineId: normalizeId(race.finishLineId),
    routeStartLineId: normalizeId(race.routeStartLineId),
    routeFinishLineId: normalizeId(race.routeFinishLineId),
    start: normalizeRaceStart(race.start),
    routeEnabled: race.routeEnabled !== undefined ? Boolean(race.routeEnabled) : true,
    route,
    createdAt: Number.isFinite(race.createdAt) ? race.createdAt : Date.now(),
    updatedAt: Number.isFinite(race.updatedAt) ? race.updatedAt : Date.now(),
    ...(hasLegacy ? { _legacy: legacy } : {}),
  };
}

function loadVenues() {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(VENUES_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.map(normalizeVenue).filter(Boolean);
  } catch (err) {
    console.warn("Failed to load venues", err);
    return [];
  }
}

function saveVenues(venues) {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(VENUES_KEY, JSON.stringify(venues || []));
}

function loadRaces() {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(RACES_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.map(normalizeRace).filter(Boolean);
  } catch (err) {
    console.warn("Failed to load races", err);
    return [];
  }
}

function saveRaces(races) {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(RACES_KEY, JSON.stringify(races || []));
}

function createVenue(name) {
  return normalizeVenue({
    id: generateId("venue"),
    name: normalizeName(name, "Local venue"),
    marks: [],
    lines: [],
    defaultStartLineId: null,
    defaultFinishLineId: null,
    defaultRouteStartLineId: null,
    defaultRouteFinishLineId: null,
    defaultRoute: [],
    updatedAt: Date.now(),
  });
}

function createRace(name, venue, options = {}) {
  const routeFromVenue = Array.isArray(venue?.defaultRoute)
    ? venue.defaultRoute.map(normalizeRouteEntry).filter(Boolean)
    : [];
  const venueLines = Array.isArray(venue?.lines) ? venue.lines : [];
  const startLineId =
    normalizeId(options.startLineId) ||
    normalizeId(venue?.defaultStartLineId) ||
    normalizeId(venueLines[0]?.id) ||
    null;
  const finishLineId =
    normalizeId(options.finishLineId) ||
    normalizeId(venue?.defaultFinishLineId) ||
    normalizeId(venueLines[0]?.id) ||
    null;
  const routeStartLineId =
    normalizeId(options.routeStartLineId) ||
    normalizeId(venue?.defaultRouteStartLineId) ||
    null;
  const routeFinishLineId =
    normalizeId(options.routeFinishLineId) ||
    normalizeId(venue?.defaultRouteFinishLineId) ||
    null;
  const start = normalizeRaceStart(options.start);
  start.startTs = null;
  start.crossedEarly = false;
  const routeReady = Boolean(routeStartLineId && routeFromVenue.length);
  return normalizeRace({
    id: generateId("race"),
    name: normalizeName(name, "Race"),
    venueId: normalizeId(venue?.id),
    isPlan: Boolean(options.isPlan),
    startLineId,
    finishLineId,
    routeStartLineId,
    routeFinishLineId,
    start,
    routeEnabled:
      options.routeEnabled !== undefined
        ? options.routeEnabled
        : routeReady,
    route: routeFromVenue,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });
}

function getVenueById(venues, id) {
  return venues.find((venue) => venue.id === id) || null;
}

function getRaceById(races, id) {
  return races.find((race) => race.id === id) || null;
}

function getLineById(lines, id) {
  if (!Array.isArray(lines)) return null;
  return lines.find((line) => line.id === id) || null;
}

function resolveLineFromVenue(venue, lineId) {
  if (!venue || !lineId) return null;
  const line = getLineById(venue.lines, lineId);
  if (!line) return null;
  const marksById = new Map(
    Array.isArray(venue.marks)
      ? venue.marks.map((mark) => [mark.id, mark])
      : []
  );
  const port = marksById.get(line.portMarkId);
  const starboard = marksById.get(line.starboardMarkId);
  if (!port || !starboard) return null;
  return {
    id: line.id,
    name: line.name,
    a: { lat: port.lat, lon: port.lon },
    b: { lat: starboard.lat, lon: starboard.lon },
    portMarkId: line.portMarkId,
    starboardMarkId: line.starboardMarkId,
  };
}

function getStartLineFromVenue(venue, race) {
  if (!venue) return null;
  const useRaceOnly = Boolean(race?.routeEnabled);
  const lineId = useRaceOnly
    ? normalizeId(race?.startLineId)
    : normalizeId(race?.startLineId) || normalizeId(venue.defaultStartLineId);
  return resolveLineFromVenue(venue, lineId);
}

function getFinishLineFromVenue(venue, race) {
  if (!venue) return null;
  const useRaceOnly = Boolean(race?.routeEnabled);
  const lineId = useRaceOnly
    ? normalizeId(race?.finishLineId)
    : normalizeId(race?.finishLineId) || normalizeId(venue.defaultFinishLineId);
  return resolveLineFromVenue(venue, lineId);
}

function migrateLineSelections(venues, races) {
  let changed = false;
  const venuesById = new Map(venues.map((venue) => [venue.id, venue]));
  races.forEach((race) => {
    const venue = venuesById.get(race.venueId);
    if (!venue) return;
    if (!Array.isArray(venue.lines)) {
      venue.lines = [];
      changed = true;
    }
    if (Array.isArray(venue.startLines) || Array.isArray(venue.finishLines)) {
      venue.lines = [];
      delete venue.startLines;
      delete venue.finishLines;
      changed = true;
    }
    const legacy = race._legacy || {};
    let startLineId = normalizeId(race.startLineId);
    let finishLineId = normalizeId(race.finishLineId);
    let routeStartLineId = normalizeId(race.routeStartLineId);
    let routeFinishLineId = normalizeId(race.routeFinishLineId);

    if (legacy.startEnabled === false) {
      startLineId = null;
    }

    if (legacy.finishEnabled === false) {
      finishLineId = null;
    }

    if (startLineId && !getLineById(venue.lines, startLineId)) {
      startLineId = null;
    }
    if (finishLineId && !getLineById(venue.lines, finishLineId)) {
      finishLineId = null;
    }
    if (routeStartLineId && !getLineById(venue.lines, routeStartLineId)) {
      routeStartLineId = null;
    }
    if (routeFinishLineId && !getLineById(venue.lines, routeFinishLineId)) {
      routeFinishLineId = null;
    }

    if (race.routeEnabled) {
      if (!routeStartLineId && startLineId) {
        routeStartLineId = startLineId;
      }
      if (!routeFinishLineId && finishLineId) {
        routeFinishLineId = finishLineId;
      }
      if (!routeStartLineId) {
        race.routeEnabled = false;
        changed = true;
      } else {
        startLineId = routeStartLineId;
        finishLineId = routeFinishLineId || null;
      }
    }

    if (race.startLineId !== startLineId) {
      race.startLineId = startLineId;
      changed = true;
    }
    if (race.finishLineId !== finishLineId) {
      race.finishLineId = finishLineId;
      changed = true;
    }
    if (race.routeStartLineId !== routeStartLineId) {
      race.routeStartLineId = routeStartLineId;
      changed = true;
    }
    if (race.routeFinishLineId !== routeFinishLineId) {
      race.routeFinishLineId = routeFinishLineId;
      changed = true;
    }

    if (venue.defaultStartLineId && !getLineById(venue.lines, venue.defaultStartLineId)) {
      venue.defaultStartLineId = null;
      changed = true;
    }
    if (venue.defaultFinishLineId && !getLineById(venue.lines, venue.defaultFinishLineId)) {
      venue.defaultFinishLineId = null;
      changed = true;
    }
    if (
      venue.defaultRouteStartLineId &&
      !getLineById(venue.lines, venue.defaultRouteStartLineId)
    ) {
      venue.defaultRouteStartLineId = null;
      changed = true;
    }
    if (
      venue.defaultRouteFinishLineId &&
      !getLineById(venue.lines, venue.defaultRouteFinishLineId)
    ) {
      venue.defaultRouteFinishLineId = null;
      changed = true;
    }

    if (race._legacy) {
      delete race._legacy;
      changed = true;
    }
    if (race.startEnabled !== undefined) {
      delete race.startEnabled;
      changed = true;
    }
    if (race.finishEnabled !== undefined) {
      delete race.finishEnabled;
      changed = true;
    }
    if (race.finishUseStartLine !== undefined) {
      delete race.finishUseStartLine;
      changed = true;
    }
    if (race.finishReverse !== undefined) {
      delete race.finishReverse;
      changed = true;
    }
  });
  return changed;
}

function buildCourseMarksFromRace(venue, race) {
  if (!venue || !race) return [];
  const marksById = new Map(
    Array.isArray(venue.marks)
      ? venue.marks.map((mark) => [mark.id, mark])
      : []
  );
  return (race.route || [])
    .map((entry) => {
      const normalized = normalizeRouteEntry(entry);
      if (!normalized) return null;
      const mark = marksById.get(normalized.markId);
      if (!mark) return null;
      return {
        lat: mark.lat,
        lon: mark.lon,
        name: mark.name,
        description: mark.description,
        rounding: normalized.rounding,
        manual: normalized.manual,
      };
    })
    .filter(Boolean);
}

export {
  VENUES_KEY,
  RACES_KEY,
  normalizeMark,
  normalizeRouteEntry,
  normalizeVenue,
  normalizeRace,
  loadVenues,
  saveVenues,
  loadRaces,
  saveRaces,
  createVenue,
  createRace,
  getVenueById,
  getRaceById,
  getLineById,
  getLineDisplayName,
  getStartLineFromVenue,
  getFinishLineFromVenue,
  migrateLineSelections,
  buildCourseMarksFromRace,
};
