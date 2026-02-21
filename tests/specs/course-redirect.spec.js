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

test("course redirects to marks map when venue has no marks", async ({ page }) => {
  await resetStorage(page);
  await page.goto("/#quick");
  await expect(page.locator("#quick-view")).toBeVisible();

  await page.click("#quick-advanced-toggle");
  page.once("dialog", (dialog) => dialog.accept());
  await page.click("#quick-edit-course");

  await expect(page.locator("#map-title")).toHaveText("Venue setup");
  await expect(page).toHaveURL(/map\.html.*mode=venue-setup/);
  await page.click("#close-map");
  await expect(page.locator("#quick-view")).toBeVisible();
  await expect(page.locator("#venue-modal")).toHaveAttribute("aria-hidden", "true");
});

test("course redirects to lines map when venue has marks but no lines", async ({ page }) => {
  await resetStorage(page);
  await page.goto("/#quick");
  await expect(page.locator("#quick-view")).toBeVisible();

  await page.evaluate(() => {
    const venuesRaw = localStorage.getItem("racetimer-venues");
    if (!venuesRaw) return;
    const venues = JSON.parse(venuesRaw);
    const venue = venues[0];
    if (!venue) return;
    venue.marks = [
      { id: "mark-1", name: "Mark 1", lat: 55.0, lon: 12.0 },
      { id: "mark-2", name: "Mark 2", lat: 55.001, lon: 12.001 },
    ];
    venue.lines = [];
    venue.updatedAt = Date.now();
    localStorage.setItem("racetimer-venues", JSON.stringify(venues));
  });

  await page.reload();
  await expect(page.locator("#quick-view")).toBeVisible();

  await page.click("#quick-advanced-toggle");
  page.once("dialog", (dialog) => dialog.accept());
  await page.click("#quick-edit-course");

  await expect(page.locator("#map-title")).toHaveText("Venue setup");
  await expect(page).toHaveURL(/map\.html.*mode=venue-setup/);
  await page.click("#close-map");
  await expect(page.locator("#quick-view")).toBeVisible();
  await expect(page.locator("#venue-modal")).toHaveAttribute("aria-hidden", "true");
});

test("change start line opens line-only when no simple lines exist", async ({ page }) => {
  await resetStorage(page);
  await page.goto("/#quick");
  await expect(page.locator("#quick-view")).toBeVisible();

  let dialogSeen = false;
  page.on("dialog", async (dialog) => {
    dialogSeen = true;
    await dialog.dismiss();
  });
  await page.click("#quick-change-lines");

  await expect(page.locator("#line-view")).toBeVisible();
  expect(dialogSeen).toBe(false);
  await page.click("#close-line");
  await expect(page.locator("#quick-view")).toBeVisible();
});
