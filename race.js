import { state } from "./state.js";
import { els } from "./dom.js";
import { toMeters } from "./geo.js";
import { fitRaceText } from "./race-fit.js";
import {
  formatUnitLabel,
  getDistanceUnitMeta,
  getSpeedUnitMeta,
  formatDistanceWithUnit,
  formatRate,
  formatDistanceValue,
  formatOverUnder,
  formatRaceDelta,
  formatRaceTimeDelta,
} from "./format.js";
import { saveSettings as saveSettingsToStorage } from "./settings.js";

function hasLine() {
  return (
    Number.isFinite(state.line.a.lat) &&
    Number.isFinite(state.line.a.lon) &&
    Number.isFinite(state.line.b.lat) &&
    Number.isFinite(state.line.b.lon)
  );
}

function updateLineStatus() {
  const valid = hasLine();
  if (els.lineStatus) {
    els.lineStatus.textContent = valid ? "" : "NO LINE";
  }
}

function computeTimeDeltaFromRate(projectedDistance, rate) {
  if (!Number.isFinite(projectedDistance) || !Number.isFinite(rate) || rate <= 0) {
    return Number.NaN;
  }
  const seconds = projectedDistance / rate;
  if (!Number.isFinite(seconds)) return Number.NaN;
  const limit = 24 * 60 * 60;
  if (Math.abs(seconds) > limit) {
    return Math.sign(seconds) * limit;
  }
  return seconds;
}

function formatRaceTimeLabel(deltaSeconds) {
  if (!Number.isFinite(deltaSeconds)) return null;
  const total = Math.round(Math.abs(deltaSeconds));
  if (total < 600) {
    return "M:SS";
  }
  if (total < 3600) {
    return "M";
  }
  if (total < 36000) {
    return "H:MM";
  }
  return "H";
}

const DIRECT_SUFFIX = "DIRECT";
const CLOSING_SUFFIX = "CURRENT HEADING";

function getRaceMetricLabel() {
  return "TO LINE AT START";
}

function stripUnitLabel(label) {
  if (!label) return "";
  return label.replace(/\[|\]/g, "");
}

function buildRaceMetricLabel(prefix, suffix) {
  const base = prefix ? `${prefix} ${getRaceMetricLabel()}` : getRaceMetricLabel();
  return suffix ? `${base} - ${suffix}` : base;
}

function getDistanceLabelFallback() {
  return formatDistanceUnitWord(getDistanceUnitMeta().label);
}

function getTimeLabelFallback() {
  return "M:SS";
}

function formatDistanceUnitWord(unit) {
  const normalized = String(unit || "").toLowerCase();
  if (normalized === "m") return "METERS";
  if (normalized === "km") return "KILOMETERS";
  if (normalized === "ft") return "FEET";
  if (normalized === "yd") return "YARDS";
  if (!normalized) return "";
  return normalized.toUpperCase();
}

function getDistanceLabelFromUnit(unitLabel) {
  const unit = stripUnitLabel(unitLabel);
  return formatDistanceUnitWord(unit);
}

function getRaceMetricValues(projectedDirect, projectedClosing, speed, closingRate) {
  const isClosing = Number.isFinite(closingRate) && closingRate > 0;
  if (state.raceMetric === "time") {
    const directSeconds = computeTimeDeltaFromRate(projectedDirect, speed);
    const closingSeconds = isClosing
      ? computeTimeDeltaFromRate(projectedClosing, closingRate)
      : Number.NaN;
    return {
      direct: formatRaceTimeDelta(directSeconds),
      closing: isClosing
        ? formatRaceTimeDelta(closingSeconds)
        : "--",
      unitDirect: null,
      unitClosing: null,
      timeDirect: directSeconds,
      timeClosing: closingSeconds,
    };
  }
  const direct = formatRaceDelta(projectedDirect);
  const closing = isClosing ? formatRaceDelta(projectedClosing) : null;
  const fallbackUnit = direct.unitLabel;
  return {
    direct: direct.text,
    closing: closing ? closing.text : "--",
    unitDirect: direct.unitLabel,
    unitClosing: closing ? closing.unitLabel : fallbackUnit,
    timeDirect: null,
    timeClosing: null,
  };
}

function setRaceValues(directValue, closingValue, closingMiss) {
  if (els.raceProjDirect) {
    els.raceProjDirect.textContent = directValue;
  }
  if (els.raceProjClosing) {
    if (closingMiss) {
      els.raceProjClosing.textContent = "miss";
    } else {
      els.raceProjClosing.textContent = closingValue;
    }
  }
}

function updateRaceValueStyles(directOver, closingOver) {
  if (els.raceProjDirect) {
    els.raceProjDirect.classList.toggle("race-value-over", Boolean(directOver));
  }
  if (els.raceProjClosing) {
    els.raceProjClosing.classList.toggle("race-value-over", Boolean(closingOver));
  }
}

function setRaceStatusText(text) {
  if (els.raceProjDirect) {
    els.raceProjDirect.textContent = text;
  }
  if (els.raceProjClosing) {
    els.raceProjClosing.textContent = text;
  }
  updateRaceValueStyles(false, false);
  fitRaceText();
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

function updateRaceHintUnits(unitDirect, unitClosing) {
  if (state.raceMetric !== "distance") return;
  const fallback = getDistanceLabelFallback();
  const directLabel = buildRaceMetricLabel(
    getDistanceLabelFromUnit(unitDirect) || fallback,
    DIRECT_SUFFIX
  );
  const closingLabel = buildRaceMetricLabel(
    getDistanceLabelFromUnit(unitClosing) || fallback,
    CLOSING_SUFFIX
  );
  if (els.raceMetricLabelDirect) {
    els.raceMetricLabelDirect.textContent = directLabel;
  }
  if (els.raceMetricLabelClosing) {
    els.raceMetricLabelClosing.textContent = closingLabel;
  }
}

function updateRaceMetricLabels() {
  if (els.raceMetricDistance) {
    els.raceMetricDistance.textContent = getDistanceUnitMeta().label;
  }
  if (els.raceMetricTime) {
    els.raceMetricTime.textContent = "s";
  }
  if (state.raceMetric === "time") {
    const directLabel = buildRaceMetricLabel(getTimeLabelFallback(), DIRECT_SUFFIX);
    const closingLabel = buildRaceMetricLabel(getTimeLabelFallback(), CLOSING_SUFFIX);
    if (els.raceMetricLabelDirect) {
      els.raceMetricLabelDirect.textContent = directLabel;
    }
    if (els.raceMetricLabelClosing) {
      els.raceMetricLabelClosing.textContent = closingLabel;
    }
  } else {
    updateRaceHintUnits();
  }
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

function updateRaceTimeFormatLabels(directSeconds, closingSeconds) {
  if (state.raceMetric !== "time") return;
  const directFormat = formatRaceTimeLabel(directSeconds) || getTimeLabelFallback();
  const closingFormat = formatRaceTimeLabel(closingSeconds) || directFormat;
  if (els.raceMetricLabelDirect) {
    els.raceMetricLabelDirect.textContent = buildRaceMetricLabel(
      directFormat,
      DIRECT_SUFFIX
    );
  }
  if (els.raceMetricLabelClosing) {
    els.raceMetricLabelClosing.textContent = buildRaceMetricLabel(
      closingFormat,
      CLOSING_SUFFIX
    );
  }
}

function setRaceMetric(metric) {
  state.raceMetric = metric === "time" ? "time" : "distance";
  updateRaceMetricLabels();
  updateLineProjection();
}

function cross2d(a, b) {
  return a.x * b.y - a.y * b.x;
}

function formatCompass16(degrees) {
  if (!Number.isFinite(degrees)) return "--";
  const labels = [
    "N",
    "NNE",
    "NE",
    "ENE",
    "E",
    "ESE",
    "SE",
    "SSE",
    "S",
    "SSW",
    "SW",
    "WSW",
    "W",
    "WNW",
    "NW",
    "NNW",
  ];
  const normalized = ((degrees % 360) + 360) % 360;
  const index = Math.round(normalized / 22.5) % labels.length;
  return labels[index];
}

function computeLineLength() {
  if (!hasLine()) return null;
  const origin = {
    lat: (state.line.a.lat + state.line.b.lat) / 2,
    lon: (state.line.a.lon + state.line.b.lon) / 2,
  };
  const pointA = toMeters(state.line.a, origin);
  const pointB = toMeters(state.line.b, origin);
  const lineLen = Math.hypot(pointB.x - pointA.x, pointB.y - pointA.y);
  return Number.isFinite(lineLen) && lineLen >= 1 ? lineLen : null;
}

function computeStartDirection() {
  if (!hasLine()) return null;
  const origin = {
    lat: (state.line.a.lat + state.line.b.lat) / 2,
    lon: (state.line.a.lon + state.line.b.lon) / 2,
  };
  const pointA = toMeters(state.line.a, origin);
  const pointB = toMeters(state.line.b, origin);
  const lineVec = { x: pointB.x - pointA.x, y: pointB.y - pointA.y };
  const lineLen = Math.hypot(lineVec.x, lineVec.y);
  if (lineLen < 1) return null;
  const normal = { x: -lineVec.y / lineLen, y: lineVec.x / lineLen };
  const bearingDegrees =
    ((Math.atan2(normal.x, normal.y) * 180) / Math.PI + 360) % 360;
  return formatCompass16(bearingDegrees);
}

function getStartDirectionStatusText() {
  if (!hasLine()) return "NO LINE";
  const direction = computeStartDirection();
  if (!direction) return "Line too short";
  return direction;
}

function getStartDirectionElement() {
  return els.statusStartDirection || document.getElementById("status-start-direction");
}

function distanceToSegment(point, pointA, pointB) {
  const abx = pointB.x - pointA.x;
  const aby = pointB.y - pointA.y;
  const apx = point.x - pointA.x;
  const apy = point.y - pointA.y;
  const abLenSq = abx * abx + aby * aby;
  let t = 0;
  if (abLenSq > 0) {
    t = (apx * abx + apy * aby) / abLenSq;
  }
  const clampedT = Math.min(1, Math.max(0, t));
  const closest = {
    x: pointA.x + abx * clampedT,
    y: pointA.y + aby * clampedT,
  };
  const dx = point.x - closest.x;
  const dy = point.y - closest.y;
  return { distance: Math.hypot(dx, dy), t, closest };
}

function headingIntersectsSegment(point, velocity, pointA, pointB) {
  if (!velocity || !Number.isFinite(velocity.x) || !Number.isFinite(velocity.y)) {
    return false;
  }
  const speedSq = velocity.x * velocity.x + velocity.y * velocity.y;
  if (speedSq < 1e-6) return false;
  const r = velocity;
  const s = { x: pointB.x - pointA.x, y: pointB.y - pointA.y };
  const denom = cross2d(r, s);
  if (Math.abs(denom) < 1e-9) return false;
  const qp = { x: pointA.x - point.x, y: pointA.y - point.y };
  const t = cross2d(qp, s) / denom;
  const u = cross2d(qp, r) / denom;
  return t >= 0 && u >= 0 && u <= 1;
}

// Precompute the line geometry once per update (meters in a local origin).
function getLineGeometry() {
  if (!hasLine()) return null;
  const origin = {
    lat: (state.line.a.lat + state.line.b.lat) / 2,
    lon: (state.line.a.lon + state.line.b.lon) / 2,
  };
  const pointA = toMeters(state.line.a, origin);
  const pointB = toMeters(state.line.b, origin);
  const lineVec = { x: pointB.x - pointA.x, y: pointB.y - pointA.y };
  const lineLen = Math.hypot(lineVec.x, lineVec.y);
  if (lineLen < 1) return null;
  const normal = { x: -lineVec.y / lineLen, y: lineVec.x / lineLen };
  return { origin, pointA, pointB, lineLen, normal };
}

// Convert a GPS position to local meters using the provided origin.
function toMetersFromPosition(position, origin) {
  if (!position) return null;
  return toMeters(
    { lat: position.coords.latitude, lon: position.coords.longitude },
    origin
  );
}

// Normalize a vector and keep its length if needed for quick checks.
function normalizeVector(vec) {
  if (!vec || !Number.isFinite(vec.x) || !Number.isFinite(vec.y)) return null;
  const len = Math.hypot(vec.x, vec.y);
  if (len <= 0) return null;
  return { x: vec.x / len, y: vec.y / len, len };
}

// Offset a point along a unit vector by a distance (meters).
function offsetPoint(point, unit, distance) {
  if (!point || !unit || !Number.isFinite(distance) || distance === 0) {
    return point;
  }
  return { x: point.x + unit.x * distance, y: point.y + unit.y * distance };
}

function isFalseStart(signedDistance) {
  return signedDistance > 0;
}

function updateLineProjection() {
  const hasStartTime = Number.isFinite(state.start.startTs);
  if (!hasLine()) {
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
    setRaceStatusText("NO LINE");
    updateRaceHintUnits();
    const missingLineText = "NO LINE";
    if (els.statusDistance) {
      if (els.statusDistanceValue) {
        els.statusDistanceValue.textContent = missingLineText;
      } else {
        els.statusDistance.textContent = missingLineText;
      }
    }
    if (els.statusLineLength) {
      if (els.statusLineLengthValue) {
        els.statusLineLengthValue.textContent = missingLineText;
      } else {
        els.statusLineLength.textContent = missingLineText;
      }
    }
    if (els.statusDistanceUnit) {
      els.statusDistanceUnit.textContent = "";
    }
    if (els.statusLineLengthUnit) {
      els.statusLineLengthUnit.textContent = "";
    }
    const startDirectionEl = getStartDirectionElement();
    if (startDirectionEl) {
      startDirectionEl.textContent = getStartDirectionStatusText();
    }
    return;
  }

  if (!state.position) {
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
    if (!hasStartTime) {
      setRaceStatusText("NO TIME");
    } else {
      setRaceStatusText("NO GPS");
    }
    updateRaceHintUnits();
    if (els.statusDistance) {
      if (els.statusDistanceValue) {
        els.statusDistanceValue.textContent = "NO GPS";
      } else {
        els.statusDistance.textContent = "NO GPS";
      }
    }
    if (els.statusDistanceUnit) {
      els.statusDistanceUnit.textContent = "";
    }
    if (els.statusLineLength) {
      const lineLen = computeLineLength();
      const lineText = lineLen ? `${formatDistanceValue(lineLen)}` : "Line too short";
      if (els.statusLineLengthValue) {
        els.statusLineLengthValue.textContent = lineText;
      } else {
        els.statusLineLength.textContent = lineText;
      }
    }
    const startDirectionEl = getStartDirectionElement();
    if (startDirectionEl) {
      startDirectionEl.textContent = getStartDirectionStatusText();
    }
    updateStatusUnitLabels();
    return;
  }

  const geometry = getLineGeometry();
  if (!geometry) {
    if (els.lineStatus) {
      els.lineStatus.textContent = "Line too short";
    }
    const startDirectionEl = getStartDirectionElement();
    if (startDirectionEl) {
      startDirectionEl.textContent = "Line too short";
    }
    return;
  }
  const deviceMeters = toMetersFromPosition(state.position, geometry.origin);
  if (!deviceMeters) {
    return;
  }
  if (els.lineStatus) {
    els.lineStatus.textContent = "";
  }

  const { normal, lineLen, pointA, pointB } = geometry;
  const bowOffsetMeters = Math.max(0, Number(state.bowOffsetMeters) || 0);
  // Device position is the base estimate. We only add bow offset where it matters:
  // - "current heading" distance uses bow offset along the heading vector.
  // - "direct to line" distance uses bow offset along the perpendicular to the line.
  const velocityUnit = normalizeVector(state.velocity);
  const bowHeading = velocityUnit
    ? offsetPoint(deviceMeters, velocityUnit, bowOffsetMeters)
    : deviceMeters;
  const bowSegment = distanceToSegment(bowHeading, pointA, pointB);
  const signedDistance =
    (bowHeading.x - pointA.x) * normal.x + (bowHeading.y - pointA.y) * normal.y;
  const distanceSign = Math.sign(signedDistance) || 1;
  const distanceToLine = Math.abs(signedDistance);
  const distanceToSegmentActual = bowSegment.distance;

  const deviceSegment = distanceToSegment(deviceMeters, pointA, pointB);
  const toLineUnit =
    deviceSegment.distance > 0
      ? {
          x: (deviceSegment.closest.x - deviceMeters.x) / deviceSegment.distance,
          y: (deviceSegment.closest.y - deviceMeters.y) / deviceSegment.distance,
        }
      : null;
  const bowDirect = toLineUnit
    ? offsetPoint(deviceMeters, toLineUnit, bowOffsetMeters)
    : deviceMeters;
  const directSegment = distanceToSegment(bowDirect, pointA, pointB);
  const directDistanceToSegment = directSegment.distance;

  state.latestDistance = distanceToSegmentActual;
  state.latestSignedDistance = signedDistance;

  const speed = state.speed;
  let timeToStart = null;
  let closingRate = Number.NaN;
  let projectedDirect = Number.NaN;
  let projectedClosing = Number.NaN;
  let isClosing = false;
  let overshootDirect = false;
  let overshootClosing = false;
  if (hasStartTime) {
    // Time remaining drives the projection forward to the start.
    timeToStart = Math.max(0, (state.start.startTs - Date.now()) / 1000);
    // "Current heading" uses bowHeading and the line normal to compute closing rate.
    const headingHitsLine = headingIntersectsSegment(
      bowHeading,
      state.velocity,
      pointA,
      pointB
    );
    closingRate = headingHitsLine
      ? -(state.velocity.x * normal.x + state.velocity.y * normal.y) * distanceSign
      : Number.NaN;
    const sideSign = isFalseStart(signedDistance) ? -1 : 1;
    projectedDirect = (directDistanceToSegment - speed * timeToStart) * sideSign;
    projectedClosing = Number.isFinite(closingRate)
      ? (distanceToLine - closingRate * timeToStart) * sideSign
      : Number.NaN;
    isClosing = Number.isFinite(closingRate) && closingRate > 0;
    overshootDirect = Number.isFinite(projectedDirect) && projectedDirect < 0;
    overshootClosing =
      isClosing && Number.isFinite(projectedClosing) && projectedClosing < 0;
  } else {
    setRaceStatusText("NO TIME");
  }

  if (els.projDirect) els.projDirect.textContent = formatOverUnder(projectedDirect);
  if (els.distDirect) {
    els.distDirect.textContent = `Distance to line ${formatDistanceWithUnit(
      distanceToSegmentActual
    )}`;
  }
  if (els.projClosing) els.projClosing.textContent = formatOverUnder(projectedClosing);
  if (els.closingRate) {
    els.closingRate.textContent = `Closing rate ${formatRate(closingRate)}`;
  }
  if (hasStartTime) {
    const raceValues = getRaceMetricValues(
      projectedDirect,
      projectedClosing,
      speed,
      closingRate
    );
    setRaceValues(raceValues.direct, raceValues.closing, !isClosing);
    updateRaceHintUnits(raceValues.unitDirect, raceValues.unitClosing);
    updateRaceTimeFormatLabels(raceValues.timeDirect, raceValues.timeClosing);
    updateRaceValueStyles(overshootDirect, overshootClosing);
    fitRaceText();
  }
  if (els.statusDistance) {
    if (els.statusDistanceValue) {
      els.statusDistanceValue.textContent = `${formatDistanceValue(
        distanceToSegmentActual
      )}`;
    } else {
      els.statusDistance.textContent = `${formatDistanceValue(distanceToSegmentActual)}`;
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
  const startDirectionEl = getStartDirectionElement();
  if (startDirectionEl) {
    startDirectionEl.textContent = getStartDirectionStatusText();
  }

  if (hasStartTime && timeToStart !== null && timeToStart <= 0 && !state.start.freeze) {
    const nextFalseStart = isFalseStart(signedDistance);
    if (state.start.crossedEarly !== nextFalseStart) {
      state.start.crossedEarly = nextFalseStart;
      saveSettingsToStorage({ start: { crossedEarly: state.start.crossedEarly } });
    }
  }

  if (hasStartTime && timeToStart !== null && timeToStart <= 0) {
    const freeze = state.start.freeze || {};
    if (!freeze.countdown) {
      freeze.countdown = state.start.crossedEarly ? "False\nStart" : "Good\nStart";
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
      const frozenClosing =
        Number.isFinite(freeze.race.closingRate) && freeze.race.closingRate > 0;
      setRaceValues(frozenValues.direct, frozenValues.closing, !frozenClosing);
      updateRaceHintUnits(frozenValues.unitDirect, frozenValues.unitClosing);
      updateRaceTimeFormatLabels(frozenValues.timeDirect, frozenValues.timeClosing);
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

export {
  hasLine,
  updateLineStatus,
  updateStatusUnitLabels,
  updateRaceHintUnits,
  updateRaceMetricLabels,
  setRaceMetric,
  updateLineProjection,
};
