import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  timeout: 60000,
  expect: { timeout: 10000 },
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: "http://localhost:5173",
    trace: "off",
    screenshot: "on",
  },
  webServer: {
    command: "npx vite --port 5173",
    port: 5173,
    timeout: 30000,
    reuseExistingServer: true,
  },
});
