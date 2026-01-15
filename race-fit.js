import { els } from "./dom.js";

function fitRaceValues() {
  const values = [els.raceProjDirect, els.raceProjClosing].filter(Boolean);
  if (els.raceCountdown) {
    values.push(els.raceCountdown);
  }
  if (!values.length) return;
  if (values.some((element) => element.clientWidth === 0 || element.clientHeight === 0)) {
    return;
  }

  const hasNoTime = values.some((element) => {
    const text = (element.textContent || "").trim();
    return text === "NO TIME";
  });

  const samples = new Map();
  values.forEach((element) => {
    const sample = element.dataset.fitSample;
    const text = (element.textContent || "").trim();
    const useSample = sample && (text === "--" || /^[+-]?\d/.test(text));
    if (useSample) {
      samples.set(element, element.textContent);
      element.textContent = sample;
    }
    element.style.fontSize = "";
  });

  try {
    const baseSize = Math.max(
      ...values.map((element) => parseFloat(window.getComputedStyle(element).fontSize) || 16)
    );
    const maxSize = Math.max(
      baseSize,
      Math.min(240, Math.max(...values.map((element) => element.clientHeight || 0)))
    ) * (hasNoTime ? 0.9 : 1);
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
  } finally {
    samples.forEach((text, element) => {
      element.textContent = text;
    });
  }
}

function fitRaceText() {
  if (!document.body.classList.contains("race-mode")) return;
  fitRaceValues();
  const targets = document.querySelectorAll(".race-view .race-label, .race-view .race-hint");
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
