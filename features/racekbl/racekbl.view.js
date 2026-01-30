export const raceKblView = `
<section id="racekbl-view" class="racekbl-view" aria-hidden="true">
  <div class="mode-shell">
    <header class="page-head">
      <div class="head-title">
        <h1 class="brand-mark brand-light">
          <span class="brand-label">Race</span><span class="brand-accent">KBL</span>
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
            id="open-racekbl-settings"
            class="icon-btn"
            type="button"
            aria-label="Wind settings"
          >
            <img src="settings-cog.svg" class="icon-gear" alt="" aria-hidden="true" />
          </button>
          <div id="racekbl-status" class="hint" aria-live="polite">Waiting</div>
        </div>
      </div>
    </header>

    <section class="panel racekbl-speed-panel">
      <h2>Wind speed</h2>
      <div class="racekbl-plot racekbl-speed-plot" aria-label="Wind speed history plot">
        <canvas id="racekbl-speed-canvas"></canvas>
      </div>
    </section>

    <section class="panel racekbl-dir-panel">
      <h2>Wind direction</h2>
      <div class="racekbl-plot racekbl-dir-plot" aria-label="Wind direction history plot">
        <canvas id="racekbl-dir-canvas"></canvas>
      </div>
    </section>

    <section class="panel racekbl-speed-acf-panel">
      <h2>Wind speed autocorr</h2>
      <div class="racekbl-plot racekbl-speed-acf-plot" aria-label="Wind speed autocorrelation plot">
        <canvas id="racekbl-speed-acf-canvas"></canvas>
      </div>
    </section>

    <section class="panel racekbl-dir-acf-panel">
      <h2>Wind direction autocorr</h2>
      <div class="racekbl-plot racekbl-dir-acf-plot" aria-label="Wind direction autocorrelation plot">
        <canvas id="racekbl-dir-acf-canvas"></canvas>
      </div>
    </section>

    <section class="panel racekbl-xcorr-dir-speed-panel">
      <h2>Dir x speed</h2>
      <div class="racekbl-plot racekbl-xcorr-plot" aria-label="Wind direction vs speed cross-correlation plot">
        <canvas id="racekbl-xcorr-dir-speed-canvas"></canvas>
      </div>
    </section>

    <section class="panel racekbl-xcorr-speed-dir-panel">
      <h2>Speed x dir</h2>
      <div class="racekbl-plot racekbl-xcorr-plot" aria-label="Wind speed vs direction cross-correlation plot">
        <canvas id="racekbl-xcorr-speed-dir-canvas"></canvas>
      </div>
    </section>

  </div>

  <section id="racekbl-settings-view" class="racekbl-settings-view" aria-hidden="true">
    <div class="racekbl-settings-panel">
      <h2>Wind settings</h2>
      <div class="racekbl-settings-group">
        <div class="racekbl-control-head">
          <h3 id="racekbl-history-title">History window</h3>
          <div id="racekbl-history-value" class="racekbl-window-value">1 h</div>
        </div>
        <input
          id="racekbl-history"
          class="racekbl-window-slider"
          type="range"
          min="20"
          max="1440"
          step="10"
          value="60"
          list="racekbl-history-ticks"
          aria-labelledby="racekbl-history-title racekbl-history-value"
        />
        <datalist id="racekbl-history-ticks">
          <option value="20" label="20m"></option>
          <option value="30" label="30m"></option>
          <option value="60" label="1h"></option>
          <option value="120" label="2h"></option>
          <option value="240" label="4h"></option>
          <option value="480" label="8h"></option>
          <option value="720" label="12h"></option>
          <option value="1440" label="24h"></option>
        </datalist>
        <div class="racekbl-history-scale" aria-hidden="true">
          <span>20m</span>
          <span>1h</span>
          <span>2h</span>
          <span>4h</span>
          <span>8h</span>
          <span>12h</span>
          <span>24h</span>
        </div>
      </div>
      <div class="racekbl-settings-group">
        <div class="racekbl-control-head">
          <h3 id="racekbl-autocorr-title">Autocorr window</h3>
          <div id="racekbl-autocorr-value" class="racekbl-window-value">1 h</div>
        </div>
        <input
          id="racekbl-autocorr"
          class="racekbl-window-slider"
          type="range"
          min="20"
          max="120"
          step="10"
          value="60"
          list="racekbl-autocorr-ticks"
          aria-labelledby="racekbl-autocorr-title racekbl-autocorr-value"
        />
        <datalist id="racekbl-autocorr-ticks">
          <option value="20" label="20m"></option>
          <option value="30" label="30m"></option>
          <option value="60" label="1h"></option>
          <option value="120" label="2h"></option>
        </datalist>
        <div class="racekbl-history-scale" aria-hidden="true">
          <span>20m</span>
          <span>1h</span>
          <span>2h</span>
        </div>
      </div>
      <div class="row stack">
        <button id="close-racekbl-settings" class="ghost">Done</button>
      </div>
    </div>
  </section>
</section>
`;
