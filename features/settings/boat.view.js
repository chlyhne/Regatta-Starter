export const boatView = `
<section id="boat-view" class="boat-view" aria-hidden="true">
  <div class="coords-panel">
    <h2>Boat</h2>
    <div class="row setting-row">
      <label for="boat-model" class="setting-label">Boat make/model</label>
      <input
        id="boat-model"
        type="text"
        autocapitalize="none"
        autocomplete="off"
        spellcheck="false"
        placeholder="J/70"
      />
    </div>
    <div class="row setting-row">
      <label for="boat-shape" class="setting-label">Hull shape</label>
      <select id="boat-shape">
        <option value="">Not set</option>
        <option value="dinghy">Dinghy</option>
        <option value="multihull">Multihull</option>
        <option value="planing-monohull">Planing monohull</option>
        <option value="non-planing-monohull">Non-planing monohull</option>
        <option value="long-slender">Long and slender</option>
      </select>
    </div>
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
      <label for="boat-weight" class="setting-label">Boat weight</label>
      <div class="input-with-unit">
        <input
          id="boat-weight"
          type="number"
          inputmode="numeric"
          step="1"
          min="0"
          max="99999"
          placeholder="0"
        />
        <span class="input-unit">[kg]</span>
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
