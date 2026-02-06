const VENUES_KEY = "racetimer-venues";
const RACES_KEY = "racetimer-races";
const MAX_COUNTDOWN_SECONDS = 24 * 60 * 60 - 1;

const LEGACY_ROLES = {
  START_PORT: "start-port",
  START_STARBOARD: "start-starboard",
  FINISH_PORT: "finish-port",
  FINISH_STARBOARD: "finish-starboard",
};

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
  const legacyRoles = new Map();
  if (Array.isArray(venue.marks)) {
    venue.marks.forEach((mark, index) => {
      const normalized = normalizeMark(mark, index);
      if (!normalized) return;
      marks.push(normalized);
      const rawRole = typeof mark.role === "string" ? mark.role : "";
      if (Object.values(LEGACY_ROLES).includes(rawRole)) {
        legacyRoles.set(normalized.id, rawRole);
      }
    });
  }
  const marksById = new Map(marks.map((mark) => [mark.id, mark]));

  let startLines = normalizeLineList(venue.startLines, marksById);
  let finishLines = normalizeLineList(venue.finishLines, marksById);

  if (!startLines.length && legacyRoles.size) {
    const portId = Array.from(legacyRoles.entries()).find(
      ([, role]) => role === LEGACY_ROLES.START_PORT
    )?.[0];
    const starboardId = Array.from(legacyRoles.entries()).find(
      ([, role]) => role === LEGACY_ROLES.START_STARBOARD
    )?.[0];
    if (portId && starboardId) {
      startLines = [
        {
          id: generateId("line"),
          name: "",
          starboardMarkId: starboardId,
          portMarkId: portId,
        },
      ];
    }
  }

  if (!finishLines.length && legacyRoles.size) {
    const portId = Array.from(legacyRoles.entries()).find(
      ([, role]) => role === LEGACY_ROLES.FINISH_PORT
    )?.[0];
    const starboardId = Array.from(legacyRoles.entries()).find(
      ([, role]) => role === LEGACY_ROLES.FINISH_STARBOARD
    )?.[0];
    if (portId && starboardId) {
      finishLines = [
        {
          id: generateId("line"),
          name: "",
          starboardMarkId: starboardId,
          portMarkId: portId,
        },
      ];
    }
  }

  let defaultStartLineId = normalizeId(venue.defaultStartLineId);
  if (!defaultStartLineId || !startLines.some((line) => line.id === defaultStartLineId)) {
    defaultStartLineId = startLines[0]?.id || null;
  }

  let defaultFinishLineId = normalizeId(venue.defaultFinishLineId);
  if (!defaultFinishLineId || !finishLines.some((line) => line.id === defaultFinishLineId)) {
    defaultFinishLineId = finishLines[0]?.id || null;
  }

  const defaultRoute = Array.isArray(venue.defaultRoute)
    ? venue.defaultRoute.map(normalizeRouteEntry).filter(Boolean)
    : [];

  return {
    id: normalizeId(venue.id) || generateId("venue"),
    name: normalizeName(venue.name, "Local venue"),
    marks,
    startLines,
    finishLines,
    defaultStartLineId,
    defaultFinishLineId,
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
    startLineId: normalizeId(race.startLineId),
    finishLineId: normalizeId(race.finishLineId),
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
    startLines: [],
    finishLines: [],
    defaultStartLineId: null,
    defaultFinishLineId: null,
    defaultRoute: [],
    updatedAt: Date.now(),
  });
}

function createRace(name, venue, options = {}) {
  const routeFromVenue = Array.isArray(venue?.defaultRoute)
    ? venue.defaultRoute.map(normalizeRouteEntry).filter(Boolean)
    : [];
  const startLineId =
    normalizeId(options.startLineId) ||
    normalizeId(venue?.defaultStartLineId) ||
    normalizeId(venue?.startLines?.[0]?.id) ||
    null;
  const finishLineId =
    normalizeId(options.finishLineId) ||
    normalizeId(venue?.defaultFinishLineId) ||
    normalizeId(venue?.finishLines?.[0]?.id) ||
    null;
  const start = normalizeRaceStart(options.start);
  start.startTs = null;
  start.crossedEarly = false;
  return normalizeRace({
    id: generateId("race"),
    name: normalizeName(name, "Race"),
    venueId: normalizeId(venue?.id),
    startLineId,
    finishLineId,
    start,
    routeEnabled:
      options.routeEnabled !== undefined
        ? options.routeEnabled
        : routeFromVenue.length > 0,
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

function resolveLineFromVenue(venue, lineId, type) {
  if (!venue || !lineId) return null;
  const lines = type === "finish" ? venue.finishLines : venue.startLines;
  const line = getLineById(lines, lineId);
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
  const lineId = normalizeId(race?.startLineId) || normalizeId(venue.defaultStartLineId);
  return resolveLineFromVenue(venue, lineId, "start");
}

function getFinishLineFromVenue(venue, race) {
  if (!venue) return null;
  const lineId = normalizeId(race?.finishLineId) || normalizeId(venue.defaultFinishLineId);
  return resolveLineFromVenue(venue, lineId, "finish");
}

function findOrCreateReversedFinishLine(venue, baseLine) {
  if (!venue || !baseLine) return null;
  if (!Array.isArray(venue.finishLines)) {
    venue.finishLines = [];
  }
  const existing = venue.finishLines.find(
    (line) =>
      line.starboardMarkId === baseLine.portMarkId &&
      line.portMarkId === baseLine.starboardMarkId
  );
  if (existing) return existing;
  const reversed = {
    id: generateId("line"),
    name: "",
    starboardMarkId: baseLine.portMarkId,
    portMarkId: baseLine.starboardMarkId,
  };
  venue.finishLines.push(reversed);
  return reversed;
}

function findOrCreateFinishLineFromStart(venue, baseLine) {
  if (!venue || !baseLine) return null;
  if (!Array.isArray(venue.finishLines)) {
    venue.finishLines = [];
  }
  const existing = venue.finishLines.find(
    (line) =>
      line.starboardMarkId === baseLine.starboardMarkId &&
      line.portMarkId === baseLine.portMarkId
  );
  if (existing) return existing;
  const line = {
    id: generateId("line"),
    name: "",
    starboardMarkId: baseLine.starboardMarkId,
    portMarkId: baseLine.portMarkId,
  };
  venue.finishLines.push(line);
  return line;
}

function migrateLineSelections(venues, races) {
  let changed = false;
  const venuesById = new Map(venues.map((venue) => [venue.id, venue]));
  races.forEach((race) => {
    const venue = venuesById.get(race.venueId);
    if (!venue) return;
    const legacy = race._legacy || {};
    let startLineId = normalizeId(race.startLineId);
    let finishLineId = normalizeId(race.finishLineId);

    if (legacy.startEnabled === false) {
      startLineId = null;
    } else if (!startLineId) {
      startLineId = normalizeId(venue.defaultStartLineId) || venue.startLines?.[0]?.id || null;
    }

    if (legacy.finishEnabled === false) {
      finishLineId = null;
    } else if (!finishLineId) {
      if (legacy.finishUseStartLine) {
        const baseLine = getLineById(venue.startLines, startLineId);
        if (baseLine) {
          if (legacy.finishReverse) {
            const reversed = findOrCreateReversedFinishLine(venue, baseLine);
            if (reversed) {
              finishLineId = reversed.id;
              changed = true;
            }
          } else {
            const same = findOrCreateFinishLineFromStart(venue, baseLine);
            if (same) {
              finishLineId = same.id;
              changed = true;
            }
          }
        }
      } else {
        finishLineId =
          normalizeId(venue.defaultFinishLineId) || venue.finishLines?.[0]?.id || null;
      }
    }

    if (startLineId && !getLineById(venue.startLines, startLineId)) {
      startLineId = null;
    }
    if (finishLineId && !getLineById(venue.finishLines, finishLineId)) {
      finishLineId = null;
    }

    if (race.startLineId !== startLineId) {
      race.startLineId = startLineId;
      changed = true;
    }
    if (race.finishLineId !== finishLineId) {
      race.finishLineId = finishLineId;
      changed = true;
    }

    if (!venue.defaultStartLineId && venue.startLines?.length) {
      venue.defaultStartLineId = venue.startLines[0].id;
      changed = true;
    }
    if (!venue.defaultFinishLineId && venue.finishLines?.length) {
      venue.defaultFinishLineId = venue.finishLines[0].id;
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
