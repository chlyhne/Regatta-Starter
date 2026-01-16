const EARTH_RADIUS = 6371000;
const DEBUG_GPS_DEFAULT = false;
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
const GPS_RETRY_DELAY_MS = 2000;
const GPS_STALE_MS = 15000;
const LINES_KEY = "racetimer-lines";
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
  speedUnit: "kn",
  distanceUnit: "m",
  bowOffsetMeters: 0,
  boatLengthMeters: 0,
  soundEnabled: true,
  debugGpsEnabled: DEBUG_GPS_DEFAULT,
  useKalman: true,
  imuCalibration: null,
  imuEnabled: false,
  imu: {
    gravity: null,
    lastTimestamp: null,
    lastRotation: null,
    lastYawRate: null,
  },
  debugIntervalId: null,
  geoWatchId: null,
  gpsRetryTimer: null,
  lastGpsFixAt: null,
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
  bowPosition: null,
  kalmanPosition: null,
  lastPosition: null,
  velocity: { x: 0, y: 0 },
  speed: 0,
  speedHistory: [],
  latestDistance: null,
  latestSignedDistance: null,
  raceMetric: "distance",
  savedLines: [],
  selectedLineId: null,
  wakeLock: null,
  gpsTrackRaw: [],
  gpsTrackDevice: [],
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

export {
  EARTH_RADIUS,
  DEBUG_GPS_DEFAULT,
  DEBUG_COORDS,
  COORD_DECIMAL_DIGITS,
  COORD_DD_DIGITS,
  DEBUG_SPEED,
  DEBUG_HEADING,
  BEEP_FREQUENCY,
  START_BEEP_FREQUENCY,
  LONG_BEEP_DURATION_MS,
  BEEP_DURATION_MS,
  START_BEEP_DURATION_MS,
  TRACK_MAX_POINTS,
  TRACK_WINDOW_MS,
  GPS_RETRY_DELAY_MS,
  GPS_STALE_MS,
  LINES_KEY,
  SPEED_UNITS,
  DISTANCE_UNITS,
  hemisphereGroups,
  state,
};
