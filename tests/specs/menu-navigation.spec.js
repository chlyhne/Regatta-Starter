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

async function seedQuickReady(page) {
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
            { id: "mark-1", name: "Start P", lat: 55.0, lon: 12.0 },
            { id: "mark-2", name: "Start SB", lat: 55.0, lon: 12.02 },
          ],
          lines: [
            {
              id: "line-1",
              name: "Start line",
              starboardMarkId: "mark-2",
              portMarkId: "mark-1",
            },
          ],
          defaultStartLineId: "line-1",
          defaultFinishLineId: "line-1",
          defaultRouteStartLineId: "line-1",
          defaultRouteFinishLineId: "line-1",
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
          startLineId: "line-1",
          finishLineId: "line-1",
          routeStartLineId: "line-1",
          routeFinishLineId: "line-1",
          routeEnabled: false,
          route: [],
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      ])
    );
  });
}

test("venue marks modal returns to venue modal", async ({ page }) => {
  await resetStorage(page);
  await page.goto("/#plan");
  await expect(page.locator("#plan-view")).toBeVisible();

  await page.click("#plan-select-venue");
  await expect(page.locator("#venue-modal")).toHaveAttribute("aria-hidden", "false");

  await page.click("#open-venue-marks");
  await expect(page.locator("#marks-modal")).toHaveAttribute("aria-hidden", "false");

  await page.click("#close-marks-modal");
  await expect(page.locator("#venue-modal")).toHaveAttribute("aria-hidden", "false");

  await page.click("#close-venue-modal");
  await expect(page.locator("#plan-view")).toBeVisible();
});

test("menu navigation returns to origin views", async ({ page }) => {
  await seedQuickReady(page);
  await page.goto("/#setup");
  await expect(page.locator("#setup-view")).toBeVisible();

  await page.click("#open-quick-race");
  await expect(page.locator("#quick-view")).toBeVisible();

  await page.click("#quick-advanced-toggle");
  await page.click("#quick-edit-course");
  await expect(page.locator("#course-modal")).toHaveAttribute("aria-hidden", "false");

  await page.click("#course-toggle");
  const openRoute = page.locator("#open-route");
  await openRoute.scrollIntoViewIfNeeded();
  await openRoute.click();
  await expect(page.locator("#course-keyboard-modal")).toHaveAttribute(
    "aria-hidden",
    "false"
  );

  await page.click("#course-keyboard-close");
  await expect(page.locator("#course-modal")).toHaveAttribute("aria-hidden", "false");

  await page.click("#close-course-modal");
  await expect(page.locator("#quick-view")).toBeVisible();

  await page.click("#close-quick");
  await expect(page.locator("#setup-view")).toBeVisible();

  await page.click("#open-start-line-only");
  await expect(page.locator("#line-view")).toBeVisible();

  await page.click("#close-line");
  await expect(page.locator("#setup-view")).toBeVisible();
});
