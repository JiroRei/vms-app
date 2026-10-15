import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { Pool } from "pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { databaseAdapter, databaseConfig } from "../src/lib/database-config";

const developmentUrl = process.env.DATABASE_URL!;
const schema = `seed_scratch_${randomUUID().replaceAll("-", "")}`;
const scratchUrl = new URL(developmentUrl);
scratchUrl.searchParams.set("schema", schema);
const pool = new Pool({ connectionString: developmentUrl });
const dev = new PrismaClient({ adapter: databaseAdapter(developmentUrl) });
const scratch = new PrismaClient({ adapter: databaseAdapter(scratchUrl.toString()) });

async function snapshot(db: PrismaClient) {
  return JSON.stringify({
    users: await db.user.findMany({ orderBy: { id: "asc" }, include: { accounts: { orderBy: { id: "asc" } } } }),
    hosts: await db.host.findMany({ orderBy: { id: "asc" } }),
    purposes: await db.purposeOption.findMany({ orderBy: { id: "asc" } }),
    appointments: await db.appointment.findMany({ orderBy: { id: "asc" } }),
  });
}
function run(args: string[], expected = 0) {
  const result = spawnSync(process.execPath, args, { env: { ...process.env, DATABASE_URL: scratchUrl.toString() }, encoding: "utf8" });
  assert.equal(result.status, expected, `Command failed: ${result.stdout}\n${result.stderr}`);
  return result.stdout + result.stderr;
}

async function main() {
try {
  const before = await snapshot(dev);
  await pool.query(`CREATE SCHEMA "${schema}"`);
  run(["node_modules/prisma/build/index.js", "migrate", "deploy", "--config", "prisma7.config.ts"]);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`SET LOCAL search_path TO "${schema}"`);
    await client.query("SET LOCAL TIME ZONE 'America/Los_Angeles'");
    // Replay just the new migration with legacy devices near the 24-hour edge.
    await client.query('ALTER TABLE "kiosk_device" DROP COLUMN "registrationStatus"');
    await client.query('DROP TYPE "KioskRegistrationStatus"');
    await client.query(`INSERT INTO "kiosk_device" (id, "deviceId", "lastSeenAt", "retiredAt") VALUES
      ('recent', 'recent', (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') - INTERVAL '23 hours', NULL),
      ('old', 'old', (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') - INTERVAL '25 hours', NULL),
      ('retired', 'retired', (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') - INTERVAL '23 hours', (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') - INTERVAL '2 hours')`);
    await client.query(readFileSync("prisma/migrations/20261015100000_kiosk_approval/migration.sql", "utf8"));
    const devices = await client.query('SELECT id, "registrationStatus"::text AS status FROM "kiosk_device" ORDER BY id');
    assert.deepEqual(devices.rows, [{ id: "old", status: "RETIRED" }, { id: "recent", status: "APPROVED" }, { id: "retired", status: "RETIRED" }]);
    const retirement = await client.query(`SELECT abs(extract(epoch FROM ("retiredAt" - (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')))) < 1 AS correct FROM "kiosk_device" WHERE id='old'`);
    assert.equal(retirement.rows[0].correct, true);
    await client.query("COMMIT");
    console.log("Kiosk migration verified at the 24-hour boundary with a non-UTC database session.");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
  const output = run(["node_modules/prisma/build/index.js", "db", "seed", "--config", "prisma7.config.ts"]);
  assert.ok(output.includes(`schema=${schema}`));
  assert.ok(output.includes(`database=${databaseConfig(developmentUrl).database}`));
  assert.equal(await scratch.user.count(), 2);
  assert.equal(await scratch.host.count(), 3);
  assert.equal(await scratch.appointment.count(), 6);
  const admin = await scratch.user.findUniqueOrThrow({ where: { email: "admin@geoplan.ph" } });
  await scratch.user.update({ where: { id: admin.id }, data: { name: "Operator changed this", emailVerified: false } });
  await scratch.account.updateMany({ where: { userId: admin.id }, data: { password: "operator-changed-password-hash" } });
  await scratch.host.updateMany({ data: { department: "Changed department", active: false } });
  await scratch.purposeOption.updateMany({ data: { isActive: false, sortOrder: 999 } });
  await scratch.appointment.updateMany({ data: { status: "CANCELLED" } });
  const modified = await snapshot(scratch);
  const refused = run(["--import", "tsx", "prisma/seed.ts"], 1);
  assert.ok(refused.includes("Refusing to seed"));
  assert.equal(await snapshot(scratch), modified, "Refused seed must not write anything");
  run(["node_modules/prisma/build/index.js", "db", "seed", "--config", "prisma7.config.ts", "--", "--force"]);
  assert.equal(await snapshot(scratch), modified, "Forced seed must preserve all existing data and credentials");
  // A missing default can be restored without touching the others.
  await scratch.appointment.delete({ where: { referenceNumber: "APT-1006" } });
  run(["--import", "tsx", "prisma/seed.ts", "--force"]);
  assert.equal(await scratch.appointment.count(), 6);
  assert.equal(await snapshot(dev), before, "Scratch seed must not change development data");
  console.log("Seed verified: scratch schema honored, repeat refused, --force preserves operator data/passwords and creates only missing records; development unchanged.");
} finally {
  await scratch.$disconnect();
  await dev.$disconnect();
  await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  await pool.end();
  console.log(`Dropped scratch schema ${schema}.`);
}

}
main().catch((error) => { console.error(error); process.exitCode = 1; });
