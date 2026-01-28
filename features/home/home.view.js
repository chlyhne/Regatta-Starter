export const homeView = `
<section id="home-view" class="shell" aria-hidden="false">
  <header class="hero page-head">
    <div class="head-title">
      <h1 class="brand-mark brand-light">
        <span class="brand-label">Race</span><span class="brand-accent">Tools</span>
      </h1>
    </div>
    <div class="head-bar">
      <div class="head-left">
        <button id="open-info" class="icon-btn" type="button" aria-label="About">
          <svg class="icon-info" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2" />
            <line x1="12" y1="10" x2="12" y2="16" stroke="currentColor" stroke-width="2" />
            <circle cx="12" cy="7" r="1.5" fill="currentColor" />
          </svg>
        </button>
        <button id="open-boat" class="icon-btn" type="button" aria-label="Boat">
          <svg class="icon-boat" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path
              d="M12 3v11M12 3l6 7h-6"
              fill="none"
              stroke="currentColor"
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
            />
            <path
              d="M3 17h18l-3 4H6l-3-4z"
              fill="none"
              stroke="currentColor"
              stroke-linejoin="round"
              stroke-width="2"
            />
          </svg>
        </button>
        <button id="open-settings" class="icon-btn" type="button" aria-label="Settings">
          <svg class="icon-gear" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" stroke-width="2" />
            <path
              d="M12 2v4M12 18v4M2 12h4M18 12h4M4.9 4.9l2.8 2.8M16.3 16.3l2.8 2.8M19.1 4.9l-2.8 2.8M7.7 16.3l-2.8 2.8"
              fill="none"
              stroke="currentColor"
              stroke-linecap="round"
              stroke-width="2"
            />
          </svg>
        </button>
        <button id="home-refresh" class="ghost home-reload" type="button">Reload</button>
      </div>
      <div class="head-right"></div>
    </div>
  </header>

  <section class="panel">
    <h2>Modes</h2>
    <div class="row stack">
      <button id="open-setup" class="home-entry brand-btn brand-mark brand-light" type="button">
        <span class="brand-label">Race</span><span class="brand-accent">Starter</span>
      </button>
      <button id="open-vmg" class="home-entry brand-btn brand-mark brand-light" type="button">
        <span class="brand-label">Race</span><span class="brand-accent">Performance</span>
      </button>
      <button id="open-lifter" class="home-entry brand-btn brand-mark brand-light" type="button">
        <span class="brand-label">Race</span><span class="brand-accent">Lifter</span>
      </button>
    </div>
  </section>

  <section class="panel">
    <h2>Replay</h2>
    <div class="row stack">
      <button id="replay-open" type="button">Replay data</button>
      <button id="replay-stop" class="ghost" type="button">Stop replay</button>
      <div id="replay-status" class="hint">Replay off</div>
    </div>
    <div class="lifter-controls">
      <div class="lifter-control-head">
        <h2 id="replay-speed-title">Replay speed</h2>
        <div id="replay-speed-value" class="lifter-window-value">1x</div>
      </div>
      <input
        id="replay-speed"
        class="lifter-window-slider"
        type="range"
        min="0.5"
        max="4"
        step="0.5"
        value="1"
        aria-labelledby="replay-speed-title replay-speed-value"
      />
    </div>
    <button id="replay-loop" class="check-toggle" type="button" aria-pressed="false">
      <span class="check-label">Loop replay</span>
      <span class="check-box" aria-hidden="true"></span>
    </button>
  </section>

  <section id="home-qr-panel" class="panel home-qr" aria-hidden="true">
    <h2>QR code</h2>
    <div class="home-qr-wrap">
      <img id="home-qr" class="home-qr-img" alt="QR code for app URL" />
    </div>
  </section>
</section>
`;
