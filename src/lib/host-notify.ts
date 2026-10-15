import "server-only";

import { prisma } from "@/lib/prisma";
import { sendHostArrivalEmail } from "@/lib/email";
import { reportError } from "@/lib/logger";

/** Host email is optional; delivery failure never rolls back a completed visit. */
export async function notifyHostArrival(input: {
  hostId: string;
  firstName: string;
  lastName: string;
  purposeLabel: string | null;
  checkedInAt: Date;
}): Promise<void> {
  try {
    const host = await prisma.host.findUnique({
      where: { id: input.hostId },
      select: { name: true, email: true },
    });
    if (!host?.email) return;
    await sendHostArrivalEmail({
      email: host.email,
      hostName: host.name,
      visitorName: [input.firstName, input.lastName].filter(Boolean).join(" "),
      purpose: input.purposeLabel,
      checkedInAt: input.checkedInAt,
    });
  } catch (cause) {
    await reportError(cause, { operation: "hostArrivalRecipient" });
  }
}
