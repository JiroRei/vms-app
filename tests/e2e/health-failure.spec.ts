import { test, expect } from "@playwright/test";
import { spawn, spawnSync } from "node:child_process";
import { resolve } from "node:path";

test("health returns a safe 503 when its database connection fails", async () => {
  test.setTimeout(90_000);
  const child = spawn(process.execPath, [resolve("node_modules/next/dist/bin/next"), "start", "--port", "3110", "--hostname", "127.0.0.1"], {
    stdio: "ignore", windowsHide: true,
    env: { ...process.env, NEXT_DIST_DIR: ".next-e2e", DATABASE_URL: "postgresql://invalid:invalid@127.0.0.1:1/unavailable?schema=e2e", EMAIL_MODE: "test", BETTER_AUTH_SECRET: "fault-test-only-auth-secret-at-least-32-characters", BETTER_AUTH_URL: "http://127.0.0.1:3110", ERROR_WEBHOOK_URL: "" },
  });
  let startupError: Error | undefined;
  child.on("error", error => { startupError = error; });
  try {
    await expect.poll(async () => {
      if (startupError) throw startupError;
      if (child.exitCode !== null) throw new Error("Fault-test server exited before the health check.");
      try {
        const response = await fetch("http://127.0.0.1:3110/api/health", { signal: AbortSignal.timeout(10_000) });
        if (response.status !== 503) return response.status;
        const body = await response.json();
        expect(Object.keys(body).sort()).toEqual(["db", "status", "time"]);
        expect(body).toMatchObject({ status: "unavailable", db: "unavailable" });
        expect(JSON.stringify(body)).not.toMatch(/password|invalid|stack|postgresql/i);
        return response.status;
      } catch (error) {
        if (error instanceof Error && (error.name === "TypeError" || error.name === "TimeoutError")) return 0;
        throw error;
      }
    }, { timeout: 60_000, intervals: [500, 1000, 2000] }).toBe(503);
  } finally {
    if (child.pid && process.platform === "win32") spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
    else child.kill("SIGTERM");
  }
});
