import { defineConfig, devices } from "@playwright/test";

const baseURL = `http://localhost:${process.env.OU_E2E_WEB_PORT ?? "3100"}`;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: {
    timeout: 12_000
  },
  forbidOnly: Boolean(process.env.CI),
  reporter: [
    ["list"],
    ["html", { open: "never", outputFolder: "output/playwright/report" }]
  ],
  outputDir: "output/playwright/artifacts",
  use: {
    baseURL,
    locale: "zh-CN",
    colorScheme: "light",
    serviceWorkers: "block",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "off"
  },
  webServer: {
    command: "exec node tests/e2e/e2e-server.mjs",
    url: `${baseURL}/install`,
    reuseExistingServer: false,
    gracefulShutdown: { signal: "SIGTERM", timeout: 10_000 },
    timeout: 120_000,
    stdout: "pipe",
    stderr: "pipe"
  },
  projects: [
    {
      name: "setup",
      testMatch: /.*\.setup\.ts/
    },
    {
      name: "chromium",
      dependencies: ["setup"],
      testIgnore: /.*\.setup\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        storageState: "output/playwright/auth/owner.json"
      }
    }
  ]
});
