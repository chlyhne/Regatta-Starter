const { test, expect } = require("@playwright/test");

test("home view loads", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#home-view")).toBeVisible();
  await expect(page.locator("#open-setup")).toBeVisible();
});
