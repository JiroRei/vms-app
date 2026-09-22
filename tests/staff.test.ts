/**
 * Staff accounts, and the guards that stop the building being locked.
 *
 * The credential round trip is checked against Better Auth's own verifier
 * rather than against the hash string: what matters is not that a hash was
 * written, but that the thing which reads it at sign-in accepts the password
 * that was set.
 */
import assert from "node:assert/strict";
import { after, beforeEach, describe, test } from "node:test";

import { verifyPassword } from "better-auth/crypto";

import { Role } from "@/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import {
  countAdmins,
  createStaff,
  deleteStaff,
  listStaff,
  setStaffRole,
} from "@/lib/staff";

import { resetDatabase } from "./helpers";

beforeEach(resetDatabase);
after(async () => {
  await prisma.$disconnect();
});

async function makeStaff(email: string, role: Role = Role.GUARD) {
  const result = await createStaff({
    email,
    name: email.split("@")[0],
    role,
    password: "correct-horse",
  });

  assert.equal(result.status, "created");
  if (result.status !== "created") throw new Error("unreachable");

  return result.staff;
}

describe("creating an account", () => {
  test("writes a credential Better Auth will actually accept", async () => {
    const staff = await makeStaff("rosa@geoplan.ph");

    const account = await prisma.account.findFirstOrThrow({
      where: { userId: staff.id, providerId: "credential" },
    });

    // Sign-in matches on both of these; either one wrong reads to the user as
    // a correct password being rejected.
    assert.equal(account.providerId, "credential");
    assert.equal(account.accountId, staff.id);

    assert.equal(
      await verifyPassword({
        hash: account.password ?? "",
        password: "correct-horse",
      }),
      true,
    );
    assert.equal(
      await verifyPassword({
        hash: account.password ?? "",
        password: "wrong-horse",
      }),
      false,
    );
  });

  test("normalises the email and refuses a duplicate", async () => {
    await makeStaff("Rosa@Geoplan.PH");

    const again = await createStaff({
      email: "rosa@geoplan.ph",
      name: "Impostor",
      role: Role.ADMIN,
      password: "another-password",
    });

    assert.equal(again.status, "email-taken");
    assert.equal(await prisma.user.count(), 1);
  });

  test("a user is never left without a credential", async () => {
    await makeStaff("someone@geoplan.ph");

    const staff = await listStaff();
    assert.equal(staff.length, 1);
    assert.equal(
      staff[0].canSignIn,
      true,
      "a user row with no account presents as a correct password failing",
    );
  });
});

describe("the last administrator", () => {
  test("cannot be demoted", async () => {
    const admin = await makeStaff("admin@geoplan.ph", Role.ADMIN);
    await makeStaff("guard@geoplan.ph", Role.GUARD);

    const result = await setStaffRole(admin.id, Role.GUARD);

    assert.equal(result.status, "last-admin");
    assert.equal(await countAdmins(), 1);
  });

  test("cannot be deleted", async () => {
    const admin = await makeStaff("admin@geoplan.ph", Role.ADMIN);

    assert.equal(await deleteStaff(admin.id), "last-admin");
    assert.equal(await prisma.user.count(), 1);
  });

  test("can be demoted once someone else is promoted", async () => {
    const admin = await makeStaff("admin@geoplan.ph", Role.ADMIN);
    const guard = await makeStaff("guard@geoplan.ph", Role.GUARD);

    assert.equal((await setStaffRole(guard.id, Role.ADMIN)).status, "updated");
    assert.equal((await setStaffRole(admin.id, Role.GUARD)).status, "updated");
    assert.equal(await countAdmins(), 1);
  });
});

describe("removing an account", () => {
  test("takes its sessions and credential with it, and nothing else", async () => {
    await makeStaff("admin@geoplan.ph", Role.ADMIN);
    const guard = await makeStaff("guard@geoplan.ph", Role.GUARD);

    await prisma.session.create({
      data: {
        id: "test-session",
        token: "test-token",
        userId: guard.id,
        expiresAt: new Date(Date.now() + 60_000),
      },
    });

    assert.equal(await deleteStaff(guard.id), "deleted");

    assert.equal(await prisma.session.count({ where: { userId: guard.id } }), 0);
    assert.equal(await prisma.account.count({ where: { userId: guard.id } }), 0);
    assert.equal(await prisma.user.count(), 1);
  });

  test("an unknown id is not-found", async () => {
    assert.equal(await deleteStaff("no-such-user"), "not-found");
    assert.equal((await setStaffRole("no-such-user", Role.ADMIN)).status, "not-found");
  });
});
