import { NextResponse } from "next/server";

import { Role } from "@/generated/prisma/enums";
import { getSession } from "@/lib/session";
import { deleteStaff, setStaffRole } from "@/lib/staff";

/** Both handlers need the same two answers, so they ask once. */
async function requireAdmin() {
  const session = await getSession();

  if (!session) {
    return {
      session: null,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }

  if (session.role !== Role.ADMIN) {
    return {
      session,
      response: NextResponse.json(
        { error: "Only administrators can manage staff accounts." },
        { status: 403 },
      ),
    };
  }

  return { session, response: null };
}

/** PATCH /api/staff/[id] — promote or demote. */
export async function PATCH(
  request: Request,
  context: RouteContext<"/api/staff/[id]">,
) {
  const { session, response } = await requireAdmin();
  if (response) return response;

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
  if (session && id === session.userId && role !== Role.ADMIN) {
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
    console.error(`PATCH /api/staff/${id} failed`, error);
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
export async function DELETE(
  _request: Request,
  context: RouteContext<"/api/staff/[id]">,
) {
  const { session, response } = await requireAdmin();
  if (response) return response;

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
    console.error(`DELETE /api/staff/${id} failed`, error);
    return NextResponse.json(
      { error: "Could not remove this account." },
      { status: 500 },
    );
  }
}
