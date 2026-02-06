const { test, expect } = require("@playwright/test");

async function seedStorage(page, { settings, marks, courses }) {
  await page.addInitScript((payload) => {
    localStorage.clear();
    if (payload.settings) {
      localStorage.setItem("racetimer-settings", JSON.stringify(payload.settings));
    }
    if (payload.marks) {
      localStorage.setItem("racetimer-marks", JSON.stringify(payload.marks));
    }
    if (payload.courses) {
      localStorage.setItem("racetimer-courses", JSON.stringify(payload.courses));
    }
  }, { settings, marks, courses });
}

function buildBaseSettings(overrides = {}) {
  return {
    version: 18,
    line: {
      a: { lat: 55.0, lon: 12.0 },
      b: { lat: 55.0005, lon: 12.0005 },
    },
    course: {
      enabled: false,
      marks: [],
      finish: {
        useStartLine: true,
        reverse: false,
        a: { lat: null, lon: null },
        b: { lat: null, lon: null },
      },
    },
    ...overrides,
  };
}

test("course marks show names and toggle rounding", async ({ page }) => {
  const settings = buildBaseSettings({
    course: {
      enabled: false,
      marks: [
        {
          lat: 55.01,
          lon: 12.01,
          name: "A",
          description: "Windward",
          rounding: "port",
          manual: true,
        },
        {
          lat: 55.02,
          lon: 12.02,
          name: "B",
          description: "",
          rounding: "starboard",
          manual: true,
        },
      ],
      finish: {
        useStartLine: true,
        reverse: false,
        a: { lat: null, lon: null },
        b: { lat: null, lon: null },
      },
    },
  });

  await seedStorage(page, { settings });
  await page.goto("/#setup");
  await expect(page.locator("#setup-view")).toBeVisible();

  await page.click("#open-course-marks");
  const markButton = page.locator(
    '.course-mark-btn:has(.mark-name:has-text("A"))'
  );
  await expect(markButton).toHaveClass(/port/);
  await expect(page.locator(".mark-desc")).toContainText("Windward");

  await markButton.click();
  await expect(markButton).toHaveClass(/starboard/);
});

test("saved marks modal adds mark to course", async ({ page }) => {
  const settings = buildBaseSettings();
  const marks = [
    { id: "mark-a", name: "A", description: "Alpha", lat: 55.03, lon: 12.03 },
    { id: "mark-c", name: "C", description: "North", lat: 55.04, lon: 12.04 },
  ];

  await seedStorage(page, { settings, marks });
  await page.goto("/#setup");
  await expect(page.locator("#setup-view")).toBeVisible();

  await page.click("#open-saved-marks");
  const markRow = page.locator("#saved-marks-list .modal-item button", {
    hasText: "C - North",
  });
  await markRow.click();
  await page.click("#confirm-mark-add");
  await page.click("#close-marks");

  await expect(page.locator("#course-marks")).toHaveText("1");
  await page.click("#open-course-marks");
  await expect(page.locator(".course-mark-btn", { hasText: "C" })).toBeVisible();
});

test("course keyboard builds sequence from single-letter marks", async ({ page }) => {
  const settings = buildBaseSettings();
  const marks = [
    { id: "mark-a", name: "A", description: "Alpha", lat: 55.05, lon: 12.05 },
    { id: "mark-b", name: "B", description: "Bravo", lat: 55.06, lon: 12.06 },
    { id: "mark-gate", name: "Gate", description: "Gate mark", lat: 55.07, lon: 12.07 },
  ];

  await seedStorage(page, { settings, marks });
  await page.goto("/#setup");
  await expect(page.locator("#setup-view")).toBeVisible();

  await page.click("#open-course-keyboard");
  await expect(page.locator(".course-key", { hasText: "A" })).toBeVisible();
  await expect(page.locator(".course-key", { hasText: "B" })).toBeVisible();
  await expect(page.locator(".course-key", { hasText: "Gate" })).toHaveCount(0);

  await page.click('.course-key:has-text("A")');
  await page.click('.course-key:has-text("B")');

  await expect(page.locator(".course-chip")).toHaveCount(2);
  await expect(page.locator(".course-chip", { hasText: "A" })).toBeVisible();
  await expect(page.locator(".course-chip", { hasText: "B" })).toBeVisible();

  await page.click("#course-keyboard-undo");
  await expect(page.locator(".course-chip")).toHaveCount(1);

  page.once("dialog", (dialog) => dialog.accept());
  await page.click("#course-keyboard-clear");
  await expect(page.locator(".course-chip")).toHaveCount(0);
  await expect(page.locator("#course-sequence .hint")).toHaveText("No marks yet.");
});
