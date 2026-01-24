export const coordsView = `
<section id="coords-view" class="coords-view" aria-hidden="true">
  <div class="coords-panel">
    <h2>Enter Coordinates</h2>
    <div class="row coords-format-row">
      <button id="coords-format" class="ghost" type="button">Format: Decimal</button>
      <button id="coords-done-top" class="ghost" type="button" hidden>Done</button>
    </div>

    <div id="coords-format-dd">
      <div class="grid">
        <div>
          <label for="lat-a">Port mark (lat)</label>
          <input id="lat-a" type="number" step="0.000001" placeholder="55.000000" />
        </div>
        <div>
          <label for="lon-a">Port mark (lon)</label>
          <input id="lon-a" type="number" step="0.000001" placeholder="12.000000" />
        </div>
        <div>
          <label for="lat-b">Starboard mark (lat)</label>
          <input id="lat-b" type="number" step="0.000001" placeholder="55.000000" />
        </div>
        <div>
          <label for="lon-b">Starboard mark (lon)</label>
          <input id="lon-b" type="number" step="0.000001" placeholder="12.000000" />
        </div>
      </div>
    </div>

    <div id="coords-format-ddm" hidden>
      <div class="coords-marks">
        <div class="coords-mark-panel">
          <h3>Port mark</h3>
          <div class="coords-latlon">
            <div class="coords-latlon-row">
              <div>
                <label for="lat-a-deg-ddm">Lat (°)</label>
                <select id="lat-a-deg-ddm"></select>
              </div>
              <div>
                <label for="lat-a-min-ddm">Lat (')</label>
                <div class="coords-composite-input">
                  <select id="lat-a-min-ddm"></select>
                  <span class="coords-decimal-dot" aria-hidden="true">.</span>
                  <input
                    id="lat-a-min-dec-ddm"
                    class="coords-decimals"
                    type="text"
                    inputmode="numeric"
                    pattern="[0-9]*"
                    maxlength="10"
                    placeholder="0000000000"
                    aria-label="Port latitude minutes decimals"
                  />
                </div>
              </div>
              <div>
                <label for="lat-a-hemi-ddm">Lat</label>
                <input type="hidden" id="lat-a-hemi-ddm" value="N" />
                <div class="coords-hemis" data-target="lat-a-hemi-ddm">
                  <button type="button" class="coords-hemisphere" data-value="N" aria-label="North">N</button>
                  <button type="button" class="coords-hemisphere" data-value="S" aria-label="South">S</button>
                </div>
              </div>
            </div>

            <div class="coords-latlon-row">
              <div>
                <label for="lon-a-deg-ddm">Lon (°)</label>
                <select id="lon-a-deg-ddm"></select>
              </div>
              <div>
                <label for="lon-a-min-ddm">Lon (')</label>
                <div class="coords-composite-input">
                  <select id="lon-a-min-ddm"></select>
                  <span class="coords-decimal-dot" aria-hidden="true">.</span>
                  <input
                    id="lon-a-min-dec-ddm"
                    class="coords-decimals"
                    type="text"
                    inputmode="numeric"
                    pattern="[0-9]*"
                    maxlength="10"
                    placeholder="0000000000"
                    aria-label="Port longitude minutes decimals"
                  />
                </div>
              </div>
              <div>
                <label for="lon-a-hemi-ddm">Lon</label>
                <input type="hidden" id="lon-a-hemi-ddm" value="E" />
                <div class="coords-hemis" data-target="lon-a-hemi-ddm">
                  <button type="button" class="coords-hemisphere" data-value="E" aria-label="East">E</button>
                  <button type="button" class="coords-hemisphere" data-value="W" aria-label="West">W</button>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div class="coords-mark-panel">
          <h3>Starboard mark</h3>
          <div class="coords-latlon">
            <div class="coords-latlon-row">
              <div>
                <label for="lat-b-deg-ddm">Lat (°)</label>
                <select id="lat-b-deg-ddm"></select>
              </div>
              <div>
                <label for="lat-b-min-ddm">Lat (')</label>
                <div class="coords-composite-input">
                  <select id="lat-b-min-ddm"></select>
                  <span class="coords-decimal-dot" aria-hidden="true">.</span>
                  <input
                    id="lat-b-min-dec-ddm"
                    class="coords-decimals"
                    type="text"
                    inputmode="numeric"
                    pattern="[0-9]*"
                    maxlength="10"
                    placeholder="0000000000"
                    aria-label="Starboard latitude minutes decimals"
                  />
                </div>
              </div>
              <div>
                <label for="lat-b-hemi-ddm">Lat</label>
                <input type="hidden" id="lat-b-hemi-ddm" value="N" />
                <div class="coords-hemis" data-target="lat-b-hemi-ddm">
                  <button type="button" class="coords-hemisphere" data-value="N" aria-label="North">N</button>
                  <button type="button" class="coords-hemisphere" data-value="S" aria-label="South">S</button>
                </div>
              </div>
            </div>

            <div class="coords-latlon-row">
              <div>
                <label for="lon-b-deg-ddm">Lon (°)</label>
                <select id="lon-b-deg-ddm"></select>
              </div>
              <div>
                <label for="lon-b-min-ddm">Lon (')</label>
                <div class="coords-composite-input">
                  <select id="lon-b-min-ddm"></select>
                  <span class="coords-decimal-dot" aria-hidden="true">.</span>
                  <input
                    id="lon-b-min-dec-ddm"
                    class="coords-decimals"
                    type="text"
                    inputmode="numeric"
                    pattern="[0-9]*"
                    maxlength="10"
                    placeholder="0000000000"
                    aria-label="Starboard longitude minutes decimals"
                  />
                </div>
              </div>
              <div>
                <label for="lon-b-hemi-ddm">Lon</label>
                <input type="hidden" id="lon-b-hemi-ddm" value="E" />
                <div class="coords-hemis" data-target="lon-b-hemi-ddm">
                  <button type="button" class="coords-hemisphere" data-value="E" aria-label="East">E</button>
                  <button type="button" class="coords-hemisphere" data-value="W" aria-label="West">W</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div id="coords-format-dms" hidden>
      <div class="coords-marks">
        <div class="coords-mark-panel">
          <h3>Port mark</h3>
          <div class="grid">
            <div>
              <label for="lat-a-deg-dms">Lat (°)</label>
              <select id="lat-a-deg-dms"></select>
            </div>
            <div>
              <label for="lat-a-min-dms">Lat (')</label>
              <select id="lat-a-min-dms"></select>
            </div>
            <div>
              <label for="lat-a-sec-dms">Lat (")</label>
              <div class="coords-composite-input">
                <select id="lat-a-sec-dms"></select>
                <span class="coords-decimal-dot" aria-hidden="true">.</span>
                <input
                  id="lat-a-sec-dec-dms"
                  class="coords-decimals"
                  type="text"
                  inputmode="numeric"
                  pattern="[0-9]*"
                  maxlength="10"
                  placeholder="0000000000"
                  aria-label="Port latitude seconds decimals"
                />
              </div>
            </div>
            <div>
              <label for="lat-a-hemi-dms">Lat</label>
              <input type="hidden" id="lat-a-hemi-dms" value="N" />
              <div class="coords-hemis" data-target="lat-a-hemi-dms">
                <button type="button" class="coords-hemisphere" data-value="N" aria-label="North">N</button>
                <button type="button" class="coords-hemisphere" data-value="S" aria-label="South">S</button>
              </div>
            </div>

            <div>
              <label for="lon-a-deg-dms">Lon (°)</label>
              <select id="lon-a-deg-dms"></select>
            </div>
            <div>
              <label for="lon-a-min-dms">Lon (')</label>
              <select id="lon-a-min-dms"></select>
            </div>
            <div>
              <label for="lon-a-sec-dms">Lon (")</label>
              <div class="coords-composite-input">
                <select id="lon-a-sec-dms"></select>
                <span class="coords-decimal-dot" aria-hidden="true">.</span>
                <input
                  id="lon-a-sec-dec-dms"
                  class="coords-decimals"
                  type="text"
                  inputmode="numeric"
                  pattern="[0-9]*"
                  maxlength="10"
                  placeholder="0000000000"
                  aria-label="Port longitude seconds decimals"
                />
              </div>
            </div>
            <div>
              <label for="lon-a-hemi-dms">Lon</label>
              <input type="hidden" id="lon-a-hemi-dms" value="E" />
              <div class="coords-hemis" data-target="lon-a-hemi-dms">
                <button type="button" class="coords-hemisphere" data-value="E" aria-label="East">E</button>
                <button type="button" class="coords-hemisphere" data-value="W" aria-label="West">W</button>
              </div>
            </div>
          </div>
        </div>

        <div class="coords-mark-panel">
          <h3>Starboard mark</h3>
          <div class="grid">
            <div>
              <label for="lat-b-deg-dms">Lat (°)</label>
              <select id="lat-b-deg-dms"></select>
            </div>
            <div>
              <label for="lat-b-min-dms">Lat (')</label>
              <select id="lat-b-min-dms"></select>
            </div>
            <div>
              <label for="lat-b-sec-dms">Lat (")</label>
              <div class="coords-composite-input">
                <select id="lat-b-sec-dms"></select>
                <span class="coords-decimal-dot" aria-hidden="true">.</span>
                <input
                  id="lat-b-sec-dec-dms"
                  class="coords-decimals"
                  type="text"
                  inputmode="numeric"
                  pattern="[0-9]*"
                  maxlength="10"
                  placeholder="0000000000"
                  aria-label="Starboard latitude seconds decimals"
                />
              </div>
            </div>
            <div>
              <label for="lat-b-hemi-dms">Lat</label>
              <input type="hidden" id="lat-b-hemi-dms" value="N" />
              <div class="coords-hemis" data-target="lat-b-hemi-dms">
                <button type="button" class="coords-hemisphere" data-value="N" aria-label="North">N</button>
                <button type="button" class="coords-hemisphere" data-value="S" aria-label="South">S</button>
              </div>
            </div>

            <div>
              <label for="lon-b-deg-dms">Lon (°)</label>
              <select id="lon-b-deg-dms"></select>
            </div>
            <div>
              <label for="lon-b-min-dms">Lon (')</label>
              <select id="lon-b-min-dms"></select>
            </div>
            <div>
              <label for="lon-b-sec-dms">Lon (")</label>
              <div class="coords-composite-input">
                <select id="lon-b-sec-dms"></select>
                <span class="coords-decimal-dot" aria-hidden="true">.</span>
                <input
                  id="lon-b-sec-dec-dms"
                  class="coords-decimals"
                  type="text"
                  inputmode="numeric"
                  pattern="[0-9]*"
                  maxlength="10"
                  placeholder="0000000000"
                  aria-label="Starboard longitude seconds decimals"
                />
              </div>
            </div>
            <div>
              <label for="lon-b-hemi-dms">Lon</label>
              <input type="hidden" id="lon-b-hemi-dms" value="E" />
              <div class="coords-hemis" data-target="lon-b-hemi-dms">
                <button type="button" class="coords-hemisphere" data-value="E" aria-label="East">E</button>
                <button type="button" class="coords-hemisphere" data-value="W" aria-label="West">W</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div class="row stack">
      <button id="swap-coords" class="ghost" type="button">Swap marks</button>
      <button id="close-coords">Done</button>
    </div>
  </div>
</section>
`;
