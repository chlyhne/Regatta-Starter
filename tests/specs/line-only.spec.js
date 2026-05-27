const { test, expect } = require("@playwright/test");

async function seedStorage(page) {
  await page.addInitScript(() => {
    if (sessionStorage.getItem("seeded") === "true") return;
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
    sessionStorage.setItem("seeded", "true");
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
    const simpleRaw = localStorage.getItem("racetimer-lines");
    const simpleLines = simpleRaw ? JSON.parse(simpleRaw) : [];
    return {
      marks: venue?.marks?.length || 0,
      lines: venue?.lines?.length || 0,
      simpleLines: simpleLines.length,
    };
  });

  expect(venueState.marks).toBe(3);
  expect(venueState.lines).toBe(1);
  expect(venueState.simpleLines).toBe(1);
});

test("line-only map editor returns to line view and stores a manual line", async ({ page }) => {
  await seedStorage(page);
  await page.goto("/#quick");
  await expect(page.locator("#quick-view")).toBeVisible();

  await page.click("#quick-change-lines");
  await expect(page.locator("#line-view")).toBeVisible();

  await page.click("#open-simple-map");
  await expect(page).toHaveURL(/map-simple\.html/);

  await expect(page.locator("#map-status")).not.toHaveText("Loading map...");
  for (const side of ["a", "b"]) {
    let set = false;
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await page.click(side === "a" ? "#set-map-a" : "#set-map-b");
      set = await page.evaluate((markSide) => {
        const raw = localStorage.getItem("racetimer-settings");
        const settings = raw ? JSON.parse(raw) : {};
        const point = settings?.line?.[markSide];
        return Number.isFinite(point?.lat) && Number.isFinite(point?.lon);
      }, side);
      if (set) break;
      await page.waitForTimeout(100);
    }
    expect(set).toBe(true);
  }
  await page.click("#close-map");

  await expect(page.locator("#line-view")).toBeVisible();

  const settingsState = await page.evaluate(() => {
    const raw = localStorage.getItem("racetimer-settings");
    const settings = raw ? JSON.parse(raw) : {};
    return {
      aLat: settings?.line?.a?.lat ?? null,
      bLat: settings?.line?.b?.lat ?? null,
      sourceId: settings?.lineMeta?.sourceId ?? null,
    };
  });

  expect(settingsState.aLat).not.toBeNull();
  expect(settingsState.bLat).not.toBeNull();
  expect(settingsState.sourceId).toBeNull();
});

test("line endpoints can be set independently across sessions and input methods", async ({
  page,
}) => {
  await seedStorage(page);
  await page.addInitScript(() => {
    const sample = () => ({
      coords: {
        latitude: 55.667,
        longitude: 12.59,
        accuracy: 5,
        speed: null,
        heading: null,
        altitude: null,
        altitudeAccuracy: null,
      },
      timestamp: Date.now(),
    });
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: {
        getCurrentPosition(success) {
          setTimeout(() => success(sample()), 0);
        },
        watchPosition(success) {
          setTimeout(() => success(sample()), 0);
          return 1;
        },
        clearWatch() {},
      },
    });
  });
  page.on("dialog", (dialog) => dialog.dismiss());

  await page.goto("/#line");
  await expect(page.locator("#line-view")).toBeVisible();

  await page.click("#open-location");
  await expect(page.locator("#location-view")).toBeVisible();
  await page.click("#use-a");

  await expect
    .poll(async () =>
      page.evaluate(() => {
        const raw = localStorage.getItem("racetimer-settings");
        const settings = raw ? JSON.parse(raw) : {};
        const point = settings?.line?.a;
        return {
          lat: point?.lat ?? null,
          lon: point?.lon ?? null,
        };
      })
    )
    .not.toEqual({ lat: null, lon: null });
  const firstPoint = await page.evaluate(() => {
    const raw = localStorage.getItem("racetimer-settings");
    const settings = raw ? JSON.parse(raw) : {};
    const point = settings?.line?.a;
    return {
      lat: point?.lat ?? null,
      lon: point?.lon ?? null,
    };
  });
  expect(firstPoint.lat).not.toBeNull();
  expect(firstPoint.lon).not.toBeNull();

  await page.reload();
  await page.goto("/#line");
  await expect(page.locator("#line-view")).toBeVisible();

  await page.click("#open-coords");
  await expect(page.locator("#coords-view")).toBeVisible();
  await page.fill("#lat-b", "55.700000");
  await page.fill("#lon-b", "12.650000");
  await page.dispatchEvent("#lat-b", "change");
  await page.dispatchEvent("#lon-b", "change");

  await expect
    .poll(async () =>
      page.evaluate(() => {
        const raw = localStorage.getItem("racetimer-settings");
        const settings = raw ? JSON.parse(raw) : {};
        return settings?.line || null;
      })
    )
    .not.toBeNull();
  const finalLine = await page.evaluate(() => {
    const raw = localStorage.getItem("racetimer-settings");
    const settings = raw ? JSON.parse(raw) : {};
    return settings?.line || null;
  });

  expect(finalLine?.a?.lat).toBeCloseTo(55.667, 3);
  expect(finalLine?.a?.lon).toBeCloseTo(12.59, 3);
  expect(finalLine?.b?.lat).toBeCloseTo(55.7, 6);
  expect(finalLine?.b?.lon).toBeCloseTo(12.65, 6);
});
