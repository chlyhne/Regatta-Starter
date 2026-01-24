export const locationView = `
<section id="location-view" class="location-view" aria-hidden="true">
  <div class="coords-panel">
    <h2>Use GPS</h2>
    <div class="row stack">
      <button id="use-a" class="ghost">Set port mark (GPS)</button>
      <button id="use-b" class="ghost">Set starboard mark (GPS)</button>
      <button id="swap-location" class="ghost" type="button">Swap marks</button>
    </div>
    <div class="hint">Best accuracy: hold still or move straight at steady speed when marking.</div>
    <div class="row stack">
      <button id="close-location">Done</button>
    </div>
  </div>
</section>
`;
