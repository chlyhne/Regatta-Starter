export const vmgView = `
<section id="vmg-view" class="vmg-view" aria-hidden="true">
  <div class="mode-shell">
    <header class="page-head">
      <div class="head-title">
        <h1 class="brand-mark brand-light">
          <span class="brand-label">Race</span><span class="brand-accent">Performance</span>
        </h1>
      </div>
      <div class="head-bar">
        <div class="head-left">
          <button class="nav-btn brand-btn brand-mark brand-light open-home" type="button">
            <span class="brand-label">Race</span><span class="brand-accent">Tools</span>
          </button>
        </div>
        <div class="head-right">
          <button
            id="open-vmg-settings"
            class="icon-btn"
            type="button"
            aria-label="Performance settings"
          >
            <svg class="icon-gear" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" stroke-width="2" />
              <path
                d="M12 2v4M12 18v4M2 12h4M18 12h4M4.9 4.9l2.8 2.8M16.3 16.3l2.8 2.8M19.1 4.9l-2.8 2.8M7.7 16.3l-2.8 2.8"
                fill="none"
                stroke="currentColor"
                stroke-linecap="round"
                stroke-width="2"
              />
            </svg>
          </button>
          <div class="gps-status">
            <span>GPS</span>
            <div
              id="vmg-gps-icon"
              class="gps-icon"
              aria-label="GPS status"
              title="GPS status"
            ></div>
          </div>
        </div>
      </div>
    </header>

    <section class="vmg-panel vmg-plot-panel">
      <div id="vmg-plot" class="vmg-plot" aria-label="Performance change plot">
        <canvas id="vmg-canvas"></canvas>
        <div id="vmg-warmup" class="vmg-warmup hint" aria-hidden="true">Warming</div>
      </div>
    </section>

    <section class="vmg-panel">
      <div class="race-toggle horizontal start-toggle vmg-mode-toggle" role="group" aria-label="Mode">
        <button
          id="vmg-mode-beat"
          class="race-toggle-btn"
          type="button"
          aria-pressed="true"
        >
          Beat
        </button>
        <button
          id="vmg-mode-reach"
          class="race-toggle-btn"
          type="button"
          aria-pressed="false"
        >
          Reach
        </button>
        <button
          id="vmg-mode-run"
          class="race-toggle-btn"
          type="button"
          aria-pressed="false"
        >
          Run
        </button>
      </div>
      <div class="race-toggle horizontal start-toggle vmg-tack-toggle" role="group" aria-label="Tack">
        <button
          id="vmg-tack-port"
          class="race-toggle-btn vmg-tack-port"
          type="button"
          aria-pressed="false"
        >
          Port
        </button>
        <button
          id="vmg-tack-starboard"
          class="race-toggle-btn vmg-tack-starboard"
          type="button"
          aria-pressed="true"
        >
          Starboard
        </button>
      </div>
    </section>

  </div>

  <section id="vmg-settings-view" class="vmg-settings-view" aria-hidden="true">
    <div class="vmg-settings-panel">
      <h2>Performance settings</h2>
      <div class="vmg-settings-group">
        <div class="hint">Enhance heading estimate using:</div>
        <button
          id="vmg-imu-toggle"
          class="check-toggle"
          type="button"
          aria-pressed="false"
        >
          <span class="check-label">Device motion sensor</span>
          <span class="check-box" aria-hidden="true"></span>
        </button>
        <button
          id="vmg-smooth-toggle"
          class="check-toggle"
          type="button"
          aria-pressed="true"
        >
          <span class="check-label">Smooth current value</span>
          <span class="check-box" aria-hidden="true"></span>
        </button>
        <button
          id="vmg-cap-toggle"
          class="check-toggle"
          type="button"
          aria-pressed="true"
        >
          <span class="check-label">Limit spikes to 50%</span>
          <span class="check-box" aria-hidden="true"></span>
        </button>
      </div>
      <div class="vmg-settings-group">
        <div class="vmg-control-head">
          <h2 id="vmg-window-title">Baseline smoothing</h2>
          <div id="vmg-window-value" class="vmg-window-value">45 s</div>
        </div>
        <div class="hint">Higher = steadier baseline.</div>
        <input
          id="vmg-window"
          class="vmg-window-slider"
          type="range"
          min="15"
          max="75"
          step="5"
          value="45"
          aria-labelledby="vmg-window-title vmg-window-value"
        />
      </div>
      <div class="vmg-settings-group">
        <div class="vmg-twa-head">
          <h2 id="vmg-twa-title">TWA</h2>
          <div id="vmg-twa-value" class="vmg-twa-value">45 deg</div>
        </div>
        <input
          id="vmg-twa"
          class="vmg-twa-slider"
          type="range"
          min="35"
          max="50"
          step="1"
          value="45"
          aria-labelledby="vmg-twa-title vmg-twa-value"
        />
        <div class="vmg-twa-scale" aria-hidden="true">
          <span>35</span>
          <span>50</span>
        </div>
      </div>
      <div class="vmg-settings-group">
        <div class="vmg-twa-head">
          <h2 id="vmg-twa-down-title">Downwind TWA</h2>
          <div id="vmg-twa-down-value" class="vmg-twa-value">150 deg</div>
        </div>
        <input
          id="vmg-twa-down"
          class="vmg-twa-slider"
          type="range"
          min="110"
          max="175"
          step="1"
          value="150"
          aria-labelledby="vmg-twa-down-title vmg-twa-down-value"
        />
        <div class="vmg-twa-scale" aria-hidden="true">
          <span>110</span>
          <span>175</span>
        </div>
      </div>
      <div class="row stack">
        <button id="close-vmg-settings" class="ghost">Done</button>
      </div>
    </div>
  </section>
</section>
`;
