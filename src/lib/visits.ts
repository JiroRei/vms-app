import "server-only";

import type { VisitStatus, VisitorType } from "@/generated/prisma/enums";
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
  /** Never CHECKED_OUT here — those are filtered out of the live list. */
  status: VisitStatus;
  /** Set only while PENDING_RETURN: when the visitor stepped out. */
  exitTime: string | null;
};

export type HostOption = {
  id: string;
  name: string;
  department: string;
};

/**
 * The hosts a visitor can pick right now.
 *
 * Active only: someone who has left should not be offered at the kiosk. For the
 * full directory — including people who have left but are still named in the
 * history — use `listHosts()` in `src/lib/hosts.ts`.
 */
export async function getHosts(): Promise<HostOption[]> {
  return prisma.host.findMany({
    where: { active: true },
    select: { id: true, name: true, department: true },
    orderBy: [{ department: "asc" }, { name: "asc" }],
  });
}

/**
 * Visits still open on the floor: someone ACTIVE inside the building, plus
 * anyone PENDING_RETURN who has stepped out but is expected back today.
 *
 * Filtering on `status` rather than `checkOutTime: null` is what keeps the two
 * apart — both carry a null `checkOutTime`, so only the status distinguishes
 * "here" from "out, coming back".
 */
export async function getActiveVisits(): Promise<ActiveVisit[]> {
  const visits = await prisma.visit.findMany({
    where: { status: { in: ["ACTIVE", "PENDING_RETURN"] } },
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
    status: visit.status,
    exitTime: visit.exitTime?.toISOString() ?? null,
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

/**
 * Looks up why an `updateMany` guard matched zero rows.
 *
 * Every transition below states its precondition in the WHERE clause, so a
 * zero-row result is ambiguous on its own: the visit may not exist, or it may
 * exist in a status the transition does not apply to. One extra read turns that
 * into a specific answer for the caller.
 */
async function readStatus(visitId: string): Promise<VisitStatus | null> {
  const visit = await prisma.visit.findUnique({
    where: { id: visitId },
    select: { status: true },
  });

  return visit?.status ?? null;
}

export type CheckOutResult = "checked-out" | "already-checked-out" | "not-found";

/**
 * Who is closing a visit.
 *
 * `null` is a real and meaningful value, not a missing one: the stale-visit
 * cleanup closes visits that nobody attended to, and recording no name there is
 * more honest than attributing the tidy-up to whoever happened to press the
 * button. The name is copied rather than only referenced so the record survives
 * the account being removed.
 */
export type CheckOutActor = { id: string; name: string } | null;

/**
 * Ends a visit for good: stamps `checkOutTime` and moves it to CHECKED_OUT.
 *
 * Applies to an ACTIVE visit and to a PENDING_RETURN one alike — a visitor who
 * stepped out and then turns out not to be coming back is checked out from
 * where they stand, without being marked as returned first. `exitTime` is left
 * as it is: it is a record of when they actually left the building.
 *
 * The `checkOutTime: null` guard is part of the WHERE clause so two concurrent
 * clicks can't both win — the second matches zero rows and reports
 * `already-checked-out` instead of overwriting the first timestamp.
 */
export async function checkOutVisit(
  visitId: string,
  actor: CheckOutActor = null,
): Promise<{ result: CheckOutResult; checkOutTime?: string }> {
  const checkOutTime = new Date();

  const { count } = await prisma.visit.updateMany({
    where: { id: visitId, checkOutTime: null },
    data: {
      checkOutTime,
      status: "CHECKED_OUT",
      checkedOutById: actor?.id ?? null,
      checkedOutByName: actor?.name ?? null,
    },
  });

  if (count > 0) {
    return { result: "checked-out", checkOutTime: checkOutTime.toISOString() };
  }

  return {
    result: (await readStatus(visitId)) ? "already-checked-out" : "not-found",
  };
}

export type StepOutResult =
  | "stepped-out"
  | "already-stepped-out"
  | "already-checked-out"
  | "not-found";

/**
 * Marks an ACTIVE visit as stepped out but expected back today.
 *
 * `checkOutTime` deliberately stays null: the visit is not over, so it keeps
 * its place in the live list and its original `checkInTime`. Only `exitTime`
 * moves, which is what makes the step-out reversible.
 */
export async function markVisitReturning(
  visitId: string,
): Promise<{ result: StepOutResult; exitTime?: string }> {
  const exitTime = new Date();

  const { count } = await prisma.visit.updateMany({
    // `status: "ACTIVE"` is the guard: a visit already stepped out or already
    // checked out must not have its `exitTime` overwritten by a second click.
    where: { id: visitId, status: "ACTIVE" },
    data: { status: "PENDING_RETURN", exitTime },
  });

  if (count > 0) {
    return { result: "stepped-out", exitTime: exitTime.toISOString() };
  }

  const status = await readStatus(visitId);

  if (status === "PENDING_RETURN") return { result: "already-stepped-out" };
  if (status === "CHECKED_OUT") return { result: "already-checked-out" };

  return { result: "not-found" };
}

export type ReturnResult =
  | "returned"
  | "already-active"
  | "already-checked-out"
  | "not-found";

/**
 * Resumes a PENDING_RETURN visit: back to ACTIVE with `exitTime` cleared.
 *
 * This updates the same Visit row rather than opening a new one, so the day
 * reads as a single visit with one `checkInTime` and, eventually, one
 * `checkOutTime` — the step-out leaves no trace in history once it is over.
 */
export async function markVisitReturned(
  visitId: string,
): Promise<{ result: ReturnResult }> {
  const { count } = await prisma.visit.updateMany({
    where: { id: visitId, status: "PENDING_RETURN" },
    data: { status: "ACTIVE", exitTime: null },
  });

  if (count > 0) {
    return { result: "returned" };
  }

  const status = await readStatus(visitId);

  if (status === "ACTIVE") return { result: "already-active" };
  if (status === "CHECKED_OUT") return { result: "already-checked-out" };

  return { result: "not-found" };
}
