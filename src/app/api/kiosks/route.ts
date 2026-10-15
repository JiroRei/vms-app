import { ApiError, boundedJson, withApi } from "@/lib/api";
import { requireAdminApi, requireStaffApi } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";
import { loadKioskDevices } from "@/lib/staff-data";

export const GET = withApi(async () => {
  await requireStaffApi();
  return Response.json({ devices: await loadKioskDevices(), time: new Date().toISOString() }, { headers: { "Cache-Control": "private, no-store" } });
});
export const PATCH = withApi(async (request: Request) => {
  await requireAdminApi("Administrator access is required.");
  const body = await boundedJson(request);
  if (body.action !== undefined && body.action !== "approve" && body.action !== "dismiss") throw new ApiError(400, "INVALID_REQUEST", "Choose Approve or Dismiss.");
  if (body.action !== undefined && body.retire !== undefined) throw new ApiError(400, "INVALID_REQUEST", "Choose one device action.");
  if (typeof body.id !== "string" || body.id.length > 100 || (body.label !== undefined && (typeof body.label !== "string" || body.label.trim().length > 80)) || (body.retire !== undefined && body.retire !== true)) throw new ApiError(400, "INVALID_REQUEST", "Please enter a label of at most 80 characters.");
  const result = await prisma.kioskDevice.updateMany({
    where: { id: body.id, ...(body.action ? { registrationStatus: "PENDING", retiredAt: null } : {}) },
    data: {
      ...(typeof body.label === "string" ? { label: body.label.trim() || null } : {}),
      ...(body.retire === true || body.action === "dismiss" ? { retiredAt: new Date(), registrationStatus: "RETIRED" } : {}),
      ...(body.action === "approve" ? { registrationStatus: "APPROVED" } : {}),
    },
  });
  if (!result.count) throw new ApiError(404, "NOT_FOUND", "Device not found.");
  return Response.json({ ok: true });
});
