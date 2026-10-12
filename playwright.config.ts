import { defineConfig, devices } from "@playwright/test";

const PORT = 3100;
// Fresh database per run so cached observations from earlier runs never leak into assertions
const DB = `data/e2e-${Date.now()}.db`;

// E2E runs against a production build with the deterministic mock provider and its own database.
export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: [["list"]],
  use: { baseURL: `http://localhost:${PORT}`, trace: "retain-on-failure", viewport: { width: 1440, height: 900 } },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } }],
  webServer: {
    command: `npx next build && npx next start -p ${PORT}`,
    url: `http://localhost:${PORT}/api/meta`,
    timeout: 240_000,
    reuseExistingServer: false,
    env: {
      TRIPSHOCK_PROVIDER: "mock",
      TRIPSHOCK_DB: process.env.TRIPSHOCK_E2E_DB ?? DB,
      TRIPSHOCK_MOCK_LATENCY_MS: "40",
    },
  },
});
