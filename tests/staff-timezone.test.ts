import assert from "node:assert/strict";
import { test } from "node:test";
import { parseStaffSchedule, toDateTimeLocalInZone } from "@/lib/booking-config";
import { getHistoryQuery } from "@/lib/history";
import { assertTestDatabase } from "./test-database";

test("staff wall-clock schedules are converted in the site zone and reject invalid values", () => {
  assert.equal(parseStaffSchedule("2026-10-16T10:00")?.toISOString(), "2026-10-16T02:00:00.000Z");
  assert.equal(toDateTimeLocalInZone(parseStaffSchedule("2026-10-16T10:00")!), "2026-10-16T10:00");
  for (const value of ["2026-02-31T10:00", "2026-10-16T24:00", "2026-10-16T10:00Z", "2026-10-16T10:00:00", ""]) assert.equal(parseStaffSchedule(value), null);
});

test("history date filters use site midnight and next midnight", () => {
  const { where } = getHistoryQuery({ from: "2026-10-16", to: "2026-10-16" });
  assert.deepEqual(where.checkInTime, { gte: new Date("2026-10-15T16:00:00Z"), lt: new Date("2026-10-16T16:00:00Z") });
});

test("cleanup rejects a Prisma client captured against development", () => {
  assert.throws(() => assertTestDatabase(process.env.VMS_DEVELOPMENT_DATABASE_URL));
});
