import { ApiError, boundedJson, withApi } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { consumeDatabaseRateLimit } from "@/lib/database-rate-limit";
import { KIOSK_HEARTBEAT_IP_LIMIT } from "@/lib/booking-config";
import { clientIp } from "@/lib/rate-limit";

export const POST = withApi(async (request: Request) => {
  const limit = await consumeDatabaseRateLimit(`heartbeat:${clientIp(request.headers)}`, KIOSK_HEARTBEAT_IP_LIMIT);
  if (!limit.allowed) return Response.json({ error: "Too many heartbeats. Please wait a minute." }, { status: 429, headers: { "Retry-After": String(limit.retryAfter) } });
  const body = await boundedJson(request, 256);
  if (Object.keys(body).length !== 1 || typeof body.deviceId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.deviceId)) throw new ApiError(400, "INVALID_DEVICE", "A valid device ID is required.");
  await prisma.kioskDevice.upsert({ where: { deviceId: body.deviceId }, create: { deviceId: body.deviceId }, update: { lastSeenAt: new Date() } });
  return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
});
