import { ApiError, boundedJson, withApi } from "@/lib/api";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";

export const GET = withApi(async () => {
  if (!await getSession()) throw new ApiError(401, "UNAUTHORIZED", "Please sign in.");
  return Response.json({ devices: await prisma.kioskDevice.findMany({ orderBy: { createdAt: "asc" } }), time: new Date().toISOString() }, { headers: { "Cache-Control": "private, no-store" } });
});
export const PATCH = withApi(async (request: Request) => {
  const session = await getSession();
  if (!session) throw new ApiError(401, "UNAUTHORIZED", "Please sign in.");
  if (session.role !== "ADMIN") throw new ApiError(403, "FORBIDDEN", "Administrator access is required.");
  const body = await boundedJson(request);
  if (typeof body.id !== "string" || body.id.length > 100 || (body.label !== undefined && (typeof body.label !== "string" || body.label.trim().length > 80)) || (body.retire !== undefined && body.retire !== true)) throw new ApiError(400, "INVALID_REQUEST", "Please enter a label of at most 80 characters.");
  const result = await prisma.kioskDevice.updateMany({ where: { id: body.id }, data: { ...(typeof body.label === "string" ? { label: body.label.trim() || null } : {}), ...(body.retire === true ? { retiredAt: new Date() } : {}) } });
  if (!result.count) throw new ApiError(404, "NOT_FOUND", "Device not found.");
  return Response.json({ ok: true });
});
