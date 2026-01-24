export const modalsView = `
<section id="imu-calibration-modal" class="modal" aria-hidden="true">
  <div class="modal-panel">
    <h2>IMU Calibration</h2>
    <p class="info-text">Place the device flat, screen up.</p>
    <p class="info-text">Tap Start and rotate clockwise for 3 seconds.</p>
    <div id="imu-calibration-progress" class="hint">Ready.</div>
    <div class="modal-actions">
      <button id="start-imu-calibration">Start</button>
      <button id="close-imu-calibration" class="ghost">Close</button>
    </div>
  </div>
</section>

<section id="vmg-imu-modal" class="modal" aria-hidden="true">
  <div class="modal-panel">
    <h2>Device motion sensor</h2>
    <p class="info-text">
      Device motion sensor needs the phone mounted rigidly to the boat, or it will give worse
      estimates.
    </p>
    <div class="row stack">
      <button id="close-vmg-imu">Got it</button>
    </div>
  </div>
</section>

<section id="load-line-modal" class="modal" aria-hidden="true">
  <div class="modal-panel">
    <h2>Load Start Line</h2>
    <div id="saved-lines-list" class="modal-list"></div>
    <div class="modal-actions">
      <button id="confirm-load">Use line</button>
      <button id="confirm-delete" class="ghost danger">Delete line</button>
      <button id="close-load" class="ghost">Cancel</button>
    </div>
  </div>
</section>
`;
