const STORAGE_KEY = "racetimer-settings";
const SETTINGS_VERSION = 1;
const MAX_COUNTDOWN_SECONDS = 24 * 60 * 60 - 1;

const DEFAULT_SETTINGS = {
  version: SETTINGS_VERSION,
  line: {
    a: { lat: null, lon: null },
    b: { lat: null, lon: null },
  },
  lineMeta: {
    name: null,
    sourceId: null,
  },
  coordsFormat: "dd",
  debugGpsEnabled: false,
  useKalman: true,
  soundEnabled: true,
  timeFormat: "24h",
  speedUnit: "ms",
  distanceUnit: "m",
  bowOffsetMeters: 0,
  start: {
    mode: "countdown",
    countdownSeconds: 300,
    absoluteTime: "",
    startTs: null,
    crossedEarly: false,
  },
};

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function toNumberOrNull(value) {
  const num = Number.parseFloat(value);
  return Number.isFinite(num) ? num : null;
}

function normalizeLinePoint(point) {
  if (!point) return { lat: null, lon: null };
  return {
    lat: toNumberOrNull(point.lat),
    lon: toNumberOrNull(point.lon),
  };
}

function normalizeLine(line) {
  return {
    a: normalizeLinePoint(line?.a),
    b: normalizeLinePoint(line?.b),
  };
}

function normalizeLineMeta(meta) {
  return {
    name: typeof meta?.name === "string" ? meta.name : null,
    sourceId: typeof meta?.sourceId === "string" ? meta.sourceId : null,
  };
}

function normalizeCoordsFormat(format) {
  if (format === "dd" || format === "ddm" || format === "dms") return format;
  return DEFAULT_SETTINGS.coordsFormat;
}

function normalizeTimeFormat(format) {
  return format === "12h" ? "12h" : "24h";
}

function normalizeSpeedUnit(unit) {
  if (unit === "kn" || unit === "mph") return unit;
  return "ms";
}

function normalizeDistanceUnit(unit) {
  if (unit === "ft" || unit === "yd") return unit;
  return "m";
}

function normalizeTimeString(value) {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (!trimmed) return "";
  const match = trimmed.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) return "";
  const hours = Number.parseInt(match[1], 10);
  const minutes = Number.parseInt(match[2], 10);
  const seconds = Number.parseInt(match[3] || "0", 10);
  if (
    !Number.isFinite(hours) ||
    !Number.isFinite(minutes) ||
    !Number.isFinite(seconds)
  ) {
    return "";
  }
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59 || seconds < 0 || seconds > 59) {
    return "";
  }
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(
    seconds
  ).padStart(2, "0")}`;
}

function normalizeStart(start) {
  return {
    mode: start?.mode === "absolute" ? "absolute" : "countdown",
    countdownSeconds: clamp(
      Number.parseInt(start?.countdownSeconds, 10) || 0,
      0,
      MAX_COUNTDOWN_SECONDS
    ),
    absoluteTime: normalizeTimeString(start?.absoluteTime),
    startTs: Number.isFinite(start?.startTs) ? start.startTs : null,
    crossedEarly: Boolean(start?.crossedEarly),
  };
}

function normalizeSettings(raw) {
  return {
    version: SETTINGS_VERSION,
    line: normalizeLine(raw?.line),
    lineMeta: normalizeLineMeta(raw?.lineMeta),
    coordsFormat: normalizeCoordsFormat(raw?.coordsFormat),
    debugGpsEnabled: Boolean(raw?.debugGpsEnabled),
    useKalman: Boolean(raw?.useKalman),
    soundEnabled: raw?.soundEnabled !== undefined ? Boolean(raw.soundEnabled) : true,
    timeFormat: normalizeTimeFormat(raw?.timeFormat),
    speedUnit: normalizeSpeedUnit(raw?.speedUnit),
    distanceUnit: normalizeDistanceUnit(raw?.distanceUnit),
    bowOffsetMeters: Math.max(0, Number.parseFloat(raw?.bowOffsetMeters) || 0),
    start: normalizeStart(raw?.start),
  };
}

function mergeSettings(base, patch) {
  const merged = { ...base, ...patch };
  if (patch?.line) {
    merged.line = {
      ...base.line,
      ...patch.line,
      a: { ...base.line.a, ...patch.line?.a },
      b: { ...base.line.b, ...patch.line?.b },
    };
  }
  if (patch?.lineMeta) {
    merged.lineMeta = { ...base.lineMeta, ...patch.lineMeta };
  }
  if (patch?.start) {
    merged.start = { ...base.start, ...patch.start };
  }
  return merged;
}

function safeParse(raw) {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (err) {
    console.warn("Failed to parse settings", err);
    return null;
  }
}

export function loadSettings() {
  if (typeof localStorage === "undefined") {
    return { ...DEFAULT_SETTINGS };
  }
  const parsed = safeParse(localStorage.getItem(STORAGE_KEY));
  if (!parsed) return { ...DEFAULT_SETTINGS };
  return normalizeSettings(mergeSettings(DEFAULT_SETTINGS, parsed));
}

export function saveSettings(patch) {
  if (typeof localStorage === "undefined") {
    return normalizeSettings(mergeSettings(DEFAULT_SETTINGS, patch));
  }
  const current = loadSettings();
  const merged = mergeSettings(current, patch || {});
  const normalized = normalizeSettings(merged);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
  return normalized;
}

export { STORAGE_KEY, SETTINGS_VERSION, DEFAULT_SETTINGS };
