const { test, expect } = require("@playwright/test");

async function seedStorage(page) {
  await page.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem(
      "racetimer-settings",
      JSON.stringify({
        version: 20,
        activeVenueId: "venue-1",
        activeRaceId: "race-1",
        defaultVenueId: "venue-2",
      })
    );
    localStorage.setItem(
      "racetimer-venues",
      JSON.stringify([
        {
          id: "venue-1",
          name: "Home Harbor",
          marks: [],
          lines: [],
          defaultStartLineId: null,
          defaultFinishLineId: null,
          defaultRouteStartLineId: null,
          defaultRouteFinishLineId: null,
          defaultRoute: [],
          updatedAt: Date.now(),
        },
        {
          id: "venue-2",
          name: "Away Harbor",
          marks: [],
          lines: [],
          defaultStartLineId: null,
          defaultFinishLineId: null,
          defaultRouteStartLineId: null,
          defaultRouteFinishLineId: null,
          defaultRoute: [],
          updatedAt: Date.now(),
        },
      ])
    );
    localStorage.setItem(
      "racetimer-races",
      JSON.stringify([
        {
          id: "race-1",
          name: "Race 1",
          venueId: "venue-1",
          routeEnabled: false,
          route: [],
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      ])
    );
  });
}

test("quick race defaults to the default venue", async ({ page }) => {
  await seedStorage(page);
  await page.goto("/#quick");
  await expect(page.locator("#quick-view")).toBeVisible();
  await expect(page.locator("#quick-venue-name")).toHaveText("Away Harbor");
  await expect(page.locator("#venue-name")).toHaveText("Away Harbor");
});
