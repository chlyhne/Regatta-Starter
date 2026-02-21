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
  await expect(page.locator("#quick-venue-actions")).toBeHidden();
  await expect(page.locator("#quick-line-actions")).toBeVisible();

  await page.click("#quick-advanced-toggle");
  await expect(page.locator("#quick-mode-panel")).toBeVisible();
  await expect(page.locator("#quick-course-panel")).toBeVisible();
  await expect(page.locator("#quick-venue-actions")).toBeVisible();
  await expect(page.locator("#quick-line-actions")).toBeHidden();
});

test("simple start line can be chosen from any venue line", async ({ page }) => {
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
            { id: "home-p", name: "Home P", lat: 55.0, lon: 12.0 },
            { id: "home-s", name: "Home SB", lat: 55.0, lon: 12.01 },
          ],
          lines: [
            {
              id: "line-home",
              name: "Home line",
              starboardMarkId: "home-s",
              portMarkId: "home-p",
              roles: { start: true, finish: false },
            },
          ],
          defaultStartLineId: "line-home",
          defaultFinishLineId: null,
          defaultRouteStartLineId: null,
          defaultRouteFinishLineId: null,
          defaultRoute: [],
          updatedAt: Date.now(),
        },
        {
          id: "venue-2",
          name: "Away Harbor",
          marks: [
            { id: "away-p", name: "Away P", lat: 56.0, lon: 13.0 },
            { id: "away-s", name: "Away SB", lat: 56.0, lon: 13.01 },
          ],
          lines: [
            {
              id: "line-away",
              name: "Away line",
              starboardMarkId: "away-s",
              portMarkId: "away-p",
              roles: { start: true, finish: false },
            },
          ],
          defaultStartLineId: "line-away",
          defaultFinishLineId: null,
          defaultRouteStartLineId: null,
          defaultRouteFinishLineId: null,
          defaultRoute: [],
          updatedAt: Date.now() + 1,
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
          startLineId: "line-home",
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
  await expect(page.locator("#quick-line-actions")).toBeVisible();

  await page.click("#quick-change-lines");
  await expect(page.locator("#line-view")).toBeVisible();
  await page.click("#load-line");
  await expect(page.locator("#load-line-modal")).toHaveAttribute("aria-hidden", "false");
  await page.getByRole("button", { name: "Away Harbor - Away line" }).click();
  await page.click("#confirm-load");
  await expect(page.locator("#line-only-status")).toHaveText("Away Harbor - Away line");
  await page.click("#close-line");
  await expect(page.locator("#quick-view")).toBeVisible();

  await expect(page.locator("#quick-start-line-name")).toHaveText("Away Harbor - Away line");
  await expect(page.locator("#quick-venue-name")).toHaveText("Home Harbor");
  await expect(page.locator("#venue-name")).toHaveText("Home Harbor");
});

test("deleting a simple line does not delete the venue line", async ({ page }) => {
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
            { id: "mark-p", name: "Start P", lat: 55.0, lon: 12.0 },
            { id: "mark-s", name: "Start SB", lat: 55.0, lon: 12.02 },
          ],
          lines: [
            {
              id: "line-1",
              name: "Start line",
              starboardMarkId: "mark-s",
              portMarkId: "mark-p",
              roles: { start: true, finish: false },
            },
          ],
          defaultStartLineId: "line-1",
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
    localStorage.setItem(
      "racetimer-lines",
      JSON.stringify([
        {
          id: "simple-1",
          name: "Harbor - Start line",
          a: { lat: 55.0, lon: 12.0 },
          b: { lat: 55.0, lon: 12.02 },
          source: { kind: "venue-line", venueId: "venue-1", lineId: "line-1" },
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      ])
    );
  });

  await page.goto("/#quick");
  await page.click("#quick-change-lines");
  await expect(page.locator("#line-view")).toBeVisible();
  await page.click("#load-line");
  await expect(page.locator("#load-line-modal")).toHaveAttribute("aria-hidden", "false");
  await page.getByRole("button", { name: "Harbor - Start line" }).click();
  page.once("dialog", (dialog) => dialog.accept());
  await page.click("#confirm-delete");

  const storage = await page.evaluate(() => {
    const venues = JSON.parse(localStorage.getItem("racetimer-venues") || "[]");
    const simpleLines = JSON.parse(localStorage.getItem("racetimer-lines") || "[]");
    return {
      venueLines: venues[0]?.lines?.length || 0,
      simpleLines: simpleLines.length,
    };
  });
  expect(storage.venueLines).toBe(1);
  expect(storage.simpleLines).toBe(0);
});

test("deleting a venue line does not delete the simple line copy", async ({ page }) => {
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
            { id: "mark-p", name: "Start P", lat: 55.0, lon: 12.0 },
            { id: "mark-s", name: "Start SB", lat: 55.0, lon: 12.02 },
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
    localStorage.setItem(
      "racetimer-lines",
      JSON.stringify([
        {
          id: "simple-1",
          name: "Harbor - Start line",
          a: { lat: 55.0, lon: 12.0 },
          b: { lat: 55.0, lon: 12.02 },
          source: { kind: "venue-line", venueId: "venue-1", lineId: "line-1" },
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      ])
    );
  });

  await page.goto("/#quick");

  const storage = await page.evaluate(() => {
    const venues = JSON.parse(localStorage.getItem("racetimer-venues") || "[]");
    const simpleLines = JSON.parse(localStorage.getItem("racetimer-lines") || "[]");
    return {
      venueLines: venues[0]?.lines?.length || 0,
      simpleLines: simpleLines.length,
    };
  });
  expect(storage.venueLines).toBe(0);
  expect(storage.simpleLines).toBe(1);
  await page.click("#quick-change-lines");
  await expect(page.locator("#line-view")).toBeVisible();
  await page.click("#load-line");
  await expect(page.getByRole("button", { name: "Harbor - Start line" })).toBeVisible();
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
