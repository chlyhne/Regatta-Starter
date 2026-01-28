export const raceView = `
<section id="race-view" class="race-view" aria-hidden="true">
  <div class="race-quad-grid">
    <div class="race-quad race-quad-direct race-block">
      <div id="race-label-direct" class="race-label">
        METERS TO LINE AT START - DIRECT
      </div>
      <div id="race-proj-direct" class="race-value" data-fit-sample="+9.99">--</div>
    </div>
    <div class="race-quad race-quad-closing race-block">
      <div id="race-label-closing" class="race-label">
        METERS TO LINE AT START - CURRENT HEADING
      </div>
      <div id="race-proj-closing" class="race-value" data-fit-sample="+9.99">--</div>
    </div>
    <div class="race-quad race-quad-time">
      <div class="race-label">Start in</div>
      <div id="race-countdown" class="race-value">--:--</div>
    </div>
    <div class="race-quad race-quad-controls">
      <div class="race-controls">
        <div class="race-stack">
          <div class="race-toggle horizontal race-toggle-full" role="group" aria-label="m/s">
            <button
              id="race-metric-distance"
              class="race-toggle-btn"
              type="button"
              aria-pressed="true"
            >
              dist
            </button>
            <button
              id="race-metric-time"
              class="race-toggle-btn"
              type="button"
              aria-pressed="false"
            >
              time
            </button>
          </div>
        </div>
        <div class="race-stack">
          <button id="race-plus" class="race-btn">+1 s</button>
          <button id="race-minus" class="race-btn">−1 s</button>
        </div>
        <div class="race-stack">
          <button id="sync-race" class="race-btn">Sync</button>
          <button id="close-race" class="race-btn">Done</button>
        </div>
      </div>
    </div>
  </div>
</section>
`;
