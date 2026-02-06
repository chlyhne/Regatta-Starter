const path = require("path");
const { defineConfig } = require("@playwright/test");

const host = process.env.HOST || "127.0.0.1";
const port = Number(process.env.PORT || 4173);
const baseURL = `http://${host}:${port}`;
const rootDir = path.resolve(__dirname, "..");

module.exports = defineConfig({
  testDir: path.join(__dirname, "specs"),
  timeout: 30 * 1000,
  expect: {
    timeout: 5 * 1000,
  },
  fullyParallel: true,
  reporter: "list",
  use: {
    baseURL,
    trace: "retain-on-failure",
  },
  webServer: {
    command: "node tests/support/static-server.js",
    cwd: rootDir,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 30 * 1000,
  },
});
