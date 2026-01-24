export const infoView = `
<section id="info-view" class="info-view" aria-hidden="true">
  <div class="coords-panel">
    <h2>About</h2>
    <div class="info-meta">
      <span>Version: 0.1</span>
      <span>Date: 12-1-2026</span>
      <span>Author: Casper Hillerup Lyhne</span>
    </div>
    <p class="info-text">
      RaceTools is a small, offline-friendly set of race-day tools for sailors who want clear
      numbers and fast decisions at the line.
    </p>
    <p class="info-text">
      This is a tool, not a gadget. The design is stark and high-contrast on purpose so it
      stays readable when it matters.
    </p>
    <ul class="info-list">
      <li>GPS and IMU are contextualized by a boat movement model for superior heading and position accuracy, so you can nail the start line.</li>
      <li>Bow offset: set where the device sits so the line is judged at the bow, not your pocket.</li>
      <li>Two answers, one decision: towards the line at current speed, or at current heading. Pick the one that matches your plan.</li>
      <li>False start check: the warning is unmistakable if you are on the wrong side at the gun.</li>
    </ul>
    <p class="info-text">
      The app tries to keep the screen awake in race mode, but iOS may still dim or lock it.
      For the best experience, disable screen auto-lock while racing.
    </p>
    <div class="row stack">
      <button id="close-info">Done</button>
    </div>
  </div>
</section>
`;
