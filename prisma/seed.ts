import "dotenv/config";

import { randomUUID } from "node:crypto";

import { PrismaPg } from "@prisma/adapter-pg";
// The same scrypt hasher Better Auth verifies against at sign-in, imported
// directly so the seed does not have to stand up an auth instance (which pulls
// in `server-only` and a Next.js request context that a script has neither of).
import { hashPassword } from "better-auth/crypto";

import { PrismaClient } from "../src/generated/prisma/client";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const hosts = [
  { name: "Jeffrey E.", department: "Human Resources" },
  { name: "Benjamin N.", department: "Facilities & Security" },
  { name: "Charlie K.", department: "Sales" },
];

/**
 * Sample pre-registered visits for testing the kiosk appointment lookup.
 * `hostName` is resolved to a real `hostId` below.
 *
 * APT-1004 is seeded as already redeemed so the "already used" error path can
 * be exercised without having to check in first.
 *
 * These four are deliberately fixed and sequential so they can be written down
 * in the README and typed from memory. Appointments created through the
 * dashboard are **not** — `createAppointment` generates a random reference, so
 * the live ones cannot be walked the way these can.
 */
const appointments = [
  {
    referenceNumber: "APT-1001",
    visitorName: "Marcus Delgado",
    purpose: "Quarterly vendor review",
    hostName: "Charlie K.",
    used: false,
  },
  {
    referenceNumber: "APT-1002",
    visitorName: "Sofia Lindqvist",
    purpose: "Candidate interview",
    hostName: "Jeffrey E.",
    used: false,
  },
  {
    referenceNumber: "APT-1003",
    visitorName: "Tunde Bakare",
    purpose: "Fire safety inspection",
    hostName: "Benjamin N.",
    used: false,
  },
  {
    referenceNumber: "APT-1004",
    visitorName: "Hannah Weiss",
    purpose: "Contract signing",
    hostName: "Charlie K.",
    used: true,
  },
];

// The staff logins. Sign-up is disabled on the API, so this is the only way an
// account comes into existence — the passwords below are hashed before they
// reach the database, and are known only because this file is the fixture.
//
// One of each role, so role-gated behaviour can be checked both ways without
// hand-editing the database: the admin sees "Close all stale visits", the guard
// does not, and `POST /api/visits/close-stale` rejects the guard with 403.
const users = [
  {
    email: "admin@geoplan.ph",
    name: "VMS Administrator",
    role: "ADMIN" as const,
    password: "admin123",
  },
  {
    email: "guard@geoplan.ph",
    name: "Front Desk Guard",
    role: "GUARD" as const,
    password: "guard123",
  },
];

async function main() {
  for (const host of hosts) {
    // `Host` has no unique business key, so match on name to stay idempotent.
    const existing = await prisma.host.findFirst({ where: { name: host.name } });

    if (existing) {
      await prisma.host.update({ where: { id: existing.id }, data: host });
    } else {
      await prisma.host.create({ data: host });
    }
  }

  for (const { hostName, ...appointment } of appointments) {
    const host = await prisma.host.findFirst({ where: { name: hostName } });

    if (!host) {
      throw new Error(`Seed host "${hostName}" not found for ${appointment.referenceNumber}`);
    }

    const data = { ...appointment, hostId: host.id };

    // Re-seeding resets `used` back to its fixture value, so the appointment
    // flow can be tested repeatedly without hand-editing the database.
    await prisma.appointment.upsert({
      where: { referenceNumber: appointment.referenceNumber },
      update: data,
      create: data,
    });
  }

  for (const { password, ...user } of users) {
    const record = await prisma.user.upsert({
      where: { email: user.email },
      update: { name: user.name, role: user.role, emailVerified: true },
      create: { ...user, emailVerified: true },
    });

    // Better Auth keeps the credential on an `account` row, and sign-in matches
    // it on two things at once: `providerId` is "credential" and `accountId` is
    // the user's own id. A row with either one wrong is not found, and the user
    // gets "invalid email or password" with a perfectly good password.
    const credential = await prisma.account.findFirst({
      where: { userId: record.id, providerId: "credential" },
      select: { id: true },
    });

    const data = {
      accountId: record.id,
      providerId: "credential",
      userId: record.id,
      password: await hashPassword(password),
    };

    if (credential) {
      // Re-hashes on every run, so re-seeding resets a password that has since
      // been changed — the same way it resets APT-1004 back to used.
      await prisma.account.update({ where: { id: credential.id }, data });
    } else {
      // Better Auth generates ids for its own tables, so the column has no
      // default and a direct insert has to supply one.
      await prisma.account.create({ data: { id: randomUUID(), ...data } });
    }
  }

  console.log(`Seeded ${hosts.length} hosts.`);
  console.log(
    `Seeded ${appointments.length} appointments (${appointments
      .map((a) => a.referenceNumber)
      .join(", ")}; APT-1004 is pre-used).`,
  );
  console.log("Seeded staff logins (passwords are hashed on `account`):");
  for (const user of users) {
    console.log(`  ${user.role.padEnd(5)} ${user.email} / ${user.password}`);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
