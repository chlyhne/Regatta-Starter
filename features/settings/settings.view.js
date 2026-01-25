export const settingsView = `
<section id="settings-view" class="settings-view" aria-hidden="true">
  <div class="coords-panel">
    <h2>Settings</h2>
    <div class="row setting-row">
      <div class="setting-label">Sound</div>
      <div class="race-toggle horizontal" role="group" aria-label="Sound">
        <button id="sound-on" class="race-toggle-btn" type="button" aria-pressed="true">
          On
        </button>
        <button id="sound-off" class="race-toggle-btn" type="button" aria-pressed="false">
          Off
        </button>
      </div>
    </div>
    <div class="row setting-row">
      <div class="setting-label">Time format</div>
      <div class="race-toggle horizontal" role="group" aria-label="Time format">
        <button id="time-format-24" class="race-toggle-btn" type="button" aria-pressed="true">
          24 h
        </button>
        <button id="time-format-12" class="race-toggle-btn" type="button" aria-pressed="false">
          12 h
        </button>
      </div>
    </div>
    <div class="row setting-row">
      <div class="setting-label">Speed unit</div>
      <div class="race-toggle horizontal" role="group" aria-label="Speed unit">
        <button id="speed-unit-kn" class="race-toggle-btn" type="button" aria-pressed="true">
          kn
        </button>
        <button id="speed-unit-ms" class="race-toggle-btn" type="button" aria-pressed="false">
          m/s
        </button>
        <button id="speed-unit-mph" class="race-toggle-btn" type="button" aria-pressed="false">
          mph
        </button>
      </div>
    </div>
    <div class="row setting-row">
      <div class="setting-label">Distance unit</div>
      <div class="race-toggle horizontal" role="group" aria-label="Distance unit">
        <button id="distance-unit-m" class="race-toggle-btn" type="button" aria-pressed="true">
          m
        </button>
        <button id="distance-unit-ft" class="race-toggle-btn" type="button" aria-pressed="false">
          ft
        </button>
        <button id="distance-unit-yd" class="race-toggle-btn" type="button" aria-pressed="false">
          yd
        </button>
      </div>
    </div>
    <div class="row setting-row">
      <div class="setting-label">IMU calibration</div>
      <button id="open-imu-calibration" type="button">Calibrate IMU</button>
    </div>
    <div id="imu-calibration-status" class="setting-note">IMU: not calibrated</div>
    <div class="row stack">
      <label class="setting-label" for="diag-upload-token">Upload key</label>
      <input
        id="diag-upload-token"
        type="text"
        inputmode="text"
        autocomplete="off"
        autocapitalize="off"
        spellcheck="false"
      />
    </div>
    <div class="row stack">
      <button id="close-settings">Done</button>
    </div>
  </div>
</section>
`;
