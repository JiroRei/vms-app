/**
 * The visit lifecycle — the part of this system that must not drift.
 *
 * A visit moves ACTIVE → PENDING_RETURN → ACTIVE → CHECKED_OUT, and the rule
 * that makes it trustworthy is that a step-out does not open a second row. The
 * concurrency cases matter as much as the happy path: two guards on two phones
 * pressing the same button is ordinary, and the preconditions in each
 * `updateMany` WHERE clause are what stop the second one overwriting a real
 * timestamp.
 */
import assert from "node:assert/strict";
import { after, beforeEach, describe, test } from "node:test";

import { prisma } from "@/lib/prisma";
import {
  checkOutVisit,
  createDeliveryVisit,
  createWalkInVisit,
  getActiveVisits,
  getHosts,
  markVisitReturned,
  markVisitReturning,
} from "@/lib/visits";

import { makeHost, makeVisit, readVisit, resetDatabase } from "./helpers";

beforeEach(resetDatabase);
after(async () => {
  await prisma.$disconnect();
});

describe("check-in", () => {
  test("a walk-in creates a visitor and one open visit", async () => {
    const host = await makeHost();

    const { visitId } = await createWalkInVisit({
      name: "Marcus Delgado",
      purpose: "Vendor review",
      hostId: host.id,
    });

    const visit = await readVisit(visitId);

    assert.equal(visit.status, "ACTIVE");
    assert.equal(visit.checkOutTime, null);
    assert.equal(visit.exitTime, null);
  });

  test("a delivery is logged without a host", async () => {
    const { visitorId } = await createDeliveryVisit({
      name: "Courier Co.",
      hostId: null,
    });

    const visitor = await prisma.visitor.findUniqueOrThrow({
      where: { id: visitorId },
    });

    assert.equal(visitor.type, "DELIVERY");
    assert.equal(visitor.hostId, null);
    // The tables render this label, so it is part of the contract.
    assert.equal(visitor.purpose, "Delivery");
  });
});

describe("step out and return", () => {
  test("a round trip stays one visit with its original check-in", async () => {
    const host = await makeHost();
    const { visit } = await makeVisit(host.id);
    const originalCheckIn = visit.checkInTime.getTime();

    await markVisitReturning(visit.id);
    const out = await readVisit(visit.id);

    assert.equal(out.status, "PENDING_RETURN");
    assert.notEqual(out.exitTime, null);
    assert.equal(out.checkOutTime, null, "a step-out must not close the visit");

    await markVisitReturned(visit.id);
    const back = await readVisit(visit.id);

    assert.equal(back.status, "ACTIVE");
    assert.equal(back.exitTime, null, "returning clears the exit");
    assert.equal(
      back.checkInTime.getTime(),
      originalCheckIn,
      "the visit keeps the time they first arrived",
    );

    // The whole point: one row, so history shows one visit, not three.
    assert.equal(await prisma.visit.count(), 1);
  });

  test("stepping out twice reports the conflict instead of moving the exit", async () => {
    const host = await makeHost();
    const { visit } = await makeVisit(host.id);

    await markVisitReturning(visit.id);
    const firstExit = (await readVisit(visit.id)).exitTime;

    const second = await markVisitReturning(visit.id);

    assert.equal(second.result, "already-stepped-out");
    assert.deepEqual(
      (await readVisit(visit.id)).exitTime,
      firstExit,
      "the second attempt must not overwrite the recorded exit time",
    );
  });

  test("returning someone who never left is a conflict", async () => {
    const host = await makeHost();
    const { visit } = await makeVisit(host.id);

    assert.equal((await markVisitReturned(visit.id)).result, "already-active");
  });
});

describe("check-out", () => {
  test("closes an active visit", async () => {
    const host = await makeHost();
    const { visit } = await makeVisit(host.id);

    const { result } = await checkOutVisit(visit.id);
    const closed = await readVisit(visit.id);

    assert.equal(result, "checked-out");
    assert.equal(closed.status, "CHECKED_OUT");
    assert.notEqual(closed.checkOutTime, null);
  });

  test("closes a stepped-out visit and keeps the exit time as a record", async () => {
    const host = await makeHost();
    const { visit } = await makeVisit(host.id);

    await markVisitReturning(visit.id);
    const exitTime = (await readVisit(visit.id)).exitTime;

    await checkOutVisit(visit.id);
    const closed = await readVisit(visit.id);

    assert.equal(closed.status, "CHECKED_OUT");
    assert.deepEqual(
      closed.exitTime,
      exitTime,
      "exitTime records when they actually left and survives check-out",
    );
  });

  test("a second check-out conflicts rather than restamping the time", async () => {
    const host = await makeHost();
    const { visit } = await makeVisit(host.id);

    await checkOutVisit(visit.id);
    const firstTime = (await readVisit(visit.id)).checkOutTime;

    const second = await checkOutVisit(visit.id);

    assert.equal(second.result, "already-checked-out");
    assert.deepEqual((await readVisit(visit.id)).checkOutTime, firstTime);
  });

  test("two concurrent check-outs produce exactly one winner", async () => {
    const host = await makeHost();
    const { visit } = await makeVisit(host.id);

    const [a, b] = await Promise.all([
      checkOutVisit(visit.id),
      checkOutVisit(visit.id),
    ]);

    const results = [a.result, b.result].sort();
    assert.deepEqual(results, ["already-checked-out", "checked-out"]);
  });

  test("an unknown id is not-found, not a crash", async () => {
    assert.equal((await checkOutVisit("does-not-exist")).result, "not-found");
    assert.equal(
      (await markVisitReturning("does-not-exist")).result,
      "not-found",
    );
    assert.equal((await markVisitReturned("does-not-exist")).result, "not-found");
  });
});

describe("the live list", () => {
  test("shows both open states and hides closed ones", async () => {
    const host = await makeHost();
    const { visit: active } = await makeVisit(host.id, { name: "Still Here" });
    const { visit: out } = await makeVisit(host.id, { name: "Stepped Out" });
    const { visit: gone } = await makeVisit(host.id, { name: "Left" });

    await markVisitReturning(out.id);
    await checkOutVisit(gone.id);

    const live = await getActiveVisits();
    const ids = live.map((v) => v.id).sort();

    assert.deepEqual(ids, [active.id, out.id].sort());
    assert.equal(
      live.find((v) => v.id === out.id)?.status,
      "PENDING_RETURN",
      "a stepped-out visitor stays on the list, badged",
    );
  });

  test("status is the authority on open, not a null check-out", async () => {
    const host = await makeHost();
    const { visit } = await makeVisit(host.id);
    await markVisitReturning(visit.id);

    const row = await readVisit(visit.id);

    // Both open states share a null checkOutTime. If anything ever filters on
    // that instead of on status, this is the case that catches it.
    assert.equal(row.checkOutTime, null);
    assert.equal(row.status, "PENDING_RETURN");
    assert.equal((await getActiveVisits()).length, 1);
  });
});

describe("host options", () => {
  test("the kiosk is offered active hosts only", async () => {
    const live = await makeHost({ name: "Current", active: true });
    await makeHost({ name: "Departed", active: false });

    const options = await getHosts();

    assert.deepEqual(
      options.map((h) => h.id),
      [live.id],
      "someone who has left must not be selectable at the door",
    );
  });
});

describe("check-out attribution", () => {
  test("records who closed the visit, by id and by name", async () => {
    const host = await makeHost();
    const { visit } = await makeVisit(host.id);

    const user = await prisma.user.create({
      data: {
        email: "rosa@geoplan.ph",
        name: "Rosa Santos",
        role: "GUARD",
        emailVerified: true,
      },
    });

    await checkOutVisit(visit.id, { id: user.id, name: user.name });
    const closed = await readVisit(visit.id);

    assert.equal(closed.checkedOutById, user.id);
    assert.equal(closed.checkedOutByName, "Rosa Santos");
  });

  test("the name outlives the account that was removed", async () => {
    const host = await makeHost();
    const { visit } = await makeVisit(host.id);

    const user = await prisma.user.create({
      data: {
        email: "leaver@geoplan.ph",
        name: "Someone Who Left",
        role: "GUARD",
        emailVerified: true,
      },
    });

    await checkOutVisit(visit.id, { id: user.id, name: user.name });
    await prisma.user.delete({ where: { id: user.id } });

    const closed = await readVisit(visit.id);

    assert.equal(closed.checkedOutById, null, "the live link is released");
    assert.equal(
      closed.checkedOutByName,
      "Someone Who Left",
      "an audit line that evaporates when someone leaves is not an audit line",
    );
    // And the visit itself is untouched.
    assert.equal(closed.status, "CHECKED_OUT");
  });

  test("an unattributed check-out leaves both columns null", async () => {
    const host = await makeHost();
    const { visit } = await makeVisit(host.id);

    await checkOutVisit(visit.id);
    const closed = await readVisit(visit.id);

    assert.equal(closed.checkedOutById, null);
    assert.equal(
      closed.checkedOutByName,
      null,
      "the overnight cleanup is nobody, and saying so is the honest record",
    );
  });
});

describe("host deletion is refused, not cascaded", () => {
  test("a host with visitors cannot be deleted", async () => {
    const host = await makeHost();
    await makeVisit(host.id);

    await assert.rejects(
      () => prisma.host.delete({ where: { id: host.id } }),
      "deleting a host used to cascade away every visit they ever hosted",
    );

    assert.equal(await prisma.visit.count(), 1);
    assert.equal(await prisma.host.count(), 1);
  });

  test("a host with an appointment cannot be deleted either", async () => {
    const host = await makeHost();
    await prisma.appointment.create({
      data: {
        referenceNumber: "APT-GUARD1",
        visitorName: "Expected",
        purpose: "x",
        hostId: host.id,
      },
    });

    await assert.rejects(() => prisma.host.delete({ where: { id: host.id } }));
  });

  test("an unused host can still be removed", async () => {
    const host = await makeHost();

    await prisma.host.delete({ where: { id: host.id } });

    assert.equal(await prisma.host.count(), 0);
  });
});
