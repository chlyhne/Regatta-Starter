export const setupView = `
<main id="setup-view" class="mode-shell" aria-hidden="true">
  <header class="page-head">
    <div class="head-title">
      <h1 class="brand-mark brand-light">
        <span class="brand-label">Race</span><span class="brand-accent">Starter</span>
      </h1>
    </div>
    <div class="head-bar">
      <div class="head-left">
        <button class="nav-btn brand-btn brand-mark brand-light open-home" type="button">
          <span class="brand-label">Race</span><span class="brand-accent">Tools</span>
        </button>
      </div>
      <div class="head-right">
        <div class="sensor-row">
          <button class="status-toggle" type="button" data-sensor="gps" aria-pressed="true">
            <span>GPS</span>
            <span id="gps-icon" class="gps-icon" aria-label="GPS status" title="GPS status"></span>
          </button>
          <button class="status-toggle" type="button" data-sensor="imu" aria-pressed="false">
            <span>IMU</span>
            <span id="imu-icon" class="imu-icon" aria-label="IMU status" title="IMU status"></span>
          </button>
        </div>
      </div>
    </div>
  </header>

  <section class="panel">
    <h2 class="panel-title">My Race</h2>
    <div class="hint">Line name</div>
    <div id="status-line-name" class="value">--</div>
    <div class="hint">Distance to line</div>
    <div id="status-distance" class="value value-split">
      <span id="status-distance-value">--</span>
      <span id="status-distance-unit" class="value-unit">[m]</span>
    </div>
    <div class="hint">Line length</div>
    <div id="status-line-length" class="value value-split">
      <span id="status-line-length-value">--</span>
      <span id="status-line-length-unit" class="value-unit">[m]</span>
    </div>
    <div class="hint">Start direction</div>
    <div id="status-start-direction" class="value">--</div>
    <div class="hint">Start time</div>
    <div id="status-start-time" class="value">--</div>
    <div class="hint">Time until start</div>
    <div id="status-time" class="value">--</div>
    <div class="row stack">
      <button id="go-race" class="race-enter">Race</button>
    </div>
  </section>

  <section class="panel">
    <h2>Define Start Line</h2>
    <div class="row stack">
      <button id="open-map" class="ghost">Select on map</button>
      <button id="swap-marks" class="ghost">Swap marks</button>
      <button id="load-line" class="ghost">Saved start lines</button>
      <button id="save-line" class="ghost">Save start line…</button>
      <button id="open-location" class="ghost">Use GPS position</button>
      <button id="open-coords" class="ghost">Enter coordinates</button>
    </div>
  </section>

  <section class="panel">
    <h2>Course</h2>
    <button id="course-toggle" class="check-toggle" type="button" aria-pressed="false">
      <span class="check-label">Track course after start</span>
      <span class="check-box" aria-hidden="true"></span>
    </button>
    <div class="hint">Marks</div>
    <div id="course-marks" class="value">NO COURSE</div>
    <div class="hint">Finish line</div>
    <div id="finish-status" class="value">OFF</div>
    <button id="finish-use-start" class="check-toggle" type="button" aria-pressed="true">
      <span class="check-label">Finish uses start line</span>
      <span class="check-box" aria-hidden="true"></span>
    </button>
    <div class="row stack">
      <button id="open-course-map" class="ghost">Select on map</button>
      <button id="open-course-marks" class="ghost">Edit marks</button>
      <button id="open-saved-marks" class="ghost">Saved marks</button>
      <button id="open-course-keyboard" class="ghost">Course keyboard</button>
      <button id="open-finish-map" class="ghost">Set finish line</button>
      <button id="swap-finish" class="ghost">Swap finish marks</button>
      <button id="clear-course" class="ghost">Clear course</button>
    </div>
  </section>

  <section class="panel">
    <h2>Saved Course</h2>
    <div class="row stack">
      <button id="load-course" class="ghost">Saved courses</button>
      <button id="save-course" class="ghost">Save course…</button>
    </div>
  </section>

  <section class="panel">
    <h2>Set Start Time</h2>
    <div class="row setting-row">
      <div class="race-toggle horizontal start-toggle" role="group" aria-label="Start mode">
        <button
          id="start-mode-absolute"
          class="race-toggle-btn"
          type="button"
          aria-pressed="true"
        >
          Time
        </button>
        <button
          id="start-mode-countdown"
          class="race-toggle-btn"
          type="button"
          aria-pressed="false"
        >
          Countdown
        </button>
      </div>
    </div>
    <div class="grid">
      <div id="start-mode-absolute-panel">
        <input id="absolute-time" type="time" step="1" aria-label="Start time" />
      </div>
      <div id="start-mode-countdown-panel" hidden>
        <div class="countdown-picker" role="group" aria-label="Countdown duration">
          <select id="countdown-hours" aria-label="Countdown hours"></select>
          <span class="countdown-sep" aria-hidden="true">:</span>
          <select id="countdown-minutes" aria-label="Countdown minutes"></select>
          <span class="countdown-sep" aria-hidden="true">:</span>
          <select id="countdown-seconds" aria-label="Countdown seconds"></select>
        </div>
      </div>
    </div>
    <div class="row stack">
      <button id="set-start">Set</button>
    </div>
  </section>

</main>
`;
