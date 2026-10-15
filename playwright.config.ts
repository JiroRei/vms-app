import "dotenv/config";
import { defineConfig } from "@playwright/test";
import { isolatedTestUrl } from "./tests/test-database";
const databaseUrl = isolatedTestUrl(process.env.DATABASE_URL, process.env.DATABASE_URL_TEST);
const baseURL = "http://127.0.0.1:3100";
export default defineConfig({
  testDir: "./tests/e2e", fullyParallel: false, workers: 1, retries: process.env.CI ? 1 : 0,
  timeout: 60_000, expect: { timeout: 15_000 }, reporter: [["list"], ["html", { open: "never" }]],
  use: { baseURL, trace: "retain-on-failure", screenshot: "only-on-failure", browserName: "chromium" },
  webServer: {
    command: "node node_modules/next/dist/bin/next start --port 3100",
    url: `${baseURL}/api/health`, reuseExistingServer: false, timeout: 180_000,
    env: { DATABASE_URL: databaseUrl, EMAIL_MODE: "test", NEXT_DIST_DIR: ".next-e2e", BETTER_AUTH_URL: baseURL, BETTER_AUTH_SECRET: "e2e-only-auth-secret-at-least-32-characters", BOOKING_VERIFY_SECRET: "e2e-only-booking-secret-at-least-32-characters", PASS_SECRET: "e2e-only-pass-secret-at-least-32-characters", CRON_SECRET: "e2e-only-cron-secret" },
  },
});
