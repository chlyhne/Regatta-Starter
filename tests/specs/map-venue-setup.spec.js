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

test("venue setup tabs switch modes and next button advances", async ({ page }) => {
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

  const next = page.locator("#map-next-step");
  await expect(next).toBeVisible();
  await expect(next).toHaveText("Next: Lines");
  await expect(next).toBeEnabled();
  await next.click();

  await expect(page.locator("#tab-lines")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#open-line-list")).toBeVisible();
  await expect(page.locator("#add-mark")).toBeHidden();
  await expect(next).toHaveText("Next: Course");

  await next.click();
  await expect(page.locator("#tab-route")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#open-mark-list")).toBeVisible();
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
