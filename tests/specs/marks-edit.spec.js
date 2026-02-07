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

test("marks modal edits mark details and coordinates", async ({ page }) => {
  await resetStorage(page);
  await page.goto("/#setup");
  await expect(page.locator("#setup-view")).toBeVisible();

  if ((await page.locator("#venue-modal").getAttribute("aria-hidden")) === "true") {
    await page.click("#select-venue");
    await expect(page.locator("#venue-modal")).toHaveAttribute("aria-hidden", "false");
  }
  page.once("dialog", (dialog) => dialog.accept("Marks Harbor"));
  await page.getByRole("button", { name: "New venue" }).evaluate((button) => {
    button.click();
  });
  await expect(page.locator("#venue-name")).toHaveText("Marks Harbor");

  const venueHidden = await page.locator("#venue-modal").getAttribute("aria-hidden");
  if (venueHidden === "true") {
    await page.click("#select-venue");
    await expect(page.locator("#venue-modal")).toHaveAttribute("aria-hidden", "false");
  }

  await page.click("#open-venue-marks");
  await expect(page.locator("#marks-modal")).toHaveAttribute("aria-hidden", "false");
  await expect(page.locator("#calibrate-mark")).toBeDisabled();

  await page.click("#open-venue-marks-map");
  await expect(page.locator("#map-title")).toHaveText("Venue marks");
  const addMark = page.locator("#add-mark");
  await expect(addMark).toBeVisible();
  await addMark.click();
  await addMark.click();
  await page.click("#close-map");

  await expect(page.locator("#marks-modal")).toHaveAttribute("aria-hidden", "false");
  await expect(page.locator("#calibrate-mark")).toBeEnabled();

  await page.click("#calibrate-mark");
  await expect(page.locator("#calibration-preview-modal")).toHaveAttribute(
    "aria-hidden",
    "false"
  );
  await expect(page.locator("#confirm-calibration")).toBeDisabled();
  await page.click("#cancel-calibration");
  await expect(page.locator("#marks-modal")).toHaveAttribute("aria-hidden", "false");

  await page.getByRole("button", { name: "Mark 1" }).click();
  await expect(page.locator("#mark-edit-modal")).toHaveAttribute("aria-hidden", "false");

  await page.fill("#mark-name", "Alpha");
  await page.dispatchEvent("#mark-name", "change");
  await page.fill("#mark-desc", "Outer");
  await page.dispatchEvent("#mark-desc", "change");
  await page.fill("#mark-lat", "55.123456");
  await page.dispatchEvent("#mark-lat", "change");
  await page.fill("#mark-lon", "12.654321");
  await page.dispatchEvent("#mark-lon", "change");

  await page.click("#close-mark-edit");
  await expect(page.locator("#marks-modal")).toHaveAttribute("aria-hidden", "false");
  await expect(page.getByRole("button", { name: "Alpha" })).toBeVisible();

  const storedMark = await page.evaluate(() => {
    const venues = JSON.parse(localStorage.getItem("racetimer-venues") || "[]");
    const venue = venues.find((entry) => entry && entry.name === "Marks Harbor");
    if (!venue || !Array.isArray(venue.marks)) return null;
    return venue.marks.find((mark) => mark && mark.name === "Alpha") || null;
  });

  expect(storedMark).toBeTruthy();
  expect(storedMark.description).toBe("Outer");
  expect(storedMark.lat).toBeCloseTo(55.123456, 6);
  expect(storedMark.lon).toBeCloseTo(12.654321, 6);
});
