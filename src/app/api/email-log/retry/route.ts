import { after } from "next/server";
import { ApiError, boundedJson, withApi } from "@/lib/api";
import { requireAdminApi } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";
import { processEmailOutbox } from "@/lib/email-outbox";
export const POST = withApi(async (request: Request) => {
  await requireAdminApi("Administrator access is required.");
  const { id } = await boundedJson(request);
  if (typeof id !== "string" || id.length > 100) throw new ApiError(400, "INVALID_REQUEST", "Message ID is required.");
  const now = new Date();
  const row = await prisma.emailOutbox.findUnique({ where: { id }, select: { expiresAt: true, bodyClearedAt: true } });
  if (!row) throw new ApiError(404, "NOT_FOUND", "Message not found.");
  if (row.expiresAt && row.expiresAt <= now) throw new ApiError(409, "EXPIRED", "This message has expired. Request a new code instead.");
  // Bodies are deleted once a message can no longer be sent (KNOWN_ISSUES M-05).
  if (row.bodyClearedAt) throw new ApiError(409, "CONFLICT", "This message's content has been deleted. Send it again from where it started, for example by re-sending the pass.");
  const result = await prisma.emailOutbox.updateMany({ where: { id, status: { in: ["PENDING", "FAILED"] }, bodyClearedAt: null, OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }] }, data: { status: "PENDING", attempts: 0, nextAttemptAt: now, lastError: null } });
  if (!result.count) throw new ApiError(409, "CONFLICT", "This message has already been sent or is being processed.");
  after(async () => { await processEmailOutbox(); });
  return Response.json({ ok: true });
});
