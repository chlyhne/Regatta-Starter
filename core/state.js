import { SPEED_UNITS, DISTANCE_UNITS } from "./units.js";

const EARTH_RADIUS = 6371000;
const COORD_DECIMAL_DIGITS = 10;
const COORD_DD_DIGITS = 6;
const BEEP_FREQUENCY = 880;
const START_BEEP_FREQUENCY = 1320;
const LONG_BEEP_DURATION_MS = 750;
const BEEP_DURATION_MS = Math.round(LONG_BEEP_DURATION_MS / 2);
const START_BEEP_DURATION_MS = 2000;
const TRACK_MAX_POINTS = 600;
const TRACK_WINDOW_MS = 3 * 60 * 1000;
const COURSE_TRACK_MAX_POINTS = 10000;
const GPS_RETRY_DELAY_MS = 2000;
const GPS_STALE_MS = 15000;
const LINES_KEY = "racetimer-lines";
const COURSES_KEY = "racetimer-courses";
const MARKS_KEY = "racetimer-marks";

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
  bowOffsetMeters: 5,
  boatLengthMeters: 8,
  boatModel: "",
  boatShape: "",
  boatWeightKg: 0,
  soundEnabled: true,
  useKalman: true,
  headingSourceByMode: { lifter: "kalman" },
  imuCalibration: null,
  diagUploadToken: "",
  windEndpoint: "/wind",
  windHistoryMinutes: 60,
  windPeriodogramMinutes: 120,
  windSpeedFitOrder: 3,
  windDirFitOrder: 3,
  imuEnabled: false,
  gpsEnabled: true,
  replay: {
    active: false,
    loading: false,
    error: "",
    file: null,
    speed: 1,
    clockNow: null,
    loop: false,
  },
  imu: {
    gravity: null,
    lastTimestamp: null,
    lastRotation: null,
    lastYawRate: null,
    pendingHeadingDeltaRad: 0,
  },
  geoWatchId: null,
  gpsRetryTimer: null,
  lastGpsFixAt: null,
  gpsMode: "setup",
  trackMode: "gps",
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
  savedCourses: [],
  selectedCourseId: null,
  savedMarks: [],
  selectedMarkId: null,
  wakeLock: null,
  gpsTrackRaw: [],
  gpsTrackDevice: [],
  gpsTrackFiltered: [],
  course: {
    enabled: false,
    marks: [],
    finish: {
      useStartLine: true,
      reverse: false,
      a: { lat: null, lon: null },
      b: { lat: null, lon: null },
    },
    version: 0,
  },
  courseTrack: [],
  courseTrackActive: false,
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
  COORD_DECIMAL_DIGITS,
  COORD_DD_DIGITS,
  BEEP_FREQUENCY,
  START_BEEP_FREQUENCY,
  LONG_BEEP_DURATION_MS,
  BEEP_DURATION_MS,
  START_BEEP_DURATION_MS,
  TRACK_MAX_POINTS,
  TRACK_WINDOW_MS,
  COURSE_TRACK_MAX_POINTS,
  GPS_RETRY_DELAY_MS,
  GPS_STALE_MS,
  LINES_KEY,
  COURSES_KEY,
  MARKS_KEY,
  SPEED_UNITS,
  DISTANCE_UNITS,
  hemisphereGroups,
  state,
};
