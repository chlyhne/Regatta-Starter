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
  if (els.raceProjDirect) {
    els.raceProjDirect.textContent = raceValues.direct;
  }
  if (els.raceProjClosing) {
    els.raceProjClosing.textContent = raceValues.closing;
  }
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
      if (els.raceProjDirect) {
        els.raceProjDirect.textContent = frozenValues.direct;
      }
      if (els.raceProjClosing) {
        els.raceProjClosing.textContent = frozenValues.closing;
      }
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

export {
  hasLine,
  updateLineStatus,
  updateStatusUnitLabels,
  updateRaceHintUnits,
  updateRaceMetricLabels,
  setRaceMetric,
  updateLineProjection,
};
