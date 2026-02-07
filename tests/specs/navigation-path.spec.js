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
            { id: "mark-1", name: "Start SB", lat: 55.0, lon: 12.0 },
            { id: "mark-2", name: "Start P", lat: 55.0, lon: 12.01 },
          ],
          lines: [
            {
              id: "line-start",
              name: "Start line",
              starboardMarkId: "mark-1",
              portMarkId: "mark-2",
            },
          ],
          defaultStartLineId: "line-start",
          defaultFinishLineId: "line-start",
          defaultRouteStartLineId: "line-start",
          defaultRouteFinishLineId: "line-start",
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
          isPlan: true,
          startLineId: "line-start",
          finishLineId: "line-start",
          routeEnabled: false,
          route: [],
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      ])
    );
  });
}

test("course modal returns to race modal when opened from race", async ({ page }) => {
  await seedStorage(page);
  await page.goto("/#plan");
  await expect(page.locator("#plan-view")).toBeVisible();

  await page.click("#plan-open-plans");
  await expect(page.locator("#race-modal")).toHaveAttribute("aria-hidden", "false");

  await page.getByRole("button", { name: /Race 1/ }).click();
  await expect(page.locator("#edit-race-course")).toBeEnabled();

  await page.click("#edit-race-course");
  await expect(page.locator("#course-modal")).toHaveAttribute("aria-hidden", "false");

  await page.click("#close-course-modal");
  await expect(page.locator("#race-modal")).toHaveAttribute("aria-hidden", "false");
});
