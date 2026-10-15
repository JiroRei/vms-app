import "server-only";

import { Prisma } from "@/generated/prisma/client";
import type {
  AppointmentActorType,
  AppointmentEventType,
  AppointmentStatus,
  CancelledBy,
} from "@/generated/prisma/enums";
import {
  addDaysToKey,
  dateKeyInZone,
  zonedTimeToUtc,
} from "@/lib/booking-config";
import {
  normalizeEmail,
  resolveBookingProfile,
  type VerifiedClaim,
} from "@/lib/booking-verification";
import { makeNameKey } from "@/lib/names";
import { prisma } from "@/lib/prisma";
import {
  appointmentExpiry,
  classifyAppointment,
  createQrToken,
  createReferenceNumber,
  describeAppointmentFailure,
  holderMatches,
  lifecycleFailure,
  type AppointmentHolder,
  type AppointmentTokenFailure,
  type ValidatedAppointment,
} from "@/lib/qr";

/**
 * How many times to retry the booking transaction on a unique-constraint
 * violation. Two things can collide: a random reference number (32^6
 * possibilities, so this is generous), or a concurrent booking creating the
 * same email + name profile first, which the retry resolves by taking the
 * "profile exists" path.
 */
const MAX_BOOKING_ATTEMPTS = 5;

/**
 * How far ahead the staff "Upcoming" tab looks, in days after today.
 *
 * TODO(multi-tenancy): global today — see MULTI_TENANCY_TODO.md.
 */
export const STAFF_UPCOMING_DAYS = 14;

// ---------------------------------------------------------------------------
// Event log
// ---------------------------------------------------------------------------

/**
 * Who is making an appointment change. VISITOR is anyone acting through a
 * public page (booking, manage link, kiosk); STAFF names the signed-in user.
 */
export type AppointmentActor =
  | { type: "VISITOR" }
  | { type: "STAFF"; userId: string };

/**
 * Appends one entry to an appointment's log, on the caller's transaction so the
 * entry and the change it describes commit or fail together. `detail` holds old
 * and new values — never a QR token, which is a bearer credential.
 */
async function logAppointmentEvent(
  tx: Prisma.TransactionClient,
  args: {
    appointmentId: string;
    type: AppointmentEventType;
    actor: AppointmentActor;
    detail?: Prisma.InputJsonValue;
  },
) {
  await tx.appointmentEvent.create({
    data: {
      appointmentId: args.appointmentId,
      type: args.type,
      actorType: args.actor.type,
      actorUserId: args.actor.type === "STAFF" ? args.actor.userId : null,
      detail: args.detail,
    },
  });
}

export type AppointmentEventRecord = {
  id: string;
  type: AppointmentEventType;
  actorType: AppointmentActorType;
  /** The staff member's name, when a staff member did it. */
  actorName: string | null;
  detail: Prisma.JsonValue;
  createdAt: string;
};

const EVENT_SELECT = {
  id: true,
  type: true,
  actorType: true,
  detail: true,
  createdAt: true,
  actorUser: { select: { name: true } },
} as const;

function toEventRecord(event: {
  id: string;
  type: AppointmentEventType;
  actorType: AppointmentActorType;
  detail: Prisma.JsonValue;
  createdAt: Date;
  actorUser: { name: string } | null;
}): AppointmentEventRecord {
  return {
    id: event.id,
    type: event.type,
    actorType: event.actorType,
    actorName: event.actorUser?.name ?? null,
    detail: event.detail,
    createdAt: event.createdAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// One appointment, as every surface reads it
// ---------------------------------------------------------------------------

const DETAIL_INCLUDE = {
  host: true,
  purpose: true,
  visit: { select: { checkInTime: true } },
} as const;

type AppointmentWithDetail = Prisma.AppointmentGetPayload<{
  include: typeof DETAIL_INCLUDE;
}>;

/**
 * An appointment with everything a page or an email shows. `qrToken` is here
 * for the server to render a QR or sign a manage link with; strip it before
 * anything crosses to a staff screen.
 */
export type AppointmentDetail = {
  id: string;
  referenceNumber: string;
  qrToken: string;
  firstName: string;
  lastName: string;
  visitorEmail: string;
  visitorPhone: string | null;
  purposeLabel: string | null;
  hostName: string;
  hostDepartment: string;
  scheduledFor: Date;
  expiresAt: Date;
  status: AppointmentStatus;
  cancelledAt: Date | null;
  cancelledBy: CancelledBy | null;
  cancelReason: string | null;
  /** When the visit it turned into began. Null if not checked in, or legacy. */
  checkedInAt: Date | null;
  visitorProfileId: string | null;
};

function toDetail(appointment: AppointmentWithDetail): AppointmentDetail {
  return {
    id: appointment.id,
    referenceNumber: appointment.referenceNumber,
    qrToken: appointment.qrToken,
    firstName: appointment.firstName,
    lastName: appointment.lastName,
    visitorEmail: appointment.visitorEmail,
    visitorPhone: appointment.visitorPhone,
    purposeLabel: appointment.purpose?.label ?? null,
    hostName: appointment.host.name,
    hostDepartment: appointment.host.department,
    scheduledFor: appointment.scheduledFor,
    expiresAt: appointment.expiresAt,
    status: appointment.status,
    cancelledAt: appointment.cancelledAt,
    cancelledBy: appointment.cancelledBy,
    cancelReason: appointment.cancelReason,
    checkedInAt: appointment.visit?.checkInTime ?? null,
    visitorProfileId: appointment.visitorProfileId,
  };
}

export async function getAppointmentById(
  id: string,
): Promise<AppointmentDetail | null> {
  const appointment = await prisma.appointment.findUnique({
    where: { id },
    include: DETAIL_INCLUDE,
  });

  return appointment ? toDetail(appointment) : null;
}

export async function getAppointmentByReference(
  reference: string,
): Promise<AppointmentDetail | null> {
  const appointment = await prisma.appointment.findUnique({
    where: { referenceNumber: reference.trim().toUpperCase() },
    include: DETAIL_INCLUDE,
  });

  return appointment ? toDetail(appointment) : null;
}

// ---------------------------------------------------------------------------
// Booking
// ---------------------------------------------------------------------------

export type CreateAppointmentInput = {
  /** As submitted; replaced by the profile's stored name when verified. */
  firstName: string;
  lastName: string;
  visitorEmail: string;
  visitorPhone: string | null;
  /** A `PurposeOption` id the caller has already confirmed is selectable. */
  purposeId: string;
  hostId: string;
  scheduledFor: Date;
  /** The verified-cookie claim, if any. See `resolveBookingProfile()`. */
  verified: VerifiedClaim | null;
  /**
   * When the visitor accepted the privacy notice. Null when staff
   * pre-register someone from the dashboard: the visitor never saw the form.
   */
  consentAcceptedAt: Date | null;
  /** Logged as the CREATED event's actor. */
  actor: AppointmentActor;
};

/** A unique-constraint violation: a code clash or a profile-creation race. */
function isUniqueViolation(cause: unknown): boolean {
  return (
    cause instanceof Prisma.PrismaClientKnownRequestError &&
    cause.code === "P2002"
  );
}

function isSlotUniqueViolation(cause: unknown): boolean {
  // The reschedule update does not alter any other unique field. The pg
  // adapter may omit the violated partial-index field target, so P2002 at this
  // boundary identifies the pending host/time index reliably.
  return isUniqueViolation(cause);
}

export class AppointmentSlotUnavailableError extends Error {
  constructor() {
    super("The selected host and time are already booked.");
    this.name = "AppointmentSlotUnavailableError";
  }
}

/**
 * Books an appointment: decides which visitor profile it belongs to (creating
 * one if needed), mints its two codes, stores when it lapses and logs CREATED.
 *
 * The profile, the appointment and its first event are written in one
 * transaction, so a failed booking never leaves a profile or a log entry
 * behind.
 *
 * Both codes are generated here rather than by the caller so every appointment
 * gets them the same way — the QR token from `crypto.randomUUID()`, the
 * reference number from the unambiguous alphabet a visitor can read aloud.
 *
 * Sending the confirmation email is deliberately *not* part of this. The row
 * must exist whether or not the mail goes out, so the caller sends afterwards
 * and reports the outcome separately.
 */
export async function createAppointment(
  input: CreateAppointmentInput,
): Promise<AppointmentDetail> {
  const expiresAt = appointmentExpiry(input.scheduledFor);

  for (let attempt = 1; attempt <= MAX_BOOKING_ATTEMPTS; attempt += 1) {
    const referenceNumber = createReferenceNumber();
    const qrToken = createQrToken();

    try {
      const appointment = await prisma.$transaction(async (tx) => {
        const occupied = await tx.appointment.findFirst({
          where: {
            hostId: input.hostId,
            scheduledFor: input.scheduledFor,
            status: "PENDING",
          },
          select: { id: true },
        });
        if (occupied) throw new AppointmentSlotUnavailableError();

        const link = await resolveBookingProfile(tx, {
          verified: input.verified,
          email: input.visitorEmail,
          firstName: input.firstName,
          lastName: input.lastName,
          phone: input.visitorPhone,
        });

        const created = await tx.appointment.create({
          data: {
            referenceNumber,
            qrToken,
            firstName: link.firstName,
            lastName: link.lastName,
            visitorEmail: input.visitorEmail,
            visitorPhone: input.visitorPhone,
            purposeId: input.purposeId,
            hostId: input.hostId,
            scheduledFor: input.scheduledFor,
            expiresAt,
            status: "PENDING",
            visitorProfileId: link.visitorProfileId,
            consentAcceptedAt: input.consentAcceptedAt,
          },
          include: DETAIL_INCLUDE,
        });

        await logAppointmentEvent(tx, {
          appointmentId: created.id,
          type: "CREATED",
          actor: input.actor,
          detail: {
            scheduledFor: created.scheduledFor.toISOString(),
            hostId: created.hostId,
            purposeId: created.purposeId,
          },
        });

        return created;
      });

      return toDetail(appointment);
    } catch (cause) {
      if (
        cause instanceof AppointmentSlotUnavailableError ||
        isSlotUniqueViolation(cause)
      ) {
        throw new AppointmentSlotUnavailableError();
      }
      // Anything else is a real failure and belongs to the caller.
      if (!isUniqueViolation(cause) || attempt === MAX_BOOKING_ATTEMPTS) {
        throw cause;
      }
    }
  }

  // Unreachable: the loop either returns or throws on its last attempt.
  throw new Error("Could not create the appointment.");
}

// ---------------------------------------------------------------------------
// Check-in
// ---------------------------------------------------------------------------

export type RedeemResult =
  | {
      status: "checked-in";
      visitorId: string;
      visitId: string;
      hostId: string;
      checkInTime: Date;
      /** The profile the visit was linked to, for the recurring-visitor check. */
      visitorProfileId: string | null;
      appointment: ValidatedAppointment;
    }
  | { status: "failed"; reason: AppointmentTokenFailure; message: string };

/**
 * Redeems an appointment by either of its codes: moves it to CHECKED_IN,
 * creates the Visitor + Visit pair and its CHECK_IN event exactly as the walk-in
 * flow does, links the visit back to the appointment, and logs CHECKED_IN.
 *
 * The whole thing runs in one transaction, and `status: "PENDING"` lives in the
 * UPDATE's WHERE clause. Two people submitting the same code at once means the
 * second matches zero rows and reports ALREADY_USED, so one appointment can
 * never produce two visits — nor two timelines.
 *
 * The eligibility re-check inside the transaction goes through
 * `classifyAppointment()`, the same rule `validateAppointmentToken()` used a
 * moment earlier at the kiosk. Nothing is re-derived here.
 *
 * `checkedInBy` is the guard who did this on the visitor's behalf — from the
 * scanner or the appointments list's one-click check-in — and stays null for
 * the self-service kiosk, which is the whole distinction the audit trail
 * records.
 */
export async function redeemAppointment(
  token: string,
  options: {
    checkedInBy?: string | null;
    /**
     * Set when a visitor pass found this appointment: the visit is recorded as
     * a PASS check-in and linked to the pass's profile (which the caller has
     * already confirmed owns the appointment).
     */
    viaPass?: { profileId: string } | null;
    /** Kiosk self-service: a reference number also needs the last name. See `holderMatches`. */
    holder?: AppointmentHolder;
  } = {},
): Promise<RedeemResult> {
  const trimmed = token.trim();

  if (!trimmed) {
    return {
      status: "failed",
      reason: "NOT_FOUND",
      message: describeAppointmentFailure("NOT_FOUND", null),
    };
  }

  return prisma.$transaction(async (tx) => {
    const appointment = await tx.appointment.findFirst({
      where: {
        OR: [{ qrToken: trimmed }, { referenceNumber: trimmed.toUpperCase() }],
      },
      include: DETAIL_INCLUDE,
    });

    if (!appointment || !holderMatches(appointment, trimmed, options.holder)) {
      return {
        status: "failed",
        reason: "NOT_FOUND",
        message: describeAppointmentFailure("NOT_FOUND", null),
      } as const;
    }

    const failure = classifyAppointment(appointment);

    if (failure) {
      return {
        status: "failed",
        reason: failure,
        message: describeAppointmentFailure(failure, {
          scheduledFor: appointment.scheduledFor,
          checkedInAt: appointment.visit?.checkInTime ?? null,
        }),
      } as const;
    }

    const { count } = await tx.appointment.updateMany({
      where: { id: appointment.id, status: "PENDING" },
      data: { status: "CHECKED_IN" },
    });

    if (count === 0) {
      // Lost the race to another scanner between the read and the update.
      return {
        status: "failed",
        reason: "ALREADY_USED",
        message: describeAppointmentFailure("ALREADY_USED", {
          scheduledFor: appointment.scheduledFor,
        }),
      } as const;
    }

    // Passed explicitly rather than left to its `now()` default so the event
    // and the visit carry the identical instant.
    const checkInTime = new Date();
    const checkedInBy = options.checkedInBy ?? null;

    const visitor = await tx.visitor.create({
      data: {
        firstName: appointment.firstName,
        lastName: appointment.lastName,
        // The visit inherits whatever the booking was for, retired option or
        // not — a check-in records what was booked, not what is still offered.
        purposeId: appointment.purposeId,
        hostId: appointment.hostId,
        visits: {
          create: {
            checkInTime,
            checkedInBy,
            checkInMethod: options.viaPass ? "PASS" : "APPOINTMENT",
            visitorProfileId:
              options.viaPass?.profileId ?? appointment.visitorProfileId,
            events: {
              create: { eventType: "CHECK_IN", timestamp: checkInTime },
            },
          },
        },
      },
      include: { visits: true },
    });

    const visitId = visitor.visits[0].id;

    await tx.appointment.update({
      where: { id: appointment.id },
      data: { visitId },
    });

    await logAppointmentEvent(tx, {
      appointmentId: appointment.id,
      type: "CHECKED_IN",
      actor: checkedInBy
        ? { type: "STAFF", userId: checkedInBy }
        : { type: "VISITOR" },
      detail: {
        from: { status: "PENDING" },
        to: { status: "CHECKED_IN" },
        visitId,
        checkInTime: checkInTime.toISOString(),
        method: options.viaPass ? "PASS" : "APPOINTMENT",
      },
    });

    return {
      status: "checked-in",
      visitorId: visitor.id,
      visitId,
      hostId: appointment.hostId,
      checkInTime,
      visitorProfileId:
        options.viaPass?.profileId ?? appointment.visitorProfileId,
      appointment: {
        referenceNumber: appointment.referenceNumber,
        firstName: appointment.firstName,
        lastName: appointment.lastName,
        purposeLabel: appointment.purpose?.label ?? null,
        hostName: appointment.host.name,
        hostDepartment: appointment.host.department,
        scheduledFor: appointment.scheduledFor.toISOString(),
        expiresAt: appointment.expiresAt.toISOString(),
      },
    } as const;
  });
}

// ---------------------------------------------------------------------------
// Changes after booking: reschedule, cancel, regenerate QR
//
// Each is one guarded UPDATE plus its log entry in a transaction. The guard in
// the WHERE clause is the rule — re-checked at write time, so a change racing
// a kiosk check-in loses cleanly instead of rewriting a redeemed appointment.
// ---------------------------------------------------------------------------

export type ChangeResult<T = Record<never, never>> =
  | ({ status: "ok"; appointment: AppointmentDetail } & T)
  | { status: "not-found" }
  /** Checked in, cancelled or lapsed — nothing left to change. */
  | { status: "not-pending" }
  /** Its time has already come; it can be checked in or cancelled, not moved. */
  | { status: "started" }
  /** Another pending appointment already occupies this host and time. */
  | { status: "slot-unavailable" };

async function explainNoMatch(
  id: string,
  now: Date,
): Promise<{ status: "not-found" | "not-pending" | "started" }> {
  const appointment = await prisma.appointment.findUnique({
    where: { id },
    select: { status: true, scheduledFor: true, expiresAt: true },
  });

  if (!appointment) return { status: "not-found" };
  if (lifecycleFailure(appointment, now)) return { status: "not-pending" };
  return { status: "started" };
}

/**
 * Moves a PENDING appointment whose time has not yet come to `scheduledFor`,
 * recomputing `expiresAt` from it. The `qrToken` and reference number are left
 * alone, so every QR already emailed keeps working and now resolves to the new
 * time.
 *
 * The caller has already checked the new time against its own rules (public
 * slots for a visitor, any future time for staff).
 */
export async function rescheduleAppointment(
  id: string,
  scheduledFor: Date,
  actor: AppointmentActor,
  now: Date = new Date(),
): Promise<ChangeResult> {
  let updated: AppointmentWithDetail | null;
  try {
    updated = await prisma.$transaction(async (tx) => {
    const before = await tx.appointment.findUnique({
      where: { id },
      select: { scheduledFor: true, expiresAt: true },
    });

    if (!before) return null;

    const expiresAt = appointmentExpiry(scheduledFor);
    const { count } = await tx.appointment.updateMany({
      where: { id, status: "PENDING", scheduledFor: { gt: now } },
      data: { scheduledFor, expiresAt },
    });

    if (count === 0) return null;

    await logAppointmentEvent(tx, {
      appointmentId: id,
      type: "RESCHEDULED",
      actor,
      detail: {
        from: {
          scheduledFor: before.scheduledFor.toISOString(),
          expiresAt: before.expiresAt.toISOString(),
        },
        to: {
          scheduledFor: scheduledFor.toISOString(),
          expiresAt: expiresAt.toISOString(),
        },
      },
    });

    return tx.appointment.findUniqueOrThrow({
      where: { id },
      include: DETAIL_INCLUDE,
    });
    });
  } catch (cause) {
    if (isSlotUniqueViolation(cause)) return { status: "slot-unavailable" };
    throw cause;
  }

  if (!updated) return explainNoMatch(id, now);
  return { status: "ok", appointment: toDetail(updated) };
}

/** Longest cancel reason kept; anything longer is cut, not refused. */
export const MAX_CANCEL_REASON = 300;

/**
 * Cancels a PENDING appointment, recording who did it and why.
 *
 * Kept as a CANCELLED row rather than deleted, so the kiosk can tell a visitor
 * why their code stopped working. Allowed until it is checked in or lapses —
 * a visitor running late may still call it off.
 */
export async function cancelAppointment(
  id: string,
  args: { actor: AppointmentActor; reason: string | null },
  now: Date = new Date(),
): Promise<ChangeResult> {
  const reason = args.reason?.trim().slice(0, MAX_CANCEL_REASON) || null;
  const cancelledBy: CancelledBy =
    args.actor.type === "STAFF" ? "STAFF" : "VISITOR";

  const updated = await prisma.$transaction(async (tx) => {
    const { count } = await tx.appointment.updateMany({
      where: { id, status: "PENDING", expiresAt: { gt: now } },
      data: {
        status: "CANCELLED",
        cancelledAt: now,
        cancelledBy,
        cancelReason: reason,
      },
    });

    if (count === 0) return null;

    await logAppointmentEvent(tx, {
      appointmentId: id,
      type: "CANCELLED",
      actor: args.actor,
      detail: {
        from: { status: "PENDING" },
        to: { status: "CANCELLED" },
        reason,
      },
    });

    return tx.appointment.findUniqueOrThrow({
      where: { id },
      include: DETAIL_INCLUDE,
    });
  });

  if (!updated) {
    const why = await explainNoMatch(id, now);
    // "Started" does not stop a cancel; only a dead appointment does.
    return why.status === "started" ? { status: "not-pending" } : why;
  }

  return { status: "ok", appointment: toDetail(updated) };
}

/**
 * Gives a PENDING appointment a fresh `qrToken`. The old one stops resolving at
 * once — it simply no longer matches any row — and, because manage links are
 * signed over the current token, so does every manage link sent before. The
 * reference number is unchanged.
 *
 * Staff-only; the caller resends the confirmation email with the new code.
 */
export async function regenerateQrToken(
  id: string,
  actor: AppointmentActor,
  now: Date = new Date(),
): Promise<ChangeResult> {
  const updated = await prisma.$transaction(async (tx) => {
    const { count } = await tx.appointment.updateMany({
      where: { id, status: "PENDING", expiresAt: { gt: now } },
      data: { qrToken: createQrToken() },
    });

    if (count === 0) return null;

    // No token values in the log: both are bearer credentials.
    await logAppointmentEvent(tx, {
      appointmentId: id,
      type: "QR_REGENERATED",
      actor,
      detail: { previousCodeRevoked: true },
    });

    return tx.appointment.findUniqueOrThrow({
      where: { id },
      include: DETAIL_INCLUDE,
    });
  });

  if (!updated) {
    const why = await explainNoMatch(id, now);
    return why.status === "started" ? { status: "not-pending" } : why;
  }

  return { status: "ok", appointment: toDetail(updated) };
}

// ---------------------------------------------------------------------------
// Staff list (dashboard /appointments — the guards' expected-arrivals view)
// ---------------------------------------------------------------------------

export type AppointmentListItem = {
  id: string;
  referenceNumber: string;
  firstName: string;
  lastName: string;
  visitorEmail: string;
  purposeLabel: string | null;
  hostName: string;
  hostDepartment: string;
  /** ISO strings; this crosses to the client. */
  scheduledFor: string;
  expiresAt: string;
  status: AppointmentStatus;
  /**
   * PENDING and not lapsed: still expected, so every row action applies.
   * Whether it may be checked in *right now* is the server's call at click
   * time, through the same rule as the kiosk.
   */
  open: boolean;
  /** The `YYYY-MM-DD` day it falls on, in the building's time zone. */
  dayKey: string;
  checkedInAt: string | null;
  cancelledBy: CancelledBy | null;
  cancelReason: string | null;
  events: AppointmentEventRecord[];
};

export type StaffAppointmentLists = {
  today: AppointmentListItem[];
  upcoming: AppointmentListItem[];
  /** The building's today, `YYYY-MM-DD`. */
  todayKey: string;
};

/**
 * Today's appointments and the next `STAFF_UPCOMING_DAYS` days', each with its
 * event log.
 *
 * "Today" also carries any still-valid appointment from an earlier day — a
 * 23:00 booking stays redeemable past midnight — so a guard never has to look
 * elsewhere for someone who may walk in now. Ordered by expected time, which is
 * the question at a front desk.
 */
export async function listStaffAppointments(
  now: Date = new Date(),
): Promise<StaffAppointmentLists> {
  const todayKey = dateKeyInZone(now);
  const todayStart = zonedTimeToUtc(todayKey, "00:00");
  const tomorrowStart = zonedTimeToUtc(addDaysToKey(todayKey, 1), "00:00");
  const windowEnd = zonedTimeToUtc(
    addDaysToKey(todayKey, STAFF_UPCOMING_DAYS + 1),
    "00:00",
  );

  const appointments = await prisma.appointment.findMany({
    where: {
      OR: [
        { scheduledFor: { gte: todayStart, lt: windowEnd } },
        {
          scheduledFor: { lt: todayStart },
          status: "PENDING",
          expiresAt: { gt: now },
        },
      ],
    },
    orderBy: [{ scheduledFor: "asc" }, { createdAt: "asc" }],
    include: {
      ...DETAIL_INCLUDE,
      events: { orderBy: { createdAt: "asc" }, select: EVENT_SELECT },
    },
  });

  const items = appointments.map((appointment): AppointmentListItem => ({
    id: appointment.id,
    referenceNumber: appointment.referenceNumber,
    firstName: appointment.firstName,
    lastName: appointment.lastName,
    visitorEmail: appointment.visitorEmail,
    purposeLabel: appointment.purpose?.label ?? null,
    hostName: appointment.host.name,
    hostDepartment: appointment.host.department,
    scheduledFor: appointment.scheduledFor.toISOString(),
    expiresAt: appointment.expiresAt.toISOString(),
    status: appointment.status,
    open: lifecycleFailure(appointment, now) === null,
    dayKey: dateKeyInZone(appointment.scheduledFor),
    checkedInAt: appointment.visit?.checkInTime.toISOString() ?? null,
    cancelledBy: appointment.cancelledBy,
    cancelReason: appointment.cancelReason,
    events: appointment.events.map(toEventRecord),
  }));

  return {
    todayKey,
    today: items.filter(
      (item) => new Date(item.scheduledFor).getTime() < tomorrowStart.getTime(),
    ),
    upcoming: items.filter(
      (item) => new Date(item.scheduledFor).getTime() >= tomorrowStart.getTime(),
    ),
  };
}

/** Appointments still expected today, for the dashboard nav's count. */
export async function countExpectedToday(now: Date = new Date()): Promise<number> {
  const todayKey = dateKeyInZone(now);

  return prisma.appointment.count({
    where: {
      status: "PENDING",
      expiresAt: { gt: now },
      scheduledFor: {
        lt: zonedTimeToUtc(addDaysToKey(todayKey, 1), "00:00"),
      },
    },
  });
}

// ---------------------------------------------------------------------------
// Visitor self-service
// ---------------------------------------------------------------------------

/**
 * Whether a verified visitor (see `VerifiedClaim`) may see this appointment:
 * it is linked to their profile, or it was booked to their exact email + name
 * pair. The second covers bookings left unlinked because the pair already had a
 * profile and the booker had not verified — the code they just entered proves
 * they own that inbox, which is where the confirmation went anyway.
 */
export function belongsToClaim(
  appointment: Pick<
    AppointmentDetail,
    "visitorProfileId" | "visitorEmail" | "firstName" | "lastName"
  >,
  claim: VerifiedClaim,
): boolean {
  if (appointment.visitorProfileId === claim.profileId) return true;

  return (
    normalizeEmail(appointment.visitorEmail) === claim.email &&
    makeNameKey(appointment.firstName, appointment.lastName) === claim.nameKey
  );
}

/** The verified visitor's appointments that have not lapsed, soonest first. */
export async function listVisitorAppointments(
  claim: VerifiedClaim,
  now: Date = new Date(),
): Promise<AppointmentDetail[]> {
  const appointments = await prisma.appointment.findMany({
    where: {
      expiresAt: { gt: now },
      OR: [
        { visitorProfileId: claim.profileId },
        { visitorEmail: { equals: claim.email, mode: "insensitive" } },
      ],
    },
    orderBy: { scheduledFor: "asc" },
    include: DETAIL_INCLUDE,
  });

  return appointments
    .map(toDetail)
    .filter((appointment) => belongsToClaim(appointment, claim));
}

// ---------------------------------------------------------------------------
// Visitor pass lookups
// ---------------------------------------------------------------------------

/**
 * What a scanned pass can check its holder into right now: their PENDING
 * appointments that pass the same `classifyAppointment()` rule as a scanned
 * appointment QR (so: today, inside the check-in window), plus any later today
 * that are still too early, so the kiosk can say when check-in opens.
 *
 * "Their" means the same as on the manage page (`belongsToClaim()`): linked to
 * the profile, or booked to its exact email + name.
 */
export async function findPassAppointments(
  profile: { id: string; email: string; nameKey: string },
  now: Date = new Date(),
): Promise<{ ready: AppointmentDetail[]; laterToday: AppointmentDetail[] }> {
  const tomorrowStart = zonedTimeToUtc(
    addDaysToKey(dateKeyInZone(now), 1),
    "00:00",
  );

  const appointments = await prisma.appointment.findMany({
    where: {
      status: "PENDING",
      expiresAt: { gt: now },
      scheduledFor: { lt: tomorrowStart },
      OR: [
        { visitorProfileId: profile.id },
        { visitorEmail: { equals: profile.email, mode: "insensitive" } },
      ],
    },
    orderBy: { scheduledFor: "asc" },
    include: DETAIL_INCLUDE,
  });

  const claim = {
    profileId: profile.id,
    email: profile.email,
    nameKey: profile.nameKey,
  };
  const mine = appointments.filter((row) => belongsToClaim(toDetail(row), claim));

  return {
    ready: mine
      .filter((row) => classifyAppointment(row, now) === null)
      .map(toDetail),
    laterToday: mine
      .filter((row) => classifyAppointment(row, now) === "TOO_EARLY")
      .map(toDetail),
  };
}
