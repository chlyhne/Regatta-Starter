export const setupView = `
<main id="setup-view" class="mode-shell" aria-hidden="true">
  <header class="page-head">
    <div class="head-title">
      <h1 class="brand-mark brand-light">
        <span class="brand-label">Race</span><span class="brand-accent">Starter</span>
      </h1>
    </div>
    <div class="head-bar">
      <div class="head-left">
        <button class="nav-btn brand-btn brand-mark brand-light open-home" type="button">
          <span class="brand-label">Race</span><span class="brand-accent">Tools</span>
        </button>
      </div>
    </div>
  </header>

  <section class="panel">
    <h2 class="panel-title">Start Setup</h2>
    <p class="hint">Set line and start time.</p>
    <div class="row stack">
      <button id="open-start-line-only" class="race-enter">Open starter</button>
    </div>
  </section>

</main>
`;
