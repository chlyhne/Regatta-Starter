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
    version: 19,
    activeVenueId: "venue-1",
    activeRaceId: "race-1",
    ...overrides,
  };
}

test("map route editing adds and clears marks", async ({ page }) => {
  const settings = buildBaseSettings();
  const venues = [
    {
      id: "venue-1",
      name: "Harbor",
      marks: [
        { id: "mark-a", name: "A", description: "Alpha", lat: 55.01, lon: 12.01 },
        { id: "mark-b", name: "B", description: "Bravo", lat: 55.02, lon: 12.02 },
      ],
      startLines: [
        { id: "start-1", name: "", starboardMarkId: "mark-b", portMarkId: "mark-a" },
      ],
      finishLines: [
        { id: "finish-1", name: "", starboardMarkId: "mark-b", portMarkId: "mark-a" },
      ],
      defaultStartLineId: "start-1",
      defaultFinishLineId: "finish-1",
      defaultRoute: [],
      updatedAt: Date.now(),
    },
  ];
  const races = [
    {
      id: "race-1",
      name: "Morning",
      venueId: "venue-1",
      startLineId: "start-1",
      finishLineId: "finish-1",
      routeEnabled: true,
      route: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    },
  ];

  await seedStorage(page, { settings, venues, races });
  await page.goto("/map.html?mode=race-route");

  await page.click("#open-mark-list");
  await page.click('.map-mark-item:has-text("A")');
  await expect(page.locator("#mark-edit-modal")).toHaveAttribute("aria-hidden", "false");
  await expect(page.locator("#mark-add-route")).toBeEnabled();
  await page.click("#mark-add-route");

  const routeLength = await page.evaluate(() => {
    const racesRaw = localStorage.getItem("racetimer-races");
    const parsed = racesRaw ? JSON.parse(racesRaw) : [];
    return parsed[0]?.route?.length || 0;
  });
  expect(routeLength).toBe(1);

  await page.click("#close-mark-edit");
  await expect(page.locator("#undo-route-mark")).toBeEnabled();
  await page.click("#undo-route-mark");

  const clearedLength = await page.evaluate(() => {
    const racesRaw = localStorage.getItem("racetimer-races");
    const parsed = racesRaw ? JSON.parse(racesRaw) : [];
    return parsed[0]?.route?.length || 0;
  });
  expect(clearedLength).toBe(0);

  await page.click("#open-mark-list");
  await page.click('.map-mark-item:has-text("A")');
  await page.click("#mark-add-route");
  await page.click("#close-mark-edit");

  page.once("dialog", (dialog) => dialog.accept());
  await page.click("#clear-route");

  const clearedAgain = await page.evaluate(() => {
    const racesRaw = localStorage.getItem("racetimer-races");
    const parsed = racesRaw ? JSON.parse(racesRaw) : [];
    return parsed[0]?.route?.length || 0;
  });
  expect(clearedAgain).toBe(0);
});
