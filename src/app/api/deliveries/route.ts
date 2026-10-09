import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { createDeliveryLog } from "@/lib/visits";
import { getSession } from "@/lib/session";

/** Caps on the free-text fields, so a paste cannot write an essay to the table. */
const MAX_NAME = 120;
const MAX_DEPARTMENT = 120;
const MAX_NOTE = 280;

/**
 * POST /api/deliveries — log a courier drop-off from the guard dashboard.
 *
 * Staff-only, unlike `POST /api/visits`: deliveries are recorded by whoever is
 * on the desk, never by the visitor-facing kiosk. The record it writes is
 * already complete — see `createDeliveryLog()`.
 *
 * Both recipient fields are optional and either may be used: `hostId` when the
 * guard picked a known host, `recipientDepartment` when they typed one. If both
 * arrive, the host wins and the free text is dropped, so a row never claims two
 * different destinations.
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

  const { name, hostId, recipientDepartment, note } = (body ?? {}) as Record<
    string,
    unknown
  >;

  const trimmedName = typeof name === "string" ? name.trim() : "";
  const selectedHostId = typeof hostId === "string" ? hostId : "";
  const typedDepartment =
    typeof recipientDepartment === "string" ? recipientDepartment.trim() : "";
  const trimmedNote = typeof note === "string" ? note.trim() : "";

  const fieldErrors: Record<string, string> = {};

  if (!trimmedName) {
    fieldErrors.name = "Please enter the courier or company name.";
  } else if (trimmedName.length > MAX_NAME) {
    fieldErrors.name = `Please keep this under ${MAX_NAME} characters.`;
  }

  if (typedDepartment.length > MAX_DEPARTMENT) {
    fieldErrors.recipientDepartment = `Please keep this under ${MAX_DEPARTMENT} characters.`;
  }

  if (trimmedNote.length > MAX_NOTE) {
    fieldErrors.note = `Please keep the note under ${MAX_NOTE} characters.`;
  }

  if (Object.keys(fieldErrors).length > 0) {
    return NextResponse.json({ fieldErrors }, { status: 400 });
  }

  try {
    // Checked up front so an unknown host is a 400 rather than a foreign-key 500.
    if (selectedHostId) {
      const host = await prisma.host.findUnique({
        where: { id: selectedHostId },
        select: { id: true },
      });

      if (!host) {
        return NextResponse.json(
          {
            fieldErrors: {
              hostId: "That department is no longer available.",
            },
          },
          { status: 400 },
        );
      }
    }

    const created = await createDeliveryLog({
      name: trimmedName,
      loggedBy: { id: session.userId, name: session.name },
      hostId: selectedHostId || null,
      recipientDepartment: selectedHostId ? null : typedDepartment || null,
      note: trimmedNote || null,
    });

    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    console.error("POST /api/deliveries failed", error);
    return NextResponse.json(
      { error: "Could not log this delivery. Please try again." },
      { status: 500 },
    );
  }
}
