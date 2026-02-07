export const quickView = `
<main id="quick-view" class="mode-shell" aria-hidden="true">
  <header class="page-head">
    <div class="head-title">
      <h1 class="brand-mark brand-light">
        <span class="brand-label">Quick</span><span class="brand-accent">Race</span>
      </h1>
    </div>
    <div class="head-bar">
      <div class="head-left">
        <button id="close-quick" class="nav-btn brand-btn brand-mark brand-light" type="button">
          <span class="brand-label">Race</span><span class="brand-accent">Plan</span>
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
    <div class="hint">Race</div>
    <div id="race-name" class="value">--</div>
    <div class="hint">Venue</div>
    <div id="venue-name" class="value">--</div>
    <div class="hint">Course length</div>
    <div id="status-course-length" class="value value-split">
      <span id="status-course-length-value">--</span>
      <span id="status-course-length-unit" class="value-unit">[m]</span>
    </div>
    <div class="hint">Line name</div>
    <div id="status-line-name" class="value">--</div>
    <div class="hint">Start time</div>
    <div id="status-start-time" class="value">--</div>
    <div class="hint">Time until start</div>
    <div id="status-time" class="value">--</div>
    <div class="row stack">
      <button id="go-race" class="race-enter">Race</button>
    </div>
  </section>

  <section class="panel">
    <h2>Mode</h2>
    <div class="race-toggle horizontal start-toggle" role="group" aria-label="Quick race mode">
      <button id="quick-mode-home" class="race-toggle-btn" type="button" aria-pressed="true">
        Home today
      </button>
      <button id="quick-mode-plan" class="race-toggle-btn" type="button" aria-pressed="false">
        Planned event
      </button>
    </div>
  </section>

  <section id="quick-home-panel" class="panel">
    <h2>Home today</h2>
    <div class="hint">Venue</div>
    <div id="quick-venue-name" class="value">--</div>
    <div class="row stack">
      <button id="quick-change-venue" class="ghost">Change venue</button>
    </div>
    <div class="hint">Start line</div>
    <div id="quick-start-line-name" class="value">--</div>
    <div class="hint">Finish line</div>
    <div id="quick-finish-line-name" class="value">--</div>
    <div class="row stack">
      <button id="quick-change-lines" class="ghost">Change lines</button>
    </div>
    <div class="hint">Course</div>
    <div id="quick-route-count" class="value">NO ROUTE</div>
    <div class="row stack">
      <button id="quick-edit-course" class="ghost">Edit course</button>
      <button id="quick-rounding" class="ghost">Rounding sides</button>
      <button id="quick-clear-course" class="ghost">Clear course</button>
    </div>
  </section>

  <section id="quick-plan-panel" class="panel" hidden>
    <h2>Planned event</h2>
    <div class="hint">Selected plan</div>
    <div id="quick-plan-name" class="value">--</div>
    <div class="hint">Venue</div>
    <div id="quick-plan-venue" class="value">--</div>
    <div class="row stack">
      <button id="quick-select-plan" class="ghost">Choose planned event</button>
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
