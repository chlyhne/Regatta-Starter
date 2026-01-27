export const lifterView = `
<section id="lifter-view" class="lifter-view" aria-hidden="true">
  <div class="mode-shell">
    <header class="page-head">
      <div class="head-title">
        <h1 class="brand-mark brand-light">
          <span class="brand-label">Race</span><span class="brand-accent">Lifter</span>
        </h1>
      </div>
      <div class="head-bar">
        <div class="head-left">
          <button class="nav-btn brand-btn brand-mark brand-light open-home" type="button">
            <span class="brand-label">Race</span><span class="brand-accent">Tools</span>
          </button>
        </div>
        <div class="head-right">
          <button id="open-lifter-settings" class="icon-btn" type="button" aria-label="Lifter settings">
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
              id="lifter-gps-icon"
              class="gps-icon"
              aria-label="GPS status"
              title="GPS status"
            ></div>
          </div>
        </div>
      </div>
    </header>

    <section class="vmg-panel">
      <div class="lifter-plot" aria-label="Heading history plot">
        <canvas id="lifter-canvas"></canvas>
      </div>
      <div class="lifter-mean" aria-label="Mean heading">
        Mean <span id="lifter-mean-value">--°</span>
      </div>
    </section>

  </div>

  <section id="lifter-settings-view" class="lifter-settings-view" aria-hidden="true">
    <div class="lifter-settings-panel">
      <h2>Lifter settings</h2>
      <div class="lifter-settings-group">
        <div class="hint">Enhance heading estimate using:</div>
        <button
          id="lifter-imu-toggle"
          class="check-toggle"
          type="button"
          aria-pressed="false"
        >
          <span class="check-label">Device motion sensor</span>
          <span class="check-box" aria-hidden="true"></span>
        </button>
      </div>
      <div class="lifter-settings-group">
        <div class="lifter-control-head">
          <h2 id="lifter-window-title">Baseline smoothing</h2>
          <div id="lifter-window-value" class="lifter-window-value">5 min</div>
        </div>
        <div class="hint">Higher = steadier baseline.</div>
        <input
          id="lifter-window"
          class="lifter-window-slider"
          type="range"
          min="60"
          max="1800"
          step="30"
          value="300"
          aria-labelledby="lifter-window-title lifter-window-value"
        />
      </div>
      <div class="row stack">
        <button id="close-lifter-settings" class="ghost">Done</button>
      </div>
    </div>
  </section>
</section>
`;
