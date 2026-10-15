import { logger } from "@/lib/logger";
import { withApi } from "@/lib/api";
import { after, NextResponse } from "next/server";

import { readJsonBody } from "@/lib/appointment-responses";
import { getSession } from "@/lib/session";
import {
  emailPass,
  getActivePass,
  issuePass,
  revokePass,
  rotatePass,
} from "@/lib/visitor-pass";
import { prisma } from "@/lib/prisma";

/**
 * POST /api/visitors/[profileId]/pass — staff manage a profile's visitor pass.
 *
 * Staff-only. Body `{ action }`:
 * - `issue`  — a new STAFF_ISSUED pass, emailed. 409 if one is already usable.
 * - `revoke` — the ACTIVE pass stops working for good. A staff revocation also
 *   stops automatic re-issuance (see `evaluateRecurringVisitor()`).
 * - `rotate` — bump the version (the old QR dies) and email the new one.
 * - `send` — queue the current QR again.
 */
async function POSTHandler(
  request: Request,
  context: RouteContext<"/api/visitors/[profileId]/pass">,
) {
  const session = await getSession();

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { profileId } = await context.params;
  const { action } = await readJsonBody(request);

  try {
    const profile = await prisma.visitorProfile.findUnique({
      where: { id: profileId },
      select: { id: true },
    });

    if (!profile) {
      return NextResponse.json({ error: "No such visitor." }, { status: 404 });
    }

    if (action === "issue") {
      const result = await issuePass(profileId, {
        reason: "STAFF_ISSUED",
        actorUserId: session.userId,
      });

      if (result.status === "already-active") {
        return NextResponse.json(
          { error: "This visitor already has an active pass. Rotate it to send a new code." },
          { status: 409 },
        );
      }

      after(() => emailPass(result.pass, "issued"));
      return NextResponse.json({ status: "issued", emailSent: false, emailQueued: true });
    }

    const active = await getActivePass(profileId);

    if (!active) {
      return NextResponse.json(
        { error: "This visitor has no active pass." },
        { status: 409 },
      );
    }

    if (action === "send") {
      after(() => emailPass(active, "issued"));
      return NextResponse.json({ status: "sent", emailSent: false, emailQueued: true });
    }

    if (action === "revoke") {
      const revoked = await revokePass(active.id, session.userId);
      return revoked
        ? NextResponse.json({ status: "revoked" })
        : NextResponse.json({ error: "This pass is no longer active." }, { status: 409 });
    }

    if (action === "rotate") {
      const rotated = await rotatePass(active.id);

      if (!rotated) {
        return NextResponse.json(
          { error: "This pass has expired. Issue a new one instead." },
          { status: 409 },
        );
      }

      after(() => emailPass(rotated, "replaced"));
      return NextResponse.json({ status: "rotated", emailSent: false, emailQueued: true });
    }

    return NextResponse.json(
      { error: "Unknown action. Use issue, send, revoke or rotate." },
      { status: 400 },
    );
  } catch (error) {
    logger.error("POST /api/visitors/[profileId]/pass failed", error);
    return NextResponse.json(
      { error: "Could not update this pass." },
      { status: 500 },
    );
  }
}

export const POST = withApi(POSTHandler);
