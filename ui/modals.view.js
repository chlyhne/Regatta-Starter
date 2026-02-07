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
      Mounted rigidly to the boat, the estimate gets much better. If it is not mounted, the
      estimate gets much worse.
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

<section id="race-modal" class="modal" aria-hidden="true">
  <div class="modal-panel">
    <h2>Races</h2>
    <div id="race-list" class="modal-list modal-scroll"></div>
    <div class="row stack">
      <button id="edit-race-venue" class="ghost">Venue</button>
      <button id="edit-race-start-line" class="ghost">Start line</button>
      <button id="edit-race-course" class="ghost">Course</button>
    </div>
    <div class="modal-actions">
      <button id="confirm-race">Use race</button>
      <button id="new-race" class="ghost">New race</button>
      <button id="delete-race" class="ghost danger">Delete race</button>
      <button id="close-race-modal" class="ghost">Cancel</button>
    </div>
  </div>
</section>

<section id="venue-modal" class="modal" aria-hidden="true">
  <div class="modal-panel">
    <h2>Venues</h2>
    <div id="venue-list" class="modal-list"></div>
    <div class="hint">Marks</div>
    <div id="mark-count" class="value">0</div>
    <div class="row stack">
      <button id="rename-venue" class="ghost">Rename venue</button>
      <button id="calibrate-mark" class="ghost">Calibrate mark</button>
      <button id="open-venue-marks" class="ghost">Edit marks</button>
      <button id="open-lines" class="ghost">Edit lines</button>
    </div>
    <div class="modal-actions">
      <button id="confirm-venue">Use venue</button>
      <button id="delete-venue" class="ghost danger">Delete venue</button>
      <button id="close-venue-modal" class="ghost">Cancel</button>
    </div>
  </div>
</section>

<section id="course-modal" class="modal" aria-hidden="true">
  <div class="modal-panel">
    <h2>Courses</h2>
    <div class="hint">Start line</div>
    <div id="start-line-status" class="value">NO LINE</div>
    <div class="row stack">
      <button id="select-start-line" class="ghost">Select start line</button>
    </div>
    <div class="hint">Finish line</div>
    <div id="finish-status" class="value">NO LINE</div>
    <div class="row stack">
      <button id="select-finish-line" class="ghost">Select finish line</button>
    </div>
    <button id="course-toggle" class="check-toggle" type="button" aria-pressed="false">
      <span class="check-label">Use course route</span>
      <span class="check-box" aria-hidden="true"></span>
    </button>
    <div class="hint">Route</div>
    <div id="route-count" class="value">NO ROUTE</div>
    <div class="row stack">
      <button id="open-route" class="ghost">Edit route</button>
      <button id="open-rounding" class="ghost">Rounding sides</button>
      <button id="clear-route" class="ghost">Clear route</button>
      <button id="open-route-map" class="ghost">Edit route on map</button>
      <button id="open-race-map" class="ghost">View race map</button>
    </div>
    <div class="modal-actions">
      <button id="close-course-modal" class="ghost">Done</button>
    </div>
  </div>
</section>

<section id="start-line-modal" class="modal" aria-hidden="true">
  <div class="modal-panel">
    <h2>Start line</h2>
    <div id="start-line-list" class="modal-list"></div>
    <div class="modal-actions">
      <button id="confirm-start-line">Use line</button>
      <button id="close-start-line" class="ghost">Cancel</button>
    </div>
  </div>
</section>

<section id="finish-line-modal" class="modal" aria-hidden="true">
  <div class="modal-panel">
    <h2>Finish line</h2>
    <div id="finish-line-list" class="modal-list"></div>
    <div class="modal-actions">
      <button id="confirm-finish-line">Use line</button>
      <button id="close-finish-line" class="ghost">Cancel</button>
    </div>
  </div>
</section>

<section id="course-marks-modal" class="modal" aria-hidden="true">
  <div class="modal-panel">
    <h2>Rounding Sides</h2>
    <p class="info-text">Tap a mark to switch port/starboard rounding.</p>
    <div id="course-marks-list" class="modal-list"></div>
    <div class="modal-actions">
      <button id="close-course-marks" class="ghost">Done</button>
    </div>
  </div>
</section>

<section id="course-keyboard-modal" class="modal" aria-hidden="true">
  <div class="modal-panel">
    <h2>Edit Route</h2>
    <p class="info-text">Tap red (port) or green (starboard) to add.</p>
    <div id="course-sequence" class="course-sequence"></div>
    <div id="course-keyboard" class="course-keyboard"></div>
    <div class="modal-actions">
      <button id="course-keyboard-undo" class="ghost">Undo</button>
      <button id="course-keyboard-clear" class="ghost">Clear</button>
      <button id="course-keyboard-close" class="ghost">Done</button>
    </div>
  </div>
</section>

<section id="record-note-modal" class="modal" aria-hidden="true">
  <div class="modal-panel">
    <h2>Recording note</h2>
    <textarea
      id="record-note"
      rows="4"
      placeholder="Optional note about this session"
    ></textarea>
    <div class="modal-actions">
      <button id="record-note-start">Start recording</button>
      <button id="record-note-cancel" class="ghost">Cancel</button>
    </div>
  </div>
</section>

<section id="replay-modal" class="modal" aria-hidden="true">
  <div class="modal-panel">
    <h2>Replay data</h2>
    <p class="info-text">Pick a replay file to load.</p>
    <div id="replay-list" class="modal-list"></div>
    <div class="modal-actions">
      <button id="replay-confirm">Start replay</button>
      <button id="replay-cancel" class="ghost">Cancel</button>
    </div>
  </div>
</section>

`;
