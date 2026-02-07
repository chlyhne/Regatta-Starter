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

test("rounding modal toggles rounding for the route", async ({ page }) => {
  const settings = buildBaseSettings();
  const venues = [
    {
      id: "venue-1",
      name: "Harbor",
      marks: [
        {
          id: "mark-a",
          name: "A",
          description: "Windward",
          lat: 55.01,
          lon: 12.01,
        },
        {
          id: "mark-b",
          name: "B",
          description: "",
          lat: 55.02,
          lon: 12.02,
        },
      ],
      lines: [
        {
          id: "line-1",
          name: "",
          starboardMarkId: "mark-b",
          portMarkId: "mark-a",
        },
      ],
      defaultStartLineId: "line-1",
      defaultFinishLineId: "line-1",
      defaultRouteStartLineId: "line-1",
      defaultRouteFinishLineId: "line-1",
      defaultRoute: [],
      updatedAt: Date.now(),
    },
  ];
  const races = [
    {
      id: "race-1",
      name: "Morning",
      venueId: "venue-1",
      startLineId: "line-1",
      finishLineId: "line-1",
      routeStartLineId: "line-1",
      routeFinishLineId: "line-1",
      routeEnabled: true,
      route: [
        { markId: "mark-a", rounding: "port", manual: true },
        { markId: "mark-b", rounding: "starboard", manual: true },
      ],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    },
  ];

  await seedStorage(page, { settings, venues, races });
  await page.goto("/#setup");
  await expect(page.locator("#setup-view")).toBeVisible();

  await page.click("#open-course");
  await expect(page.locator("#course-modal")).toBeVisible();
  const roundingButton = page.locator("#open-rounding");
  await roundingButton.scrollIntoViewIfNeeded();
  await roundingButton.click();
  const markButton = page.locator(
    '.course-mark-btn:has(.mark-name:has-text("A"))'
  );
  await expect(markButton).toHaveClass(/port/);
  await expect(page.locator(".mark-desc")).toContainText("Windward");

  await markButton.click();
  await expect(markButton).toHaveClass(/starboard/);
});

test("route keyboard builds sequence from single-letter marks", async ({ page }) => {
  const settings = buildBaseSettings();
  const venues = [
    {
      id: "venue-1",
      name: "Harbor",
      marks: [
        { id: "mark-a", name: "A", description: "Alpha", lat: 55.05, lon: 12.05 },
        { id: "mark-b", name: "B", description: "Bravo", lat: 55.06, lon: 12.06 },
        { id: "mark-gate", name: "Gate", description: "Gate mark", lat: 55.07, lon: 12.07 },
      ],
      lines: [
        {
          id: "line-1",
          name: "",
          starboardMarkId: "mark-b",
          portMarkId: "mark-a",
        },
      ],
      defaultStartLineId: "line-1",
      defaultFinishLineId: "line-1",
      defaultRouteStartLineId: "line-1",
      defaultRouteFinishLineId: "line-1",
      defaultRoute: [],
      updatedAt: Date.now(),
    },
  ];
  const races = [
    {
      id: "race-1",
      name: "Morning",
      venueId: "venue-1",
      startLineId: "line-1",
      finishLineId: "line-1",
      routeEnabled: false,
      route: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    },
  ];

  await seedStorage(page, { settings, venues, races });
  await page.goto("/#setup");
  await expect(page.locator("#setup-view")).toBeVisible();

  await page.click("#open-course");
  await expect(page.locator("#course-modal")).toBeVisible();
  await page.click("#open-route");
  await expect(page.getByRole("button", { name: "Add A (port)" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add B (starboard)" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add Gate (port)" })).toBeVisible();

  await page.getByRole("button", { name: "Add A (port)" }).click();
  await page.getByRole("button", { name: "Add B (starboard)" }).click();

  await expect(page.locator(".course-chip")).toHaveCount(2);
  await expect(page.locator(".course-chip", { hasText: "A" })).toBeVisible();
  await expect(page.locator(".course-chip", { hasText: "B" })).toBeVisible();
  const routeState = await page.evaluate(() => {
    const racesRaw = localStorage.getItem("racetimer-races");
    const parsed = racesRaw ? JSON.parse(racesRaw) : [];
    return parsed[0]?.route || [];
  });
  expect(routeState).toEqual([
    { markId: "mark-a", rounding: "port", manual: true },
    { markId: "mark-b", rounding: "starboard", manual: true },
  ]);

  await page.click("#course-keyboard-undo");
  await expect(page.locator(".course-chip")).toHaveCount(1);

  page.once("dialog", (dialog) => dialog.accept());
  await page.click("#course-keyboard-clear");
  await expect(page.locator(".course-chip")).toHaveCount(0);
  await expect(page.locator("#course-sequence .hint")).toHaveText("No route yet.");
});
