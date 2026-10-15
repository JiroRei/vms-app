/**
 * Shared fixtures and the reset that runs between cases.
 *
 * Tests share one database, so every case starts from empty and builds exactly
 * what it needs. That is slower than seeding once, and it is the reason a
 * failure points at one test rather than at whichever test happened to run
 * before it.
 */
import { prisma } from "@/lib/prisma";
import { randomUUID } from "node:crypto";
import type { AppointmentStatus } from "@/generated/prisma/enums";
import { appointmentExpiry } from "@/lib/qr";
import { assertTestDatabase } from "./test-database";

/**
 * Empties every table.
 *
 * Ordered child-first even though most relations cascade: relying on the
 * cascade would mean this quietly stops working the day one is changed to
 * `Restrict`, and the failure would look like a flaky test rather than a
 * deliberate schema decision.
 */
export async function resetDatabase(): Promise<void> {
  assertTestDatabase();
  await prisma.emailOutbox.deleteMany();
  await prisma.kioskDevice.deleteMany();
  await prisma.rateLimitBucket.deleteMany();
  await prisma.exportLog.deleteMany();
  await prisma.appointmentEvent.deleteMany();
  await prisma.visitEvent.deleteMany();
  await prisma.visit.deleteMany();
  await prisma.visitor.deleteMany();
  await prisma.appointment.deleteMany();
  await prisma.visitorPass.deleteMany();
  await prisma.visitorProfile.deleteMany();
  await prisma.visitorVerification.deleteMany();
  await prisma.purposeOption.deleteMany();
  await prisma.host.deleteMany();
  await prisma.session.deleteMany();
  await prisma.account.deleteMany();
  await prisma.user.deleteMany();
  await prisma.verification.deleteMany();
}

export async function makePurpose(label = "Testing") {
  const existing = await prisma.purposeOption.findFirst({
    where: { label: { equals: label, mode: "insensitive" } },
  });
  return existing ?? prisma.purposeOption.create({ data: { label } });
}

export async function makeHost(
  overrides: Partial<{ name: string; department: string; active: boolean }> = {},
) {
  return prisma.host.create({
    data: {
      name: overrides.name ?? "Test Host",
      department: overrides.department ?? "Testing",
      active: overrides.active ?? true,
    },
  });
}

/** A visitor with one open visit, the shape every check-in flow produces. */
export async function makeVisit(
  hostId: string | null,
  overrides: Partial<{ name: string; checkInTime: Date }> = {},
) {
  const [firstName, ...lastName] = (overrides.name ?? "Test Visitor").split(" ");
  const purpose = await makePurpose();
  const visitor = await prisma.visitor.create({
    data: {
      firstName,
      lastName: lastName.join(" "),
      purposeId: purpose.id,
      hostId,
      visits: {
        create: overrides.checkInTime
          ? { checkInTime: overrides.checkInTime }
          : {},
      },
    },
    include: { visits: true },
  });

  return { visitor, visit: visitor.visits[0] };
}

export async function makeAppointment(
  hostId: string,
  overrides: Partial<{
    referenceNumber: string;
    status: AppointmentStatus;
    scheduledFor: Date;
    expiresAt: Date;
    firstName: string;
    lastName: string;
    visitorEmail: string;
  }> = {},
) {
  const purpose = await makePurpose();
  const scheduledFor = overrides.scheduledFor ?? new Date();
  return prisma.appointment.create({
    data: {
      referenceNumber: overrides.referenceNumber ?? "APT-TEST01",
      qrToken: randomUUID(),
      firstName: overrides.firstName ?? "Appointment",
      lastName: overrides.lastName ?? "Visitor",
      visitorEmail: overrides.visitorEmail ?? "appointment@example.invalid",
      purposeId: purpose.id,
      hostId,
      scheduledFor,
      expiresAt: overrides.expiresAt ?? appointmentExpiry(scheduledFor),
      status: overrides.status ?? "PENDING",
    },
  });
}

/** Reads a visit back, for asserting on what a transition actually wrote. */
export async function readVisit(id: string) {
  return prisma.visit.findUniqueOrThrow({ where: { id } });
}
