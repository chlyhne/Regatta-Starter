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
        defaultVenueId: "venue-1",
      })
    );
    localStorage.setItem(
      "racetimer-venues",
      JSON.stringify([
        {
          id: "venue-1",
          name: "Harbor",
          marks: [
            { id: "mark-1", name: "Reference", lat: 55.0, lon: 12.01 },
          ],
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

test("line-only flow saves a line to the nearby venue", async ({ page }) => {
  await seedStorage(page);
  await page.goto("/#quick");
  await expect(page.locator("#quick-view")).toBeVisible();

  await page.click("#go-race");
  await expect(page.locator("#line-view")).toBeVisible();

  await page.click("#open-coords");
  await expect(page.locator("#coords-view")).toBeVisible();

  await page.fill("#lat-a", "55.0");
  await page.fill("#lon-a", "12.0");
  await page.fill("#lat-b", "55.0");
  await page.fill("#lon-b", "12.02");
  await page.dispatchEvent("#lat-a", "change");
  await page.dispatchEvent("#lon-a", "change");
  await page.dispatchEvent("#lat-b", "change");
  await page.dispatchEvent("#lon-b", "change");

  await page.click("#close-coords");
  await expect(page.locator("#line-view")).toBeVisible();

  page.once("dialog", (dialog) => dialog.accept());
  await page.click("#line-go-race");
  await expect(page.locator("#race-view")).toBeVisible();

  const venueState = await page.evaluate(() => {
    const raw = localStorage.getItem("racetimer-venues");
    const venues = raw ? JSON.parse(raw) : [];
    const venue = venues.find((entry) => entry.id === "venue-1");
    return {
      marks: venue?.marks?.length || 0,
      lines: venue?.lines?.length || 0,
    };
  });

  expect(venueState.marks).toBe(3);
  expect(venueState.lines).toBe(1);
});
