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
          <div id="racekbl-status" class="hint" aria-live="polite">Waiting</div>
        </div>
      </div>
    </header>

    <section class="panel racekbl-now">
      <h2>Wind now</h2>
      <div class="racekbl-now-grid">
        <div class="racekbl-metric">
          <div class="racekbl-label">Speed</div>
          <div class="racekbl-value">
            <span id="racekbl-speed">--</span>
            <span class="racekbl-unit">kn</span>
          </div>
        </div>
        <div class="racekbl-metric">
          <div class="racekbl-label">Gust</div>
          <div class="racekbl-value">
            <span id="racekbl-gust">--</span>
            <span class="racekbl-unit">kn</span>
          </div>
        </div>
        <div class="racekbl-metric racekbl-direction">
          <div class="racekbl-label">Dir</div>
          <div id="racekbl-dir" class="racekbl-value">--</div>
          <div class="racekbl-compass" aria-hidden="true">
            <svg id="racekbl-arrow" class="racekbl-arrow" viewBox="0 0 24 24">
              <path d="M12 2l4 8h-8l4-8z" fill="currentColor" />
              <path d="M12 10v10" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
            </svg>
          </div>
        </div>
      </div>
      <div id="racekbl-updated" class="hint" aria-live="polite">Waiting for wind</div>
    </section>

    <section class="panel racekbl-plot-panel">
      <h2>Wind history</h2>
      <div class="racekbl-plot" aria-label="Wind history plot">
        <canvas id="racekbl-canvas"></canvas>
      </div>
    </section>

    <section class="panel racekbl-source">
      <h2>Source</h2>
      <label class="setting-label" for="racekbl-endpoint">Endpoint</label>
      <input
        id="racekbl-endpoint"
        type="text"
        inputmode="url"
        placeholder="/wind"
        autocomplete="off"
      />
      <div class="row">
        <button id="racekbl-save-endpoint" class="ghost" type="button">Save</button>
      </div>
    </section>
  </div>
</section>
`;
