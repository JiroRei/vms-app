/**
 * Pre-registration: producing a reference, spending it exactly once, and
 * cancelling one that has not been spent.
 *
 * The single-use rule is the load-bearing one. Two people submitting the same
 * reference at the same moment is exactly what happens when a visitor taps
 * twice on a slow kiosk, and one appointment producing two visits would put a
 * phantom person in the building.
 */
import assert from "node:assert/strict";
import { after, beforeEach, describe, test } from "node:test";

import {
  cancelAppointment,
  createAppointment,
  listAppointments,
  lookupAppointment,
  redeemAppointment,
} from "@/lib/appointments";
import { prisma } from "@/lib/prisma";

import { makeAppointment, makeHost, resetDatabase } from "./helpers";

beforeEach(resetDatabase);
after(async () => {
  await prisma.$disconnect();
});

describe("creating", () => {
  test("generates a reference that is neither sequential nor ambiguous", async () => {
    const host = await makeHost();

    const references = new Set<string>();

    for (let i = 0; i < 25; i += 1) {
      const result = await createAppointment({
        visitorName: `Visitor ${i}`,
        purpose: "Testing",
        hostId: host.id,
        scheduledFor: null,
      });

      assert.equal(result.status, "created");
      if (result.status !== "created") return;

      const reference = result.appointment.referenceNumber;

      assert.match(
        reference,
        /^APT-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/,
        "O/0 and I/1/L are excluded so a visitor can read it aloud",
      );
      references.add(reference);
    }

    assert.equal(references.size, 25, "references must not collide or count up");
  });

  test("an unknown host is refused before it reaches the database", async () => {
    const result = await createAppointment({
      visitorName: "Nobody",
      purpose: "Testing",
      hostId: "no-such-host",
      scheduledFor: null,
    });

    assert.equal(result.status, "unknown-host");
    assert.equal(await prisma.appointment.count(), 0);
  });

  test("keeps the scheduled time when one is given", async () => {
    const host = await makeHost();
    const when = new Date("2026-10-01T09:30:00.000Z");

    const result = await createAppointment({
      visitorName: "Punctual Person",
      purpose: "Testing",
      hostId: host.id,
      scheduledFor: when,
    });

    assert.equal(result.status, "created");
    if (result.status !== "created") return;
    assert.equal(result.appointment.scheduledFor, when.toISOString());
  });
});

describe("looking up", () => {
  test("is case-insensitive and tolerates surrounding space", async () => {
    const host = await makeHost();
    await makeAppointment(host.id, { referenceNumber: "APT-ABC123" });

    const result = await lookupAppointment("  apt-abc123  ");

    assert.equal(result.status, "found");
  });

  test("a spent reference reads as used, not as missing", async () => {
    const host = await makeHost();
    await makeAppointment(host.id, { used: true });

    assert.equal((await lookupAppointment("APT-TEST01")).status, "already-used");
    assert.equal((await lookupAppointment("APT-NOPE99")).status, "not-found");
  });
});

describe("redeeming", () => {
  test("marks it used and opens a visit", async () => {
    const host = await makeHost();
    await makeAppointment(host.id);

    const result = await redeemAppointment("APT-TEST01");

    assert.equal(result.status, "checked-in");
    assert.equal(await prisma.visit.count(), 1);

    const appointment = await prisma.appointment.findUniqueOrThrow({
      where: { referenceNumber: "APT-TEST01" },
    });
    assert.equal(appointment.used, true);
  });

  test("two simultaneous redemptions produce exactly one visit", async () => {
    const host = await makeHost();
    await makeAppointment(host.id);

    const [a, b] = await Promise.all([
      redeemAppointment("APT-TEST01"),
      redeemAppointment("APT-TEST01"),
    ]);

    const statuses = [a.status, b.status].sort();

    assert.deepEqual(statuses, ["already-used", "checked-in"]);
    assert.equal(
      await prisma.visit.count(),
      1,
      "one reference must never put two people in the building",
    );
  });
});

describe("cancelling", () => {
  test("removes an unspent appointment", async () => {
    const host = await makeHost();
    await makeAppointment(host.id);

    assert.equal(await cancelAppointment("APT-TEST01"), "cancelled");
    assert.equal(await prisma.appointment.count(), 0);
  });

  test("refuses one that has been redeemed, and keeps the row", async () => {
    const host = await makeHost();
    await makeAppointment(host.id);
    await redeemAppointment("APT-TEST01");

    assert.equal(await cancelAppointment("APT-TEST01"), "already-used");
    assert.equal(
      await prisma.appointment.count(),
      1,
      "it produced a visit; deleting it would leave that visit unexplained",
    );
  });

  test("cancelling twice reports not-found rather than throwing", async () => {
    const host = await makeHost();
    await makeAppointment(host.id);

    await cancelAppointment("APT-TEST01");
    assert.equal(await cancelAppointment("APT-TEST01"), "not-found");
  });
});

describe("the staff list", () => {
  test("puts unspent first, then by when they are expected", async () => {
    const host = await makeHost();

    await prisma.appointment.createMany({
      data: [
        {
          referenceNumber: "APT-LATER0",
          visitorName: "Later",
          purpose: "x",
          hostId: host.id,
          scheduledFor: new Date("2026-10-02T10:00:00Z"),
        },
        {
          referenceNumber: "APT-SOON00",
          visitorName: "Soon",
          purpose: "x",
          hostId: host.id,
          scheduledFor: new Date("2026-10-01T10:00:00Z"),
        },
        {
          referenceNumber: "APT-NOTIME",
          visitorName: "Unscheduled",
          purpose: "x",
          hostId: host.id,
          scheduledFor: null,
        },
        {
          referenceNumber: "APT-DONE00",
          visitorName: "Gone",
          purpose: "x",
          hostId: host.id,
          used: true,
        },
      ],
    });

    const all = await listAppointments({ includeUsed: true });

    assert.deepEqual(
      all.map((a) => a.visitorName),
      ["Soon", "Later", "Unscheduled", "Gone"],
      "unscheduled is not 'earliest' — it sorts after everything with a time",
    );

    const waiting = await listAppointments({ includeUsed: false });
    assert.equal(waiting.length, 3);
  });
});
