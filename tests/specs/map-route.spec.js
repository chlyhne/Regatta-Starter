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

test("map route editing adds and clears marks", async ({ page }) => {
  const settings = buildBaseSettings();
  const venues = [
    {
      id: "venue-1",
      name: "Harbor",
      marks: [
        { id: "mark-a", name: "A", description: "Alpha", lat: 55.01, lon: 12.01 },
        { id: "mark-b", name: "B", description: "Bravo", lat: 55.02, lon: 12.02 },
      ],
      lines: [
        { id: "line-1", name: "", starboardMarkId: "mark-b", portMarkId: "mark-a" },
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
      route: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    },
  ];

  await seedStorage(page, { settings, venues, races });
  await page.goto("/map.html?mode=race-route");

  await expect(page.locator(".map-mark-mark-a")).toBeVisible();
  await page.click(".map-mark-mark-a");
  await expect(page.locator("#mark-edit-modal")).toHaveAttribute("aria-hidden", "true");

  const routeLength = await page.evaluate(() => {
    const racesRaw = localStorage.getItem("racetimer-races");
    const parsed = racesRaw ? JSON.parse(racesRaw) : [];
    return parsed[0]?.route?.length || 0;
  });
  expect(routeLength).toBe(1);

  await page.click(".map-mark-mark-a");

  const clearedLength = await page.evaluate(() => {
    const racesRaw = localStorage.getItem("racetimer-races");
    const parsed = racesRaw ? JSON.parse(racesRaw) : [];
    return parsed[0]?.route?.length || 0;
  });
  expect(clearedLength).toBe(0);

  await page.click(".map-mark-mark-a");

  await expect(page.locator("#undo-route-mark")).toBeEnabled();
  await page.click("#undo-route-mark");

  const afterUndoLength = await page.evaluate(() => {
    const racesRaw = localStorage.getItem("racetimer-races");
    const parsed = racesRaw ? JSON.parse(racesRaw) : [];
    return parsed[0]?.route?.length || 0;
  });
  expect(afterUndoLength).toBe(0);

  await page.click(".map-mark-mark-a");

  page.once("dialog", (dialog) => dialog.accept());
  await page.click("#clear-route");

  const clearedAgain = await page.evaluate(() => {
    const racesRaw = localStorage.getItem("racetimer-races");
    const parsed = racesRaw ? JSON.parse(racesRaw) : [];
    return parsed[0]?.route?.length || 0;
  });
  expect(clearedAgain).toBe(0);
});

test("route line includes start and finish lines", async ({ page }) => {
  const settings = buildBaseSettings();
  const venues = [
    {
      id: "venue-1",
      name: "Harbor",
      marks: [
        { id: "mark-port", name: "Port", description: "", lat: 55.0, lon: 12.0 },
        { id: "mark-star", name: "Starboard", description: "", lat: 55.0, lon: 12.02 },
        { id: "mark-a", name: "A", description: "", lat: 55.01, lon: 12.01 },
        { id: "mark-port-finish", name: "Finish P", description: "", lat: 55.02, lon: 12.0 },
        {
          id: "mark-star-finish",
          name: "Finish S",
          description: "",
          lat: 55.02,
          lon: 12.02,
        },
      ],
      lines: [
        {
          id: "line-start",
          name: "",
          starboardMarkId: "mark-star",
          portMarkId: "mark-port",
        },
        {
          id: "line-finish",
          name: "",
          starboardMarkId: "mark-star-finish",
          portMarkId: "mark-port-finish",
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
      name: "Morning",
      venueId: "venue-1",
      startLineId: "line-start",
      finishLineId: "line-finish",
      routeStartLineId: "line-start",
      routeFinishLineId: "line-finish",
      routeEnabled: true,
      route: [{ markId: "mark-a", rounding: "port", manual: true }],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    },
  ];

  await seedStorage(page, { settings, venues, races });
  await page.goto("/map.html?mode=race-route");

  await expect
    .poll(async () => {
      return page.evaluate(() => {
        const paths = Array.from(document.querySelectorAll("path"));
        return paths.some((path) => {
          const attr = (path.getAttribute("stroke") || "").toLowerCase();
          if (attr === "#0f6bff") return true;
          const style = (path.getAttribute("style") || "").toLowerCase();
          if (style.includes("stroke: #0f6bff")) return true;
          if (style.includes("stroke: rgb(15, 107, 255)")) return true;
          const computed = window.getComputedStyle(path).stroke;
          return computed === "rgb(15, 107, 255)";
        });
      });
    })
    .toBe(true);
});

test("line arrows point in the start direction", async ({ page }) => {
  const settings = buildBaseSettings();
  const venues = [
    {
      id: "venue-1",
      name: "Harbor",
      marks: [
        { id: "mark-port", name: "Port", description: "", lat: 55.0, lon: 12.0 },
        { id: "mark-star", name: "Starboard", description: "", lat: 55.0, lon: 12.02 },
      ],
      lines: [
        {
          id: "line-1",
          name: "",
          starboardMarkId: "mark-star",
          portMarkId: "mark-port",
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
  await page.goto("/map.html?mode=venue-lines");

  const arrow = page.locator(".map-line-arrow span");
  await expect(arrow).toBeVisible();

  const angle = await arrow.evaluate((span) => {
    const inline = span.getAttribute("style") || "";
    const inlineMatch = inline.match(/rotate\(([-\d.]+)deg\)/);
    if (inlineMatch) return Number(inlineMatch[1]);
    const computed = window.getComputedStyle(span).transform;
    if (!computed || computed === "none") return null;
    const matrixMatch = computed.match(/matrix\(([^)]+)\)/);
    if (!matrixMatch) return null;
    const values = matrixMatch[1].split(",").map((value) => Number(value.trim()));
    if (values.length < 2 || values.some((value) => !Number.isFinite(value))) {
      return null;
    }
    const [a, b] = values;
    return (Math.atan2(b, a) * 180) / Math.PI;
  });
  expect(angle).not.toBeNull();
  expect(Math.abs(angle + 90)).toBeLessThan(12);
});

test("route uses finish line role when no finish line is selected", async ({ page }) => {
  const settings = buildBaseSettings();
  const venues = [
    {
      id: "venue-1",
      name: "Harbor",
      marks: [
        { id: "mark-port", name: "Port", description: "", lat: 55.0, lon: 12.0 },
        { id: "mark-star", name: "Starboard", description: "", lat: 55.0, lon: 12.02 },
        { id: "mark-a", name: "A", description: "", lat: 55.01, lon: 12.01 },
        { id: "mark-port-finish", name: "Finish P", description: "", lat: 55.02, lon: 12.0 },
        {
          id: "mark-star-finish",
          name: "Finish S",
          description: "",
          lat: 55.02,
          lon: 12.02,
        },
      ],
      lines: [
        {
          id: "line-start",
          name: "Start",
          starboardMarkId: "mark-star",
          portMarkId: "mark-port",
          roles: { start: true, finish: false },
        },
        {
          id: "line-finish",
          name: "Finish",
          starboardMarkId: "mark-star-finish",
          portMarkId: "mark-port-finish",
          roles: { start: false, finish: true },
        },
      ],
      defaultStartLineId: "line-start",
      defaultFinishLineId: null,
      defaultRouteStartLineId: "line-start",
      defaultRouteFinishLineId: null,
      defaultRoute: [],
      updatedAt: Date.now(),
    },
  ];
  const races = [
    {
      id: "race-1",
      name: "Morning",
      venueId: "venue-1",
      startLineId: "line-start",
      finishLineId: null,
      routeStartLineId: "line-start",
      routeFinishLineId: null,
      routeEnabled: true,
      route: [{ markId: "mark-a", rounding: "port", manual: true }],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    },
  ];

  await seedStorage(page, { settings, venues, races });
  await page.goto("/map.html?mode=race-route&debug=true");

  await page.waitForFunction(() => window.__raceTimerMap);
  const ids = await page.evaluate(() => window.__raceTimerMap.getRouteLineIds());
  expect(ids.finishLineId).toBe("line-finish");
});

test("mark labels fit text and arrows are sized", async ({ page }) => {
  const settings = buildBaseSettings();
  const venues = [
    {
      id: "venue-1",
      name: "Harbor",
      marks: [
        { id: "mark-port", name: "Port Mark", description: "", lat: 55.0, lon: 12.0 },
        { id: "mark-star", name: "Starboard Mark", description: "", lat: 55.0, lon: 12.02 },
      ],
      lines: [
        {
          id: "line-1",
          name: "",
          starboardMarkId: "mark-star",
          portMarkId: "mark-port",
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
  await page.goto("/map.html?mode=venue-lines");

  await expect(page.locator(".mark-label").first()).toBeVisible();
  await expect(page.locator(".map-line-arrow")).toBeVisible();

  const metrics = await page.evaluate(() => {
    const label = document.querySelector(".mark-label");
    const arrow = document.querySelector(".map-line-arrow");
    const paths = Array.from(document.querySelectorAll("path"));
    const markPath = paths.find((path) => {
      const computed = window.getComputedStyle(path);
      const fill = (path.getAttribute("fill") || computed.fill || "").toLowerCase();
      if (!fill || fill === "none" || fill === "transparent") return false;
      if (fill.startsWith("rgba") && fill.includes("0, 0, 0, 0")) return false;
      return true;
    });

    if (!label || !arrow || !markPath) {
      return { textFits: false, markVisible: false, arrowSized: false };
    }

    const labelRect = label.getBoundingClientRect();
    const markRect = markPath.getBoundingClientRect();
    const markCenter = {
      x: markRect.left + markRect.width / 2,
      y: markRect.top + markRect.height / 2,
    };
    const textFits =
      label.scrollWidth <= label.clientWidth + 1 &&
      label.scrollHeight <= label.clientHeight + 1;
    const markVisible = !(
      markCenter.x >= labelRect.left &&
      markCenter.x <= labelRect.right &&
      markCenter.y >= labelRect.top &&
      markCenter.y <= labelRect.bottom
    );
    const arrowRect = arrow.getBoundingClientRect();
    const arrowSized = arrowRect.width >= 32 && arrowRect.height >= 24;

    return { textFits, markVisible, arrowSized };
  });

  expect(metrics.textFits).toBe(true);
  expect(metrics.markVisible).toBe(true);
  expect(metrics.arrowSized).toBe(true);
});
