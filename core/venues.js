const VENUES_KEY = "racetimer-venues";
const RACES_KEY = "racetimer-races";

const MARK_ROLES = {
  NONE: "none",
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

function normalizeDescription(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeRole(role) {
  const value = typeof role === "string" ? role : "none";
  if (Object.values(MARK_ROLES).includes(value)) return value;
  return MARK_ROLES.NONE;
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
    role: normalizeRole(mark.role),
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

function normalizeVenue(venue) {
  if (!venue || typeof venue !== "object") return null;
  const marks = Array.isArray(venue.marks)
    ? venue.marks.map(normalizeMark).filter(Boolean)
    : [];
  const defaultRoute = Array.isArray(venue.defaultRoute)
    ? venue.defaultRoute.map(normalizeRouteEntry).filter(Boolean)
    : [];
  return {
    id: normalizeId(venue.id) || generateId("venue"),
    name: normalizeName(venue.name, "Local venue"),
    marks,
    defaultRoute,
    updatedAt: Number.isFinite(venue.updatedAt) ? venue.updatedAt : Date.now(),
  };
}

function normalizeRace(race) {
  if (!race || typeof race !== "object") return null;
  const route = Array.isArray(race.route)
    ? race.route.map(normalizeRouteEntry).filter(Boolean)
    : [];
  return {
    id: normalizeId(race.id) || generateId("race"),
    name: normalizeName(race.name, "Race"),
    venueId: normalizeId(race.venueId),
    startEnabled: race.startEnabled !== undefined ? Boolean(race.startEnabled) : true,
    finishEnabled: race.finishEnabled !== undefined ? Boolean(race.finishEnabled) : true,
    finishUseStartLine:
      race.finishUseStartLine !== undefined ? Boolean(race.finishUseStartLine) : false,
    finishReverse:
      race.finishReverse !== undefined ? Boolean(race.finishReverse) : false,
    routeEnabled: race.routeEnabled !== undefined ? Boolean(race.routeEnabled) : true,
    route,
    createdAt: Number.isFinite(race.createdAt) ? race.createdAt : Date.now(),
    updatedAt: Number.isFinite(race.updatedAt) ? race.updatedAt : Date.now(),
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
    defaultRoute: [],
    updatedAt: Date.now(),
  });
}

function createRace(name, venue, options = {}) {
  const routeFromVenue = Array.isArray(venue?.defaultRoute)
    ? venue.defaultRoute.map(normalizeRouteEntry).filter(Boolean)
    : [];
  return normalizeRace({
    id: generateId("race"),
    name: normalizeName(name, "Race"),
    venueId: normalizeId(venue?.id),
    startEnabled: options.startEnabled !== undefined ? options.startEnabled : true,
    finishEnabled: options.finishEnabled !== undefined ? options.finishEnabled : true,
    finishUseStartLine:
      options.finishUseStartLine !== undefined ? options.finishUseStartLine : false,
    finishReverse:
      options.finishReverse !== undefined ? options.finishReverse : false,
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

function getMarkByRole(venue, role) {
  if (!venue || !Array.isArray(venue.marks)) return null;
  return venue.marks.find((mark) => mark.role === role) || null;
}

function getStartLineFromVenue(venue, race) {
  if (race && race.startEnabled === false) return null;
  const port = getMarkByRole(venue, MARK_ROLES.START_PORT);
  const starboard = getMarkByRole(venue, MARK_ROLES.START_STARBOARD);
  if (!port || !starboard) return null;
  return {
    a: { lat: port.lat, lon: port.lon },
    b: { lat: starboard.lat, lon: starboard.lon },
  };
}

function getFinishLineFromVenue(venue, race) {
  if (race && race.finishEnabled === false) return null;
  if (race && race.finishUseStartLine) {
    if (race.startEnabled === false) return null;
    const startPort = getMarkByRole(venue, MARK_ROLES.START_PORT);
    const startStarboard = getMarkByRole(venue, MARK_ROLES.START_STARBOARD);
    if (!startPort || !startStarboard) return null;
    const reverse = Boolean(race.finishReverse);
    return reverse
      ? {
          a: { lat: startStarboard.lat, lon: startStarboard.lon },
          b: { lat: startPort.lat, lon: startPort.lon },
        }
      : {
          a: { lat: startPort.lat, lon: startPort.lon },
          b: { lat: startStarboard.lat, lon: startStarboard.lon },
        };
  }
  const port = getMarkByRole(venue, MARK_ROLES.FINISH_PORT);
  const starboard = getMarkByRole(venue, MARK_ROLES.FINISH_STARBOARD);
  if (!port || !starboard) return null;
  return {
    a: { lat: port.lat, lon: port.lon },
    b: { lat: starboard.lat, lon: starboard.lon },
  };
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
  MARK_ROLES,
  normalizeRole,
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
  getMarkByRole,
  getStartLineFromVenue,
  getFinishLineFromVenue,
  buildCourseMarksFromRace,
};
