import { spawnSync } from "node:child_process";
export function requireTools(names: string[]): boolean {
  for (const name of names) {
    const result = spawnSync(name, ["--version"], { encoding: "utf8" });
    if (result.error || result.status !== 0) {
      console.log(`Skipped: ${name} is not installed or not on PATH. Install PostgreSQL client tools before running this command.`);
      return false;
    }
  }
  return true;
}
/** Keep passwords out of command lines and remove Prisma-only URL parameters. */
export function pgEnvironment(raw: string): NodeJS.ProcessEnv {
  const url = new URL(raw);
  return { ...process.env, PGHOST: url.hostname, PGPORT: url.port || "5432", PGDATABASE: decodeURIComponent(url.pathname.slice(1)), PGUSER: decodeURIComponent(url.username), PGPASSWORD: decodeURIComponent(url.password), ...(url.searchParams.get("sslmode") ? { PGSSLMODE: url.searchParams.get("sslmode")! } : {}) };
}
