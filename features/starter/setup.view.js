export const setupView = `
<main id="setup-view" class="mode-shell" aria-hidden="true">
  <header class="page-head">
    <div class="head-title">
      <h1 class="brand-mark brand-light">
        <span class="brand-label">Race</span><span class="brand-accent">Plan</span>
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
    <h2 class="panel-title">Race Plan</h2>
    <div class="row stack">
      <button id="open-plan-venue" class="race-enter">Plan venue</button>
      <button id="open-quick-race" class="race-enter">Quick race</button>
      <button id="open-start-line-only" class="race-enter">Start line only</button>
    </div>
  </section>

</main>
`;
