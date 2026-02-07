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
    defaultVenueId: "venue-1",
    ...overrides,
  };
}

test("venue setup tabs switch modes", async ({ page }) => {
  const settings = buildBaseSettings();
  const venues = [
    {
      id: "venue-1",
      name: "Harbor",
      marks: [
        { id: "mark-port", name: "Port", description: "", lat: 55.0, lon: 12.0 },
        { id: "mark-star", name: "Starboard", description: "", lat: 55.0, lon: 12.02 },
      ],
      lines: [
        {
          id: "line-start",
          name: "Start",
          starboardMarkId: "mark-star",
          portMarkId: "mark-port",
          roles: { start: true, finish: false },
        },
      ],
      defaultStartLineId: "line-start",
      defaultFinishLineId: null,
      defaultRouteStartLineId: "line-start",
      defaultRouteFinishLineId: null,
      defaultRoute: [],
      updatedAt: Date.now(),
    },
  ];
  const races = [
    {
      id: "race-1",
      name: "Morning",
      venueId: "venue-1",
      routeEnabled: false,
      route: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    },
  ];

  await seedStorage(page, { settings, venues, races });
  await page.goto("/map.html?mode=venue-setup&step=marks");

  await expect(page.locator("#map-tabs")).toBeVisible();
  await expect(page.locator("#tab-marks")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#add-mark")).toBeVisible();
  await expect(page.locator("#open-line-list")).toBeHidden();

  await page.click("#tab-lines");
  await expect(page.locator("#tab-lines")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#open-line-list")).toBeVisible();
  await expect(page.locator("#add-mark")).toBeHidden();

  await page.click("#tab-route");
  await expect(page.locator("#tab-route")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#open-mark-list")).toBeHidden();
  await expect(page.locator("#open-line-list")).toBeHidden();
  await expect(page.locator("#undo-route-mark")).toBeVisible();
});

test("venue setup enables lines tab after adding a mark", async ({ page }) => {
  const settings = buildBaseSettings({ activeVenueId: "venue-1" });
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
  const races = [
    {
      id: "race-1",
      name: "Morning",
      venueId: "venue-1",
      routeEnabled: false,
      route: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    },
  ];

  await seedStorage(page, { settings, venues, races });
  await page.goto("/map.html?mode=venue-setup&step=marks");

  await expect(page.locator("#tab-lines")).toBeDisabled();
  await page.click("#add-mark");
  await expect(page.locator("#tab-lines")).toBeEnabled();
});

test("venue setup course updates race route", async ({ page }) => {
  const settings = buildBaseSettings();
  const venues = [
    {
      id: "venue-1",
      name: "Harbor",
      marks: [
        { id: "mark-a", name: "A", description: "", lat: 55.0, lon: 12.0 },
        { id: "mark-b", name: "B", description: "", lat: 55.0, lon: 12.02 },
      ],
      lines: [
        {
          id: "line-start",
          name: "Start",
          starboardMarkId: "mark-b",
          portMarkId: "mark-a",
        },
      ],
      defaultStartLineId: "line-start",
      defaultFinishLineId: "line-start",
      defaultRouteStartLineId: "line-start",
      defaultRouteFinishLineId: "line-start",
      defaultRoute: [],
      updatedAt: Date.now(),
    },
  ];
  const races = [
    {
      id: "race-1",
      name: "Morning",
      venueId: "venue-1",
      routeEnabled: false,
      route: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    },
  ];

  await seedStorage(page, { settings, venues, races });
  await page.goto("/map.html?mode=venue-setup&step=route");

  await expect(page.locator(".map-mark-mark-a")).toBeVisible();
  await page.click(".map-mark-mark-a");

  const routeCounts = await page.evaluate(() => {
    const venuesRaw = localStorage.getItem("racetimer-venues");
    const racesRaw = localStorage.getItem("racetimer-races");
    const venuesState = venuesRaw ? JSON.parse(venuesRaw) : [];
    const racesState = racesRaw ? JSON.parse(racesRaw) : [];
    return {
      venueRoute: venuesState[0]?.defaultRoute?.length || 0,
      raceRoute: racesState[0]?.route?.length || 0,
    };
  });

  expect(routeCounts.venueRoute).toBe(1);
  expect(routeCounts.raceRoute).toBe(1);
});
