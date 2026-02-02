export const raceWindView = `
<section id="racewind-view" class="racewind-view" aria-hidden="true">
  <div class="mode-shell">
    <header class="page-head">
      <div class="head-title">
        <h1 class="brand-mark brand-light">
          <span class="brand-label">Race</span><span class="brand-accent">Wind</span>
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
            id="open-racewind-settings"
            class="icon-btn"
            type="button"
            aria-label="Wind settings"
          >
            <img src="settings-cog.svg" class="icon-gear" alt="" aria-hidden="true" />
          </button>
          <div id="racewind-status" class="hint" aria-live="polite">Waiting</div>
        </div>
      </div>
    </header>

    <section class="panel racewind-speed-panel">
      <h2 id="racewind-speed-title">Wind speed</h2>
      <div class="racewind-plot racewind-speed-plot" aria-label="Wind speed history plot">
        <canvas id="racewind-speed-canvas"></canvas>
      </div>
      <div id="racewind-speed-recon-note" class="racewind-plot-note">
        Significant periods: --:--, --:--, --:-- Trend: --
      </div>
      <div class="racewind-fit-control">
        <div class="racewind-control-head">
          <h3 id="racewind-speed-fit-title">Fit order</h3>
          <div id="racewind-speed-fit-value" class="racewind-window-value">3</div>
        </div>
        <input
          id="racewind-speed-fit-order"
          class="racewind-window-slider"
          type="range"
          min="1"
          max="5"
          step="1"
          value="3"
          aria-labelledby="racewind-speed-fit-title racewind-speed-fit-value"
        />
      </div>
    </section>

    <section class="panel racewind-dir-panel">
      <h2 id="racewind-dir-title">Wind direction</h2>
      <div class="racewind-plot racewind-dir-plot" aria-label="Wind direction history plot">
        <canvas id="racewind-dir-canvas"></canvas>
      </div>
      <div id="racewind-dir-recon-note" class="racewind-plot-note">
        Significant periods: --:--, --:--, --:-- Trend: --
      </div>
      <div class="racewind-fit-control">
        <div class="racewind-control-head">
          <h3 id="racewind-dir-fit-title">Fit order</h3>
          <div id="racewind-dir-fit-value" class="racewind-window-value">3</div>
        </div>
        <input
          id="racewind-dir-fit-order"
          class="racewind-window-slider"
          type="range"
          min="1"
          max="5"
          step="1"
          value="3"
          aria-labelledby="racewind-dir-fit-title racewind-dir-fit-value"
        />
      </div>
    </section>

    <section class="panel racewind-speed-periodogram-panel">
      <h2>Wind speed periodogram</h2>
      <div class="racewind-plot racewind-speed-periodogram-plot" aria-label="Wind speed periodogram plot">
        <canvas id="racewind-speed-periodogram-canvas"></canvas>
      </div>
    </section>

  </div>

  <section id="racewind-settings-view" class="racewind-settings-view" aria-hidden="true">
    <div class="racewind-settings-panel">
      <h2>Wind settings</h2>
      <div class="racewind-settings-group">
        <div class="racewind-control-head">
          <h3 id="racewind-periodogram-title">Periodogram max period</h3>
          <div id="racewind-periodogram-value" class="racewind-window-value">1 h</div>
        </div>
        <input
          id="racewind-periodogram"
          class="racewind-window-slider"
          type="range"
          min="0"
          max="120"
          step="10"
          value="60"
          list="racewind-periodogram-ticks"
          aria-labelledby="racewind-periodogram-title racewind-periodogram-value"
        />
        <datalist id="racewind-periodogram-ticks">
          <option value="0" label="0m"></option>
          <option value="30" label="30m"></option>
          <option value="60" label="1h"></option>
          <option value="120" label="2h"></option>
        </datalist>
        <div class="racewind-history-scale" aria-hidden="true">
          <span>0m</span>
          <span>30m</span>
          <span>1h</span>
          <span>2h</span>
        </div>
      </div>
      <div class="row stack">
        <button id="close-racewind-settings" class="ghost">Done</button>
      </div>
    </div>
  </section>
</section>
`;
