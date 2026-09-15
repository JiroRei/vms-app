import "server-only";

import type { VisitorType } from "@/generated/prisma/enums";
import { prisma } from "@/lib/prisma";

/**
 * Shape sent to the client. Dates are ISO strings because this crosses the
 * server/client boundary as JSON (both as an RSC prop and as an API response).
 */
export type ActiveVisit = {
  id: string;
  checkInTime: string;
  visitorName: string;
  visitorType: VisitorType;
  purpose: string;
  /** Null for a delivery logged without a named recipient. */
  hostName: string | null;
  hostDepartment: string | null;
};

export type HostOption = {
  id: string;
  name: string;
  department: string;
};

export async function getHosts(): Promise<HostOption[]> {
  return prisma.host.findMany({
    select: { id: true, name: true, department: true },
    orderBy: [{ department: "asc" }, { name: "asc" }],
  });
}

/** Visits that have been checked in but not yet checked out. */
export async function getActiveVisits(): Promise<ActiveVisit[]> {
  const visits = await prisma.visit.findMany({
    where: { checkOutTime: null },
    orderBy: { checkInTime: "desc" },
    include: { visitor: { include: { host: true } } },
  });

  return visits.map((visit) => ({
    id: visit.id,
    checkInTime: visit.checkInTime.toISOString(),
    visitorName: visit.visitor.name,
    visitorType: visit.visitor.type,
    purpose: visit.visitor.purpose,
    hostName: visit.visitor.host?.name ?? null,
    hostDepartment: visit.visitor.host?.department ?? null,
  }));
}

/**
 * Registers a walk-in: one `Visitor` plus its opening `Visit`. The nested
 * write runs in a single transaction, so a visitor is never left without a
 * visit. `checkInTime` defaults to now() and `checkOutTime` stays null.
 */
export async function createWalkInVisit(input: {
  name: string;
  purpose: string;
  hostId: string;
}) {
  const visitor = await prisma.visitor.create({
    data: {
      name: input.name,
      purpose: input.purpose,
      hostId: input.hostId,
      visits: { create: {} },
    },
    include: { visits: true },
  });

  return { visitorId: visitor.id, visitId: visitor.visits[0].id };
}

/**
 * Logs a courier drop-off: same Visitor + Visit pattern as a walk-in, with
 * `type: DELIVERY` and no purpose to collect. `hostId` is optional because a
 * courier may not know which department the parcel is for.
 */
export async function createDeliveryVisit(input: {
  name: string;
  hostId: string | null;
}) {
  const visitor = await prisma.visitor.create({
    data: {
      name: input.name,
      // `purpose` is required on Visitor and the delivery form collects none,
      // so it carries the fixed label the tables display.
      purpose: "Delivery",
      type: "DELIVERY",
      hostId: input.hostId,
      visits: { create: {} },
    },
    include: { visits: true },
  });

  return { visitorId: visitor.id, visitId: visitor.visits[0].id };
}

export type CheckOutResult = "checked-out" | "already-checked-out" | "not-found";

/**
 * Stamps `checkOutTime` on an active visit.
 *
 * The `checkOutTime: null` guard is part of the WHERE clause so two concurrent
 * clicks can't both win — the second matches zero rows and reports
 * `already-checked-out` instead of overwriting the first timestamp.
 */
export async function checkOutVisit(
  visitId: string,
): Promise<{ result: CheckOutResult; checkOutTime?: string }> {
  const checkOutTime = new Date();

  const { count } = await prisma.visit.updateMany({
    where: { id: visitId, checkOutTime: null },
    data: { checkOutTime },
  });

  if (count > 0) {
    return { result: "checked-out", checkOutTime: checkOutTime.toISOString() };
  }

  const exists = await prisma.visit.findUnique({
    where: { id: visitId },
    select: { id: true },
  });

  return { result: exists ? "already-checked-out" : "not-found" };
}
