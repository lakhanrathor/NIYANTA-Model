import { defineConfig } from '@playwright/test'

/**
 * E2E runs against the already-running stack:
 *   backend  127.0.0.1:8000   frontend  127.0.0.1:5174
 * One worker, no retries — a flake is a bug we want to see.
 */
export default defineConfig({
  testDir: './tests',
  timeout: 20 * 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    // vite listens on ::1 — 127.0.0.1 would refuse the connection
    baseURL: 'http://localhost:5174',
    viewport: { width: 1720, height: 1000 },
    navigationTimeout: 45_000,
    actionTimeout: 15_000,
    trace: 'retain-on-failure',
  },
})
