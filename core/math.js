function median(values) {
  if (!Array.isArray(values) || !values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2) return sorted[mid];
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

function fitLinearTrend(times, values) {
  const points = [];
  for (let i = 0; i < times.length; i += 1) {
    const time = times[i];
    const value = values[i];
    if (!Number.isFinite(time) || !Number.isFinite(value)) continue;
    points.push({ time, value });
  }
  if (!points.length) {
    return { slope: 0, intercept: 0, offset: Number.isFinite(times[0]) ? times[0] : 0, count: 0 };
  }

  const offset = points[0].time;
  const count = points.length;
  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumXX = 0;
  for (let i = 0; i < count; i += 1) {
    const x = points[i].time - offset;
    const y = points[i].value;
    sumX += x;
    sumY += y;
    sumXY += x * y;
    sumXX += x * x;
  }
  const denom = count * sumXX - sumX * sumX;
  const slope = denom ? (count * sumXY - sumX * sumY) / denom : 0;
  const intercept = (sumY - slope * sumX) / count;
  return { slope, intercept, offset, count };
}

function evaluateTrend(trend, time) {
  if (!trend || !Number.isFinite(time)) return 0;
  const slope = Number.isFinite(trend.slope) ? trend.slope : 0;
  const intercept = Number.isFinite(trend.intercept) ? trend.intercept : 0;
  const offset = Number.isFinite(trend.offset) ? trend.offset : 0;
  return intercept + slope * (time - offset);
}

function solveLinearSystem(matrix, vector) {
  const size = vector.length;
  const a = matrix.map((row) => row.slice());
  const b = vector.slice();

  for (let i = 0; i < size; i += 1) {
    let pivotRow = i;
    let pivotValue = Math.abs(a[i][i]);
    for (let r = i + 1; r < size; r += 1) {
      const value = Math.abs(a[r][i]);
      if (value > pivotValue) {
        pivotValue = value;
        pivotRow = r;
      }
    }
    if (pivotValue <= 1e-12) return null;
    if (pivotRow !== i) {
      [a[i], a[pivotRow]] = [a[pivotRow], a[i]];
      [b[i], b[pivotRow]] = [b[pivotRow], b[i]];
    }
    const pivot = a[i][i];
    for (let c = i; c < size; c += 1) {
      a[i][c] /= pivot;
    }
    b[i] /= pivot;
    for (let r = i + 1; r < size; r += 1) {
      const factor = a[r][i];
      if (factor === 0) continue;
      for (let c = i; c < size; c += 1) {
        a[r][c] -= factor * a[i][c];
      }
      b[r] -= factor * b[i];
    }
  }

  const solution = new Array(size).fill(0);
  for (let i = size - 1; i >= 0; i -= 1) {
    let sum = b[i];
    for (let c = i + 1; c < size; c += 1) {
      sum -= a[i][c] * solution[c];
    }
    solution[i] = sum;
  }
  return solution;
}

export { median, fitLinearTrend, evaluateTrend, solveLinearSystem };
