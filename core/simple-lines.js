import { LINES_KEY } from "./state.js";
import { getLineDisplayName, getLineRoles } from "./venues.js";

const SIMPLE_LINES_MIGRATION_KEY = "racetimer-simple-lines-migrated-v1";
const SIMPLE_LINE_FALLBACK_NAME = "Start line";
const POINT_MATCH_EPSILON = 1e-7;

function normalizeId(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function toNumberOrNull(value) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizePoint(point) {
  return {
    lat: toNumberOrNull(point?.lat),
    lon: toNumberOrNull(point?.lon),
  };
}

function isPointValid(point) {
  return Number.isFinite(point?.lat) && Number.isFinite(point?.lon);
}

function normalizeName(name, fallback = SIMPLE_LINE_FALLBACK_NAME) {
  const trimmed = typeof name === "string" ? name.trim() : "";
  return trimmed || fallback;
}

function normalizeSource(source) {
  if (!source || typeof source !== "object") return null;
  if (source.kind === "manual") {
    return { kind: "manual" };
  }
  if (source.kind === "venue-line") {
    const venueId = normalizeId(source.venueId);
    const lineId = normalizeId(source.lineId);
    if (!venueId || !lineId) return null;
    return { kind: "venue-line", venueId, lineId };
  }
  return null;
}

function buildSimpleLineId() {
  return `simple-line-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function normalizeSimpleLine(line) {
  if (!line || typeof line !== "object") return null;
  const a = normalizePoint(line.a);
  const b = normalizePoint(line.b);
  if (!isPointValid(a) || !isPointValid(b)) return null;
  const createdAt = Number.isFinite(line.createdAt) ? line.createdAt : Date.now();
  const updatedAt = Number.isFinite(line.updatedAt) ? line.updatedAt : createdAt;
  return {
    id: normalizeId(line.id) || buildSimpleLineId(),
    name: normalizeName(line.name),
    a,
    b,
    source: normalizeSource(line.source),
    createdAt,
    updatedAt,
  };
}

function dedupeById(lines) {
  const seen = new Set();
  const deduped = [];
  lines.forEach((line) => {
    if (!line || seen.has(line.id)) return;
    seen.add(line.id);
    deduped.push(line);
  });
  return deduped;
}

function loadSimpleLines() {
  try {
    const raw = localStorage.getItem(LINES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return dedupeById(parsed.map((line) => normalizeSimpleLine(line)).filter(Boolean));
  } catch {
    return [];
  }
}

function saveSimpleLines(lines) {
  const normalized = dedupeById(
    (Array.isArray(lines) ? lines : [])
      .map((line) => normalizeSimpleLine(line))
      .filter(Boolean)
  );
  localStorage.setItem(LINES_KEY, JSON.stringify(normalized));
  return normalized;
}

function pointsMatch(left, right) {
  return (
    Math.abs(left.lat - right.lat) <= POINT_MATCH_EPSILON &&
    Math.abs(left.lon - right.lon) <= POINT_MATCH_EPSILON
  );
}

function lineMatchesGeometry(entry, a, b) {
  return (
    (pointsMatch(entry.a, a) && pointsMatch(entry.b, b)) ||
    (pointsMatch(entry.a, b) && pointsMatch(entry.b, a))
  );
}

function getSimpleLineById(lines, lineId) {
  const id = normalizeId(lineId);
  if (!id) return null;
  const pool = Array.isArray(lines) ? lines : [];
  return pool.find((line) => line.id === id) || null;
}

function removeSimpleLineById(lines, lineId) {
  const id = normalizeId(lineId);
  if (!id) return { lines: Array.isArray(lines) ? lines : [], removed: false };
  const pool = Array.isArray(lines) ? lines : [];
  const filtered = pool.filter((line) => line.id !== id);
  return { lines: filtered, removed: filtered.length !== pool.length };
}

function resolveVenueLinePoints(venue, line) {
  if (!venue || !line) return null;
  const marksById = new Map(
    Array.isArray(venue.marks) ? venue.marks.map((mark) => [mark.id, mark]) : []
  );
  const port = marksById.get(line.portMarkId);
  const starboard = marksById.get(line.starboardMarkId);
  if (!port || !starboard) return null;
  const a = normalizePoint({ lat: port.lat, lon: port.lon });
  const b = normalizePoint({ lat: starboard.lat, lon: starboard.lon });
  if (!isPointValid(a) || !isPointValid(b)) return null;
  return { a, b };
}

function buildVenueSimpleLineName(venue, line) {
  const lines = Array.isArray(venue?.lines) ? venue.lines : [];
  const lineName = getLineDisplayName(line, lines, SIMPLE_LINE_FALLBACK_NAME);
  const venueName = normalizeName(venue?.name, "");
  return venueName ? `${venueName} - ${lineName}` : lineName;
}

function upsertSimpleLineFromVenueLine(lines, venue, line) {
  const normalizedLines = dedupeById(
    (Array.isArray(lines) ? lines : [])
      .map((entry) => normalizeSimpleLine(entry))
      .filter(Boolean)
  );
  if (!venue || !line || !getLineRoles(line).start) {
    return { lines: normalizedLines, changed: false, line: null };
  }
  const venueId = normalizeId(venue.id);
  const lineId = normalizeId(line.id);
  if (!venueId || !lineId) {
    return { lines: normalizedLines, changed: false, line: null };
  }
  const points = resolveVenueLinePoints(venue, line);
  if (!points) {
    return { lines: normalizedLines, changed: false, line: null };
  }
  const now = Date.now();
  const name = buildVenueSimpleLineName(venue, line);
  let existingIndex = normalizedLines.findIndex(
    (entry) =>
      entry.source?.kind === "venue-line" &&
      entry.source.venueId === venueId &&
      entry.source.lineId === lineId
  );
  if (existingIndex < 0) {
    existingIndex = normalizedLines.findIndex((entry) =>
      lineMatchesGeometry(entry, points.a, points.b)
    );
  }
  if (existingIndex >= 0) {
    const existing = normalizedLines[existingIndex];
    const updated = {
      ...existing,
      name,
      a: { ...points.a },
      b: { ...points.b },
      source: { kind: "venue-line", venueId, lineId },
      updatedAt: now,
    };
    const unchanged =
      existing.name === updated.name &&
      lineMatchesGeometry(existing, updated.a, updated.b);
    if (unchanged) {
      return { lines: normalizedLines, changed: false, line: existing };
    }
    const nextLines = [...normalizedLines];
    nextLines[existingIndex] = updated;
    return { lines: nextLines, changed: true, line: updated };
  }
  const created = {
    id: buildSimpleLineId(),
    name,
    a: { ...points.a },
    b: { ...points.b },
    source: { kind: "venue-line", venueId, lineId },
    createdAt: now,
    updatedAt: now,
  };
  return { lines: [...normalizedLines, created], changed: true, line: created };
}

function upsertSimpleLineFromCoordinates(lines, options = {}) {
  const normalizedLines = dedupeById(
    (Array.isArray(lines) ? lines : [])
      .map((entry) => normalizeSimpleLine(entry))
      .filter(Boolean)
  );
  const a = normalizePoint(options.a);
  const b = normalizePoint(options.b);
  if (!isPointValid(a) || !isPointValid(b)) {
    return { lines: normalizedLines, changed: false, line: null };
  }
  const name = normalizeName(options.name);
  const now = Date.now();
  const source = options.source?.kind === "venue-line" ? normalizeSource(options.source) : {
    kind: "manual",
  };
  const existingIndex = normalizedLines.findIndex(
    (entry) => entry.source?.kind === "manual" && lineMatchesGeometry(entry, a, b)
  );
  if (existingIndex >= 0) {
    const existing = normalizedLines[existingIndex];
    const updated = {
      ...existing,
      name,
      a: { ...a },
      b: { ...b },
      source,
      updatedAt: now,
    };
    const unchanged = existing.name === updated.name && lineMatchesGeometry(existing, a, b);
    if (unchanged) {
      return { lines: normalizedLines, changed: false, line: existing };
    }
    const nextLines = [...normalizedLines];
    nextLines[existingIndex] = updated;
    return { lines: nextLines, changed: true, line: updated };
  }
  const created = {
    id: buildSimpleLineId(),
    name,
    a: { ...a },
    b: { ...b },
    source,
    createdAt: now,
    updatedAt: now,
  };
  return { lines: [...normalizedLines, created], changed: true, line: created };
}

function migrateSimpleLinesFromVenuesOnce(venues) {
  try {
    if (localStorage.getItem(SIMPLE_LINES_MIGRATION_KEY) === "1") {
      return loadSimpleLines();
    }
    let lines = loadSimpleLines();
    if (!lines.length && Array.isArray(venues)) {
      venues.forEach((venue) => {
        const venueLines = Array.isArray(venue?.lines) ? venue.lines : [];
        venueLines.forEach((line) => {
          const result = upsertSimpleLineFromVenueLine(lines, venue, line);
          lines = result.lines;
        });
      });
      lines = saveSimpleLines(lines);
    }
    localStorage.setItem(SIMPLE_LINES_MIGRATION_KEY, "1");
    return lines;
  } catch {
    return loadSimpleLines();
  }
}

export {
  getSimpleLineById,
  loadSimpleLines,
  migrateSimpleLinesFromVenuesOnce,
  removeSimpleLineById,
  saveSimpleLines,
  upsertSimpleLineFromCoordinates,
  upsertSimpleLineFromVenueLine,
};
