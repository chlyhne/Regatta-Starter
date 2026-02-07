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

<section id="marks-modal" class="modal" aria-hidden="true">
  <div class="modal-panel">
    <h2>Marks</h2>
    <div id="marks-list" class="modal-list modal-scroll"></div>
    <div class="hint">Calibration</div>
    <div id="calibration-status" class="value">--</div>
    <div class="row stack">
      <button id="calibrate-mark" class="ghost">Calibrate marks</button>
      <button id="calibration-undo" class="ghost" disabled>Undo calibration</button>
      <button id="open-venue-marks-map" class="ghost">Edit on map</button>
    </div>
    <div class="modal-actions">
      <button id="close-marks-modal" class="ghost">Done</button>
    </div>
  </div>
</section>

<section id="calibration-preview-modal" class="modal" aria-hidden="true">
  <div class="modal-panel">
    <h2>Calibrate marks</h2>
    <div class="hint">Nearest mark</div>
    <div id="calibration-preview-mark" class="value">--</div>
    <div class="hint">Move</div>
    <div id="calibration-preview-distance" class="value">--</div>
    <div id="calibration-preview-status" class="hint">--</div>
    <div class="modal-actions">
      <button id="confirm-calibration">Calibrate</button>
      <button id="cancel-calibration" class="ghost">Cancel</button>
    </div>
  </div>
</section>

<section id="mark-edit-modal" class="modal" aria-hidden="true">
  <div class="modal-panel">
    <h2 id="mark-edit-title">Edit mark</h2>
    <div class="grid">
      <div>
        <label for="mark-name">Mark name</label>
        <input
          id="mark-name"
          type="text"
          placeholder="Mark"
          autocomplete="off"
          spellcheck="false"
        />
      </div>
      <div>
        <label for="mark-desc">Description</label>
        <input
          id="mark-desc"
          type="text"
          placeholder="Optional"
          autocomplete="off"
          spellcheck="false"
        />
      </div>
    </div>
    <div class="row coords-format-row">
      <button id="mark-coords-format" class="ghost" type="button">Format: Decimal</button>
    </div>
    <div id="mark-format-dd">
      <div class="grid">
        <div>
          <label for="mark-lat">Mark (lat)</label>
          <input id="mark-lat" type="number" step="0.000001" placeholder="55.000000" />
        </div>
        <div>
          <label for="mark-lon">Mark (lon)</label>
          <input id="mark-lon" type="number" step="0.000001" placeholder="12.000000" />
        </div>
      </div>
    </div>
    <div id="mark-format-ddm" hidden>
      <div class="coords-marks">
        <div class="coords-mark-panel">
          <h3>Mark</h3>
          <div class="coords-latlon">
            <div class="coords-latlon-row">
              <div>
                <label for="mark-lat-deg-ddm">Lat (°)</label>
                <select id="mark-lat-deg-ddm"></select>
              </div>
              <div>
                <label for="mark-lat-min-ddm">Lat (')</label>
                <div class="coords-composite-input">
                  <select id="mark-lat-min-ddm"></select>
                  <span class="coords-decimal-dot" aria-hidden="true">.</span>
                  <input
                    id="mark-lat-min-dec-ddm"
                    class="coords-decimals"
                    type="text"
                    inputmode="numeric"
                    pattern="[0-9]*"
                    maxlength="10"
                    placeholder="0000000000"
                    aria-label="Mark latitude minutes decimals"
                  />
                </div>
              </div>
              <div>
                <label for="mark-lat-hemi-ddm">Lat</label>
                <input type="hidden" id="mark-lat-hemi-ddm" value="N" />
                <div class="coords-hemis" data-target="mark-lat-hemi-ddm" data-scope="mark">
                  <button type="button" class="coords-hemisphere" data-value="N" aria-label="North">N</button>
                  <button type="button" class="coords-hemisphere" data-value="S" aria-label="South">S</button>
                </div>
              </div>
            </div>

            <div class="coords-latlon-row">
              <div>
                <label for="mark-lon-deg-ddm">Lon (°)</label>
                <select id="mark-lon-deg-ddm"></select>
              </div>
              <div>
                <label for="mark-lon-min-ddm">Lon (')</label>
                <div class="coords-composite-input">
                  <select id="mark-lon-min-ddm"></select>
                  <span class="coords-decimal-dot" aria-hidden="true">.</span>
                  <input
                    id="mark-lon-min-dec-ddm"
                    class="coords-decimals"
                    type="text"
                    inputmode="numeric"
                    pattern="[0-9]*"
                    maxlength="10"
                    placeholder="0000000000"
                    aria-label="Mark longitude minutes decimals"
                  />
                </div>
              </div>
              <div>
                <label for="mark-lon-hemi-ddm">Lon</label>
                <input type="hidden" id="mark-lon-hemi-ddm" value="E" />
                <div class="coords-hemis" data-target="mark-lon-hemi-ddm" data-scope="mark">
                  <button type="button" class="coords-hemisphere" data-value="E" aria-label="East">E</button>
                  <button type="button" class="coords-hemisphere" data-value="W" aria-label="West">W</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
    <div id="mark-format-dms" hidden>
      <div class="coords-marks">
        <div class="coords-mark-panel">
          <h3>Mark</h3>
          <div class="grid">
            <div>
              <label for="mark-lat-deg-dms">Lat (°)</label>
              <select id="mark-lat-deg-dms"></select>
            </div>
            <div>
              <label for="mark-lat-min-dms">Lat (')</label>
              <select id="mark-lat-min-dms"></select>
            </div>
            <div>
              <label for="mark-lat-sec-dms">Lat (")</label>
              <div class="coords-composite-input">
                <select id="mark-lat-sec-dms"></select>
                <span class="coords-decimal-dot" aria-hidden="true">.</span>
                <input
                  id="mark-lat-sec-dec-dms"
                  class="coords-decimals"
                  type="text"
                  inputmode="numeric"
                  pattern="[0-9]*"
                  maxlength="10"
                  placeholder="0000000000"
                  aria-label="Mark latitude seconds decimals"
                />
              </div>
            </div>
            <div>
              <label for="mark-lat-hemi-dms">Lat</label>
              <input type="hidden" id="mark-lat-hemi-dms" value="N" />
              <div class="coords-hemis" data-target="mark-lat-hemi-dms" data-scope="mark">
                <button type="button" class="coords-hemisphere" data-value="N" aria-label="North">N</button>
                <button type="button" class="coords-hemisphere" data-value="S" aria-label="South">S</button>
              </div>
            </div>

            <div>
              <label for="mark-lon-deg-dms">Lon (°)</label>
              <select id="mark-lon-deg-dms"></select>
            </div>
            <div>
              <label for="mark-lon-min-dms">Lon (')</label>
              <select id="mark-lon-min-dms"></select>
            </div>
            <div>
              <label for="mark-lon-sec-dms">Lon (")</label>
              <div class="coords-composite-input">
                <select id="mark-lon-sec-dms"></select>
                <span class="coords-decimal-dot" aria-hidden="true">.</span>
                <input
                  id="mark-lon-sec-dec-dms"
                  class="coords-decimals"
                  type="text"
                  inputmode="numeric"
                  pattern="[0-9]*"
                  maxlength="10"
                  placeholder="0000000000"
                  aria-label="Mark longitude seconds decimals"
                />
              </div>
            </div>
            <div>
              <label for="mark-lon-hemi-dms">Lon</label>
              <input type="hidden" id="mark-lon-hemi-dms" value="E" />
              <div class="coords-hemis" data-target="mark-lon-hemi-dms" data-scope="mark">
                <button type="button" class="coords-hemisphere" data-value="E" aria-label="East">E</button>
                <button type="button" class="coords-hemisphere" data-value="W" aria-label="West">W</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
    <div class="row stack">
      <button id="mark-set-gps" class="ghost">Set from GPS</button>
    </div>
    <div class="modal-actions">
      <button id="close-mark-edit" class="ghost">Done</button>
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
