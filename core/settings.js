const STORAGE_KEY = "racetimer-settings";
const SETTINGS_VERSION = 3;
const MAX_COUNTDOWN_SECONDS = 24 * 60 * 60 - 1;
const DEFAULT_HEADING_SOURCE_BY_MODE = { vmg: "kalman", lifter: "kalman" };

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
  headingSourceByMode: { ...DEFAULT_HEADING_SOURCE_BY_MODE },
  soundEnabled: true,
  timeFormat: "24h",
  speedUnit: "kn",
  distanceUnit: "m",
  bowOffsetMeters: 0,
  boatLengthMeters: 0,
  imuCalibration: null,
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

function normalizeHeadingSource(source) {
  if (source === "gps") return "gps";
  return "kalman";
}

function normalizeHeadingSourceByMode(sourceByMode) {
  const value = sourceByMode && typeof sourceByMode === "object" ? sourceByMode : {};
  return {
    vmg: normalizeHeadingSource(value.vmg),
    lifter: normalizeHeadingSource(value.lifter),
  };
}

function normalizeImuCalibration(calibration) {
  if (!calibration || typeof calibration !== "object") return null;
  const axes = Array.isArray(calibration.axes) ? calibration.axes.slice(0, 3) : null;
  const signs = Array.isArray(calibration.signs) ? calibration.signs.slice(0, 3) : null;
  const validAxes = ["alpha", "beta", "gamma"];
  if (!axes || axes.length !== 3 || !axes.every((axis) => validAxes.includes(axis))) {
    return null;
  }
  if (!signs || signs.length !== 3) return null;
  const normalizedSigns = signs.map((sign) => (sign === -1 ? -1 : 1));
  const calibratedAt = Number.isFinite(calibration.calibratedAt)
    ? calibration.calibratedAt
    : null;
  return {
    axes,
    signs: normalizedSigns,
    calibratedAt,
  };
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
    headingSourceByMode: normalizeHeadingSourceByMode(raw?.headingSourceByMode),
    soundEnabled: raw?.soundEnabled !== undefined ? Boolean(raw.soundEnabled) : true,
    timeFormat: normalizeTimeFormat(raw?.timeFormat),
    speedUnit: normalizeSpeedUnit(raw?.speedUnit),
    distanceUnit: normalizeDistanceUnit(raw?.distanceUnit),
    bowOffsetMeters: Math.max(0, Number.parseFloat(raw?.bowOffsetMeters) || 0),
    boatLengthMeters: Math.max(0, Number.parseFloat(raw?.boatLengthMeters) || 0),
    imuCalibration: normalizeImuCalibration(raw?.imuCalibration),
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
  if (patch?.headingSourceByMode) {
    merged.headingSourceByMode = {
      ...base.headingSourceByMode,
      ...patch.headingSourceByMode,
    };
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

function migrateSettings(raw) {
  if (!raw || typeof raw !== "object") return raw;
  const version = Number.isFinite(raw.version) ? raw.version : 0;
  if (version >= SETTINGS_VERSION) return raw;
  const migrated = { ...raw };
  if (version < 2) {
    migrated.imuCalibration = null;
    migrated.version = 2;
  }
  if (version < 3) {
    migrated.headingSourceByMode = { ...DEFAULT_HEADING_SOURCE_BY_MODE };
    migrated.version = 3;
  }
  return migrated;
}

export function loadSettings() {
  if (typeof localStorage === "undefined") {
    return { ...DEFAULT_SETTINGS };
  }
  const parsed = migrateSettings(safeParse(localStorage.getItem(STORAGE_KEY)));
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

export { STORAGE_KEY, SETTINGS_VERSION, DEFAULT_SETTINGS, MAX_COUNTDOWN_SECONDS };
