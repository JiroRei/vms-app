import "dotenv/config";
import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import { resolve } from "node:path";
import { isolatedTestUrl } from "../tests/test-database";
import { E2E_MAIL_SINK } from "../tests/e2e-mail";

const testUrl = isolatedTestUrl(process.env.DATABASE_URL, process.env.DATABASE_URL_TEST);
process.env.DATABASE_URL_TEST = testUrl;
process.env.EMAIL_MODE = "test";
process.env.E2E_BASE_URL = "http://127.0.0.1:3100";
process.env.BETTER_AUTH_URL = process.env.E2E_BASE_URL;
process.env.BETTER_AUTH_SECRET = "e2e-only-auth-secret-at-least-32-characters";
process.env.CRON_SECRET = "e2e-only-cron-secret";
process.env.BOOKING_VERIFY_SECRET = "e2e-only-booking-secret-at-least-32-characters";
process.env.PASS_SECRET = "e2e-only-pass-secret-at-least-32-characters";
process.env.NEXT_DIST_DIR = ".next-e2e";
rmSync(E2E_MAIL_SINK, { force: true });
let exitCode = 0;
try {
  for (const args of [
    ["--import", "tsx", "tests/migrate.ts"],
    [resolve("node_modules/next/dist/bin/next"), "build"],
    ["--import", "tsx", "--conditions=react-server", "prisma/seed-e2e.ts"],
    [resolve("node_modules/@playwright/test/cli.js"), "test", ...process.argv.slice(2)],
  ]) {
    const result = spawnSync(process.execPath, args, { stdio: "inherit", env: args.includes("build") ? { ...process.env, DATABASE_URL: testUrl } : process.env });
    if (result.status !== 0) { exitCode = result.status ?? 1; break; }
  }

} finally {
  const cleanup = spawnSync(process.execPath, ["--import", "tsx", "--conditions=react-server", "tests/cleanup.ts"], { stdio: "inherit", env: process.env });
  if (cleanup.status !== 0) exitCode = cleanup.status ?? 1;
  rmSync(E2E_MAIL_SINK, { force: true });
}
process.exitCode = exitCode;
