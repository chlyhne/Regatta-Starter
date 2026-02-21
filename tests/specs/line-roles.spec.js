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

test("start and finish line lists respect line roles", async ({ page }) => {
  const settings = buildBaseSettings();
  const venues = [
    {
      id: "venue-1",
      name: "Harbor",
      marks: [
        { id: "mark-1", name: "A", lat: 55.01, lon: 12.01 },
        { id: "mark-2", name: "B", lat: 55.02, lon: 12.02 },
        { id: "mark-3", name: "C", lat: 55.03, lon: 12.03 },
      ],
      lines: [
        {
          id: "line-start",
          name: "Start Line",
          starboardMarkId: "mark-2",
          portMarkId: "mark-1",
          roles: { start: true, finish: false },
        },
        {
          id: "line-finish",
          name: "Finish Line",
          starboardMarkId: "mark-3",
          portMarkId: "mark-2",
          roles: { start: false, finish: true },
        },
        {
          id: "line-both",
          name: "Shared Line",
          starboardMarkId: "mark-3",
          portMarkId: "mark-1",
          roles: { start: true, finish: true },
        },
      ],
      defaultStartLineId: "line-start",
      defaultFinishLineId: "line-finish",
      defaultRouteStartLineId: "line-start",
      defaultRouteFinishLineId: "line-finish",
      defaultRoute: [],
      updatedAt: Date.now(),
    },
  ];
  const races = [
    {
      id: "race-1",
      name: "Race 1",
      venueId: "venue-1",
      routeEnabled: false,
      route: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    },
  ];

  await seedStorage(page, { settings, venues, races });
  await page.goto("/#quick");
  await expect(page.locator("#quick-view")).toBeVisible();

  await page.click("#quick-advanced-toggle");
  await page.click("#quick-edit-course");
  await expect(page.locator("#course-modal")).toHaveAttribute("aria-hidden", "false");

  const startLineBtn = page.locator("#select-start-line");
  await startLineBtn.scrollIntoViewIfNeeded();
  await startLineBtn.click();
  await expect(page.locator("#start-line-modal")).toHaveAttribute("aria-hidden", "false");
  const startModal = page.locator("#start-line-modal");

  await expect(startModal.getByRole("button", { name: "Start Line", exact: true })).toBeVisible();
  await expect(startModal.getByRole("button", { name: "Shared Line", exact: true })).toBeVisible();
  await expect(startModal.getByRole("button", { name: "Finish Line", exact: true })).toHaveCount(0);

  await page.click("#close-start-line");

  await expect(page.locator("#course-finish-section")).toBeHidden();
  await page.click("#course-toggle");
  await expect(page.locator("#course-finish-section")).toBeVisible();

  const finishLineBtn = page.locator("#select-finish-line");
  await finishLineBtn.scrollIntoViewIfNeeded();
  await finishLineBtn.click();
  await expect(page.locator("#finish-line-modal")).toHaveAttribute("aria-hidden", "false");
  const finishModal = page.locator("#finish-line-modal");

  await expect(
    finishModal.getByRole("button", { name: "Finish Line", exact: true })
  ).toBeVisible();
  await expect(finishModal.getByRole("button", { name: "Shared Line", exact: true })).toBeVisible();
  await expect(finishModal.getByRole("button", { name: "Start Line", exact: true })).toHaveCount(
    0
  );
});
