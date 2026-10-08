/**
 * Runs before any test module is loaded (`node --import ./tests/setup.ts`), so
 * `src/lib/prisma.ts` — which reads `DATABASE_URL` at import time — sees the
 * test database rather than the development one.
 *
 * The URL is derived from `DATABASE_URL` rather than configured separately:
 * one connection string to keep correct, and no way for a stale `.env.test` to
 * quietly point the suite at data someone cares about. Tests truncate every
 * table between cases, so being sure of that is the whole point.
 */
import "dotenv/config";

/** Tests refuse to run against a database whose name does not end in this. */
const REQUIRED_SUFFIX = "_test";

function toTestDatabaseUrl(raw: string | undefined): string {
  if (!raw) {
    throw new Error(
      "DATABASE_URL is not set, so the test database name cannot be derived from it.",
    );
  }

  const url = new URL(raw);
  // `pathname` is "/vms"; the database name is what follows the slash.
  const name = url.pathname.replace(/^\//, "");

  if (!name) {
    throw new Error(`DATABASE_URL has no database name: ${url.pathname}`);
  }

  url.pathname = `/${name.endsWith(REQUIRED_SUFFIX) ? name : name + REQUIRED_SUFFIX}`;

  return url.toString();
}

const testUrl = toTestDatabaseUrl(process.env.DATABASE_URL);

// Belt and braces. `toTestDatabaseUrl` already guarantees this, but the cost of
// being wrong is somebody's development data, so it is checked again from the
// value that will actually be used.
if (!new URL(testUrl).pathname.endsWith(REQUIRED_SUFFIX)) {
  throw new Error(
    `Refusing to run: the test database name must end in "${REQUIRED_SUFFIX}".`,
  );
}

process.env.DATABASE_URL = testUrl;
