import { state, SPEED_UNITS, DISTANCE_UNITS } from "./state.js";

function formatUnitLabel(label) {
  return `[${String(label).toLowerCase()}]`;
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

function trimTrailingZeros(value) {
  if (!value.includes(".")) return value;
  return value.replace(/\.?0+$/, "");
}

function formatSignificant(value, digits = 3) {
  if (!Number.isFinite(value)) {
    return "--";
  }
  if (value === 0) {
    return "0";
  }
  const abs = Math.abs(value);
  const magnitude = Math.floor(Math.log10(abs));
  const decimals = Math.max(0, digits - magnitude - 1);
  const rounded = abs.toFixed(decimals);
  return trimTrailingZeros(rounded);
}

function formatRaceDelta(value) {
  if (!Number.isFinite(value)) {
    return { text: "--", unitLabel: formatUnitLabel("m") };
  }
  const absMeters = Math.abs(value);
  const useKm = absMeters >= 1000;
  const unitLabel = formatUnitLabel(useKm ? "km" : "m");
  const displayValue = useKm ? absMeters / 1000 : absMeters;
  const absText = formatSignificant(displayValue, 3);
  if (absText === "0") {
    return { text: "0", unitLabel };
  }
  const sign = value < 0 ? "+" : "-";
  return { text: `${sign}${absText}`, unitLabel };
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

export {
  formatUnitLabel,
  normalizeTimeFormat,
  normalizeSpeedUnit,
  normalizeDistanceUnit,
  getSpeedUnitMeta,
  getDistanceUnitMeta,
  formatDistanceValue,
  formatDistanceWithUnit,
  formatMeters,
  formatRate,
  formatClockTime,
  formatTimeInput,
  parseTimeInput,
  formatTimeRemainingHMSFull,
  splitDurationSeconds,
  formatDurationInput,
  parseDurationInput,
  formatOverUnder,
  formatRaceSign,
  formatRaceDelta,
  formatRaceTimeDelta,
  formatTimeRemaining,
  formatTimeRemainingHMS,
};
