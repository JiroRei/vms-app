import "dotenv/config";
import { defineConfig } from "@playwright/test";
import { isolatedTestUrl } from "./tests/test-database";
import { E2E_MAIL_SINK } from "./tests/e2e-mail";
const databaseUrl = isolatedTestUrl(process.env.DATABASE_URL, process.env.DATABASE_URL_TEST);
const baseURL = "http://127.0.0.1:3100";
export default defineConfig({
  testDir: "./tests/e2e", fullyParallel: false, workers: 1, retries: process.env.CI ? 1 : 0,
  timeout: 60_000, expect: { timeout: 15_000 }, reporter: [["list"], ["html", { open: "never" }]],
  use: { baseURL, trace: "retain-on-failure", screenshot: "only-on-failure", browserName: "chromium" },
  webServer: {
    command: "node server.mjs --port 3100",
    url: `${baseURL}/api/health`, reuseExistingServer: false, timeout: 180_000,
    // TRUSTED_PROXY_COUNT=1: the suite plays the reverse proxy, so a test can
    // stand for several clients by setting X-Forwarded-For (the rightmost
    // entry is the one a proxy would append).
    env: { DATABASE_URL: databaseUrl, EMAIL_MODE: "test", EMAIL_TEST_SINK: E2E_MAIL_SINK, TRUSTED_PROXY_COUNT: "1", NEXT_DIST_DIR: ".next-e2e", BETTER_AUTH_URL: baseURL, BETTER_AUTH_SECRET: "e2e-only-auth-secret-at-least-32-characters", BOOKING_VERIFY_SECRET: "e2e-only-booking-secret-at-least-32-characters", PASS_SECRET: "e2e-only-pass-secret-at-least-32-characters", CRON_SECRET: "e2e-only-cron-secret" },
  },
});
