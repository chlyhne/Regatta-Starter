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

async function expectFullPageModal(page, selector) {
  const modal = page.locator(selector);
  const panel = page.locator(`${selector} .modal-panel`);
  await expect(modal).toHaveAttribute("aria-hidden", "false");
  const viewport = page.viewportSize() || (await page.evaluate(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
  })));
  const box = await panel.boundingBox();
  expect(box).toBeTruthy();
  expect(box.width).toBeGreaterThanOrEqual(viewport.width * 0.98);
  expect(box.height).toBeGreaterThanOrEqual(viewport.height * 0.98);
  const bg = await modal.evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(bg).toBe("rgb(255, 255, 255)");
}

test("modals use full-page layout", async ({ page }) => {
  await resetStorage(page);
  await page.goto("/#setup");
  await expect(page.locator("#setup-view")).toBeVisible();

  await page.click("#select-race");
  await expectFullPageModal(page, "#race-modal");
  await page.click("#close-race-modal");
  await expect(page.locator("#race-modal")).toHaveAttribute("aria-hidden", "true");

  await page.click("#select-venue");
  await expect(page.locator("#venue-modal")).toHaveAttribute("aria-hidden", "false");
  await page.click("#open-venue-marks");
  await expectFullPageModal(page, "#marks-modal");
});
