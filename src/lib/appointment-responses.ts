import "server-only";

import { NextResponse } from "next/server";

import type { ChangeResult } from "@/lib/appointments";

/**
 * The HTTP answer for a reschedule, cancel or regenerate that changed nothing,
 * shared by the staff and visitor routes so both explain it the same way.
 */
export function changeFailureResponse(
  result: Exclude<ChangeResult, { status: "ok" }>,
  action: "reschedule" | "cancel" | "regenerate",
): NextResponse {
  if (result.status === "not-found") {
    return NextResponse.json(
      { error: "No appointment has that reference." },
      { status: 404 },
    );
  }

  if (result.status === "started") {
    return NextResponse.json(
      {
        error:
          "This appointment's time has already come, so it can no longer be moved. It can still be checked in or cancelled.",
      },
      { status: 409 },
    );
  }

  if (result.status === "slot-unavailable") {
    return NextResponse.json(
      { error: "That host is already booked for this time. Please choose another time." },
      { status: 409 },
    );
  }

  const verb = {
    reschedule: "rescheduled",
    cancel: "cancelled",
    regenerate: "given a new code",
  }[action];

  return NextResponse.json(
    {
      error: `This appointment can no longer be ${verb} — it was checked in, cancelled, or has expired.`,
    },
    { status: 409 },
  );
}

/** Reads a JSON body without throwing; an empty or invalid body is `{}`. */
export async function readJsonBody(
  request: Request,
): Promise<Record<string, unknown>> {
  try {
    const body = await request.json();
    return body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
