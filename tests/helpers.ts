/**
 * Shared fixtures and the reset that runs between cases.
 *
 * Tests share one database, so every case starts from empty and builds exactly
 * what it needs. That is slower than seeding once, and it is the reason a
 * failure points at one test rather than at whichever test happened to run
 * before it.
 */
import { prisma } from "@/lib/prisma";

/**
 * Empties every table.
 *
 * Ordered child-first even though most relations cascade: relying on the
 * cascade would mean this quietly stops working the day one is changed to
 * `Restrict`, and the failure would look like a flaky test rather than a
 * deliberate schema decision.
 */
export async function resetDatabase(): Promise<void> {
  await prisma.visit.deleteMany();
  await prisma.visitor.deleteMany();
  await prisma.appointment.deleteMany();
  await prisma.host.deleteMany();
  await prisma.session.deleteMany();
  await prisma.account.deleteMany();
  await prisma.user.deleteMany();
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
  const visitor = await prisma.visitor.create({
    data: {
      name: overrides.name ?? "Test Visitor",
      purpose: "Testing",
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
  overrides: Partial<{ referenceNumber: string; used: boolean }> = {},
) {
  return prisma.appointment.create({
    data: {
      referenceNumber: overrides.referenceNumber ?? "APT-TEST01",
      visitorName: "Appointment Visitor",
      purpose: "Scheduled testing",
      hostId,
      used: overrides.used ?? false,
    },
  });
}

/** Reads a visit back, for asserting on what a transition actually wrote. */
export async function readVisit(id: string) {
  return prisma.visit.findUniqueOrThrow({ where: { id } });
}
