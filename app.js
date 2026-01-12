const STORAGE_KEY = "racetimer-settings";
const LINES_KEY = "racetimer-lines";
const EARTH_RADIUS = 6371000;
const DEBUG_GPS_DEFAULT = true;
const DEBUG_COORDS = { lat: 55.0, lon: 12.0 };
const COORD_DECIMAL_DIGITS = 10;
const COORD_DD_DIGITS = 6;
const DEBUG_SPEED = 3.5;
const DEBUG_HEADING = 90;
const BEEP_FREQUENCY = 880;
const START_BEEP_FREQUENCY = 1320;
const LONG_BEEP_DURATION_MS = 750;
const BEEP_DURATION_MS = Math.round(LONG_BEEP_DURATION_MS / 2);
const START_BEEP_DURATION_MS = 2000;
const TRACK_MAX_POINTS = 600;
const TRACK_WINDOW_MS = 3 * 60 * 1000;
const SPEED_UNITS = {
  ms: { factor: 1, label: "m/s" },
  kn: { factor: 1.943844, label: "kn" },
  mph: { factor: 2.236936, label: "mph" },
};
const DISTANCE_UNITS = {
  m: { factor: 1, label: "m" },
  ft: { factor: 3.28084, label: "ft" },
  yd: { factor: 1.093613, label: "yd" },
};

function formatUnitLabel(label) {
  return `[${String(label).toLowerCase()}]`;
}

function formatBowOffsetValue(meters) {
  if (!Number.isFinite(meters)) return "";
  const { factor } = getDistanceUnitMeta();
  const value = meters * factor;
  const rounded = Math.round(value * 100) / 100;
  return trimTrailingZeros(rounded.toFixed(2));
}

function parseBowOffsetInput() {
  if (!els.bowOffset || !state.useKalman) return state.bowOffsetMeters;
  const raw = Number.parseFloat(String(els.bowOffset.value || "").replace(",", "."));
  if (!Number.isFinite(raw)) return 0;
  const safe = Math.max(0, raw);
  const { factor } = getDistanceUnitMeta();
  return safe / factor;
}

function syncBowOffsetInput() {
  const enabled = state.useKalman;
  if (els.bowOffset) {
    els.bowOffset.disabled = !enabled;
    els.bowOffset.style.display = enabled ? "" : "none";
    if (enabled) {
      els.bowOffset.value = formatBowOffsetValue(state.bowOffsetMeters);
    } else {
      els.bowOffset.value = "";
    }
  }
  if (els.bowOffsetUnit) {
    els.bowOffsetUnit.textContent = formatUnitLabel(getDistanceUnitMeta().label);
    els.bowOffsetUnit.style.display = enabled ? "" : "none";
  }
  if (els.bowOffsetNa) {
    els.bowOffsetNa.style.display = enabled ? "none" : "";
  }
  if (els.bowOffsetLabel) {
    els.bowOffsetLabel.style.display = enabled ? "" : "none";
  }
}
const GPS_OPTIONS_RACE = {
  enableHighAccuracy: true,
  maximumAge: 0,
  timeout: 5000,
};
const GPS_OPTIONS_SETUP = {
  enableHighAccuracy: false,
  maximumAge: 10000,
  timeout: 20000,
};

const els = {
  latA: document.getElementById("lat-a"),
  lonA: document.getElementById("lon-a"),
  latB: document.getElementById("lat-b"),
  lonB: document.getElementById("lon-b"),
  coordsFormatBtn: document.getElementById("coords-format"),
  coordsFormatDD: document.getElementById("coords-format-dd"),
  coordsFormatDDM: document.getElementById("coords-format-ddm"),
  coordsFormatDMS: document.getElementById("coords-format-dms"),
  ddm: {
    latA: {
      deg: document.getElementById("lat-a-deg-ddm"),
      min: document.getElementById("lat-a-min-ddm"),
      minDec: document.getElementById("lat-a-min-dec-ddm"),
      hemi: document.getElementById("lat-a-hemi-ddm"),
    },
    lonA: {
      deg: document.getElementById("lon-a-deg-ddm"),
      min: document.getElementById("lon-a-min-ddm"),
      minDec: document.getElementById("lon-a-min-dec-ddm"),
      hemi: document.getElementById("lon-a-hemi-ddm"),
    },
    latB: {
      deg: document.getElementById("lat-b-deg-ddm"),
      min: document.getElementById("lat-b-min-ddm"),
      minDec: document.getElementById("lat-b-min-dec-ddm"),
      hemi: document.getElementById("lat-b-hemi-ddm"),
    },
    lonB: {
      deg: document.getElementById("lon-b-deg-ddm"),
      min: document.getElementById("lon-b-min-ddm"),
      minDec: document.getElementById("lon-b-min-dec-ddm"),
      hemi: document.getElementById("lon-b-hemi-ddm"),
    },
  },
  dms: {
    latA: {
      deg: document.getElementById("lat-a-deg-dms"),
      min: document.getElementById("lat-a-min-dms"),
      sec: document.getElementById("lat-a-sec-dms"),
      secDec: document.getElementById("lat-a-sec-dec-dms"),
      hemi: document.getElementById("lat-a-hemi-dms"),
    },
    lonA: {
      deg: document.getElementById("lon-a-deg-dms"),
      min: document.getElementById("lon-a-min-dms"),
      sec: document.getElementById("lon-a-sec-dms"),
      secDec: document.getElementById("lon-a-sec-dec-dms"),
      hemi: document.getElementById("lon-a-hemi-dms"),
    },
    latB: {
      deg: document.getElementById("lat-b-deg-dms"),
      min: document.getElementById("lat-b-min-dms"),
      sec: document.getElementById("lat-b-sec-dms"),
      secDec: document.getElementById("lat-b-sec-dec-dms"),
      hemi: document.getElementById("lat-b-hemi-dms"),
    },
    lonB: {
      deg: document.getElementById("lon-b-deg-dms"),
      min: document.getElementById("lon-b-min-dms"),
      sec: document.getElementById("lon-b-sec-dms"),
      secDec: document.getElementById("lon-b-sec-dec-dms"),
      hemi: document.getElementById("lon-b-hemi-dms"),
    },
  },
  lineStatus: document.getElementById("line-status"),
  openMap: document.getElementById("open-map"),
  openCoords: document.getElementById("open-coords"),
  openLocation: document.getElementById("open-location"),
  openSettings: document.getElementById("open-settings"),
  loadLine: document.getElementById("load-line"),
  saveLine: document.getElementById("save-line"),
  loadModal: document.getElementById("load-line-modal"),
  savedLinesList: document.getElementById("saved-lines-list"),
  confirmLoad: document.getElementById("confirm-load"),
  confirmDelete: document.getElementById("confirm-delete"),
  closeLoad: document.getElementById("close-load"),
  useA: document.getElementById("use-a"),
  useB: document.getElementById("use-b"),
  statusDistance: document.getElementById("status-distance"),
  statusLineName: document.getElementById("status-line-name"),
  statusLineLength: document.getElementById("status-line-length"),
  statusDistanceValue: document.getElementById("status-distance-value"),
  statusDistanceUnit: document.getElementById("status-distance-unit"),
  statusLineLengthValue: document.getElementById("status-line-length-value"),
  statusLineLengthUnit: document.getElementById("status-line-length-unit"),
  statusStartTime: document.getElementById("status-start-time"),
  statusTime: document.getElementById("status-time"),
  absoluteTime: document.getElementById("absolute-time"),
  gpsIcon: document.getElementById("gps-icon"),
  projDirect: document.getElementById("proj-direct"),
  distDirect: document.getElementById("dist-direct"),
  projClosing: document.getElementById("proj-closing"),
  closingRate: document.getElementById("closing-rate"),
  raceCountdown: document.getElementById("race-countdown"),
  raceStartClock: document.getElementById("race-start-clock"),
  raceMetricLabelDirect: document.getElementById("race-label-direct"),
  raceMetricLabelClosing: document.getElementById("race-label-closing"),
  raceHintUnitDirect: document.getElementById("race-hint-unit-direct"),
  raceHintUnitClosing: document.getElementById("race-hint-unit-closing"),
  raceMetricDistance: document.getElementById("race-metric-distance"),
  raceMetricTime: document.getElementById("race-metric-time"),
  raceProjDirect: document.getElementById("race-proj-direct"),
  raceProjClosing: document.getElementById("race-proj-closing"),
  racePlus: document.getElementById("race-plus"),
  raceMinus: document.getElementById("race-minus"),
  syncRace: document.getElementById("sync-race"),
  countdownHours: document.getElementById("countdown-hours"),
  countdownMinutes: document.getElementById("countdown-minutes"),
  countdownSeconds: document.getElementById("countdown-seconds"),
  setCountdown: document.getElementById("set-countdown"),
  setAbsolute: document.getElementById("set-absolute"),
  goRace: document.getElementById("go-race"),
  closeRace: document.getElementById("close-race"),
  coordsDoneTop: document.getElementById("coords-done-top"),
  closeCoords: document.getElementById("close-coords"),
  closeLocation: document.getElementById("close-location"),
  closeSettings: document.getElementById("close-settings"),
  kalmanOn: document.getElementById("kalman-on"),
  kalmanOff: document.getElementById("kalman-off"),
  bowOffset: document.getElementById("bow-offset"),
  bowOffsetUnit: document.getElementById("bow-offset-unit"),
  bowOffsetNa: document.getElementById("bow-offset-na"),
  bowOffsetLabel: document.getElementById("bow-offset-label"),
  soundOn: document.getElementById("sound-on"),
  soundOff: document.getElementById("sound-off"),
  timeFormat24: document.getElementById("time-format-24"),
  timeFormat12: document.getElementById("time-format-12"),
  speedUnitMs: document.getElementById("speed-unit-ms"),
  speedUnitKn: document.getElementById("speed-unit-kn"),
  speedUnitMph: document.getElementById("speed-unit-mph"),
  distanceUnitM: document.getElementById("distance-unit-m"),
  distanceUnitFt: document.getElementById("distance-unit-ft"),
  distanceUnitYd: document.getElementById("distance-unit-yd"),
  debugPanel: document.getElementById("debug-panel"),
  debugGpsToggle: document.getElementById("debug-gps-toggle"),
  openTrack: document.getElementById("open-track"),
  closeTrack: document.getElementById("close-track"),
  trackCanvas: document.getElementById("track-canvas"),
  debugRefresh: document.getElementById("debug-refresh"),
};

const hemisphereGroups = {};

const state = {
  line: {
    a: { lat: null, lon: null },
    b: { lat: null, lon: null },
  },
  lineName: null,
  lineSourceId: null,
  coordsFormat: "dd",
  timeFormat: "24h",
  speedUnit: "ms",
  distanceUnit: "m",
  bowOffsetMeters: 0,
  soundEnabled: true,
  debugGpsEnabled: DEBUG_GPS_DEFAULT,
  useKalman: true,
  debugIntervalId: null,
  geoWatchId: null,
  gpsMode: "setup",
  start: {
    mode: "countdown",
    countdownSeconds: 300,
    absoluteTime: "",
    startTs: null,
    crossedEarly: false,
    freeze: null,
  },
  position: null,
  lastPosition: null,
  velocity: { x: 0, y: 0 },
  speed: 0,
  latestDistance: null,
  latestSignedDistance: null,
  raceMetric: "distance",
  savedLines: [],
  selectedLineId: null,
  wakeLock: null,
  gpsTrackRaw: [],
  gpsTrackFiltered: [],
  kalman: null,
  audio: {
    ctx: null,
    lastBeepSecond: null,
    unlocked: false,
    milestoneArmed: null,
    startBeeped: false,
  },
};

function toRadians(deg) {
  return (deg * Math.PI) / 180;
}

function createDebugPosition() {
  return {
    coords: {
      latitude: DEBUG_COORDS.lat,
      longitude: DEBUG_COORDS.lon,
      accuracy: 3,
      speed: DEBUG_SPEED,
      heading: DEBUG_HEADING,
    },
    timestamp: Date.now(),
  };
}

function initAudio() {
  if (state.audio.ctx) return;
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) return;
  state.audio.ctx = new AudioContext();
  if (state.audio.ctx.state === "suspended") {
    state.audio.ctx.resume().catch(() => {});
  }
}

function unlockAudio() {
  initAudio();
  if (!state.audio.ctx) return;
  if (state.audio.ctx.state === "suspended") {
    state.audio.ctx.resume().catch(() => {});
  }
  if (state.audio.unlocked) return;
  const ctx = state.audio.ctx;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  gain.gain.value = 0;
  osc.connect(gain);
  gain.connect(ctx.destination);
  const now = ctx.currentTime;
  osc.start(now);
  osc.stop(now + 0.02);
  state.audio.unlocked = true;
}

function ensureAudio() {
  if (!state.audio.ctx || state.audio.ctx.state === "closed") {
    state.audio.ctx = null;
    initAudio();
  }
  if (state.audio.ctx && state.audio.ctx.state === "suspended") {
    state.audio.ctx.resume().catch(() => {});
  }
}

function playBeep(durationMs = BEEP_DURATION_MS, frequency = BEEP_FREQUENCY) {
  if (!state.soundEnabled) return;
  ensureAudio();
  if (!state.audio.ctx) return;
  const ctx = state.audio.ctx;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "square";
  osc.frequency.value = frequency;
  gain.gain.value = 0.12;
  osc.connect(gain);
  gain.connect(ctx.destination);
  const now = ctx.currentTime;
  gain.gain.setValueAtTime(0.0, now);
  gain.gain.linearRampToValueAtTime(0.12, now + 0.01);
  gain.gain.linearRampToValueAtTime(0.0, now + durationMs / 1000);
  osc.start(now);
  osc.stop(now + durationMs / 1000 + 0.01);
}

function handleCountdownBeeps(deltaSeconds) {
  if (!document.body.classList.contains("race-mode")) {
    state.audio.lastBeepSecond = null;
    state.audio.milestoneArmed = null;
    return;
  }
  if (!Number.isFinite(deltaSeconds) || deltaSeconds <= 0) {
    state.audio.lastBeepSecond = null;
    state.audio.milestoneArmed = null;
    return;
  }
  const remaining = Math.floor(deltaSeconds);
  if (!state.audio.milestoneArmed) {
    state.audio.milestoneArmed = {
      300: false,
      240: false,
      60: false,
    };
  }
  [300, 240, 60].forEach((milestone) => {
    if (remaining > milestone) {
      state.audio.milestoneArmed[milestone] = true;
      return;
    }
    if (state.audio.milestoneArmed[milestone]) {
      playBeep(milestone === 60 ? LONG_BEEP_DURATION_MS : BEEP_DURATION_MS);
      state.audio.milestoneArmed[milestone] = false;
    }
  });
  if (remaining > 10) {
    state.audio.lastBeepSecond = null;
    return;
  }
  if (remaining === 0) {
    if (!state.audio.startBeeped) {
      playBeep(START_BEEP_DURATION_MS, START_BEEP_FREQUENCY);
      state.audio.startBeeped = true;
    }
    state.audio.lastBeepSecond = remaining;
    return;
  }
  if (remaining === state.audio.lastBeepSecond) return;
  state.audio.lastBeepSecond = remaining;
  playBeep();
}

function resetBeepState() {
  state.audio.lastBeepSecond = null;
  state.audio.milestoneArmed = null;
  state.audio.startBeeped = false;
}

function setRaceTimingControlsEnabled(enabled) {
  const disabled = !enabled;
  if (els.racePlus) els.racePlus.disabled = disabled;
  if (els.raceMinus) els.raceMinus.disabled = disabled;
  if (els.syncRace) els.syncRace.disabled = disabled;
}

async function requestWakeLock() {
  if (!("wakeLock" in navigator)) return;
  try {
    if (state.wakeLock) return;
    state.wakeLock = await navigator.wakeLock.request("screen");
  } catch (err) {
    console.warn("Wake lock failed", err);
  }
}

function releaseWakeLock() {
  if (!state.wakeLock) return;
  state.wakeLock.release().catch(() => {});
  state.wakeLock = null;
}

function toMeters(point, origin) {
  const latRad = toRadians(point.lat);
  const lonRad = toRadians(point.lon);
  const originLatRad = toRadians(origin.lat);
  const originLonRad = toRadians(origin.lon);
  const x = (lonRad - originLonRad) * Math.cos(originLatRad) * EARTH_RADIUS;
  const y = (latRad - originLatRad) * EARTH_RADIUS;
  return { x, y };
}

function fromMeters(point, origin) {
  const originLatRad = toRadians(origin.lat);
  const lat = origin.lat + (point.y / EARTH_RADIUS) * (180 / Math.PI);
  const lon =
    origin.lon +
    (point.x / (EARTH_RADIUS * Math.cos(originLatRad))) * (180 / Math.PI);
  return { lat, lon };
}

function applyForwardOffset(position, velocity, offsetMeters) {
  if (!position || !velocity) return position;
  if (!Number.isFinite(offsetMeters) || offsetMeters <= 0) return position;
  const speed = Math.hypot(velocity.x, velocity.y);
  if (!Number.isFinite(speed) || speed <= 0) return position;
  const unit = { x: velocity.x / speed, y: velocity.y / speed };
  const origin = { lat: position.coords.latitude, lon: position.coords.longitude };
  const coords = fromMeters(
    { x: unit.x * offsetMeters, y: unit.y * offsetMeters },
    origin
  );
  return {
    coords: {
      latitude: coords.lat,
      longitude: coords.lon,
      accuracy: position.coords.accuracy,
    },
    timestamp: position.timestamp,
  };
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

function getSpeedUnitMeta() {
  const key = normalizeSpeedUnit(state.speedUnit);
  return SPEED_UNITS[key] || SPEED_UNITS.ms;
}

function getDistanceUnitMeta() {
  const key = normalizeDistanceUnit(state.distanceUnit);
  return DISTANCE_UNITS[key] || DISTANCE_UNITS.m;
}

function formatDistanceValue(value) {
  if (!Number.isFinite(value)) {
    return "--";
  }
  const { factor } = getDistanceUnitMeta();
  const abs = Math.abs(value) * factor;
  return String(Math.round(abs));
}

function formatDistanceWithUnit(value) {
  const { label } = getDistanceUnitMeta();
  const unitLabel = formatUnitLabel(label);
  if (!Number.isFinite(value)) {
    return `-- ${unitLabel}`;
  }
  return `${formatDistanceValue(value)} ${unitLabel}`;
}

function formatMeters(value) {
  return formatDistanceValue(value);
}

function formatRate(value) {
  const { factor, label } = getSpeedUnitMeta();
  const unitLabel = formatUnitLabel(label);
  if (!Number.isFinite(value)) {
    return `-- ${unitLabel}`;
  }
  const rounded = Math.round(value * factor);
  return `${rounded} ${unitLabel}`;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function formatClockTime(date, includeSeconds) {
  const format = normalizeTimeFormat(state.timeFormat);
  const locale = format === "12h" ? "en-US" : "en-GB";
  const options = {
    hour: "2-digit",
    minute: "2-digit",
    hour12: format === "12h",
  };
  if (includeSeconds) {
    options.second = "2-digit";
  }
  return date.toLocaleTimeString(locale, options);
}

function formatTimeInput(date) {
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");
  return `${hours}:${minutes}:${seconds}`;
}

function parseTimeInput(value) {
  if (!value) return null;
  const parts = value.split(":").map((part) => Number.parseInt(part, 10));
  const hours = parts[0];
  const minutes = parts[1];
  const seconds = parts.length > 2 ? parts[2] : 0;
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  const date = new Date();
  date.setHours(hours, minutes, Number.isFinite(seconds) ? seconds : 0, 0);
  return date;
}

function formatTimeRemainingHMSFull(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return "--:--:--";
  }
  const total = Math.floor(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(
    2,
    "0"
  )}:${String(secs).padStart(2, "0")}`;
}

function splitDurationSeconds(totalSeconds) {
  const safe = Math.max(0, Number.parseInt(totalSeconds, 10) || 0);
  return {
    hours: Math.floor(safe / 3600),
    minutes: Math.floor((safe % 3600) / 60),
    seconds: safe % 60,
  };
}

function formatDurationInput(totalSeconds) {
  const { hours, minutes, seconds } = splitDurationSeconds(totalSeconds);
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(
    2,
    "0"
  )}:${String(seconds).padStart(2, "0")}`;
}

function parseDurationInput(value) {
  if (!value) return 0;
  const parts = value.split(":").map((part) => Number.parseInt(part, 10));
  if (parts.length === 2) {
    const [hours, minutes] = parts;
    return (hours || 0) * 3600 + (minutes || 0) * 60;
  }
  if (parts.length === 3) {
    const [hours, minutes, seconds] = parts;
    return (hours || 0) * 3600 + (minutes || 0) * 60 + (seconds || 0);
  }
  return 0;
}

function syncCountdownPicker() {
  if (!els.countdownHours || !els.countdownMinutes || !els.countdownSeconds) return;
  const { hours, minutes, seconds } = splitDurationSeconds(state.start.countdownSeconds);
  setNumberInputValue(els.countdownHours, hours);
  setNumberInputValue(els.countdownMinutes, minutes);
  setNumberInputValue(els.countdownSeconds, seconds);
}

function getCountdownSecondsFromPicker() {
  if (!els.countdownHours || !els.countdownMinutes || !els.countdownSeconds) {
    return state.start.countdownSeconds;
  }
  const hours = Number.parseInt(els.countdownHours.value, 10) || 0;
  const minutes = Number.parseInt(els.countdownMinutes.value, 10) || 0;
  const seconds = Number.parseInt(els.countdownSeconds.value, 10) || 0;
  return hours * 3600 + minutes * 60 + seconds;
}

function formatOverUnder(value) {
  if (!Number.isFinite(value)) {
    return `-- ${formatUnitLabel(getDistanceUnitMeta().label)}`;
  }
  if (value < 0) {
    return `Over by ${formatDistanceWithUnit(value)}`;
  }
  return `Under by ${formatDistanceWithUnit(value)}`;
}

function formatRaceSign(value) {
  if (!Number.isFinite(value)) {
    return "--";
  }
  return value < 0 ? "+" : "-";
}

function formatRaceDelta(value) {
  if (!Number.isFinite(value)) {
    return "--";
  }
  const limitMeters = 250;
  const limitDisplay = Math.round(limitMeters * getDistanceUnitMeta().factor);
  if (value < -limitMeters) {
    return `< -${limitDisplay}`;
  }
  if (value > limitMeters) {
    return `> ${limitDisplay}`;
  }
  const abs = formatDistanceValue(value);
  return value < 0 ? `+${abs}` : `-${abs}`;
}

function formatRaceTimeDelta(deltaSeconds) {
  if (!Number.isFinite(deltaSeconds)) {
    return "--";
  }
  if (deltaSeconds > 600) {
    return "> 10:00";
  }
  if (deltaSeconds < -600) {
    return "< 10:00";
  }
  const total = Math.round(Math.abs(deltaSeconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  const value = hours
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`
    : `${minutes}:${String(secs).padStart(2, "0")}`;
  if (total === 0) {
    return "0:00";
  }
  const sign = deltaSeconds < 0 ? "+" : "-";
  return `${sign}${value}`;
}

function computeTimeDeltaFromRate(projectedDistance, rate) {
  if (!Number.isFinite(projectedDistance) || !Number.isFinite(rate) || rate <= 0) {
    return Number.NaN;
  }
  return projectedDistance / rate;
}

function getRaceMetricLabel() {
  return state.raceMetric === "time"
    ? "Time to Line at Start"
    : "Distance to Line at Start";
}

function getRaceMetricValues(projectedDirect, projectedClosing, speed, closingRate) {
  const isClosing = Number.isFinite(closingRate) && closingRate > 0;
  if (state.raceMetric === "time") {
    return {
      direct: formatRaceTimeDelta(computeTimeDeltaFromRate(projectedDirect, speed)),
      closing: isClosing
        ? formatRaceTimeDelta(computeTimeDeltaFromRate(projectedClosing, closingRate))
        : "--",
    };
  }
  return {
    direct: formatRaceDelta(projectedDirect),
    closing: isClosing ? formatRaceDelta(projectedClosing) : "--",
  };
}

function updateRaceMetricLabels() {
  const label = getRaceMetricLabel();
  if (els.raceMetricLabelDirect) {
    els.raceMetricLabelDirect.textContent = label;
  }
  if (els.raceMetricLabelClosing) {
    els.raceMetricLabelClosing.textContent = label;
  }
  updateRaceHintUnits();
  fitRaceText();
  if (els.raceMetricDistance) {
    els.raceMetricDistance.setAttribute(
      "aria-pressed",
      state.raceMetric === "time" ? "false" : "true"
    );
  }
  if (els.raceMetricTime) {
    els.raceMetricTime.setAttribute(
      "aria-pressed",
      state.raceMetric === "time" ? "true" : "false"
    );
  }
}

function setRaceMetric(metric) {
  state.raceMetric = metric === "time" ? "time" : "distance";
  updateRaceMetricLabels();
  updateLineProjection();
}

function updateKalmanToggle() {
  if (els.kalmanOn) {
    els.kalmanOn.setAttribute("aria-pressed", state.useKalman ? "true" : "false");
  }
  if (els.kalmanOff) {
    els.kalmanOff.setAttribute("aria-pressed", state.useKalman ? "false" : "true");
  }
}

function updateSoundToggle() {
  if (els.soundOn) {
    els.soundOn.setAttribute("aria-pressed", state.soundEnabled ? "true" : "false");
  }
  if (els.soundOff) {
    els.soundOff.setAttribute("aria-pressed", state.soundEnabled ? "false" : "true");
  }
}

function updateTimeFormatToggle() {
  const format = normalizeTimeFormat(state.timeFormat);
  if (els.timeFormat24) {
    els.timeFormat24.setAttribute("aria-pressed", format === "24h" ? "true" : "false");
  }
  if (els.timeFormat12) {
    els.timeFormat12.setAttribute("aria-pressed", format === "12h" ? "true" : "false");
  }
}

function updateSpeedUnitToggle() {
  const unit = normalizeSpeedUnit(state.speedUnit);
  if (els.speedUnitMs) {
    els.speedUnitMs.setAttribute("aria-pressed", unit === "ms" ? "true" : "false");
  }
  if (els.speedUnitKn) {
    els.speedUnitKn.setAttribute("aria-pressed", unit === "kn" ? "true" : "false");
  }
  if (els.speedUnitMph) {
    els.speedUnitMph.setAttribute("aria-pressed", unit === "mph" ? "true" : "false");
  }
}

function updateDistanceUnitToggle() {
  const unit = normalizeDistanceUnit(state.distanceUnit);
  if (els.distanceUnitM) {
    els.distanceUnitM.setAttribute("aria-pressed", unit === "m" ? "true" : "false");
  }
  if (els.distanceUnitFt) {
    els.distanceUnitFt.setAttribute("aria-pressed", unit === "ft" ? "true" : "false");
  }
  if (els.distanceUnitYd) {
    els.distanceUnitYd.setAttribute("aria-pressed", unit === "yd" ? "true" : "false");
  }
}

function updateStatusUnitLabels() {
  const unit = formatUnitLabel(getDistanceUnitMeta().label);
  if (els.statusDistanceUnit) {
    els.statusDistanceUnit.textContent = unit;
  }
  if (els.statusLineLengthUnit) {
    els.statusLineLengthUnit.textContent = unit;
  }
}

function updateRaceHintUnits() {
  const showUnit = state.raceMetric === "distance";
  const unit = formatUnitLabel(getDistanceUnitMeta().label);
  if (els.raceHintUnitDirect) {
    els.raceHintUnitDirect.textContent = unit;
    els.raceHintUnitDirect.style.display = showUnit ? "" : "none";
  }
  if (els.raceHintUnitClosing) {
    els.raceHintUnitClosing.textContent = unit;
    els.raceHintUnitClosing.style.display = showUnit ? "" : "none";
  }
}


function setKalmanEnabled(enabled) {
  state.useKalman = Boolean(enabled);
  if (!state.useKalman) {
    state.kalman = null;
    state.gpsTrackFiltered = [];
  }
  saveSettings();
  updateKalmanToggle();
  syncBowOffsetInput();
}

function setSoundEnabled(enabled) {
  state.soundEnabled = Boolean(enabled);
  saveSettings();
  updateSoundToggle();
}

function setTimeFormat(format) {
  state.timeFormat = normalizeTimeFormat(format);
  saveSettings();
  updateTimeFormatToggle();
  updateCurrentTime();
  updateStartDisplay();
}

function setSpeedUnit(unit) {
  state.speedUnit = normalizeSpeedUnit(unit);
  saveSettings();
  updateSpeedUnitToggle();
  updateLineProjection();
  updateGPSDisplay();
}

function setDistanceUnit(unit) {
  state.distanceUnit = normalizeDistanceUnit(unit);
  saveSettings();
  updateDistanceUnitToggle();
  updateStatusUnitLabels();
  updateRaceHintUnits();
  syncBowOffsetInput();
  updateLineProjection();
  updateGPSDisplay();
}

function updateRaceValueStyles(directOver, closingOver) {
  if (els.raceProjDirect) {
    els.raceProjDirect.classList.toggle("race-value-over", Boolean(directOver));
  }
  if (els.raceProjClosing) {
    els.raceProjClosing.classList.toggle("race-value-over", Boolean(closingOver));
  }
}

function appendTrackPoint(list, point) {
  list.push(point);
  if (list.length > TRACK_MAX_POINTS) {
    list.splice(0, list.length - TRACK_MAX_POINTS);
  }
}

function pruneTrackPoints(list, cutoff) {
  for (let i = list.length - 1; i >= 0; i -= 1) {
    if (list[i].ts < cutoff) {
      list.splice(0, i + 1);
      break;
    }
  }
}

function recordTrackPoints(rawPosition, filteredPosition) {
  if (!rawPosition) return;
  const cutoff = Date.now() - TRACK_WINDOW_MS;
  appendTrackPoint(state.gpsTrackRaw, {
    lat: rawPosition.coords.latitude,
    lon: rawPosition.coords.longitude,
    ts: rawPosition.timestamp || Date.now(),
  });
  pruneTrackPoints(state.gpsTrackRaw, cutoff);
  if (filteredPosition) {
    appendTrackPoint(state.gpsTrackFiltered, {
      lat: filteredPosition.coords.latitude,
      lon: filteredPosition.coords.longitude,
      ts: filteredPosition.timestamp || Date.now(),
    });
    pruneTrackPoints(state.gpsTrackFiltered, cutoff);
  }
  if (document.body.classList.contains("track-mode")) {
    renderTrack();
  }
}

function renderTrack() {
  if (!els.trackCanvas) return;
  const canvas = els.trackCanvas;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const dpr = window.devicePixelRatio || 1;
  const width = canvas.clientWidth || 300;
  const height = canvas.clientHeight || 300;
  canvas.width = Math.max(1, Math.round(width * dpr));
  canvas.height = Math.max(1, Math.round(height * dpr));
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.scale(dpr, dpr);

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);

  const rawPoints = state.gpsTrackRaw;
  const filteredPoints = state.gpsTrackFiltered;
  const allPoints = rawPoints.length ? rawPoints : filteredPoints;
  if (!allPoints.length) {
    ctx.fillStyle = "#666666";
    ctx.font = "14px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("No GPS data yet", width / 2, height / 2);
    return;
  }

  const meanLat =
    allPoints.reduce((sum, p) => sum + p.lat, 0) / allPoints.length;
  const meanLon =
    allPoints.reduce((sum, p) => sum + p.lon, 0) / allPoints.length;
  const origin = { lat: meanLat, lon: meanLon };

  const toXY = (point) => toMeters(point, origin);
  const collectBounds = (points) => {
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    points.forEach((point) => {
      const xy = toXY(point);
      minX = Math.min(minX, xy.x);
      maxX = Math.max(maxX, xy.x);
      minY = Math.min(minY, xy.y);
      maxY = Math.max(maxY, xy.y);
    });
    return { minX, maxX, minY, maxY };
  };

  let bounds = collectBounds(allPoints);
  if (filteredPoints.length) {
    const filteredBounds = collectBounds(filteredPoints);
    bounds = {
      minX: Math.min(bounds.minX, filteredBounds.minX),
      maxX: Math.max(bounds.maxX, filteredBounds.maxX),
      minY: Math.min(bounds.minY, filteredBounds.minY),
      maxY: Math.max(bounds.maxY, filteredBounds.maxY),
    };
  }

  const padding = 16;
  const spanX = Math.max(1, bounds.maxX - bounds.minX);
  const spanY = Math.max(1, bounds.maxY - bounds.minY);
  const scale = Math.min(
    (width - padding * 2) / spanX,
    (height - padding * 2) / spanY
  );

  const project = (point) => {
    const xy = toXY(point);
    const x = padding + (xy.x - bounds.minX) * scale;
    const y = padding + (bounds.maxY - xy.y) * scale;
    return { x, y };
  };
  const projectMeters = (xMeters, yMeters) => {
    const x = padding + (xMeters - bounds.minX) * scale;
    const y = padding + (bounds.maxY - yMeters) * scale;
    return { x, y };
  };

  const drawLine = (points, color, lineWidth) => {
    if (!points.length) return;
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.beginPath();
    points.forEach((point, index) => {
      const { x, y } = project(point);
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
  };

  const gridSpacing = 10;
  const gridStartX = Math.floor(bounds.minX / gridSpacing) * gridSpacing;
  const gridEndX = Math.ceil(bounds.maxX / gridSpacing) * gridSpacing;
  const gridStartY = Math.floor(bounds.minY / gridSpacing) * gridSpacing;
  const gridEndY = Math.ceil(bounds.maxY / gridSpacing) * gridSpacing;

  ctx.strokeStyle = "#e2e2e2";
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = gridStartX; x <= gridEndX; x += gridSpacing) {
    const p1 = projectMeters(x, bounds.minY);
    const p2 = projectMeters(x, bounds.maxY);
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
  }
  for (let y = gridStartY; y <= gridEndY; y += gridSpacing) {
    const p1 = projectMeters(bounds.minX, y);
    const p2 = projectMeters(bounds.maxX, y);
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
  }
  ctx.stroke();

  drawLine(rawPoints, "#9a9a9a", 2);
  drawLine(filteredPoints, "#000000", 2.5);

  const latest = (filteredPoints.length ? filteredPoints : rawPoints)[
    (filteredPoints.length ? filteredPoints : rawPoints).length - 1
  ];
  if (latest) {
    const { x, y } = project(latest);
    ctx.fillStyle = "#000000";
    ctx.beginPath();
    ctx.arc(x, y, 3, 0, Math.PI * 2);
    ctx.fill();
  }
}

function fitRaceValues() {
  const values = [els.raceProjDirect, els.raceProjClosing].filter(Boolean);
  if (window.matchMedia("(orientation: portrait)").matches && els.raceCountdown) {
    values.push(els.raceCountdown);
  }
  if (!values.length) return;
  if (values.some((element) => element.clientWidth === 0 || element.clientHeight === 0)) {
    return;
  }

  values.forEach((element) => {
    element.style.fontSize = "";
  });

  const baseSize = Math.max(
    ...values.map((element) => parseFloat(window.getComputedStyle(element).fontSize) || 16)
  );
  const maxSize = Math.max(
    baseSize,
    Math.min(240, Math.max(...values.map((element) => element.clientHeight || 0)))
  );
  const minSize = Math.min(14, maxSize);
  const precision = 0.5;
  let low = Math.round(minSize / precision);
  let high = Math.round(maxSize / precision);
  let best = low;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const size = mid * precision;
    values.forEach((element) => {
      element.style.fontSize = `${size}px`;
    });
    const fits = values.every(
      (element) =>
        element.scrollWidth <= element.clientWidth &&
        element.scrollHeight <= element.clientHeight
    );
    if (fits) {
      best = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  const finalSize = best * precision;
  values.forEach((element) => {
    element.style.fontSize = `${finalSize}px`;
  });
}

function fitRaceText() {
  if (!document.body.classList.contains("race-mode")) return;
  fitRaceValues();
  const targets = document.querySelectorAll(".race-block .race-label, .race-block .race-hint");
  targets.forEach((element) => {
    if (!element || element.clientWidth === 0) return;
    const minSize = 10;
    element.style.fontSize = "";
    const baseSize = parseFloat(window.getComputedStyle(element).fontSize) || 16;
    let size = baseSize;
    element.style.fontSize = `${size}px`;
    let guard = 0;
    while (
      (element.scrollWidth > element.clientWidth ||
        element.scrollHeight > element.clientHeight) &&
      size > minSize &&
      guard < 24
    ) {
      size -= 0.5;
      element.style.fontSize = `${size}px`;
      guard += 1;
    }
  });
}

function formatTimeRemaining(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return "--";
  }
  const total = Math.floor(seconds);
  if (total < 60) {
    return String(total);
  }
  if (total < 3600) {
    const minutes = Math.floor(total / 60);
    const secs = total % 60;
    return `${minutes}:${String(secs).padStart(2, "0")}`;
  }
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  return `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(
    2,
    "0"
  )}`;
}

function formatTimeRemainingHMS(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return "--:--:--";
  }
  const total = Math.floor(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hours === 0) {
    return `${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(
    2,
    "0"
  )}:${String(secs).padStart(2, "0")}`;
}

function loadSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    state.line = parsed.line || state.line;
    if (parsed.coordsFormat === "dd" || parsed.coordsFormat === "ddm" || parsed.coordsFormat === "dms") {
      state.coordsFormat = parsed.coordsFormat;
    }
    if (parsed.lineMeta) {
      state.lineName = parsed.lineMeta.name || null;
      state.lineSourceId = parsed.lineMeta.sourceId || null;
    }
    if (typeof parsed.debugGpsEnabled === "boolean") {
      state.debugGpsEnabled = parsed.debugGpsEnabled;
    }
    if (typeof parsed.useKalman === "boolean") {
      state.useKalman = parsed.useKalman;
    }
    const bowOffset = Number.parseFloat(parsed.bowOffsetMeters);
    if (Number.isFinite(bowOffset)) {
      state.bowOffsetMeters = bowOffset;
    }
    if (typeof parsed.soundEnabled === "boolean") {
      state.soundEnabled = parsed.soundEnabled;
    }
    if (parsed.timeFormat === "12h" || parsed.timeFormat === "24h") {
      state.timeFormat = parsed.timeFormat;
    }
    if (parsed.speedUnit === "ms" || parsed.speedUnit === "kn" || parsed.speedUnit === "mph") {
      state.speedUnit = parsed.speedUnit;
    }
    if (parsed.distanceUnit === "m" || parsed.distanceUnit === "ft" || parsed.distanceUnit === "yd") {
      state.distanceUnit = parsed.distanceUnit;
    }
    state.start = { ...state.start, ...parsed.start };
    delete state.start.preStartSign;
  } catch (err) {
    console.warn("Failed to load settings", err);
  }
}

function saveSettings() {
  const payload = {
    line: state.line,
    lineMeta: {
      name: state.lineName,
      sourceId: state.lineSourceId,
    },
    coordsFormat: state.coordsFormat,
    debugGpsEnabled: state.debugGpsEnabled,
    useKalman: state.useKalman,
    bowOffsetMeters: state.bowOffsetMeters,
    soundEnabled: state.soundEnabled,
    timeFormat: state.timeFormat,
    speedUnit: state.speedUnit,
    distanceUnit: state.distanceUnit,
    start: {
      mode: state.start.mode,
      countdownSeconds: state.start.countdownSeconds,
      absoluteTime: state.start.absoluteTime,
      startTs: state.start.startTs,
      crossedEarly: state.start.crossedEarly,
    },
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
}

function loadSavedLines() {
  try {
    const raw = localStorage.getItem(LINES_KEY);
    state.savedLines = raw ? JSON.parse(raw) : [];
  } catch (err) {
    console.warn("Failed to load saved lines", err);
    state.savedLines = [];
  }
}

function updateLineNameDisplay() {
  if (!els.statusLineName) return;
  els.statusLineName.textContent = state.lineName || "--";
}

function syncLineNameWithSavedLines() {
  if (!state.lineSourceId) {
    updateLineNameDisplay();
    return;
  }
  const exists = state.savedLines.some((line) => line.id === state.lineSourceId);
  if (!exists) {
    state.lineName = null;
    state.lineSourceId = null;
    saveSettings();
  }
  updateLineNameDisplay();
}

function saveSavedLines() {
  localStorage.setItem(LINES_KEY, JSON.stringify(state.savedLines));
}

function openLoadModal() {
  if (!els.savedLinesList) return;
  state.selectedLineId = null;
  renderSavedLinesList();
  document.body.classList.add("modal-open");
  if (els.loadModal) {
    els.loadModal.setAttribute("aria-hidden", "false");
  }
}

function closeLoadModal() {
  document.body.classList.remove("modal-open");
  if (els.loadModal) {
    els.loadModal.setAttribute("aria-hidden", "true");
  }
}

function renderSavedLinesList() {
  if (!els.savedLinesList) return;
  els.savedLinesList.innerHTML = "";
  if (!state.savedLines.length) {
    const empty = document.createElement("div");
    empty.className = "hint";
    empty.textContent = "No saved lines yet.";
    els.savedLinesList.appendChild(empty);
    updateModalButtons();
    return;
  }
  state.savedLines.forEach((line) => {
    const row = document.createElement("div");
    row.className = "modal-item";
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = line.name;
    if (state.selectedLineId === line.id) {
      button.classList.add("selected");
    }
    button.addEventListener("click", () => {
      state.selectedLineId = line.id;
      renderSavedLinesList();
    });
    row.appendChild(button);
    els.savedLinesList.appendChild(row);
  });
  updateModalButtons();
}

function updateModalButtons() {
  const hasSelection = Boolean(state.selectedLineId);
  if (els.confirmLoad) {
    els.confirmLoad.disabled = !hasSelection;
  }
  if (els.confirmDelete) {
    els.confirmDelete.disabled = !hasSelection;
  }
}

function updateInputs() {
  syncCoordinateInputs();
  syncCountdownPicker();
  updateKalmanToggle();
  syncBowOffsetInput();
  updateSoundToggle();
  updateTimeFormatToggle();
  updateSpeedUnitToggle();
  updateDistanceUnitToggle();
  updateStatusUnitLabels();
  updateRaceHintUnits();
  els.absoluteTime.value = state.start.absoluteTime || "";
}

function normalizeCoordinateFormat(format) {
  if (format === "dd" || format === "ddm" || format === "dms") return format;
  return "dd";
}

function getCoordinateFormatLabel(format) {
  const normalized = normalizeCoordinateFormat(format);
  if (normalized === "ddm") return "Deg+Min";
  if (normalized === "dms") return "DMS";
  return "Decimal";
}

function syncCoordinateFormatUI() {
  const format = normalizeCoordinateFormat(state.coordsFormat);
  if (els.coordsFormatBtn) {
    els.coordsFormatBtn.textContent = `Format: ${getCoordinateFormatLabel(format)}`;
  }
  if (els.coordsDoneTop) {
    els.coordsDoneTop.hidden = format === "dd";
  }
  if (els.coordsFormatDD) els.coordsFormatDD.hidden = format !== "dd";
  if (els.coordsFormatDDM) els.coordsFormatDDM.hidden = format !== "ddm";
  if (els.coordsFormatDMS) els.coordsFormatDMS.hidden = format !== "dms";
}

function trimTrailingZeros(value) {
  if (!value.includes(".")) return value;
  return value.replace(/\.?0+$/, "");
}

function formatCoordinateValue(value, digits) {
  const fixed = value.toFixed(digits);
  const trimmed = trimTrailingZeros(fixed);
  return trimmed === "-0" ? "0" : trimmed;
}

function roundFraction(value, digits) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function formatFractionDigits(value, digits) {
  if (!Number.isFinite(value) || value <= 0) return "";
  const fixed = value.toFixed(digits);
  const parts = fixed.split(".");
  if (parts.length < 2) return "";
  return parts[1].replace(/0+$/, "");
}

function splitDecimalToDDM(value, kind) {
  const abs = Math.abs(value);
  let deg = Math.floor(abs);
  const minTotal = (abs - deg) * 60;
  let min = Math.floor(minTotal);
  let minFraction = roundFraction(minTotal - min, COORD_DECIMAL_DIGITS);
  if (minFraction >= 1) {
    min += 1;
    minFraction = 0;
  }
  if (min >= 60) {
    min = 0;
    deg += 1;
  }
  const hemi = kind === "lon" ? (value < 0 ? "W" : "E") : value < 0 ? "S" : "N";
  return { deg, min, minDec: formatFractionDigits(minFraction, COORD_DECIMAL_DIGITS), hemi };
}

function splitDecimalToDMS(value, kind) {
  const abs = Math.abs(value);
  let deg = Math.floor(abs);
  const minTotal = (abs - deg) * 60;
  let min = Math.floor(minTotal);
  const secTotal = (minTotal - min) * 60;
  let sec = Math.floor(secTotal);
  let secFraction = roundFraction(secTotal - sec, COORD_DECIMAL_DIGITS);
  if (secFraction >= 1) {
    sec += 1;
    secFraction = 0;
  }
  if (sec >= 60) {
    sec = 0;
    min += 1;
  }
  if (min >= 60) {
    min = 0;
    deg += 1;
  }
  const hemi = kind === "lon" ? (value < 0 ? "W" : "E") : value < 0 ? "S" : "N";
  return { deg, min, sec, secDec: formatFractionDigits(secFraction, COORD_DECIMAL_DIGITS), hemi };
}

function setNumberInputValue(input, value) {
  if (!input) return;
  if (!Number.isFinite(value)) {
    input.value = "";
    return;
  }
  input.value = String(value);
}

function setFixedInputValue(input, value, digits) {
  if (!input) return;
  if (!Number.isFinite(value)) {
    input.value = "";
    return;
  }
  input.value = formatCoordinateValue(value, digits);
}

function setDigitsInputValue(input, value) {
  if (!input) return;
  if (typeof value === "string") {
    input.value = value;
    return;
  }
  if (!Number.isFinite(value)) {
    input.value = "";
    return;
  }
  input.value = String(value);
}

function populateNumberSelect(select, options = {}) {
  if (!select) return;
  const min = Number.isFinite(options.min) ? options.min : 0;
  const max = Number.isFinite(options.max) ? options.max : 0;
  const pad = Number.isFinite(options.pad) ? options.pad : 0;
  const includePlaceholder = options.placeholder !== false;
  const previous = select.value;
  select.innerHTML = "";

  if (includePlaceholder) {
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "--";
    select.appendChild(placeholder);
  }

  for (let value = min; value <= max; value += 1) {
    const option = document.createElement("option");
    option.value = String(value);
    option.textContent = pad ? String(value).padStart(pad, "0") : String(value);
    select.appendChild(option);
  }

  if (previous !== "") {
    select.value = previous;
  }
}

function initCoordinatePickers() {
  const latDegreeSelects = [
    els.ddm.latA.deg,
    els.ddm.latB.deg,
    els.dms.latA.deg,
    els.dms.latB.deg,
  ].filter(Boolean);
  latDegreeSelects.forEach((select) => populateNumberSelect(select, { max: 90 }));

  const lonDegreeSelects = [
    els.ddm.lonA.deg,
    els.ddm.lonB.deg,
    els.dms.lonA.deg,
    els.dms.lonB.deg,
  ].filter(Boolean);
  lonDegreeSelects.forEach((select) => populateNumberSelect(select, { max: 180 }));

  const minuteSelects = [
    els.ddm.latA.min,
    els.ddm.lonA.min,
    els.ddm.latB.min,
    els.ddm.lonB.min,
    els.dms.latA.min,
    els.dms.lonA.min,
    els.dms.latB.min,
    els.dms.lonB.min,
  ].filter(Boolean);
  minuteSelects.forEach((select) => populateNumberSelect(select, { max: 59, pad: 2 }));

  const secondSelects = [
    els.dms.latA.sec,
    els.dms.lonA.sec,
    els.dms.latB.sec,
    els.dms.lonB.sec,
  ].filter(Boolean);
  secondSelects.forEach((select) => populateNumberSelect(select, { max: 59, pad: 2 }));
}

function initCountdownPicker() {
  populateNumberSelect(els.countdownHours, { max: 23, pad: 2, placeholder: false });
  populateNumberSelect(els.countdownMinutes, { max: 59, pad: 2, placeholder: false });
  populateNumberSelect(els.countdownSeconds, { max: 59, pad: 2, placeholder: false });
}


function applyDDMDegreeLimit(group, maxDegrees) {
  if (!group || !group.deg || !group.min || !group.minDec) return;
  const degrees = Number.parseInt(group.deg.value, 10);
  const limitHit = Number.isFinite(degrees) && degrees === maxDegrees;
  if (limitHit) {
    group.min.value = "0";
    group.minDec.value = "";
  }
  group.min.disabled = limitHit;
  group.minDec.disabled = limitHit;
}

function applyDMSDegreeLimit(group, maxDegrees) {
  if (!group || !group.deg || !group.min || !group.sec || !group.secDec) return;
  const degrees = Number.parseInt(group.deg.value, 10);
  const limitHit = Number.isFinite(degrees) && degrees === maxDegrees;
  if (limitHit) {
    group.min.value = "0";
    group.sec.value = "0";
    group.secDec.value = "";
  }
  group.min.disabled = limitHit;
  group.sec.disabled = limitHit;
  group.secDec.disabled = limitHit;
}

function applyCoordinatePickerConstraints() {
  applyDDMDegreeLimit(els.ddm.latA, 90);
  applyDDMDegreeLimit(els.ddm.lonA, 180);
  applyDDMDegreeLimit(els.ddm.latB, 90);
  applyDDMDegreeLimit(els.ddm.lonB, 180);
  applyDMSDegreeLimit(els.dms.latA, 90);
  applyDMSDegreeLimit(els.dms.lonA, 180);
  applyDMSDegreeLimit(els.dms.latB, 90);
  applyDMSDegreeLimit(els.dms.lonB, 180);
}

function handleCoordinateInputsChanged() {
  applyCoordinatePickerConstraints();
  parseLineInputs();
  updateInputs();
  updateLineStatus();
  updateLineProjection();
  refreshHemisphereButtons();
}

function refreshHemisphereButtons() {
  Object.values(hemisphereGroups).forEach(({ input, buttons }) => {
    const value = input.value || "";
    buttons.forEach((button) => {
      const isActive = button.dataset.value === value;
      button.classList.toggle("active", isActive);
      button.setAttribute("aria-pressed", isActive ? "true" : "false");
    });
  });
}

function initHemisphereToggles() {
  document.querySelectorAll(".coords-hemis").forEach((container) => {
    const target = container.dataset.target;
    const input = document.getElementById(target);
    if (!input) return;
    const buttons = Array.from(container.querySelectorAll(".coords-hemisphere"));
    if (!buttons.length) return;
    hemisphereGroups[target] = { input, buttons };
    buttons.forEach((button) => {
      button.addEventListener("click", () => {
        const next = button.dataset.value;
        if (input.value === next) return;
        input.value = next;
        handleCoordinateInputsChanged();
      });
    });
  });
}

function syncCoordinateInputs() {
  const activeFormat = normalizeCoordinateFormat(state.coordsFormat);
  syncCoordinateFormatUI();

  syncCoordinateField({
    value: state.line.a.lat,
    kind: "lat",
    activeFormat,
    dd: els.latA,
    ddm: els.ddm.latA,
    dms: els.dms.latA,
  });
  syncCoordinateField({
    value: state.line.a.lon,
    kind: "lon",
    activeFormat,
    dd: els.lonA,
    ddm: els.ddm.lonA,
    dms: els.dms.lonA,
  });
  syncCoordinateField({
    value: state.line.b.lat,
    kind: "lat",
    activeFormat,
    dd: els.latB,
    ddm: els.ddm.latB,
    dms: els.dms.latB,
  });
  syncCoordinateField({
    value: state.line.b.lon,
    kind: "lon",
    activeFormat,
    dd: els.lonB,
    ddm: els.ddm.lonB,
    dms: els.dms.lonB,
  });

  applyCoordinatePickerConstraints();
  refreshHemisphereButtons();
}

function syncCoordinateField({ value, kind, activeFormat, dd, ddm, dms }) {
  if (Number.isFinite(value)) {
    if (dd) setFixedInputValue(dd, value, COORD_DD_DIGITS);
    if (ddm && ddm.deg && ddm.min && ddm.minDec && ddm.hemi) {
      const parts = splitDecimalToDDM(value, kind);
      setNumberInputValue(ddm.deg, parts.deg);
      setNumberInputValue(ddm.min, parts.min);
      setDigitsInputValue(ddm.minDec, parts.minDec);
      ddm.hemi.value = parts.hemi;
    }
    if (dms && dms.deg && dms.min && dms.sec && dms.secDec && dms.hemi) {
      const parts = splitDecimalToDMS(value, kind);
      setNumberInputValue(dms.deg, parts.deg);
      setNumberInputValue(dms.min, parts.min);
      setNumberInputValue(dms.sec, parts.sec);
      setDigitsInputValue(dms.secDec, parts.secDec);
      dms.hemi.value = parts.hemi;
    }
    return;
  }

  if (activeFormat !== "dd" && dd) dd.value = "";
  if (activeFormat !== "ddm" && ddm) {
    if (ddm.deg) ddm.deg.value = "";
    if (ddm.min) ddm.min.value = "";
    if (ddm.minDec) ddm.minDec.value = "";
  }
  if (activeFormat !== "dms" && dms) {
    if (dms.deg) dms.deg.value = "";
    if (dms.min) dms.min.value = "";
    if (dms.sec) dms.sec.value = "";
    if (dms.secDec) dms.secDec.value = "";
  }
}

function parseDecimalDegreesInput(input) {
  if (!input) return null;
  const parsed = Number.parseFloat(input.value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseDigitFraction(input, maxDigits) {
  if (!input) return null;
  const raw = String(input.value || "").trim();
  if (!raw) return 0;
  if (raw.length > maxDigits) return null;
  if (!/^\d+$/.test(raw)) return null;
  const digits = Number.parseInt(raw, 10);
  if (!Number.isFinite(digits)) return null;
  return digits / 10 ** raw.length;
}

function parseDDMInput(group, kind) {
  if (!group || !group.deg || !group.min || !group.minDec || !group.hemi) return null;
  if (!group.deg.value || !group.min.value) return null;
  const deg = Number.parseInt(group.deg.value, 10);
  const minInt = Number.parseInt(group.min.value, 10);
  if (!Number.isFinite(deg) || !Number.isFinite(minInt)) return null;
  if (minInt < 0 || minInt >= 60) return null;
  const maxDeg = kind === "lon" ? 180 : 90;
  if (deg < 0 || deg > maxDeg) return null;
  const minFraction = parseDigitFraction(group.minDec, COORD_DECIMAL_DIGITS);
  if (minFraction === null) return null;
  const minutes = minInt + minFraction;
  if (minutes < 0 || minutes >= 60) return null;
  if (deg === maxDeg && minutes > 0) return null;
  const hemi = group.hemi.value;
  const sign =
    kind === "lon" ? (hemi === "W" ? -1 : hemi === "E" ? 1 : null) : hemi === "S" ? -1 : hemi === "N" ? 1 : null;
  if (sign === null) return null;
  return sign * (deg + minutes / 60);
}

function parseDMSInput(group, kind) {
  if (!group || !group.deg || !group.min || !group.sec || !group.secDec || !group.hemi) return null;
  if (!group.deg.value || !group.min.value || !group.sec.value) return null;
  const deg = Number.parseInt(group.deg.value, 10);
  const min = Number.parseInt(group.min.value, 10);
  const secInt = Number.parseInt(group.sec.value, 10);
  if (!Number.isFinite(deg) || !Number.isFinite(min) || !Number.isFinite(secInt)) return null;
  if (min < 0 || min >= 60) return null;
  if (secInt < 0 || secInt >= 60) return null;
  const maxDeg = kind === "lon" ? 180 : 90;
  if (deg < 0 || deg > maxDeg) return null;
  const secFraction = parseDigitFraction(group.secDec, COORD_DECIMAL_DIGITS);
  if (secFraction === null) return null;
  const sec = secInt + secFraction;
  if (sec < 0 || sec >= 60) return null;
  if (deg === maxDeg && (min > 0 || sec > 0)) return null;
  const hemi = group.hemi.value;
  const sign =
    kind === "lon" ? (hemi === "W" ? -1 : hemi === "E" ? 1 : null) : hemi === "S" ? -1 : hemi === "N" ? 1 : null;
  if (sign === null) return null;
  return sign * (deg + min / 60 + sec / 3600);
}

function parseLineInputs(options = {}) {
  const preserveLineMeta = Boolean(options.preserveLineMeta);
  const format = normalizeCoordinateFormat(state.coordsFormat);
  const previous = {
    a: { ...state.line.a },
    b: { ...state.line.b },
  };

  let aLat = null;
  let aLon = null;
  let bLat = null;
  let bLon = null;

  if (format === "ddm") {
    aLat = parseDDMInput(els.ddm.latA, "lat");
    aLon = parseDDMInput(els.ddm.lonA, "lon");
    bLat = parseDDMInput(els.ddm.latB, "lat");
    bLon = parseDDMInput(els.ddm.lonB, "lon");
  } else if (format === "dms") {
    aLat = parseDMSInput(els.dms.latA, "lat");
    aLon = parseDMSInput(els.dms.lonA, "lon");
    bLat = parseDMSInput(els.dms.latB, "lat");
    bLon = parseDMSInput(els.dms.lonB, "lon");
  } else {
    aLat = parseDecimalDegreesInput(els.latA);
    aLon = parseDecimalDegreesInput(els.lonA);
    bLat = parseDecimalDegreesInput(els.latB);
    bLon = parseDecimalDegreesInput(els.lonB);
  }

  state.line.a.lat = Number.isFinite(aLat) ? aLat : null;
  state.line.a.lon = Number.isFinite(aLon) ? aLon : null;
  state.line.b.lat = Number.isFinite(bLat) ? bLat : null;
  state.line.b.lon = Number.isFinite(bLon) ? bLon : null;

  const changed =
    state.line.a.lat !== previous.a.lat ||
    state.line.a.lon !== previous.a.lon ||
    state.line.b.lat !== previous.b.lat ||
    state.line.b.lon !== previous.b.lon;

  if (changed && !preserveLineMeta) {
    state.lineName = null;
    state.lineSourceId = null;
  }

  saveSettings();
  updateLineNameDisplay();
}

function updateLineStatus() {
  const valid = hasLine();
  els.lineStatus.textContent = valid ? "" : "Line not set";
}

function hasLine() {
  return (
    Number.isFinite(state.line.a.lat) &&
    Number.isFinite(state.line.a.lon) &&
    Number.isFinite(state.line.b.lat) &&
    Number.isFinite(state.line.b.lon)
  );
}


function computeStartTimestamp() {
  if (state.start.mode === "countdown") {
    const seconds = Number.parseInt(state.start.countdownSeconds, 10) || 0;
    return Date.now() + seconds * 1000;
  }
  if (!state.start.absoluteTime) return null;
  const parts = state.start.absoluteTime.split(":").map(Number);
  const [hours, minutes, seconds = 0] = parts;
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  const now = new Date();
  const target = new Date(now);
  target.setHours(hours, minutes, seconds, 0);
  if (target.getTime() <= now.getTime()) {
    target.setDate(target.getDate() + 1);
  }
  return target.getTime();
}

function setStart(options = {}) {
  state.start.startTs = computeStartTimestamp();
  state.start.crossedEarly = false;
  state.start.freeze = null;
  resetBeepState();
  saveSettings();
  if (options.goToRace) {
    setView("race");
  }
}

function syncStartToMinute() {
  if (!state.start.startTs) return;
  const now = Date.now();
  const deltaMs = state.start.startTs - now;
  if (deltaMs <= 0) return;
  if (deltaMs < 60000) {
    state.start.startTs = now + 60000;
  } else {
    const roundedMs = Math.round(deltaMs / 60000) * 60000;
    state.start.startTs = now + roundedMs;
  }
  resetBeepState();
  saveSettings();
  updateStartDisplay();
  updateLineProjection();
}

function adjustStart(seconds) {
  if (!state.start.startTs) return;
  state.start.startTs += seconds * 1000;
  if (state.start.startTs > Date.now()) {
    resetBeepState();
  }
  saveSettings();
}

function updateStartDisplay() {
  const canAdjustStart =
    Boolean(state.start.startTs) && state.start.startTs > Date.now();
  setRaceTimingControlsEnabled(canAdjustStart);

  if (!state.start.startTs) {
    if (els.statusTime) {
      els.statusTime.textContent = "--";
    }
    if (els.statusStartTime) {
      els.statusStartTime.textContent = "--";
    }
    els.raceCountdown.textContent = "--";
    if (els.raceStartClock) {
      els.raceStartClock.textContent = "Start not set";
    }
    state.start.freeze = null;
    document.body.classList.remove("race-success", "race-fail");
    resetBeepState();
    fitRaceText();
    return;
  }
  const now = Date.now();
  const delta = Math.max(0, (state.start.startTs - now) / 1000);
  if (els.statusTime) {
    els.statusTime.textContent = formatTimeRemainingHMSFull(delta);
  }
  if (delta > 0) {
    if (state.start.freeze) {
      state.start.freeze = null;
    }
    document.body.classList.remove("race-success", "race-fail");
    els.raceCountdown.textContent = formatTimeRemainingHMS(delta);
    handleCountdownBeeps(delta);
  }
  const startDate = new Date(state.start.startTs);
  const formattedTime = formatClockTime(startDate, false);
  if (els.raceStartClock) {
    els.raceStartClock.textContent = `Start at ${formattedTime}`;
  }
  if (els.statusStartTime) {
    els.statusStartTime.textContent = formatClockTime(startDate, true);
  }
  if (delta <= 0) {
    if (!state.audio.startBeeped) {
      if (document.body.classList.contains("race-mode")) {
        playBeep(START_BEEP_DURATION_MS, START_BEEP_FREQUENCY);
      }
      state.audio.startBeeped = true;
    }
    setGpsMode("setup");
    if (!state.start.freeze) {
      state.start.freeze = {
        countdown: state.start.crossedEarly ? "False Start" : "Good Start",
      };
    }
    if (!state.start.freeze.countdown) {
      state.start.freeze.countdown = state.start.crossedEarly ? "False Start" : "Good Start";
    }
    els.raceCountdown.textContent = state.start.freeze.countdown;
    if (state.start.crossedEarly) {
      document.body.classList.add("race-fail");
      document.body.classList.remove("race-success");
    } else {
      document.body.classList.add("race-success");
      document.body.classList.remove("race-fail");
    }
    state.audio.lastBeepSecond = null;
  }
  fitRaceText();
}

function updateGPSDisplay() {
  if (!els.gpsIcon) return;
  if (!state.position) {
    els.gpsIcon.classList.remove("ok", "bad");
    els.gpsIcon.classList.add("bad");
    els.gpsIcon.title = "GPS waiting";
    return;
  }
  const accuracy = state.position.coords.accuracy;
  if (accuracy <= 10) {
    els.gpsIcon.classList.add("ok");
    els.gpsIcon.classList.remove("bad");
  } else {
    els.gpsIcon.classList.add("bad");
    els.gpsIcon.classList.remove("ok");
  }
  els.gpsIcon.title = `GPS accuracy ${formatDistanceWithUnit(accuracy)}`;
}

function updateCurrentTime() {
  if (!els.currentTime) return;
  const now = new Date();
  els.currentTime.textContent = formatClockTime(now, true);
}

function getGpsOptionsForMode(mode) {
  return mode === "race" ? GPS_OPTIONS_RACE : GPS_OPTIONS_SETUP;
}

function updateDebugControls() {
  if (els.debugGpsToggle) {
    const label = state.debugGpsEnabled ? "Simulate GPS: on" : "Simulate GPS: off";
    els.debugGpsToggle.textContent = label;
    els.debugGpsToggle.setAttribute(
      "aria-pressed",
      state.debugGpsEnabled ? "true" : "false"
    );
  }
}

function stopDebugGps() {
  if (!state.debugIntervalId) return;
  clearInterval(state.debugIntervalId);
  state.debugIntervalId = null;
}

function stopRealGps() {
  if (state.geoWatchId !== null && navigator.geolocation) {
    navigator.geolocation.clearWatch(state.geoWatchId);
  }
  state.geoWatchId = null;
}

function startDebugGps() {
  stopRealGps();
  if (state.debugIntervalId) return;
  handlePosition(createDebugPosition());
  state.debugIntervalId = setInterval(() => {
    handlePosition(createDebugPosition());
  }, 1000);
}

function startRealGps(options = GPS_OPTIONS_SETUP) {
  stopDebugGps();
  if (!navigator.geolocation) {
    if (els.gpsIcon) {
      els.gpsIcon.classList.add("bad");
      els.gpsIcon.title = "Geolocation unavailable";
    }
    return;
  }
  if (state.geoWatchId !== null) {
    navigator.geolocation.clearWatch(state.geoWatchId);
    state.geoWatchId = null;
  }
  state.geoWatchId = navigator.geolocation.watchPosition(
    handlePosition,
    handlePositionError,
    options
  );
}

function requestHighPrecisionPosition(callback) {
  if (!navigator.geolocation) {
    handlePositionError(new Error("Geolocation unavailable"));
    return;
  }
  navigator.geolocation.getCurrentPosition(
    (position) => {
      handlePosition(position);
      if (callback) callback(position);
    },
    handlePositionError,
    GPS_OPTIONS_RACE
  );
}

function resetPositionState() {
  state.position = null;
  state.lastPosition = null;
  state.velocity = { x: 0, y: 0 };
  state.speed = 0;
  state.kalman = null;
  state.gpsTrackRaw = [];
  state.gpsTrackFiltered = [];
  updateGPSDisplay();
  updateLineProjection();
}

function setDebugGpsEnabled(enabled) {
  const next = Boolean(enabled);
  if (state.debugGpsEnabled === next) {
    updateDebugControls();
    return;
  }
  state.debugGpsEnabled = next;
  saveSettings();
  state.kalman = null;
  if (state.debugGpsEnabled) {
    startDebugGps();
  } else {
    stopDebugGps();
    resetPositionState();
    startRealGps(getGpsOptionsForMode(state.gpsMode));
  }
  updateDebugControls();
}

function setGpsMode(mode, options = {}) {
  const prev = state.gpsMode;
  const next = mode === "race" ? "race" : "setup";
  const force = Boolean(options.force);
  const highAccuracy = Boolean(options.highAccuracy);
  state.gpsMode = next;
  if (state.debugGpsEnabled) {
    return;
  }
  if (!force && state.geoWatchId !== null && prev === next && !highAccuracy) {
    return;
  }
  const gpsOptions = highAccuracy ? GPS_OPTIONS_RACE : getGpsOptionsForMode(state.gpsMode);
  startRealGps(gpsOptions);
}

function computeVelocityFromHeading(speed, headingDegrees) {
  if (!Number.isFinite(speed) || !Number.isFinite(headingDegrees)) {
    return { x: 0, y: 0 };
  }
  const headingRad = toRadians(headingDegrees);
  return {
    x: speed * Math.sin(headingRad),
    y: speed * Math.cos(headingRad),
  };
}

function computeVelocityFromPositions(current, previous) {
  if (!current || !previous) return { x: 0, y: 0, speed: 0 };
  const dt = (current.timestamp - previous.timestamp) / 1000;
  if (dt <= 0) return { x: 0, y: 0, speed: 0 };

  const origin = {
    lat: (current.coords.latitude + previous.coords.latitude) / 2,
    lon: (current.coords.longitude + previous.coords.longitude) / 2,
  };
  const currentM = toMeters(
    { lat: current.coords.latitude, lon: current.coords.longitude },
    origin
  );
  const previousM = toMeters(
    { lat: previous.coords.latitude, lon: previous.coords.longitude },
    origin
  );
  const dx = currentM.x - previousM.x;
  const dy = currentM.y - previousM.y;
  const speed = Math.hypot(dx, dy) / dt;
  return { x: dx / dt, y: dy / dt, speed };
}

function initKalmanState(position) {
  const origin = { lat: position.coords.latitude, lon: position.coords.longitude };
  const accuracy = clamp(position.coords.accuracy || 10, 3, 50);
  let vx = 0;
  let vy = 0;
  if (Number.isFinite(position.coords.speed) && Number.isFinite(position.coords.heading)) {
    const velocity = computeVelocityFromHeading(position.coords.speed, position.coords.heading);
    vx = velocity.x;
    vy = velocity.y;
  }
  const sigma2 = accuracy ** 2;
  return {
    origin,
    lastTs: position.timestamp || Date.now(),
    x: [0, 0, vx, vy],
    P: [
      sigma2, 0, 0, 0,
      0, sigma2, 0, 0,
      0, 0, 25, 0,
      0, 0, 0, 25,
    ],
  };
}

function applyKalmanFilter(position) {
  if (!position) return null;
  if (!state.kalman) {
    state.kalman = initKalmanState(position);
  }
  const filter = state.kalman;
  const timestamp = position.timestamp || Date.now();
  const dtRaw = (timestamp - filter.lastTs) / 1000;
  if (!Number.isFinite(dtRaw) || dtRaw <= 0) {
    const coords = fromMeters({ x: filter.x[0], y: filter.x[1] }, filter.origin);
    return {
      position: {
        coords: {
          latitude: coords.lat,
          longitude: coords.lon,
          accuracy: position.coords.accuracy,
        },
        timestamp,
      },
      velocity: { x: filter.x[2], y: filter.x[3] },
      speed: Math.hypot(filter.x[2], filter.x[3]),
    };
  }

  const dt = clamp(dtRaw, 0.2, 5);
  filter.lastTs = timestamp;

  const q = 0.8;
  const dt2 = dt * dt;
  const dt3 = dt2 * dt;
  const dt4 = dt2 * dt2;

  const F = [
    1, 0, dt, 0,
    0, 1, 0, dt,
    0, 0, 1, 0,
    0, 0, 0, 1,
  ];
  const Q = [
    q * dt4 / 4, 0, q * dt3 / 2, 0,
    0, q * dt4 / 4, 0, q * dt3 / 2,
    q * dt3 / 2, 0, q * dt2, 0,
    0, q * dt3 / 2, 0, q * dt2,
  ];

  const x = filter.x;
  const P = filter.P;

  const xPred = [
    x[0] + x[2] * dt,
    x[1] + x[3] * dt,
    x[2],
    x[3],
  ];

  const FP = new Array(16).fill(0);
  for (let r = 0; r < 4; r += 1) {
    for (let c = 0; c < 4; c += 1) {
      FP[r * 4 + c] =
        F[r * 4 + 0] * P[0 * 4 + c] +
        F[r * 4 + 1] * P[1 * 4 + c] +
        F[r * 4 + 2] * P[2 * 4 + c] +
        F[r * 4 + 3] * P[3 * 4 + c];
    }
  }
  const PPred = new Array(16).fill(0);
  for (let r = 0; r < 4; r += 1) {
    for (let c = 0; c < 4; c += 1) {
      PPred[r * 4 + c] =
        FP[r * 4 + 0] * F[c * 4 + 0] +
        FP[r * 4 + 1] * F[c * 4 + 1] +
        FP[r * 4 + 2] * F[c * 4 + 2] +
        FP[r * 4 + 3] * F[c * 4 + 3] +
        Q[r * 4 + c];
    }
  }

  const measurement = toMeters(
    { lat: position.coords.latitude, lon: position.coords.longitude },
    filter.origin
  );
  const z = [measurement.x, measurement.y];
  const accuracy = clamp(position.coords.accuracy || 10, 3, 50);
  const r = accuracy ** 2;
  const S00 = PPred[0] + r;
  const S01 = PPred[1];
  const S10 = PPred[4];
  const S11 = PPred[5] + r;
  const det = S00 * S11 - S01 * S10;
  if (!Number.isFinite(det) || det === 0) {
    filter.x = xPred;
    filter.P = PPred;
  } else {
    const invS00 = S11 / det;
    const invS01 = -S01 / det;
    const invS10 = -S10 / det;
    const invS11 = S00 / det;

    const PHt = [
      PPred[0], PPred[1],
      PPred[4], PPred[5],
      PPred[8], PPred[9],
      PPred[12], PPred[13],
    ];
    const K = [
      PHt[0] * invS00 + PHt[1] * invS10,
      PHt[0] * invS01 + PHt[1] * invS11,
      PHt[2] * invS00 + PHt[3] * invS10,
      PHt[2] * invS01 + PHt[3] * invS11,
      PHt[4] * invS00 + PHt[5] * invS10,
      PHt[4] * invS01 + PHt[5] * invS11,
      PHt[6] * invS00 + PHt[7] * invS10,
      PHt[6] * invS01 + PHt[7] * invS11,
    ];

    const y0 = z[0] - xPred[0];
    const y1 = z[1] - xPred[1];

    xPred[0] += K[0] * y0 + K[1] * y1;
    xPred[1] += K[2] * y0 + K[3] * y1;
    xPred[2] += K[4] * y0 + K[5] * y1;
    xPred[3] += K[6] * y0 + K[7] * y1;

    const HP = [
      PPred[0], PPred[1], PPred[2], PPred[3],
      PPred[4], PPred[5], PPred[6], PPred[7],
    ];
    const KHP = new Array(16).fill(0);
    for (let rIdx = 0; rIdx < 4; rIdx += 1) {
      const k0 = K[rIdx * 2];
      const k1 = K[rIdx * 2 + 1];
      KHP[rIdx * 4 + 0] = k0 * HP[0] + k1 * HP[4];
      KHP[rIdx * 4 + 1] = k0 * HP[1] + k1 * HP[5];
      KHP[rIdx * 4 + 2] = k0 * HP[2] + k1 * HP[6];
      KHP[rIdx * 4 + 3] = k0 * HP[3] + k1 * HP[7];
    }
    for (let i = 0; i < 16; i += 1) {
      PPred[i] -= KHP[i];
    }

    filter.x = xPred;
    filter.P = PPred;
  }

  const coords = fromMeters({ x: filter.x[0], y: filter.x[1] }, filter.origin);
  return {
    position: {
      coords: {
        latitude: coords.lat,
        longitude: coords.lon,
        accuracy: position.coords.accuracy,
      },
      timestamp,
    },
    velocity: { x: filter.x[2], y: filter.x[3] },
    speed: Math.hypot(filter.x[2], filter.x[3]),
  };
}

function computeLineMetrics(position) {
  if (!hasLine() || !position) return null;
  const origin = {
    lat: (state.line.a.lat + state.line.b.lat) / 2,
    lon: (state.line.a.lon + state.line.b.lon) / 2,
  };

  const pointA = toMeters(state.line.a, origin);
  const pointB = toMeters(state.line.b, origin);
  const boat = toMeters(
    { lat: position.coords.latitude, lon: position.coords.longitude },
    origin
  );

  const lineVec = { x: pointB.x - pointA.x, y: pointB.y - pointA.y };
  const lineLen = Math.hypot(lineVec.x, lineVec.y);
  if (lineLen < 1) return null;

  const normal = { x: -lineVec.y / lineLen, y: lineVec.x / lineLen };
  const signedDistance = (boat.x - pointA.x) * normal.x + (boat.y - pointA.y) * normal.y;
  return { normal, signedDistance, distance: Math.abs(signedDistance), lineLen };
}

function isFalseStart(signedDistance) {
  return signedDistance > 0;
}

function updateLineProjection() {
  if (!hasLine() || !state.position) {
    if (els.projDirect) {
      els.projDirect.textContent = `-- ${formatUnitLabel(getDistanceUnitMeta().label)}`;
    }
    if (els.distDirect) {
      els.distDirect.textContent = `Distance to line -- ${formatUnitLabel(
        getDistanceUnitMeta().label
      )}`;
    }
    if (els.projClosing) {
      els.projClosing.textContent = `-- ${formatUnitLabel(getDistanceUnitMeta().label)}`;
    }
    if (els.closingRate) {
      els.closingRate.textContent = `Closing rate -- ${formatUnitLabel(
        getSpeedUnitMeta().label
      )}`;
    }
    els.raceProjDirect.textContent = "--";
    els.raceProjClosing.textContent = "--";
    updateRaceValueStyles(false, false);
    fitRaceText();
    if (els.statusDistance) {
      if (els.statusDistanceValue) {
        els.statusDistanceValue.textContent = "--";
      } else {
        els.statusDistance.textContent = "--";
      }
    }
    if (els.statusLineLength) {
      if (els.statusLineLengthValue) {
        els.statusLineLengthValue.textContent = "--";
      } else {
        els.statusLineLength.textContent = "--";
      }
    }
    updateStatusUnitLabels();
    return;
  }

  const metrics = computeLineMetrics(state.position);
  if (!metrics) {
    els.lineStatus.textContent = "Line too short";
    return;
  }
  els.lineStatus.textContent = "";

  const { normal, signedDistance, distance, lineLen } = metrics;
  const distanceSign = Math.sign(signedDistance) || 1;
  state.latestDistance = distance;
  state.latestSignedDistance = signedDistance;

  const timeToStart = state.start.startTs
    ? Math.max(0, (state.start.startTs - Date.now()) / 1000)
    : 0;

  const speed = state.speed;
  const closingRate =
    -(state.velocity.x * normal.x + state.velocity.y * normal.y) * distanceSign;
  const sideSign = isFalseStart(signedDistance) ? -1 : 1;
  const projectedDirect = (distance - speed * timeToStart) * sideSign;
  const projectedClosing = (distance - closingRate * timeToStart) * sideSign;
  const isClosing = Number.isFinite(closingRate) && closingRate > 0;
  const overshootDirect = Number.isFinite(projectedDirect) && projectedDirect < 0;
  const overshootClosing =
    isClosing && Number.isFinite(projectedClosing) && projectedClosing < 0;

  if (els.projDirect) els.projDirect.textContent = formatOverUnder(projectedDirect);
  if (els.distDirect) {
    els.distDirect.textContent = `Distance to line ${formatDistanceWithUnit(distance)}`;
  }
  if (els.projClosing) els.projClosing.textContent = formatOverUnder(projectedClosing);
  if (els.closingRate) {
    els.closingRate.textContent = `Closing rate ${formatRate(closingRate)}`;
  }
  const raceValues = getRaceMetricValues(
    projectedDirect,
    projectedClosing,
    speed,
    closingRate
  );
  els.raceProjDirect.textContent = raceValues.direct;
  els.raceProjClosing.textContent = raceValues.closing;
  updateRaceValueStyles(overshootDirect, overshootClosing);
  fitRaceText();
  if (els.statusDistance) {
    if (els.statusDistanceValue) {
      els.statusDistanceValue.textContent = `${formatDistanceValue(distance)}`;
    } else {
      els.statusDistance.textContent = `${formatDistanceValue(distance)}`;
    }
  }
  if (els.statusLineLength) {
    if (els.statusLineLengthValue) {
      els.statusLineLengthValue.textContent = `${formatDistanceValue(lineLen)}`;
    } else {
      els.statusLineLength.textContent = `${formatDistanceValue(lineLen)}`;
    }
  }
  updateStatusUnitLabels();

  if (state.start.startTs && timeToStart <= 0 && !state.start.freeze) {
    const nextFalseStart = isFalseStart(signedDistance);
    if (state.start.crossedEarly !== nextFalseStart) {
      state.start.crossedEarly = nextFalseStart;
      saveSettings();
    }
  }

  if (timeToStart <= 0) {
    const freeze = state.start.freeze || {};
    if (!freeze.countdown) {
      freeze.countdown = state.start.crossedEarly ? "False Start" : "Good Start";
    }
    if (!freeze.race) {
      freeze.race = {
        projectedDirect,
        projectedClosing,
        speed,
        closingRate,
      };
    }
    state.start.freeze = freeze;
    if (freeze.race) {
      const frozenValues = getRaceMetricValues(
        freeze.race.projectedDirect,
        freeze.race.projectedClosing,
        freeze.race.speed,
        freeze.race.closingRate
      );
      els.raceProjDirect.textContent = frozenValues.direct;
      els.raceProjClosing.textContent = frozenValues.closing;
      const frozenClosing =
        Number.isFinite(freeze.race.closingRate) && freeze.race.closingRate > 0;
      const frozenOvershootDirect =
        Number.isFinite(freeze.race.projectedDirect) && freeze.race.projectedDirect < 0;
      const frozenOvershootClosing =
        frozenClosing &&
        Number.isFinite(freeze.race.projectedClosing) &&
        freeze.race.projectedClosing < 0;
      updateRaceValueStyles(frozenOvershootDirect, frozenOvershootClosing);
      fitRaceText();
    }
    return;
  }
}


function handlePosition(position) {
  const filtered = state.useKalman ? applyKalmanFilter(position) : null;
  if (!state.useKalman && state.kalman) {
    state.kalman = null;
  }
  let activePosition = position;
  if (filtered) {
    filtered.position = applyForwardOffset(
      filtered.position,
      filtered.velocity,
      state.bowOffsetMeters
    );
    activePosition = filtered.position;
  }
  state.position = activePosition;
  recordTrackPoints(position, filtered ? filtered.position : null);
  if (filtered) {
    state.speed = filtered.speed;
    state.velocity = filtered.velocity;
  } else {
    const coords = position.coords;
    if (Number.isFinite(coords.speed) && Number.isFinite(coords.heading)) {
      state.speed = coords.speed;
      state.velocity = computeVelocityFromHeading(coords.speed, coords.heading);
    } else {
      const computed = computeVelocityFromPositions(position, state.lastPosition);
      state.speed = computed.speed;
      state.velocity = { x: computed.x, y: computed.y };
    }
  }

  state.lastPosition = activePosition;
  updateGPSDisplay();
  updateLineProjection();
}

function handlePositionError(err) {
  if (!els.gpsIcon) return;
  els.gpsIcon.classList.add("bad");
  els.gpsIcon.classList.remove("ok");
  els.gpsIcon.title = `GPS error: ${err.message}`;
}

function initGeolocation() {
  if (state.debugGpsEnabled) {
    startDebugGps();
    return;
  }
  setGpsMode(state.gpsMode, { force: true });
}

function registerServiceWorker() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch((err) => {
      console.warn("Service worker failed", err);
    });
  }
}

function bindEvents() {
  const coordinateInputs = [
    els.latA,
    els.lonA,
    els.latB,
    els.lonB,
    els.ddm.latA.deg,
    els.ddm.latA.min,
    els.ddm.latA.minDec,
    els.ddm.latA.hemi,
    els.ddm.lonA.deg,
    els.ddm.lonA.min,
    els.ddm.lonA.minDec,
    els.ddm.lonA.hemi,
    els.ddm.latB.deg,
    els.ddm.latB.min,
    els.ddm.latB.minDec,
    els.ddm.latB.hemi,
    els.ddm.lonB.deg,
    els.ddm.lonB.min,
    els.ddm.lonB.minDec,
    els.ddm.lonB.hemi,
    els.dms.latA.deg,
    els.dms.latA.min,
    els.dms.latA.sec,
    els.dms.latA.secDec,
    els.dms.latA.hemi,
    els.dms.lonA.deg,
    els.dms.lonA.min,
    els.dms.lonA.sec,
    els.dms.lonA.secDec,
    els.dms.lonA.hemi,
    els.dms.latB.deg,
    els.dms.latB.min,
    els.dms.latB.sec,
    els.dms.latB.secDec,
    els.dms.latB.hemi,
    els.dms.lonB.deg,
    els.dms.lonB.min,
    els.dms.lonB.sec,
    els.dms.lonB.secDec,
    els.dms.lonB.hemi,
  ].filter(Boolean);

  coordinateInputs.forEach((input) => {
    input.addEventListener("change", () => {
      applyCoordinatePickerConstraints();
      parseLineInputs();
      updateInputs();
      updateLineStatus();
      updateLineProjection();
    });
  });

  const digitInputs = [
    { input: els.ddm.latA.minDec, maxDigits: COORD_DECIMAL_DIGITS },
    { input: els.ddm.lonA.minDec, maxDigits: COORD_DECIMAL_DIGITS },
    { input: els.ddm.latB.minDec, maxDigits: COORD_DECIMAL_DIGITS },
    { input: els.ddm.lonB.minDec, maxDigits: COORD_DECIMAL_DIGITS },
    { input: els.dms.latA.secDec, maxDigits: COORD_DECIMAL_DIGITS },
    { input: els.dms.lonA.secDec, maxDigits: COORD_DECIMAL_DIGITS },
    { input: els.dms.latB.secDec, maxDigits: COORD_DECIMAL_DIGITS },
    { input: els.dms.lonB.secDec, maxDigits: COORD_DECIMAL_DIGITS },
  ].filter(({ input }) => Boolean(input));

  digitInputs.forEach(({ input, maxDigits }) => {
    input.addEventListener("input", () => {
      const sanitized = String(input.value || "")
        .replace(/\D/g, "")
        .slice(0, maxDigits);
      if (sanitized !== input.value) {
        input.value = sanitized;
      }
    });
  });

  els.useA.addEventListener("click", () => {
    requestHighPrecisionPosition((position) => {
      state.line.a = {
        lat: position.coords.latitude,
        lon: position.coords.longitude,
      };
      state.lineName = null;
      state.lineSourceId = null;
      saveSettings();
      updateLineNameDisplay();
      updateInputs();
      updateLineStatus();
      updateLineProjection();
    });
  });

  els.useB.addEventListener("click", () => {
    requestHighPrecisionPosition((position) => {
      state.line.b = {
        lat: position.coords.latitude,
        lon: position.coords.longitude,
      };
      state.lineName = null;
      state.lineSourceId = null;
      saveSettings();
      updateLineNameDisplay();
      updateInputs();
      updateLineStatus();
      updateLineProjection();
    });
  });

  els.openMap.addEventListener("click", () => {
    window.location.href = "map.html";
  });

  els.openCoords.addEventListener("click", () => {
    setView("coords");
  });

  if (els.coordsFormatBtn) {
    els.coordsFormatBtn.addEventListener("click", () => {
      const formats = ["dd", "ddm", "dms"];
      const current = normalizeCoordinateFormat(state.coordsFormat);
      const index = formats.indexOf(current);
      state.coordsFormat = formats[(index + 1) % formats.length];
      saveSettings();
      updateInputs();
    });
  }

  if (els.coordsDoneTop) {
    els.coordsDoneTop.addEventListener("click", () => {
      setView("setup");
    });
  }

  els.openLocation.addEventListener("click", () => {
    setView("location");
  });

  if (els.openSettings) {
    els.openSettings.addEventListener("click", () => {
      setView("settings");
    });
  }

  if (els.openTrack) {
    els.openTrack.addEventListener("click", () => {
      setView("track");
    });
  }

  els.saveLine.addEventListener("click", () => {
    if (!hasLine()) {
      window.alert("No start line defined. Set port and starboard marks first.");
      return;
    }
    const nameInput = window.prompt("Name this start line:");
    const timestamp = new Date().toLocaleString("en-GB", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    const name = (nameInput || "").trim() || `Line ${state.savedLines.length + 1} (${timestamp})`;
    const entry = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      name,
      line: {
        a: { ...state.line.a },
        b: { ...state.line.b },
      },
    };
    state.savedLines.unshift(entry);
    saveSavedLines();
  });

  if (els.loadLine) {
    els.loadLine.addEventListener("click", () => {
      openLoadModal();
    });
  }

  if (els.confirmLoad) {
    els.confirmLoad.addEventListener("click", () => {
      if (!state.selectedLineId) return;
      const entry = state.savedLines.find((line) => line.id === state.selectedLineId);
      if (!entry) return;
      state.line = {
        a: { ...entry.line.a },
        b: { ...entry.line.b },
      };
      state.lineName = entry.name || null;
      state.lineSourceId = entry.id || null;
      updateInputs();
      updateLineStatus();
      updateLineProjection();
      saveSettings();
      updateLineNameDisplay();
      closeLoadModal();
    });
  }

  if (els.confirmDelete) {
    els.confirmDelete.addEventListener("click", () => {
      if (!state.selectedLineId) return;
      const entry = state.savedLines.find((line) => line.id === state.selectedLineId);
      if (!entry) return;
      const confirmed = window.confirm(`Delete "${entry.name}"?`);
      if (!confirmed) return;
      state.savedLines = state.savedLines.filter((line) => line.id !== entry.id);
      if (state.lineSourceId === entry.id) {
        state.lineName = null;
        state.lineSourceId = null;
        saveSettings();
        updateLineNameDisplay();
      }
      saveSavedLines();
      state.selectedLineId = null;
      renderSavedLinesList();
    });
  }

  if (els.closeLoad) {
    els.closeLoad.addEventListener("click", () => {
      closeLoadModal();
    });
  }

  const countdownInputs = [
    els.countdownHours,
    els.countdownMinutes,
    els.countdownSeconds,
  ].filter(Boolean);

  if (countdownInputs.length) {
    countdownInputs.forEach((input) => {
      input.addEventListener("change", () => {
        state.start.countdownSeconds = getCountdownSecondsFromPicker();
        saveSettings();
      });
    });
  }

  if (els.absoluteTime) {
    els.absoluteTime.addEventListener("change", () => {
      state.start.absoluteTime = els.absoluteTime.value;
      saveSettings();
    });
  }

  els.setCountdown.addEventListener("click", () => {
    unlockAudio();
    state.start.mode = "countdown";
    state.start.countdownSeconds = getCountdownSecondsFromPicker();
    saveSettings();
    setStart({ goToRace: false });
    if (state.start.startTs) {
      const startDate = new Date(state.start.startTs);
      const absoluteValue = formatTimeInput(startDate);
      state.start.absoluteTime = absoluteValue;
      if (els.absoluteTime) {
        els.absoluteTime.value = absoluteValue;
      }
      saveSettings();
    }
    updateStartDisplay();
    updateLineProjection();
  });

  els.setAbsolute.addEventListener("click", () => {
    unlockAudio();
    state.start.mode = "absolute";
    saveSettings();
    setStart({ goToRace: false });
    updateStartDisplay();
    updateLineProjection();
  });

  els.goRace.addEventListener("click", () => {
    unlockAudio();
    setView("race");
  });

  els.closeRace.addEventListener("click", () => {
    setView("setup");
  });


  els.closeCoords.addEventListener("click", () => {
    setView("setup");
  });

  els.closeLocation.addEventListener("click", () => {
    setView("setup");
  });

  if (els.closeSettings) {
    els.closeSettings.addEventListener("click", () => {
      setView("setup");
    });
  }

  if (els.closeTrack) {
    els.closeTrack.addEventListener("click", () => {
      setView("setup");
    });
  }

  if (els.kalmanOn) {
    els.kalmanOn.addEventListener("click", () => {
      setKalmanEnabled(true);
    });
  }

  if (els.kalmanOff) {
    els.kalmanOff.addEventListener("click", () => {
      setKalmanEnabled(false);
    });
  }

  if (els.bowOffset) {
    els.bowOffset.addEventListener("change", () => {
      state.bowOffsetMeters = parseBowOffsetInput();
      saveSettings();
    });
    els.bowOffset.addEventListener("focus", () => {
      const raw = String(els.bowOffset.value || "").trim();
      if (/^0([.,]0+)?$/.test(raw)) {
        els.bowOffset.value = "";
      }
    });
  }

  if (els.soundOn) {
    els.soundOn.addEventListener("click", () => {
      setSoundEnabled(true);
    });
  }

  if (els.soundOff) {
    els.soundOff.addEventListener("click", () => {
      setSoundEnabled(false);
    });
  }

  if (els.timeFormat24) {
    els.timeFormat24.addEventListener("click", () => {
      setTimeFormat("24h");
    });
  }

  if (els.timeFormat12) {
    els.timeFormat12.addEventListener("click", () => {
      setTimeFormat("12h");
    });
  }

  if (els.speedUnitMs) {
    els.speedUnitMs.addEventListener("click", () => {
      setSpeedUnit("ms");
    });
  }

  if (els.speedUnitKn) {
    els.speedUnitKn.addEventListener("click", () => {
      setSpeedUnit("kn");
    });
  }

  if (els.speedUnitMph) {
    els.speedUnitMph.addEventListener("click", () => {
      setSpeedUnit("mph");
    });
  }

  if (els.distanceUnitM) {
    els.distanceUnitM.addEventListener("click", () => {
      setDistanceUnit("m");
    });
  }

  if (els.distanceUnitFt) {
    els.distanceUnitFt.addEventListener("click", () => {
      setDistanceUnit("ft");
    });
  }

  if (els.distanceUnitYd) {
    els.distanceUnitYd.addEventListener("click", () => {
      setDistanceUnit("yd");
    });
  }

  if (els.syncRace) {
    els.syncRace.addEventListener("click", () => {
      if (!state.start.startTs || state.start.startTs <= Date.now()) return;
      unlockAudio();
      syncStartToMinute();
    });
  }

  if (els.raceMetricDistance) {
    els.raceMetricDistance.addEventListener("click", () => {
      setRaceMetric("distance");
    });
  }

  if (els.raceMetricTime) {
    els.raceMetricTime.addEventListener("click", () => {
      setRaceMetric("time");
    });
  }

  if (els.racePlus) {
    els.racePlus.addEventListener("click", () => {
      if (!state.start.startTs || state.start.startTs <= Date.now()) return;
      unlockAudio();
      adjustStart(1);
      updateStartDisplay();
      updateLineProjection();
    });
  }

  if (els.raceMinus) {
    els.raceMinus.addEventListener("click", () => {
      if (!state.start.startTs || state.start.startTs <= Date.now()) return;
      unlockAudio();
      adjustStart(-1);
      updateStartDisplay();
      updateLineProjection();
    });
  }

  if (els.debugGpsToggle) {
    els.debugGpsToggle.addEventListener("click", () => {
      setDebugGpsEnabled(!state.debugGpsEnabled);
    });
  }

  if (els.debugRefresh) {
    els.debugRefresh.addEventListener("click", () => {
      window.location.reload();
    });
  }


  window.addEventListener("hashchange", syncViewFromHash);
}

function setView(view) {
  if (view === "race") {
    document.body.classList.add("race-mode");
    document.body.classList.remove("coords-mode");
    document.body.classList.remove("location-mode");
    document.body.classList.remove("settings-mode");
    document.body.classList.remove("track-mode");
    document.getElementById("race-view").setAttribute("aria-hidden", "false");
    document.getElementById("coords-view").setAttribute("aria-hidden", "true");
    document.getElementById("settings-view").setAttribute("aria-hidden", "true");
    document.getElementById("track-view").setAttribute("aria-hidden", "true");
    document.getElementById("setup-view").setAttribute("aria-hidden", "true");
    history.replaceState(null, "", "#race");
    window.scrollTo({ top: 0, behavior: "instant" });
    requestWakeLock();
    setGpsMode("race");
    fitRaceText();
    return;
  }
  if (view === "coords") {
    updateInputs();
    document.body.classList.remove("race-mode");
    document.body.classList.add("coords-mode");
    document.body.classList.remove("location-mode");
    document.body.classList.remove("settings-mode");
    document.body.classList.remove("track-mode");
    document.getElementById("race-view").setAttribute("aria-hidden", "true");
    document.getElementById("coords-view").setAttribute("aria-hidden", "false");
    document.getElementById("location-view").setAttribute("aria-hidden", "true");
    document.getElementById("settings-view").setAttribute("aria-hidden", "true");
    document.getElementById("track-view").setAttribute("aria-hidden", "true");
    document.getElementById("setup-view").setAttribute("aria-hidden", "true");
    history.replaceState(null, "", "#coords");
    window.scrollTo({ top: 0, behavior: "instant" });
    releaseWakeLock();
    setGpsMode("setup");
    return;
  }
  if (view === "location") {
    document.body.classList.remove("race-mode");
    document.body.classList.remove("coords-mode");
    document.body.classList.add("location-mode");
    document.body.classList.remove("settings-mode");
    document.body.classList.remove("track-mode");
    document.getElementById("race-view").setAttribute("aria-hidden", "true");
    document.getElementById("coords-view").setAttribute("aria-hidden", "true");
    document.getElementById("location-view").setAttribute("aria-hidden", "false");
    document.getElementById("settings-view").setAttribute("aria-hidden", "true");
    document.getElementById("track-view").setAttribute("aria-hidden", "true");
    document.getElementById("setup-view").setAttribute("aria-hidden", "true");
    history.replaceState(null, "", "#location");
    releaseWakeLock();
    setGpsMode("setup", { force: true, highAccuracy: true });
    return;
  }
  if (view === "settings") {
    updateInputs();
    document.body.classList.remove("race-mode");
    document.body.classList.remove("coords-mode");
    document.body.classList.remove("location-mode");
    document.body.classList.add("settings-mode");
    document.body.classList.remove("track-mode");
    document.getElementById("race-view").setAttribute("aria-hidden", "true");
    document.getElementById("coords-view").setAttribute("aria-hidden", "true");
    document.getElementById("location-view").setAttribute("aria-hidden", "true");
    document.getElementById("settings-view").setAttribute("aria-hidden", "false");
    document.getElementById("track-view").setAttribute("aria-hidden", "true");
    document.getElementById("setup-view").setAttribute("aria-hidden", "true");
    history.replaceState(null, "", "#settings");
    window.scrollTo({ top: 0, behavior: "instant" });
    releaseWakeLock();
    setGpsMode("setup");
    return;
  }
  if (view === "track") {
    document.body.classList.remove("race-mode");
    document.body.classList.remove("coords-mode");
    document.body.classList.remove("location-mode");
    document.body.classList.remove("settings-mode");
    document.body.classList.add("track-mode");
    document.getElementById("race-view").setAttribute("aria-hidden", "true");
    document.getElementById("coords-view").setAttribute("aria-hidden", "true");
    document.getElementById("location-view").setAttribute("aria-hidden", "true");
    document.getElementById("settings-view").setAttribute("aria-hidden", "true");
    document.getElementById("track-view").setAttribute("aria-hidden", "false");
    document.getElementById("setup-view").setAttribute("aria-hidden", "true");
    history.replaceState(null, "", "#track");
    window.scrollTo({ top: 0, behavior: "instant" });
    releaseWakeLock();
    setGpsMode("setup");
    renderTrack();
    return;
  }
  document.body.classList.remove("race-mode");
  document.body.classList.remove("coords-mode");
  document.body.classList.remove("location-mode");
  document.body.classList.remove("settings-mode");
  document.body.classList.remove("track-mode");
  document.getElementById("race-view").setAttribute("aria-hidden", "true");
  document.getElementById("coords-view").setAttribute("aria-hidden", "true");
  document.getElementById("location-view").setAttribute("aria-hidden", "true");
  document.getElementById("settings-view").setAttribute("aria-hidden", "true");
  document.getElementById("track-view").setAttribute("aria-hidden", "true");
  document.getElementById("setup-view").setAttribute("aria-hidden", "false");
  history.replaceState(null, "", "#setup");
  releaseWakeLock();
  setGpsMode("setup");
}

function syncViewFromHash() {
  if (location.hash === "#race") {
    setView("race");
    return;
  }
  if (location.hash === "#coords") {
    setView("coords");
    return;
  }
  if (location.hash === "#location") {
    setView("location");
    return;
  }
  if (location.hash === "#settings") {
    setView("settings");
    return;
  }
  if (location.hash === "#track") {
    setView("track");
    return;
  }
  setView("setup");
}

function tick() {
  updateLineProjection();
  updateStartDisplay();
  updateCurrentTime();
  requestAnimationFrame(() => {
    setTimeout(tick, 1000);
  });
}

loadSettings();
initCoordinatePickers();
initCountdownPicker();
initHemisphereToggles();
loadSavedLines();
syncLineNameWithSavedLines();
updateInputs();
updateLineStatus();
updateRaceMetricLabels();
bindEvents();
initGeolocation();
registerServiceWorker();
updateStartDisplay();
updateGPSDisplay();
updateCurrentTime();
syncViewFromHash();
tick();

window.addEventListener("resize", () => {
  if (document.body.classList.contains("track-mode")) {
    renderTrack();
  }
});

document.addEventListener("click", unlockAudio, { once: true });
document.addEventListener("touchstart", unlockAudio, { once: true });
document.addEventListener("pointerdown", unlockAudio, { once: true });
updateDebugControls();

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && document.body.classList.contains("race-mode")) {
    requestWakeLock();
  }
});
