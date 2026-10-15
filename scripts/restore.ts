import "dotenv/config";
import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { createGunzip } from "node:zlib";
import { pipeline } from "node:stream/promises";
import { pgEnvironment, requireTools } from "./postgres-tools";

async function main() {
  if (!requireTools(["pg_restore"])) return;
  const [filename] = process.argv.slice(2);
  const target = process.env.DATABASE_URL_RESTORE;
  if (!filename || !target) throw new Error("Usage: set DATABASE_URL_RESTORE to a new empty database, then run bun run db:restore -- backups/file.dump.gz");
  const targetUrl = new URL(target), devUrl = new URL(process.env.DATABASE_URL ?? target);
  if (targetUrl.hostname === devUrl.hostname && (targetUrl.port || "5432") === (devUrl.port || "5432") && targetUrl.pathname === devUrl.pathname) throw new Error("Restore target must be a different, empty database.");
  const child = spawn("pg_restore", ["--dbname", decodeURIComponent(targetUrl.pathname.slice(1)), "--no-owner", "--no-acl", "--exit-on-error", "--single-transaction"], { env: pgEnvironment(target), stdio: ["pipe", "ignore", "ignore"] });
  const completed = new Promise<void>((done, fail) => { child.on("error", fail); child.on("close", code => code === 0 ? done() : fail(new Error("Restore failed; transaction rolled back."))); });
  await Promise.all([pipeline(createReadStream(filename), createGunzip(), child.stdin!), completed]);
  console.log("Backup restored to the specified separate database.");
}
main().catch(error => { console.error(error instanceof Error ? error.message : "Restore failed."); process.exitCode = 1; });
