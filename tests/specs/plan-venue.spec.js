const { test, expect } = require("@playwright/test");

async function seedStorage(page, { settings, venues, races }) {
  await page.addInitScript((payload) => {
    if (sessionStorage.getItem("seeded") === "true") return;
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
    sessionStorage.setItem("seeded", "true");
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

test("plan venue selection updates default venue", async ({ page }) => {
  const settings = buildBaseSettings();
  const venues = [
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
  await page.goto("/#plan");
  await expect(page.locator("#plan-view")).toBeVisible();

  await page.click("#plan-select-venue");
  await expect(page.locator("#venue-modal")).toHaveAttribute("aria-hidden", "false");
  await expect(page.locator("#rename-venue")).toBeVisible();

  await page.getByRole("button", { name: "Away Harbor" }).click();
  await page.click("#confirm-venue");
  await expect(page.locator("#plan-venue-name")).toHaveText("Away Harbor");

  await page.click("#plan-set-default");
  await expect(page.locator("#plan-default-venue")).toHaveText("Away Harbor");
  await expect(page.locator("#plan-set-default")).toBeHidden();
});

test("plan edit venue opens venue setup map without marks", async ({ page }) => {
  const settings = buildBaseSettings();
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
      name: "Race 1",
      venueId: "venue-1",
      routeEnabled: false,
      route: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    },
  ];

  await seedStorage(page, { settings, venues, races });
  await page.goto("/#plan");
  await expect(page.locator("#plan-view")).toBeVisible();

  await page.click("#plan-edit-marks");
  await expect(page.locator("#marks-modal")).toHaveAttribute("aria-hidden", "false");
  await page.click("#open-venue-marks-map");

  await expect(page.locator("#map-title")).toHaveText("Venue setup");
  await expect(page).toHaveURL(/map\.html.*mode=venue-setup/);
});

test("plan edit venue returns after map", async ({ page }) => {
  const settings = buildBaseSettings();
  const venues = [
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
  await page.goto("/#plan");
  await expect(page.locator("#plan-view")).toBeVisible();

  await page.click("#plan-edit-marks");
  await expect(page.locator("#marks-modal")).toHaveAttribute("aria-hidden", "false");

  await page.click("#open-venue-marks-map");
  await expect(page.locator("#map-title")).toHaveText("Venue setup");
  await expect(page).toHaveURL(/map\.html.*mode=venue-setup/);

  await page.click("#close-map");
  await expect(page.locator("#marks-modal")).toHaveAttribute("aria-hidden", "false");
  await page.click("#close-marks-modal");
  await expect(page.locator("#plan-view")).toBeVisible();
});

test("plan edit venue updates default course", async ({ page }) => {
  const settings = buildBaseSettings();
  const venues = [
    {
      id: "venue-1",
      name: "Harbor",
      marks: [
        { id: "mark-1", name: "A", lat: 55.01, lon: 12.01 },
        { id: "mark-2", name: "B", lat: 55.02, lon: 12.02 },
      ],
      lines: [
        {
          id: "line-1",
          name: "Start line",
          starboardMarkId: "mark-2",
          portMarkId: "mark-1",
          roles: { start: true, finish: true },
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
      name: "Race 1",
      venueId: "venue-1",
      routeEnabled: false,
      route: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    },
  ];

  await seedStorage(page, { settings, venues, races });
  await page.goto("/#plan");
  await expect(page.locator("#plan-view")).toBeVisible();

  await page.click("#plan-edit-marks");
  await expect(page.locator("#marks-modal")).toHaveAttribute("aria-hidden", "false");
  await page.click("#open-venue-marks-map");
  await expect(page.locator("#map-title")).toHaveText("Venue setup");

  const routeTab = page.locator("#tab-route");
  await expect(routeTab).toBeEnabled();
  await routeTab.click();
  await page.click("#open-mark-list");
  await expect(page.locator("#mark-list-modal")).toHaveAttribute("aria-hidden", "false");
  await page.locator("#map-mark-list").getByRole("button", { name: "A" }).click();
  await expect(page.locator("#mark-edit-modal")).toHaveAttribute("aria-hidden", "false");
  await page.click("#mark-add-route");
  await page.click("#close-mark-edit");

  await page.click("#close-map");
  await expect(page.locator("#marks-modal")).toHaveAttribute("aria-hidden", "false");
  await page.click("#close-marks-modal");

  const storedRouteCount = await page.evaluate(() => {
    const raw = localStorage.getItem("racetimer-venues");
    const venuesState = raw ? JSON.parse(raw) : [];
    const venue = venuesState.find((entry) => entry && entry.id === "venue-1");
    return venue?.defaultRoute?.length || 0;
  });
  expect(storedRouteCount).toBe(1);
});

test("plan edit venue map shows venue setup tabs", async ({ page }) => {
  const settings = buildBaseSettings();
  const venues = [
    {
      id: "venue-1",
      name: "Harbor",
      marks: [
        { id: "mark-1", name: "A", lat: 55.01, lon: 12.01 },
        { id: "mark-2", name: "B", lat: 55.02, lon: 12.02 },
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
  await page.goto("/#plan");
  await expect(page.locator("#plan-view")).toBeVisible();

  await page.click("#plan-edit-marks");
  await expect(page.locator("#marks-modal")).toHaveAttribute("aria-hidden", "false");
  await page.click("#open-venue-marks-map");

  await expect(page.locator("#map-title")).toHaveText("Venue setup");
  await expect(page).toHaveURL(/map\.html.*mode=venue-setup/);
  await expect(page.locator("#map-tabs")).toBeVisible();
  await expect(page.locator("#tab-lines")).toBeEnabled();
});

test("planned events create plan races from quick view", async ({ page }) => {
  const settings = buildBaseSettings();
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

  await page.click("#quick-mode-plan");
  await page.click("#quick-select-plan");
  await expect(page.locator("#race-modal")).toHaveAttribute("aria-hidden", "false");

  page.once("dialog", (dialog) => dialog.accept("Wednesday"));
  await page.click("#new-race");
  await expect(page.locator("#race-modal")).toHaveAttribute("aria-hidden", "true");

  await page.click("#quick-select-plan");
  await expect(page.locator("#race-modal")).toHaveAttribute("aria-hidden", "false");
  await expect(page.getByRole("button", { name: "Wednesday" })).toBeVisible();

  const planRace = await page.evaluate(() => {
    const raw = localStorage.getItem("racetimer-races");
    const racesState = raw ? JSON.parse(raw) : [];
    return racesState.find((entry) => entry.name === "Wednesday");
  });
  expect(planRace).toBeTruthy();
  expect(planRace.isPlan).toBe(true);
  expect(planRace.venueId).toBe("venue-1");
});

test("changing venue hides rename button", async ({ page }) => {
  const settings = buildBaseSettings();
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
    {
      id: "venue-2",
      name: "Away",
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

  await page.click("#quick-change-venue");
  await expect(page.locator("#venue-modal")).toHaveAttribute("aria-hidden", "false");
  await expect(page.locator("#rename-venue")).toBeHidden();
});
