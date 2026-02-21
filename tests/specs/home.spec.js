const { test, expect } = require("@playwright/test");

test("home view loads by default and RaceStarter opens quick view", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#home-view")).toBeVisible();
  await page.click("#open-setup");
  await expect(page.locator("#quick-view")).toBeVisible();
  await expect(page.locator("#go-race")).toBeVisible();
});
