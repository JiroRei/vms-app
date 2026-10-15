import "dotenv/config";
import { spawn } from "node:child_process";
import { mkdir, readdir, stat, unlink, rename } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { createGzip } from "node:zlib";
import { pipeline } from "node:stream/promises";
import { resolve, join } from "node:path";
import { pgEnvironment, requireTools } from "./postgres-tools";

async function main() {
  if (!requireTools(["pg_dump"])) return;
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required.");
  const directory = resolve("backups");
  await mkdir(directory, { recursive: true });
  const filename = join(directory, `vms-${new Date().toISOString().replace(/[:.]/g, "-")}.dump.gz`);
  const temporary = `${filename}.partial`;
  const child = spawn("pg_dump", ["--format=custom", "--no-owner", "--no-acl"], { env: pgEnvironment(process.env.DATABASE_URL), stdio: ["ignore", "pipe", "ignore"] });
  const completed = new Promise<void>((done, fail) => { child.on("error", fail); child.on("close", (code) => code === 0 ? done() : fail(new Error("pg_dump failed; no backup retained."))); });
  try { await Promise.all([pipeline(child.stdout!, createGzip(), createWriteStream(temporary, { flags: "wx" })), completed]); await rename(temporary, filename); }
  catch (error) { await unlink(temporary).catch(() => {}); throw error; }
  const files = await Promise.all((await readdir(directory)).filter(name => /^vms-[\dTZ-]+\.dump\.gz$/.test(name)).map(async name => ({ path: join(directory, name), time: (await stat(join(directory, name))).mtimeMs })));
  files.sort((a, b) => b.time - a.time);
  for (const file of files.slice(14)) await unlink(file.path);
  console.log(`Backup written: ${filename}. Retained latest 14 dumps.`);
}
main().catch(() => { console.error("Backup failed. Check PostgreSQL client tools, database access and disk space."); process.exitCode = 1; });
