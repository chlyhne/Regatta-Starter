export const planView = `
<main id="plan-view" class="mode-shell" aria-hidden="true">
  <header class="page-head">
    <div class="head-title">
      <h1 class="brand-mark brand-light">
        <span class="brand-label">Plan</span><span class="brand-accent">Venue</span>
      </h1>
    </div>
    <div class="head-bar">
      <div class="head-left">
        <button id="close-plan" class="nav-btn brand-btn brand-mark brand-light" type="button">
          <span class="brand-label">Race</span><span class="brand-accent">Plan</span>
        </button>
      </div>
    </div>
  </header>

  <section class="panel">
    <h2>Venue</h2>
    <div class="hint">Selected venue</div>
    <div id="plan-venue-name" class="value">--</div>
    <div class="hint">Default venue</div>
    <div id="plan-default-venue" class="value">--</div>
    <div class="row stack">
      <button id="plan-select-venue" class="ghost">Change venue</button>
      <button id="plan-set-default" class="ghost">Set as default venue</button>
    </div>
    <div class="row stack">
      <button id="plan-edit-marks" class="ghost">Edit venue</button>
    </div>
  </section>
</main>
`;
