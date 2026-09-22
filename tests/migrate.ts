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

import "./setup";

const result = spawnSync("npx", ["prisma", "migrate", "deploy"], {
  stdio: "inherit",
  shell: true,
  env: process.env,
});

process.exit(result.status ?? 1);
