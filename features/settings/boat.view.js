export const boatView = `
<section id="boat-view" class="boat-view" aria-hidden="true">
  <div class="coords-panel">
    <h2>Boat</h2>
    <div class="row setting-row">
      <label for="boat-length" class="setting-label">Boat length</label>
      <div class="input-with-unit">
        <input
          id="boat-length"
          type="number"
          inputmode="decimal"
          step="0.1"
          min="0"
          placeholder="0"
        />
        <span id="boat-length-unit" class="input-unit">[m]</span>
      </div>
    </div>
    <div class="row setting-row">
      <label for="bow-offset" class="setting-label">Device to bow</label>
      <div class="input-with-unit">
        <input
          id="bow-offset"
          type="number"
          inputmode="decimal"
          step="0.1"
          min="0"
          placeholder="0"
        />
        <span id="bow-offset-unit" class="input-unit">[m]</span>
      </div>
    </div>
    <div class="row stack">
      <button id="close-boat">Done</button>
    </div>
  </div>
</section>
`;
