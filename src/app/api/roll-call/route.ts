import { withApi } from "@/lib/api";
import { requireStaffApi } from "@/lib/api-auth";
import { loadRollCall } from "@/lib/staff-data";

export const dynamic = "force-dynamic";
export const GET = withApi(async () => {
  await requireStaffApi();
  return Response.json(await loadRollCall(), { headers: { "Cache-Control": "private, no-store" } });
});
