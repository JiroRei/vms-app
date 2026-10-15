import { logger } from "@/lib/logger";
import { withApi } from "@/lib/api";
import { cookies } from "next/headers";
import { after, NextResponse } from "next/server";

import { appBaseUrl, manageUrl } from "@/lib/appointment-access";
import { emailAppointment } from "@/lib/appointment-notify";
import {
  AppointmentSlotUnavailableError,
  createAppointment,
} from "@/lib/appointments";
import { checkSlot, PUBLIC_BOOKING_EMAIL_LIMIT, PUBLIC_BOOKING_IP_LIMIT } from "@/lib/booking-config";
import { consumeDatabaseRateLimit } from "@/lib/database-rate-limit";
import { BOOKING_PASS_COOKIE_NAME, BOOKING_PASS_COOKIE_PATH, readBookingPassClaim } from "@/lib/booking-pass";
import {
  readVerifiedCookie,
  VERIFIED_COOKIE_NAME,
} from "@/lib/booking-verification";
import { parseNameParts } from "@/lib/names";
import { prisma } from "@/lib/prisma";
import { findSelectablePurpose } from "@/lib/purposes";
import { renderQrDataUrl } from "@/lib/qr";
import { getClientIp } from "@/lib/client-ip";

/** Caps on the free-text fields, so a paste cannot write an essay to the table. */
const MAX_EMAIL = 200;
const MAX_PHONE = 40;

/**
 * Deliberately permissive: the real test of an address is whether the
 * confirmation arrives, and a stricter pattern mostly rejects valid addresses.
 * This catches typing a name into the email box.
 */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

/**
 * POST /api/appointments — book a visit from the public booking page.
 *
 * Deliberately unauthenticated: anyone invited to the building can book, which
 * is the point of `/appointment-booking` being public.
 *
 * The appointment is created first and the email sent afterwards, never the
 * other way round. A mail outage must not cost someone their booking, so a
 * failed send comes back as `emailSent: false` and the confirmation screen falls
 * back to showing the reference number — which still checks them in.
 *
 * `scheduledFor` arrives as a `YYYY-MM-DDTHH:mm` wall-clock slot in the
 * building's time zone and is re-checked against `src/lib/booking-config.ts`
 * (on a slot boundary, inside the booking window, in the future) before being
 * stored as a UTC instant. `consent` must be `true`.
 *
 * Which visitor profile the booking joins is decided by the email + name pair
 * (`resolveBookingProfile()`, run inside `createAppointment()`'s transaction);
 * a verified returning visitor is booked under their stored name.
 */
async function POSTHandler(request: Request) {
  const limit = await consumeDatabaseRateLimit(
    `public-booking:${getClientIp(request.headers)}`,
    PUBLIC_BOOKING_IP_LIMIT,
  );
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many booking attempts. Please try again later." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfter) } },
    );
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const fields = (body ?? {}) as Record<string, unknown>;
  const {
    visitorEmail,
    visitorPhone,
    hostId,
    purposeId,
    scheduledFor,
    consent,
  } = fields;

  const name = parseNameParts(fields);
  const email = typeof visitorEmail === "string" ? visitorEmail.trim() : "";
  const phone = typeof visitorPhone === "string" ? visitorPhone.trim() : "";
  const selectedHostId = typeof hostId === "string" ? hostId : "";
  const selectedPurposeId = typeof purposeId === "string" ? purposeId : "";
  const rawSchedule = typeof scheduledFor === "string" ? scheduledFor.trim() : "";

  const fieldErrors: Record<string, string> = name.ok ? {} : { ...name.errors };

  if (!email) {
    fieldErrors.visitorEmail = "Please enter your email address.";
  } else if (email.length > MAX_EMAIL || !EMAIL_PATTERN.test(email)) {
    fieldErrors.visitorEmail = "Please enter a valid email address.";
  }

  if (phone.length > MAX_PHONE) {
    fieldErrors.visitorPhone = `Please keep this under ${MAX_PHONE} characters.`;
  }

  if (!selectedHostId) {
    fieldErrors.hostId = "Please choose who you are visiting.";
  }

  if (!selectedPurposeId) {
    fieldErrors.purposeId = "Please say what the visit is about.";
  }

  const now = new Date();
  const slot = checkSlot(rawSchedule, now);

  if (!slot.ok) {
    fieldErrors.scheduledFor = slot.error;
  }

  if (consent !== true) {
    fieldErrors.consent = "Please agree to the Privacy Policy to continue.";
  }

  if (!name.ok || Object.keys(fieldErrors).length > 0) {
    return NextResponse.json({ fieldErrors }, { status: 400 });
  }

  const emailLimit = await consumeDatabaseRateLimit(`public-booking-email:${email.toLowerCase()}`, PUBLIC_BOOKING_EMAIL_LIMIT);
  if (!emailLimit.allowed) return NextResponse.json({ error: "Too many bookings for this email. Please try again in an hour or ask the guard for help." }, { status: 429, headers: { "Retry-After": String(emailLimit.retryAfter) } });

  try {
    // Both checked up front so an unknown id is a 400 rather than a
    // foreign-key 500, and so a retired purpose cannot be booked against.
    const [host, purpose] = await Promise.all([
      prisma.host.findFirst({
        where: { id: selectedHostId, active: true },
        select: { id: true },
      }),
      findSelectablePurpose(selectedPurposeId),
    ]);

    if (!host) {
      return NextResponse.json(
        { fieldErrors: { hostId: "That host is no longer available." } },
        { status: 400 },
      );
    }

    if (!purpose) {
      return NextResponse.json(
        { fieldErrors: { purposeId: "That purpose is no longer available." } },
        { status: 400 },
      );
    }

    const cookieStore = await cookies();
    const passToken = cookieStore.get(BOOKING_PASS_COOKIE_NAME)?.value;
    const passClaim = passToken ? await readBookingPassClaim(passToken, now) : null;
    if (passToken && !passClaim) {
      cookieStore.delete({ name: BOOKING_PASS_COOKIE_NAME, path: BOOKING_PASS_COOKIE_PATH });
      return NextResponse.json({ error: "Your visitor pass is no longer active. Use your name and email to continue.", reauthenticate: true }, { status: 401 });
    }
    const verified = passClaim ?? readVerifiedCookie(
      cookieStore.get(VERIFIED_COOKIE_NAME)?.value,
      now,
    );

    const appointment = await createAppointment({
      firstName: name.firstName,
      lastName: name.lastName,
      visitorEmail: email,
      visitorPhone: phone || null,
      purposeId: purpose.id,
      hostId: selectedHostId,
      // Narrowed above: any failed slot check has already returned a 400.
      scheduledFor: (slot as { scheduledFor: Date }).scheduledFor,
      verified,
      consentAcceptedAt: now,
      actor: { type: "VISITOR" },
    });

    // The proof has done its job; don't leave it on what may be a shared device.
    if (verified) {
      cookieStore.delete(VERIFIED_COOKIE_NAME);
      cookieStore.delete({ name: BOOKING_PASS_COOKIE_NAME, path: BOOKING_PASS_COOKIE_PATH });
    }

    // Past the point of no return for the booking — from here nothing may throw
    // its way out and make a created appointment look like a failure.
    const baseUrl = appBaseUrl(request);
    after(() => emailAppointment(appointment, baseUrl, "confirmed"));
    const qrDataUrl = await renderQrDataUrl(appointment.qrToken).catch(() => null);

    return NextResponse.json(
      {
        appointment: {
          referenceNumber: appointment.referenceNumber,
          firstName: appointment.firstName,
          lastName: appointment.lastName,
          visitorEmail: appointment.visitorEmail,
          purposeLabel: appointment.purposeLabel,
          hostName: appointment.hostName,
          hostDepartment: appointment.hostDepartment,
          scheduledFor: appointment.scheduledFor.toISOString(),
          expiresAt: appointment.expiresAt.toISOString(),
        },
        qrDataUrl,
        emailSent: false,
        emailQueued: true,
        // The person on this page just booked it, so they get the same link
        // the email carries.
        manageUrl: manageUrl(appBaseUrl(request), appointment),
      },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof AppointmentSlotUnavailableError) {
      return NextResponse.json(
        { fieldErrors: { scheduledFor: "That host is already booked for this time. Please choose another slot." } },
        { status: 409 },
      );
    }
    logger.error("POST /api/appointments failed", error);
    return NextResponse.json(
      { error: "Could not book this visit. Please try again." },
      { status: 500 },
    );
  }
}

export const POST = withApi(POSTHandler);
