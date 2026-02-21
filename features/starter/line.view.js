export const lineView = `
<main id="line-view" class="mode-shell" aria-hidden="true">
  <header class="page-head">
    <div class="head-title">
      <h1 class="brand-mark brand-light">
        <span class="brand-label">Start</span><span class="brand-accent">Line</span>
      </h1>
    </div>
    <div class="head-bar">
      <div class="head-left">
        <button id="close-line" class="nav-btn brand-btn brand-mark brand-light" type="button">
          <span class="brand-label">Race</span><span class="brand-accent">Plan</span>
        </button>
      </div>
    </div>
  </header>

  <section class="panel">
    <h2>Define start line</h2>
    <div class="hint">Line name</div>
    <div id="line-only-status" class="value">--</div>
    <div class="row stack">
      <button id="open-simple-map" class="ghost">Select on map</button>
      <button id="swap-marks" class="ghost">Swap marks</button>
      <button id="load-line" class="ghost">Saved start lines</button>
      <button id="save-line" class="ghost">Save start line</button>
      <button id="open-location" class="ghost">Use GPS to mark line</button>
      <button id="open-coords" class="ghost">Enter coordinates</button>
    </div>
  </section>

  <section class="panel">
    <h2>Set Start Time</h2>
    <div class="row setting-row">
      <div class="race-toggle horizontal start-toggle" role="group" aria-label="Start mode">
        <button
          id="line-start-mode-absolute"
          class="race-toggle-btn"
          type="button"
          aria-pressed="true"
        >
          Time
        </button>
        <button
          id="line-start-mode-countdown"
          class="race-toggle-btn"
          type="button"
          aria-pressed="false"
        >
          Countdown
        </button>
      </div>
    </div>
    <div class="grid">
      <div id="line-start-mode-absolute-panel">
        <input id="line-absolute-time" type="time" step="1" aria-label="Start time" />
      </div>
      <div id="line-start-mode-countdown-panel" hidden>
        <div class="countdown-picker" role="group" aria-label="Countdown duration">
          <select id="line-countdown-hours" aria-label="Countdown hours"></select>
          <span class="countdown-sep" aria-hidden="true">:</span>
          <select id="line-countdown-minutes" aria-label="Countdown minutes"></select>
          <span class="countdown-sep" aria-hidden="true">:</span>
          <select id="line-countdown-seconds" aria-label="Countdown seconds"></select>
        </div>
      </div>
    </div>
    <div class="row stack">
      <button id="line-set-start">Set</button>
    </div>
  </section>

  <section class="panel">
    <div class="row stack">
      <button id="line-go-race" class="race-enter">Race</button>
    </div>
  </section>
</main>
`;
