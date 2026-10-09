import { NextResponse } from "next/server";

import { createAppointment } from "@/lib/appointments";
import { sendAppointmentEmail } from "@/lib/email";
import { parseNameParts } from "@/lib/names";
import { prisma } from "@/lib/prisma";
import { findSelectablePurpose } from "@/lib/purposes";
import { getSession } from "@/lib/session";

const MAX_EMAIL = 200;
const MAX_PHONE = 40;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

/**
 * POST /api/appointments/manage — staff pre-register a visitor from the
 * dashboard.
 *
 * Staff-only, unlike `POST /api/appointments`, which is the public booking
 * form's. Both go through `createAppointment()`, so a desk booking gets the
 * same QR token, expiry, profile handling and confirmation email as a public
 * one. Two deliberate differences: no consent is recorded (the visitor never
 * saw the form), and the time is any future moment rather than one of the
 * public booking slots, because the desk may need to fit someone in.
 */
export async function POST(request: Request) {
  const session = await getSession();

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const fields = (body ?? {}) as Record<string, unknown>;
  const name = parseNameParts(fields);
  const email =
    typeof fields.visitorEmail === "string" ? fields.visitorEmail.trim() : "";
  const phone =
    typeof fields.visitorPhone === "string" ? fields.visitorPhone.trim() : "";
  const purposeId = typeof fields.purposeId === "string" ? fields.purposeId : "";
  const hostId = typeof fields.hostId === "string" ? fields.hostId : "";
  const rawSchedule =
    typeof fields.scheduledFor === "string" ? fields.scheduledFor.trim() : "";

  const fieldErrors: Record<string, string> = name.ok ? {} : { ...name.errors };

  if (!email) {
    fieldErrors.visitorEmail = "Please enter the visitor's email address.";
  } else if (email.length > MAX_EMAIL || !EMAIL_PATTERN.test(email)) {
    fieldErrors.visitorEmail = "Please enter a valid email address.";
  }

  if (phone.length > MAX_PHONE) {
    fieldErrors.visitorPhone = `Please keep this under ${MAX_PHONE} characters.`;
  }

  if (!purposeId) fieldErrors.purposeId = "Please choose the purpose of the visit.";
  if (!hostId) fieldErrors.hostId = "Please choose who they are here to see.";

  // An ISO instant from the browser. Required: the appointment's expiry is
  // derived from it, and the kiosk turns a lapsed one away.
  const scheduled = rawSchedule ? new Date(rawSchedule) : null;

  if (!scheduled || Number.isNaN(scheduled.getTime())) {
    fieldErrors.scheduledFor = "Please choose when they are expected.";
  } else if (scheduled.getTime() <= Date.now()) {
    fieldErrors.scheduledFor = "Please choose a time in the future.";
  }

  if (!name.ok || Object.keys(fieldErrors).length > 0) {
    return NextResponse.json({ fieldErrors }, { status: 400 });
  }

  try {
    const [host, purpose] = await Promise.all([
      prisma.host.findFirst({
        where: { id: hostId, active: true },
        select: { id: true },
      }),
      findSelectablePurpose(purposeId),
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

    const appointment = await createAppointment({
      firstName: name.firstName,
      lastName: name.lastName,
      visitorEmail: email,
      visitorPhone: phone || null,
      purposeId: purpose.id,
      hostId: host.id,
      scheduledFor: scheduled as Date,
      verified: null,
      consentAcceptedAt: null,
    });

    const sent = await sendAppointmentEmail({
      firstName: appointment.firstName,
      visitorEmail: appointment.visitorEmail,
      referenceNumber: appointment.referenceNumber,
      qrToken: appointment.qrToken,
      purposeLabel: appointment.purposeLabel,
      hostName: appointment.hostName,
      hostDepartment: appointment.hostDepartment,
      scheduledFor: appointment.scheduledFor,
    });

    return NextResponse.json(
      {
        appointment: {
          referenceNumber: appointment.referenceNumber,
          firstName: appointment.firstName,
          lastName: appointment.lastName,
          visitorEmail: appointment.visitorEmail,
        },
        emailSent: sent.sent,
      },
      { status: 201 },
    );
  } catch (error) {
    console.error("POST /api/appointments/manage failed", error);
    return NextResponse.json(
      { error: "Could not create this appointment." },
      { status: 500 },
    );
  }
}
