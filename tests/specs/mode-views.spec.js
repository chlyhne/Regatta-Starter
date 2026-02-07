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

async function expectOnlyVisible(page, visibleId) {
  const ids = ["#setup-view", "#quick-view", "#plan-view", "#line-view"];
  for (const id of ids) {
    const locator = page.locator(id);
    if (id === visibleId) {
      await expect(locator).toBeVisible();
    } else {
      await expect(locator).toBeHidden();
    }
  }
}

test("setup, quick, plan, and line views are mutually exclusive", async ({ page }) => {
  await resetStorage(page);
  await page.goto("/#setup");
  await expectOnlyVisible(page, "#setup-view");

  await page.click("#open-quick-race");
  await expectOnlyVisible(page, "#quick-view");

  await page.click("#close-quick");
  await expectOnlyVisible(page, "#setup-view");

  await page.click("#open-plan-venue");
  await expectOnlyVisible(page, "#plan-view");

  await page.click("#close-plan");
  await expectOnlyVisible(page, "#setup-view");

  await page.click("#open-start-line-only");
  await expectOnlyVisible(page, "#line-view");
});
