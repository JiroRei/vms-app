import { ApiError, boundedJson, withApi } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { consumeDatabaseRateLimit } from "@/lib/database-rate-limit";
import { KIOSK_CREATION_IP_LIMIT, KIOSK_HEARTBEAT_DEVICE_LIMIT, KIOSK_HEARTBEAT_IP_LIMIT } from "@/lib/booking-config";
import { getClientIp } from "@/lib/client-ip";
import { registerKioskHeartbeat } from "@/lib/kiosk-registration";

const tooMany = (retryAfter: number) => Response.json({ error: "Too many device requests. Please wait before trying again." }, { status: 429, headers: { "Retry-After": String(retryAfter) } });

export const POST = withApi(async (request: Request) => {
  const limit = await consumeDatabaseRateLimit(`heartbeat:${getClientIp(request.headers)}`, KIOSK_HEARTBEAT_IP_LIMIT);
  if (!limit.allowed) return tooMany(limit.retryAfter);
  const body = await boundedJson(request, 256);
  if (Object.keys(body).length !== 1 || typeof body.deviceId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.deviceId)) throw new ApiError(400, "INVALID_DEVICE", "A valid device ID is required.");
  // Per device as well as per address, so one device cannot flood from many
  // addresses (KNOWN_ISSUES M-01).
  const deviceLimit = await consumeDatabaseRateLimit(`heartbeat-device:${body.deviceId.toLowerCase()}`, KIOSK_HEARTBEAT_DEVICE_LIMIT);
  if (!deviceLimit.allowed) return tooMany(deviceLimit.retryAfter);
  const deviceId = body.deviceId.toLowerCase();
  const existing = await prisma.kioskDevice.findUnique({ where: { deviceId }, select: { id: true } });
  if (!existing) {
    const creationLimit = await consumeDatabaseRateLimit(`kiosk-registration:${getClientIp(request.headers)}`, KIOSK_CREATION_IP_LIMIT);
    if (!creationLimit.allowed) return tooMany(creationLimit.retryAfter);
  }
  if (!await registerKioskHeartbeat(deviceId)) throw new ApiError(429, "PENDING_LIMIT", "Unconfirmed device limit reached. Please contact an administrator.");
  return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
});
