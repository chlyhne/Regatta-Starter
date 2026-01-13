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
    els.lineStatus.textContent = valid ? "" : "Line not set";
  }
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

function formatRaceValue(prefix, value) {
  if (value === "--") return value;
  return `${prefix}: ${value}`;
}

function setRaceValues(directValue, closingValue, closingMiss) {
  if (els.raceProjDirect) {
    els.raceProjDirect.textContent = formatRaceValue("D", directValue);
  }
  if (els.raceProjClosing) {
    if (closingMiss) {
      els.raceProjClosing.innerHTML = '<span class="race-miss">line<br>miss</span>';
    } else {
      els.raceProjClosing.textContent = formatRaceValue("C", closingValue);
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

function cross2d(a, b) {
  return a.x * b.y - a.y * b.x;
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
  const segment = distanceToSegment(boat, pointA, pointB);
  return {
    normal,
    signedDistance,
    lineLen,
    boat,
    pointA,
    pointB,
    segmentDistance: segment.distance,
  };
}

function isFalseStart(signedDistance) {
  return signedDistance > 0;
}

function updateLineProjection() {
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
    if (els.raceProjDirect) {
      els.raceProjDirect.textContent = "--";
    }
    if (els.raceProjClosing) {
      els.raceProjClosing.textContent = "--";
    }
    updateRaceValueStyles(false, false);
    fitRaceText();
    const missingLineText = "Set start line";
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
    if (els.raceProjDirect) {
      els.raceProjDirect.textContent = "--";
    }
    if (els.raceProjClosing) {
      els.raceProjClosing.textContent = "--";
    }
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
    if (els.lineStatus) {
      els.lineStatus.textContent = "Line too short";
    }
    return;
  }
  if (els.lineStatus) {
    els.lineStatus.textContent = "";
  }

  const { normal, signedDistance, lineLen, boat, pointA, pointB, segmentDistance } =
    metrics;
  const distanceSign = Math.sign(signedDistance) || 1;
  const distanceToLine = Math.abs(signedDistance);
  const distanceToSegmentActual = segmentDistance;
  const bowOffsetMeters = state.useKalman ? state.bowOffsetMeters : 0;
  let phone = boat;
  if (bowOffsetMeters > 0) {
    const speed = Math.hypot(state.velocity.x, state.velocity.y);
    if (Number.isFinite(speed) && speed > 0) {
      phone = {
        x: boat.x - (state.velocity.x / speed) * bowOffsetMeters,
        y: boat.y - (state.velocity.y / speed) * bowOffsetMeters,
      };
    }
  }
  const phoneSegment = distanceToSegment(phone, pointA, pointB);
  let directBow = phone;
  if (bowOffsetMeters > 0 && phoneSegment.distance > 0) {
    const ux = (phoneSegment.closest.x - phone.x) / phoneSegment.distance;
    const uy = (phoneSegment.closest.y - phone.y) / phoneSegment.distance;
    directBow = {
      x: phone.x + ux * bowOffsetMeters,
      y: phone.y + uy * bowOffsetMeters,
    };
  }
  const directSegment = distanceToSegment(directBow, pointA, pointB);
  const directDistanceToSegment = directSegment.distance;
  state.latestDistance = distanceToSegmentActual;
  state.latestSignedDistance = signedDistance;

  const timeToStart = state.start.startTs
    ? Math.max(0, (state.start.startTs - Date.now()) / 1000)
    : 0;

  const speed = state.speed;
  const headingHitsLine = headingIntersectsSegment(boat, state.velocity, pointA, pointB);
  const closingRate = headingHitsLine
    ? -(state.velocity.x * normal.x + state.velocity.y * normal.y) * distanceSign
    : Number.NaN;
  const sideSign = isFalseStart(signedDistance) ? -1 : 1;
  const projectedDirect = (directDistanceToSegment - speed * timeToStart) * sideSign;
  const projectedClosing = Number.isFinite(closingRate)
    ? (distanceToLine - closingRate * timeToStart) * sideSign
    : Number.NaN;
  const isClosing = Number.isFinite(closingRate) && closingRate > 0;
  const overshootDirect = Number.isFinite(projectedDirect) && projectedDirect < 0;
  const overshootClosing =
    isClosing && Number.isFinite(projectedClosing) && projectedClosing < 0;

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
  const raceValues = getRaceMetricValues(
    projectedDirect,
    projectedClosing,
    speed,
    closingRate
  );
  setRaceValues(raceValues.direct, raceValues.closing, !isClosing);
  updateRaceValueStyles(overshootDirect, overshootClosing);
  fitRaceText();
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

  if (state.start.startTs && timeToStart <= 0 && !state.start.freeze) {
    const nextFalseStart = isFalseStart(signedDistance);
    if (state.start.crossedEarly !== nextFalseStart) {
      state.start.crossedEarly = nextFalseStart;
      saveSettingsToStorage({ start: { crossedEarly: state.start.crossedEarly } });
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
      const frozenClosing =
        Number.isFinite(freeze.race.closingRate) && freeze.race.closingRate > 0;
      setRaceValues(frozenValues.direct, frozenValues.closing, !frozenClosing);
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
