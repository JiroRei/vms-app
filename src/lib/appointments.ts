import "server-only";

import { prisma } from "@/lib/prisma";

export type AppointmentDetails = {
  referenceNumber: string;
  visitorName: string;
  purpose: string;
  hostName: string;
  hostDepartment: string;
};

export type LookupResult =
  | { status: "found"; appointment: AppointmentDetails }
  | { status: "not-found" }
  | { status: "already-used" };

/** Reference numbers are typed on a kiosk, so match them case-insensitively. */
function normalizeReference(reference: string): string {
  return reference.trim().toUpperCase();
}

export async function lookupAppointment(
  reference: string,
): Promise<LookupResult> {
  const referenceNumber = normalizeReference(reference);

  const appointment = await prisma.appointment.findUnique({
    where: { referenceNumber },
    include: { host: true },
  });

  if (!appointment) {
    return { status: "not-found" };
  }

  if (appointment.used) {
    return { status: "already-used" };
  }

  return {
    status: "found",
    appointment: {
      referenceNumber: appointment.referenceNumber,
      visitorName: appointment.visitorName,
      purpose: appointment.purpose,
      hostName: appointment.host.name,
      hostDepartment: appointment.host.department,
    },
  };
}

export type RedeemResult =
  | { status: "checked-in"; visitorId: string; visitId: string }
  | { status: "not-found" }
  | { status: "already-used" };

/**
 * Redeems an appointment: marks it used and creates the Visitor + Visit pair,
 * exactly as the walk-in flow does.
 *
 * The whole thing runs in one transaction, and the `used: false` guard lives in
 * the UPDATE's WHERE clause. Two people submitting the same reference number at
 * once means the second matches zero rows and rolls back, so one appointment
 * can never produce two visits.
 */
export async function redeemAppointment(
  reference: string,
): Promise<RedeemResult> {
  const referenceNumber = normalizeReference(reference);

  return prisma.$transaction(async (tx) => {
    const appointment = await tx.appointment.findUnique({
      where: { referenceNumber },
    });

    if (!appointment) {
      return { status: "not-found" } as const;
    }

    const { count } = await tx.appointment.updateMany({
      where: { referenceNumber, used: false },
      data: { used: true },
    });

    if (count === 0) {
      return { status: "already-used" } as const;
    }

    const visitor = await tx.visitor.create({
      data: {
        name: appointment.visitorName,
        purpose: appointment.purpose,
        hostId: appointment.hostId,
        visits: { create: {} },
      },
      include: { visits: true },
    });

    return {
      status: "checked-in",
      visitorId: visitor.id,
      visitId: visitor.visits[0].id,
    } as const;
  });
}
