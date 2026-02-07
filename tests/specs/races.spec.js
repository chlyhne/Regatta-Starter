const { test, expect } = require("@playwright/test");

async function seedStorage(page, { settings, venues, races }) {
  await page.addInitScript((payload) => {
    localStorage.clear();
    if (payload.settings) {
      localStorage.setItem("racetimer-settings", JSON.stringify(payload.settings));
    }
    if (payload.venues) {
      localStorage.setItem("racetimer-venues", JSON.stringify(payload.venues));
    }
    if (payload.races) {
      localStorage.setItem("racetimer-races", JSON.stringify(payload.races));
    }
  }, { settings, venues, races });
}

function buildBaseSettings(overrides = {}) {
  return {
    version: 20,
    activeVenueId: "venue-1",
    activeRaceId: "race-1",
    ...overrides,
  };
}

test("races list is scrollable", async ({ page }) => {
  const settings = buildBaseSettings();
  const venues = [
    {
      id: "venue-1",
      name: "Harbor",
      marks: [],
      lines: [],
      defaultStartLineId: null,
      defaultFinishLineId: null,
      defaultRouteStartLineId: null,
      defaultRouteFinishLineId: null,
      defaultRoute: [],
      updatedAt: Date.now(),
    },
  ];
  const races = Array.from({ length: 30 }, (_, index) => ({
    id: `race-${index + 1}`,
    name: `Race ${index + 1}`,
    venueId: "venue-1",
    isPlan: true,
    startLineId: null,
    finishLineId: null,
    routeEnabled: false,
    route: [],
    createdAt: Date.now(),
    updatedAt: Date.now() + index,
  }));

  await seedStorage(page, { settings, venues, races });
  await page.goto("/#quick");
  await expect(page.locator("#quick-view")).toBeVisible();

  await page.click("#quick-mode-plan");
  await page.click("#quick-select-plan");
  await expect(page.locator("#race-modal")).toBeVisible();

  const scrollable = await page.evaluate(() => {
    const list = document.getElementById("race-list");
    if (!list) return false;
    return list.scrollHeight > list.clientHeight;
  });
  expect(scrollable).toBe(true);
});
