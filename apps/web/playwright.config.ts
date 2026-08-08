import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:3000",
    trace: "on-first-retry",
  },
  webServer: {
    command:
      "PROOFSPEND_ADAPTER_MODE=mock PROOFSPEND_AGENT_MODE=mock bun run build && PROOFSPEND_ADAPTER_MODE=mock PROOFSPEND_AGENT_MODE=mock bun run start",
    url: "http://127.0.0.1:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
  projects: [
    {
      name: "Desktop Chrome",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } },
    },
    {
      name: "Mobile",
      use: { ...devices["Desktop Chrome"], viewport: { width: 375, height: 667 } },
    },
    {
      name: "Short viewport desktop",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 600 } },
    },
  ],
});
