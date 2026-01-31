import { clamp } from "./common.js";
import {
  normalizeTimeFormat,
  normalizeSpeedUnit,
  normalizeDistanceUnit,
} from "./units.js";

const STORAGE_KEY = "racetimer-settings";
const SETTINGS_VERSION = 15;
const MAX_COUNTDOWN_SECONDS = 24 * 60 * 60 - 1;
const DEFAULT_HEADING_SOURCE_BY_MODE = { lifter: "kalman" };
const BOAT_SHAPES = new Set([
  "dinghy",
  "multihull",
  "planing-monohull",
  "non-planing-monohull",
  "long-slender",
]);
const VMG_BASELINE_TAU_DEFAULT_SEC = 45;
const VMG_BASELINE_TAU_MIN_SEC = 15;
const VMG_BASELINE_TAU_MAX_SEC = 75;

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
  useKalman: true,
  headingSourceByMode: { ...DEFAULT_HEADING_SOURCE_BY_MODE },
  soundEnabled: true,
  timeFormat: "24h",
  speedUnit: "kn",
  distanceUnit: "m",
  bowOffsetMeters: 5,
  boatLengthMeters: 8,
  boatModel: "",
  boatShape: "",
  boatWeightKg: 0,
  imuCalibration: null,
  diagUploadToken: "",
  windEndpoint: "/wind",
  windHistoryMinutes: 60,
  windPeriodogramMinutes: 60,
  windSpeedFitOrder: 3,
  windDirFitOrder: 3,
  replayLoop: false,
  vmg: {
    baselineTauSeconds: VMG_BASELINE_TAU_DEFAULT_SEC,
    smoothCurrent: true,
    capEnabled: true,
  },
  start: {
    mode: "countdown",
    countdownSeconds: 300,
    absoluteTime: "",
    startTs: null,
    crossedEarly: false,
  },
};

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

function normalizeHeadingSource(source) {
  if (source === "gps") return "gps";
  return "kalman";
}

function normalizeHeadingSourceByMode(sourceByMode) {
  const value = sourceByMode && typeof sourceByMode === "object" ? sourceByMode : {};
  return {
    lifter: normalizeHeadingSource(value.lifter),
  };
}

function normalizeBoatShape(shape) {
  if (typeof shape !== "string") return "";
  const trimmed = shape.trim();
  return BOAT_SHAPES.has(trimmed) ? trimmed : "";
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

function normalizeVmgSettings(vmg) {
  const baselineTau = Number.parseInt(vmg?.baselineTauSeconds, 10);
  return {
    baselineTauSeconds: clamp(
      Number.isFinite(baselineTau) ? baselineTau : VMG_BASELINE_TAU_DEFAULT_SEC,
      VMG_BASELINE_TAU_MIN_SEC,
      VMG_BASELINE_TAU_MAX_SEC
    ),
    smoothCurrent:
      vmg?.smoothCurrent !== undefined ? Boolean(vmg.smoothCurrent) : true,
    capEnabled: vmg?.capEnabled !== undefined ? Boolean(vmg.capEnabled) : true,
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

function normalizeWindEndpoint(value) {
  if (typeof value !== "string") return DEFAULT_SETTINGS.windEndpoint;
  const trimmed = value.trim();
  return trimmed || DEFAULT_SETTINGS.windEndpoint;
}

function normalizeWindHistoryMinutes(value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return DEFAULT_SETTINGS.windHistoryMinutes;
  return Math.min(1440, Math.max(15, parsed));
}

function normalizeWindPeriodogramMinutes(value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return DEFAULT_SETTINGS.windPeriodogramMinutes;
  const clamped = Math.min(120, Math.max(0, parsed));
  return Math.round(clamped / 2) * 2;
}

function normalizeWindFitOrder(value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return 3;
  return Math.min(5, Math.max(1, parsed));
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
    useKalman: Boolean(raw?.useKalman),
    headingSourceByMode: normalizeHeadingSourceByMode(raw?.headingSourceByMode),
    soundEnabled: raw?.soundEnabled !== undefined ? Boolean(raw.soundEnabled) : true,
    timeFormat: normalizeTimeFormat(raw?.timeFormat),
    speedUnit: normalizeSpeedUnit(raw?.speedUnit),
    distanceUnit: normalizeDistanceUnit(raw?.distanceUnit),
    bowOffsetMeters: Math.max(
      0,
      Number.isFinite(Number.parseFloat(raw?.bowOffsetMeters))
        ? Number.parseFloat(raw?.bowOffsetMeters)
        : DEFAULT_SETTINGS.bowOffsetMeters
    ),
    boatLengthMeters: Math.max(
      0,
      Number.isFinite(Number.parseFloat(raw?.boatLengthMeters))
        ? Number.parseFloat(raw?.boatLengthMeters)
        : DEFAULT_SETTINGS.boatLengthMeters
    ),
    boatModel: typeof raw?.boatModel === "string" ? raw.boatModel.trim() : "",
    boatShape: normalizeBoatShape(raw?.boatShape),
    boatWeightKg: Math.min(
      99999,
      Math.max(
        0,
        Number.isFinite(Number.parseFloat(raw?.boatWeightKg))
          ? Number.parseFloat(raw?.boatWeightKg)
          : DEFAULT_SETTINGS.boatWeightKg
      )
    ),
    imuCalibration: normalizeImuCalibration(raw?.imuCalibration),
    diagUploadToken: typeof raw?.diagUploadToken === "string" ? raw.diagUploadToken : "",
    windEndpoint: normalizeWindEndpoint(raw?.windEndpoint),
    windHistoryMinutes: normalizeWindHistoryMinutes(raw?.windHistoryMinutes),
    windPeriodogramMinutes: normalizeWindPeriodogramMinutes(raw?.windPeriodogramMinutes),
    windSpeedFitOrder: normalizeWindFitOrder(raw?.windSpeedFitOrder),
    windDirFitOrder: normalizeWindFitOrder(raw?.windDirFitOrder),
    replayLoop: Boolean(raw?.replayLoop),
    vmg: normalizeVmgSettings(raw?.vmg),
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
  if (patch?.vmg) {
    merged.vmg = { ...base.vmg, ...patch.vmg };
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
  if (version < 4) {
    migrated.diagUploadToken = "";
    migrated.version = 4;
  }
  if (version < 5) {
    const bowOffset = Number.parseFloat(migrated.bowOffsetMeters);
    const boatLength = Number.parseFloat(migrated.boatLengthMeters);
    migrated.bowOffsetMeters =
      Number.isFinite(bowOffset) && bowOffset > 0 ? bowOffset : DEFAULT_SETTINGS.bowOffsetMeters;
    migrated.boatLengthMeters =
      Number.isFinite(boatLength) && boatLength > 0 ? boatLength : DEFAULT_SETTINGS.boatLengthMeters;
    migrated.version = 5;
  }
  if (version < 6) {
    migrated.boatModel = typeof migrated.boatModel === "string" ? migrated.boatModel.trim() : "";
    const boatWeight = Number.parseFloat(migrated.boatWeightKg);
    migrated.boatWeightKg =
      Number.isFinite(boatWeight) && boatWeight > 0
        ? Math.min(99999, boatWeight)
        : DEFAULT_SETTINGS.boatWeightKg;
    migrated.version = 6;
  }
  if (version < 7) {
    migrated.boatShape = normalizeBoatShape(migrated.boatShape);
    migrated.replayLoop = Boolean(migrated.replayLoop);
    migrated.version = 7;
  }
  if (version < 8) {
    migrated.vmg = { ...DEFAULT_SETTINGS.vmg };
    migrated.version = 8;
  }
  if (version < 9) {
    migrated.vmg = { ...DEFAULT_SETTINGS.vmg, ...migrated.vmg };
    migrated.version = 9;
  }
  if (version < 10) {
    migrated.windEndpoint = DEFAULT_SETTINGS.windEndpoint;
    migrated.version = 10;
  }
  if (version < 11) {
    migrated.windHistoryMinutes = DEFAULT_SETTINGS.windHistoryMinutes;
    migrated.version = 11;
  }
  if (version < 13) {
    migrated.windPeriodogramMinutes = DEFAULT_SETTINGS.windPeriodogramMinutes;
    migrated.version = 13;
  }
  if (version < 14) {
    migrated.windSpeedFitOrder = DEFAULT_SETTINGS.windSpeedFitOrder;
    migrated.windDirFitOrder = DEFAULT_SETTINGS.windDirFitOrder;
    migrated.version = 14;
  }
  if (version < 15) {
    delete migrated.windAutoCorrMinutes;
    migrated.version = 15;
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
