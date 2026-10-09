import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import type {
  VisitEventType,
  VisitStatus,
  VisitorType,
} from "@/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import { findDeliveryPurposeId } from "@/lib/purposes";

/**
 * Shape sent to the client. Dates are ISO strings because this crosses the
 * server/client boundary as JSON (both as an RSC prop and as an API response).
 */
export type ActiveVisit = {
  id: string;
  checkInTime: string;
  /** Display with `formatFullName()`. */
  firstName: string;
  lastName: string;
  visitorType: VisitorType;
  /** The chosen option's label. Null if the visit carries no purpose at all. */
  purposeLabel: string | null;
  /**
   * Null only for a legacy DELIVERY row left open by the retired kiosk flow —
   * deliveries are logged closed now, and every other flow requires a host.
   */
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
 *
 * Deliveries never appear here: `createDeliveryLog()` writes them as
 * CHECKED_OUT, so the same status filter excludes them without a type test.
 */
export async function getActiveVisits(): Promise<ActiveVisit[]> {
  const visits = await prisma.visit.findMany({
    where: { status: { in: ["ACTIVE", "PENDING_RETURN"] } },
    orderBy: { checkInTime: "desc" },
    include: { visitor: { include: { host: true, purpose: true } } },
  });

  return visits.map((visit) => ({
    id: visit.id,
    checkInTime: visit.checkInTime.toISOString(),
    firstName: visit.visitor.firstName,
    lastName: visit.visitor.lastName,
    visitorType: visit.visitor.type,
    purposeLabel: visit.visitor.purpose?.label ?? null,
    hostName: visit.visitor.host?.name ?? null,
    hostDepartment: visit.visitor.host?.department ?? null,
    status: visit.status,
    exitTime: visit.exitTime?.toISOString() ?? null,
  }));
}

/**
 * Registers a walk-in: one `Visitor`, its opening `Visit`, and that visit's
 * CHECK_IN event. The nested write runs in a single transaction, so a visitor is
 * never left without a visit and a visit is never left without its first event.
 *
 * `checkInTime` is passed explicitly rather than left to its `now()` default so
 * the event and the visit carry the identical instant — the timeline should
 * never disagree with the check-in time shown next to it. `checkOutTime` stays
 * null.
 */
export async function createWalkInVisit(input: {
  /** Already cleaned and validated by `parseNameParts()`. */
  firstName: string;
  lastName: string;
  /** A `PurposeOption` id the caller has already confirmed is selectable. */
  purposeId: string;
  hostId: string;
}) {
  const checkInTime = new Date();

  const visitor = await prisma.visitor.create({
    data: {
      firstName: input.firstName,
      lastName: input.lastName,
      purposeId: input.purposeId,
      hostId: input.hostId,
      visits: {
        create: {
          checkInTime,
          events: { create: { eventType: "CHECK_IN", timestamp: checkInTime } },
        },
      },
    },
    include: { visits: true },
  });

  return { visitorId: visitor.id, visitId: visitor.visits[0].id };
}

/**
 * Logs a courier drop-off from the guard dashboard: the same Visitor + Visit
 * pattern as a walk-in, with `type: DELIVERY`.
 *
 * The difference that matters is the visit is born finished — `checkOutTime` is
 * stamped with the same instant as `checkInTime` and the status goes straight to
 * CHECKED_OUT. A courier hands the parcel over and leaves, so there is no open
 * session for a guard to remember to close. That also keeps deliveries out of
 * the live list, which selects on the two open statuses, while leaving them in
 * history as ordinary completed rows.
 *
 * The recipient is optional and takes either form: `hostId` when the guard
 * picked a known host, `recipientDepartment` when they typed one instead.
 *
 * Both ends of the visit are real events, so both are logged: the timeline reads
 * as a CHECK_IN and a CHECK_OUT at one instant, which is what a drop-off is.
 *
 * `name` is a courier or company, not a person, so it is not split: it is kept
 * whole in `firstName` with an empty `lastName`, which `formatFullName()` shows
 * unchanged.
 */
export async function createDeliveryLog(input: {
  name: string;
  /** The guard logging it, recorded as who closed the (born-closed) visit. */
  loggedBy: { id: string; name: string };
  hostId: string | null;
  recipientDepartment: string | null;
  note: string | null;
}) {
  // One timestamp for both ends of the visit, so the record reads as a single
  // instant rather than a zero-length session that happens to round to one.
  const loggedAt = new Date();

  // The delivery modal collects no purpose and is not gaining a field for one;
  // this is only so the Purpose column keeps reading "Delivery" as it always
  // has. Null if an admin renamed or removed that option, which the nullable
  // column handles.
  const purposeId = await findDeliveryPurposeId();

  const visitor = await prisma.visitor.create({
    data: {
      firstName: input.name,
      lastName: "",
      purposeId,
      type: "DELIVERY",
      hostId: input.hostId,
      recipientDepartment: input.recipientDepartment,
      note: input.note,
      visits: {
        create: {
          checkInTime: loggedAt,
          checkOutTime: loggedAt,
          status: "CHECKED_OUT",
          checkedOutById: input.loggedBy.id,
          checkedOutByName: input.loggedBy.name,
          events: {
            create: [
              { eventType: "CHECK_IN", timestamp: loggedAt },
              { eventType: "CHECK_OUT", timestamp: loggedAt },
            ],
          },
        },
      },
    },
    include: { visits: true },
  });

  return {
    visitorId: visitor.id,
    visitId: visitor.visits[0].id,
    loggedAt: loggedAt.toISOString(),
  };
}

/**
 * One entry in a visit's timeline, as sent to the client.
 */
export type VisitEventRecord = {
  id: string;
  eventType: VisitEventType;
  timestamp: string;
};

/**
 * Tie-break for events that share a timestamp, which a delivery always does —
 * it is checked in and out at one instant. Ordering by time alone would leave
 * that pair in whatever order the database returned them.
 */
const EVENT_ORDER: Record<VisitEventType, number> = {
  CHECK_IN: 0,
  STEP_OUT: 1,
  RETURN: 2,
  CHECK_OUT: 3,
};

/** A visit's timeline, plus the context the panel shows above it. */
export type VisitTimeline = {
  /** The chosen option's label. Null if the visit carries no purpose at all. */
  purposeLabel: string | null;
  events: VisitEventRecord[];
};

/**
 * One visit's own timeline, oldest first. `null` means there is no such visit,
 * which is distinct from a visit that happens to have no events.
 *
 * Fetched on its own rather than joined into the live list or history query:
 * both render a page of rows at a time and only one row's timeline is ever open,
 * so loading every row's events up front would be work thrown away.
 *
 * Scoped to a single visit by design — there is no visitor identity across
 * visits to hang a wider history off yet.
 */
export async function getVisitEvents(
  visitId: string,
): Promise<VisitTimeline | null> {
  const visit = await prisma.visit.findUnique({
    where: { id: visitId },
    select: {
      // Carried along with the events so the expanded panel can name what the
      // visit was for without the table having to pass it down or the client
      // making a second request.
      visitor: { select: { purpose: { select: { label: true } } } },
      events: {
        orderBy: { timestamp: "asc" },
        select: { id: true, eventType: true, timestamp: true },
      },
    },
  });

  if (!visit) {
    return null;
  }

  return {
    purposeLabel: visit.visitor.purpose?.label ?? null,
    events: visit.events
      .map((event) => ({
        id: event.id,
        eventType: event.eventType,
        timestamp: event.timestamp.toISOString(),
      }))
      .sort(
        (a, b) =>
          a.timestamp.localeCompare(b.timestamp) ||
          EVENT_ORDER[a.eventType] - EVENT_ORDER[b.eventType],
      ),
  };
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

/**
 * Runs one guarded transition together with the timeline entry that describes
 * it, in a single transaction.
 *
 * The event is written only when the guarded `updateMany` actually matched a
 * row, and inside the same transaction, so the two can never come apart: no
 * timeline entry for a state change that lost a concurrency race, and no silent
 * state change that left no trace. Each caller still spells out its own WHERE
 * guard — that is the part worth reading at the call site.
 *
 * Returns the matched row count, so callers keep the zero-row branch they
 * already had for working out *why* nothing matched.
 */
async function applyVisitTransition(args: {
  visitId: string;
  where: Prisma.VisitWhereInput;
  data: Prisma.VisitUpdateManyMutationInput;
  eventType: VisitEventType;
  timestamp: Date;
}): Promise<number> {
  return prisma.$transaction(async (tx) => {
    const { count } = await tx.visit.updateMany({
      where: args.where,
      data: args.data,
    });

    if (count > 0) {
      await tx.visitEvent.create({
        data: {
          visitId: args.visitId,
          eventType: args.eventType,
          timestamp: args.timestamp,
        },
      });
    }

    return count;
  });
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

  const count = await applyVisitTransition({
    visitId,
    where: { id: visitId, checkOutTime: null },
    data: {
      checkOutTime,
      status: "CHECKED_OUT",
      checkedOutById: actor?.id ?? null,
      checkedOutByName: actor?.name ?? null,
    },
    eventType: "CHECK_OUT",
    timestamp: checkOutTime,
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

  const count = await applyVisitTransition({
    visitId,
    // `status: "ACTIVE"` is the guard: a visit already stepped out or already
    // checked out must not have its `exitTime` overwritten by a second click.
    where: { id: visitId, status: "ACTIVE" },
    data: { status: "PENDING_RETURN", exitTime },
    eventType: "STEP_OUT",
    timestamp: exitTime,
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
 * `checkOutTime` — the step-out leaves no trace on the row once it is over.
 *
 * "On the row" is the limit of that now: clearing `exitTime` still erases the
 * round trip from the visit itself, but the STEP_OUT and RETURN events remain,
 * so the timeline keeps what the columns forget.
 */
export async function markVisitReturned(
  visitId: string,
): Promise<{ result: ReturnResult }> {
  // The visit stores no timestamp for a return — `exitTime` is cleared rather
  // than moved — so this instant lives only on the event.
  const returnedAt = new Date();

  const count = await applyVisitTransition({
    visitId,
    where: { id: visitId, status: "PENDING_RETURN" },
    data: { status: "ACTIVE", exitTime: null },
    eventType: "RETURN",
    timestamp: returnedAt,
  });

  if (count > 0) {
    return { result: "returned" };
  }

  const status = await readStatus(visitId);

  if (status === "ACTIVE") return { result: "already-active" };
  if (status === "CHECKED_OUT") return { result: "already-checked-out" };

  return { result: "not-found" };
}
