import { logger } from "@/lib/logger";
import { withApi } from "@/lib/api";
import { requireAdminApi } from "@/lib/api-auth";
import { NextResponse } from "next/server";

import { Role } from "@/generated/prisma/enums";
import { deleteStaff, setStaffRole } from "@/lib/staff";

const ADMIN_ONLY = "Only administrators can manage staff accounts.";

/** PATCH /api/staff/[id] — promote or demote. */
async function PATCHHandler(
  request: Request,
  context: RouteContext<"/api/staff/[id]">,
) {
  const session = await requireAdminApi(ADMIN_ONLY);

  const { id } = await context.params;

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const { role } = (body ?? {}) as Record<string, unknown>;

  if (role !== Role.ADMIN && role !== Role.GUARD) {
    return NextResponse.json(
      { error: "Role must be ADMIN or GUARD." },
      { status: 400 },
    );
  }

  // Demoting yourself is allowed only while someone else can put you back; the
  // last-administrator check below is what actually decides that. Saying it
  // here as well means the message names the real problem.
  if (id === session.userId && role !== Role.ADMIN) {
    return NextResponse.json(
      {
        error:
          "You would lose administrator access. Ask another administrator to do it.",
      },
      { status: 409 },
    );
  }

  try {
    const result = await setStaffRole(id, role as Role);

    if (result.status === "not-found") {
      return NextResponse.json({ error: "Account not found." }, { status: 404 });
    }

    if (result.status === "last-admin") {
      return NextResponse.json(
        {
          error:
            "This is the only administrator. Promote someone else before demoting them.",
        },
        { status: 409 },
      );
    }

    return NextResponse.json({ staff: result.staff });
  } catch (error) {
    logger.error(`PATCH /api/staff/${id} failed`, error);
    return NextResponse.json(
      { error: "Could not update this account." },
      { status: 500 },
    );
  }
}

/**
 * DELETE /api/staff/[id] — remove a login.
 *
 * Sessions and the credential go with it by cascade. No visit history does —
 * nothing in the visit chain references `User`.
 */
async function DELETEHandler(
  _request: Request,
  context: RouteContext<"/api/staff/[id]">,
) {
  const session = await requireAdminApi(ADMIN_ONLY);

  const { id } = await context.params;

  // Deleting the account you are signed in as would end the session mid-request
  // and leave the page talking to a door that no longer opens.
  if (session && id === session.userId) {
    return NextResponse.json(
      { error: "You cannot delete the account you are signed in as." },
      { status: 409 },
    );
  }

  try {
    const result = await deleteStaff(id);

    if (result === "not-found") {
      return NextResponse.json({ error: "Account not found." }, { status: 404 });
    }

    if (result === "last-admin") {
      return NextResponse.json(
        {
          error:
            "This is the only administrator. Promote someone else before removing them.",
        },
        { status: 409 },
      );
    }

    return NextResponse.json({ deleted: true });
  } catch (error) {
    logger.error(`DELETE /api/staff/${id} failed`, error);
    return NextResponse.json(
      { error: "Could not remove this account." },
      { status: 500 },
    );
  }
}

export const PATCH = withApi(PATCHHandler);
export const DELETE = withApi(DELETEHandler);
