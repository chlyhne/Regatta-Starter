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

test("quick race hides advanced controls until toggled", async ({ page }) => {
  await seedStorage(page);
  await page.goto("/#quick");
  await expect(page.locator("#quick-view")).toBeVisible();
  await expect(page.locator("#quick-mode-panel")).toBeHidden();
  await expect(page.locator("#quick-course-panel")).toBeHidden();

  await page.click("#quick-advanced-toggle");
  await expect(page.locator("#quick-mode-panel")).toBeVisible();
  await expect(page.locator("#quick-course-panel")).toBeVisible();
});

test("quick race uses the default venue start line", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem(
      "racetimer-settings",
      JSON.stringify({
        version: 20,
        activeVenueId: "venue-1",
        activeRaceId: "race-1",
        defaultVenueId: "venue-1",
      })
    );
    localStorage.setItem(
      "racetimer-venues",
      JSON.stringify([
        {
          id: "venue-1",
          name: "Home Harbor",
          marks: [
            { id: "mark-p", name: "Start P", lat: 55.0, lon: 12.0 },
            { id: "mark-s", name: "Start SB", lat: 55.0, lon: 12.02 },
          ],
          lines: [
            {
              id: "line-1",
              name: "Start line",
              starboardMarkId: "mark-s",
              portMarkId: "mark-p",
            },
          ],
          defaultStartLineId: "line-1",
          defaultFinishLineId: "line-1",
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
          startLineId: "line-old",
          finishLineId: null,
          routeEnabled: false,
          route: [],
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      ])
    );
  });

  await page.goto("/#quick");
  await expect(page.locator("#quick-view")).toBeVisible();
  await expect(page.locator("#quick-start-line-name")).toHaveText("Start line");

  const storedStartLineId = await page.evaluate(() => {
    const races = JSON.parse(localStorage.getItem("racetimer-races") || "[]");
    return races.find((race) => race.id === "race-1")?.startLineId || null;
  });
  expect(storedStartLineId).toBe("line-1");
});
