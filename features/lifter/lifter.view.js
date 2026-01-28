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
            <img src="settings-cog.svg" class="icon-gear" alt="" aria-hidden="true" />
          </button>
          <div class="sensor-row">
            <button class="status-toggle" type="button" data-sensor="gps" aria-pressed="true">
              <span>GPS</span>
              <span
                id="lifter-gps-icon"
                class="gps-icon"
                aria-label="GPS status"
                title="GPS status"
              ></span>
            </button>
            <button class="status-toggle" type="button" data-sensor="imu" aria-pressed="false">
              <span>IMU</span>
              <span
                id="lifter-imu-icon"
                class="imu-icon"
                aria-label="IMU status"
                title="IMU status"
              ></span>
            </button>
          </div>
        </div>
      </div>
    </header>

    <section class="vmg-panel">
      <div class="lifter-plot" aria-label="Heading history plot">
        <canvas id="lifter-canvas"></canvas>
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
          <h2 id="lifter-window-title">History window</h2>
          <div id="lifter-window-value" class="lifter-window-value">5 min</div>
        </div>
        <div class="hint">Longer = more history.</div>
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
