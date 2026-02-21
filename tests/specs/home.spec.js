const { test, expect } = require("@playwright/test");

test("quick view loads by default", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#quick-view")).toBeVisible();
  await expect(page.locator("#go-race")).toBeVisible();
});
