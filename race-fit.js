import { els } from "./dom.js";

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

export { fitRaceText, fitRaceValues };
