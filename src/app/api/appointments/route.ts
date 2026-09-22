import { NextResponse } from "next/server";

import { createAppointment } from "@/lib/appointments";
import { getSession } from "@/lib/session";

/**
 * POST /api/appointments — pre-register a visitor.
 *
 * Staff-only, unlike the lookup and check-in routes beside it: those are the
 * kiosk's, this is the front desk's. The reference number is generated here
 * rather than supplied, so a caller cannot choose a guessable one.
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

  const { visitorName, purpose, hostId, scheduledFor } = (body ?? {}) as Record<
    string,
    unknown
  >;

  const trimmedName = typeof visitorName === "string" ? visitorName.trim() : "";
  const trimmedPurpose = typeof purpose === "string" ? purpose.trim() : "";
  const selectedHostId = typeof hostId === "string" ? hostId : "";

  const fieldErrors: Record<string, string> = {};

  if (!trimmedName) {
    fieldErrors.visitorName = "Please enter the visitor's name.";
  }

  if (!trimmedPurpose) {
    fieldErrors.purpose = "Please enter the purpose of the visit.";
  }

  if (!selectedHostId) {
    fieldErrors.hostId = "Please choose who they are here to see.";
  }

  // Optional, but if one is given it has to be a real date — an unparseable
  // string must not reach Prisma as an Invalid Date and land as null.
  let scheduled: Date | null = null;

  if (typeof scheduledFor === "string" && scheduledFor.trim()) {
    const parsed = new Date(scheduledFor);

    if (Number.isNaN(parsed.getTime())) {
      fieldErrors.scheduledFor = "That date and time could not be read.";
    } else {
      scheduled = parsed;
    }
  }

  if (Object.keys(fieldErrors).length > 0) {
    return NextResponse.json({ fieldErrors }, { status: 400 });
  }

  try {
    const result = await createAppointment({
      visitorName: trimmedName,
      purpose: trimmedPurpose,
      hostId: selectedHostId,
      scheduledFor: scheduled,
    });

    if (result.status === "unknown-host") {
      return NextResponse.json(
        { fieldErrors: { hostId: "That host is no longer available." } },
        { status: 400 },
      );
    }

    return NextResponse.json({ appointment: result.appointment }, { status: 201 });
  } catch (error) {
    console.error("POST /api/appointments failed", error);
    return NextResponse.json(
      { error: "Could not create this appointment." },
      { status: 500 },
    );
  }
}
