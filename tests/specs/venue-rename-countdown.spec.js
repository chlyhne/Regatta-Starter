const { test, expect } = require("@playwright/test");

async function resetStorage(page) {
  await page.addInitScript(() => {
    if (sessionStorage.getItem("seeded") === "true") return;
    localStorage.clear();
    localStorage.setItem(
      "racetimer-settings",
      JSON.stringify({ version: 20, activeVenueId: null, activeRaceId: null })
    );
    sessionStorage.setItem("seeded", "true");
  });
}

function getActiveRaceStart() {
  const settings = JSON.parse(localStorage.getItem("racetimer-settings") || "{}");
  const races = JSON.parse(localStorage.getItem("racetimer-races") || "[]");
  const race = races.find((entry) => entry && entry.id === settings.activeRaceId) || null;
  return {
    activeRaceId: settings.activeRaceId || null,
    startTs: race?.start?.startTs || null,
  };
}

test("renaming venue keeps active countdown", async ({ page }) => {
  await resetStorage(page);
  await page.goto("/#quick");
  await expect(page.locator("#quick-view")).toBeVisible();

  await page.selectOption("#countdown-minutes", "1");
  await page.selectOption("#countdown-seconds", "0");
  await page.click("#set-start");
  await expect(page.locator("#status-time")).not.toHaveText("NO TIME");

  const before = await page.evaluate(getActiveRaceStart);
  expect(before.activeRaceId).toBeTruthy();
  expect(Number.isFinite(before.startTs)).toBe(true);

  await page.click("#close-quick");
  await expect(page.locator("#setup-view")).toBeVisible();
  await page.click("#open-plan-venue");
  await expect(page.locator("#plan-view")).toBeVisible();
  await page.click("#plan-select-venue");
  await expect(page.locator("#venue-modal")).toHaveAttribute("aria-hidden", "false");
  page.once("dialog", (dialog) => dialog.accept("Renamed Venue"));
  await page.locator("#rename-venue").evaluate((button) => button.click());
  await page.click("#close-venue-modal");
  await expect(page.locator("#venue-modal")).toHaveAttribute("aria-hidden", "true");

  const after = await page.evaluate(getActiveRaceStart);
  expect(after.activeRaceId).toBe(before.activeRaceId);
  expect(after.startTs).toBe(before.startTs);
});
