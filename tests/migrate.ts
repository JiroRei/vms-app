/**
 * Brings the test database up to date, then hands back.
 *
 * Exists because `prisma migrate deploy` reads `DATABASE_URL` from the
 * environment, and setting an environment variable inline is not portable
 * between the shells this project is run from. Importing `setup.ts` first
 * rewrites the variable to the test database using the same derivation the
 * suite uses, so the two can never disagree about which database is which.
 */
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

import "./setup";

const result = spawnSync(process.execPath, [
  resolve("node_modules/prisma/build/index.js"),
  "migrate", "deploy", "--config", "prisma7.config.ts",
], {
  stdio: "inherit",
  cwd: process.cwd(),
  env: process.env,
});

if (result.error) console.error(result.error.message);

process.exit(result.status ?? 1);
