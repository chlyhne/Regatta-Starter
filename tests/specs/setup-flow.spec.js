const { test, expect } = require("@playwright/test");

async function resetStorage(page) {
  await page.addInitScript(() => {
    if (sessionStorage.getItem("seeded") === "true") return;
    localStorage.clear();
    localStorage.setItem(
      "racetimer-settings",
      JSON.stringify({ version: 19, activeVenueId: null, activeRaceId: null })
    );
    sessionStorage.setItem("seeded", "true");
  });
}

test("setup flow builds a venue course and start time", async ({ page }) => {
  await resetStorage(page);
  await page.goto("/#setup");
  await expect(page.locator("#setup-view")).toBeVisible();

  if ((await page.locator("#venue-modal").getAttribute("aria-hidden")) === "true") {
    await page.click("#select-venue");
    await expect(page.locator("#venue-modal")).toHaveAttribute("aria-hidden", "false");
  }
  page.once("dialog", (dialog) => dialog.accept("Test Harbor"));
  await page.getByRole("button", { name: "New venue" }).evaluate((button) => {
    button.click();
  });
  await expect(page.locator("#venue-name")).toHaveText("Test Harbor");
  const venueModalHidden = await page.locator("#venue-modal").getAttribute("aria-hidden");
  if (venueModalHidden === "true") {
    await page.click("#select-venue");
    await expect(page.locator("#venue-modal")).toHaveAttribute("aria-hidden", "false");
  }
  await expect(page.locator("#rename-venue")).toBeEnabled();
  page.once("dialog", (dialog) => dialog.accept("Renamed Harbor"));
  await page.locator("#rename-venue").evaluate((button) => {
    button.click();
  });
  await expect(page.getByRole("button", { name: "Renamed Harbor" })).toBeVisible();
  await page.click("#confirm-venue");
  await expect(page.locator("#venue-modal")).toHaveAttribute("aria-hidden", "true");

  if ((await page.locator("#venue-modal").getAttribute("aria-hidden")) === "true") {
    await page.click("#select-venue");
    await expect(page.locator("#venue-modal")).toHaveAttribute("aria-hidden", "false");
  }
  await page.click("#open-venue-marks");

  await expect(page.locator("#marks-modal")).toHaveAttribute("aria-hidden", "false");
  await page.click("#open-venue-marks-map");

  await expect(page.locator("#map-title")).toHaveText("Venue marks");
  const addMark = page.locator("#add-mark");
  await expect(addMark).toBeVisible();
  for (let i = 0; i < 5; i += 1) {
    await addMark.click();
  }
  await page.click("#close-map");
  await expect(page.locator("#marks-modal")).toHaveAttribute("aria-hidden", "false");
  await page.click("#close-marks-modal");
  await expect(page.locator("#venue-modal")).toHaveAttribute("aria-hidden", "false");

  await page.evaluate(() => {
    const venuesRaw = localStorage.getItem("racetimer-venues");
    if (!venuesRaw) return;
    const venues = JSON.parse(venuesRaw);
    const venue =
      venues.find((entry) => entry && entry.name === "Renamed Harbor") || venues[0];
    if (!venue || !Array.isArray(venue.marks) || venue.marks.length < 5) return;
    const marks = venue.marks.slice(0, 5);
    const names = ["Start SB", "Start P", "Mid", "Finish SB", "Finish P"];
    const coords = [
      { lat: 55.0, lon: 12.02 },
      { lat: 55.0, lon: 12.0 },
      { lat: 55.01, lon: 12.01 },
      { lat: 55.02, lon: 12.02 },
      { lat: 55.02, lon: 12.0 },
    ];
    venue.marks = venue.marks.map((mark, index) =>
      index < marks.length
        ? {
            ...mark,
            name: names[index],
            lat: coords[index].lat,
            lon: coords[index].lon,
          }
        : mark
    );
    const lineStartId = `line-start-${Date.now()}`;
    const lineFinishId = `line-finish-${Date.now()}`;
    venue.lines = [
      {
        id: lineStartId,
        name: "Start line",
        starboardMarkId: marks[0].id,
        portMarkId: marks[1].id,
      },
      {
        id: lineFinishId,
        name: "Finish line",
        starboardMarkId: marks[3].id,
        portMarkId: marks[4].id,
      },
    ];
    venue.defaultStartLineId = lineStartId;
    venue.defaultFinishLineId = lineFinishId;
    venue.defaultRouteStartLineId = lineStartId;
    venue.defaultRouteFinishLineId = lineFinishId;
    localStorage.setItem("racetimer-venues", JSON.stringify(venues));
  });

  await page.reload();
  await expect(page.locator("#setup-view")).toBeVisible();

  await page.click("#open-course");
  await expect(page.locator("#course-modal")).toBeVisible();

  await page.click("#select-start-line");
  await expect(page.locator("#start-line-modal")).toBeVisible();
  await page.getByRole("button", { name: "Start line" }).click();
  await page.click("#confirm-start-line");
  await expect(page.locator("#course-modal")).toBeVisible();

  await page.click("#select-finish-line");
  await expect(page.locator("#finish-line-modal")).toBeVisible();
  await page.getByRole("button", { name: "Finish line" }).click();
  await page.click("#confirm-finish-line");
  await expect(page.locator("#course-modal")).toBeVisible();

  await page.click("#course-toggle");
  await page.click("#open-route");
  await expect(page.locator("#course-keyboard-modal")).toBeVisible();
  await page.getByRole("button", { name: "Add Mid (port)" }).click();
  await page.click("#course-keyboard-close");
  await expect(page.locator("#course-keyboard-modal")).toHaveAttribute(
    "aria-hidden",
    "true"
  );
  await expect(page.locator("#course-modal")).toHaveAttribute("aria-hidden", "false");
  await page.click("#close-course-modal");
  await expect(page.locator("#course-modal")).toHaveAttribute("aria-hidden", "true");

  await expect(page.locator("#status-line-name")).toHaveText("Start line");

  await page.click("#start-mode-absolute");
  await page.fill("#absolute-time", "12:34:56");
  await page.dispatchEvent("#absolute-time", "change");
  await page.click("#set-start");

  await expect(page.locator("#race-name")).toHaveText("Race 2");
  await expect(page.locator("#venue-name")).toHaveText("Renamed Harbor");
  await expect(page.locator("#status-start-time")).toContainText("12:34");

  const lengthValue = await page.locator("#status-course-length-value").textContent();
  const lengthUnit = await page.locator("#status-course-length-unit").textContent();
  const parsedValue = Number.parseFloat(lengthValue || "");
  expect(lengthUnit).toBe("[nm]");
  expect(Number.isFinite(parsedValue)).toBe(true);
  expect(parsedValue).toBeGreaterThan(1.1);
  expect(parsedValue).toBeLessThan(1.3);
});
