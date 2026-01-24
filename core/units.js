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

export {
  SPEED_UNITS,
  DISTANCE_UNITS,
  normalizeTimeFormat,
  normalizeSpeedUnit,
  normalizeDistanceUnit,
};
