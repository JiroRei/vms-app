import { withApi } from "@/lib/api";
import { requireStaffApi } from "@/lib/api-auth";
import { loadDashboardStats } from "@/lib/staff-data";

export const dynamic = "force-dynamic";
export const GET = withApi(async () => {
  await requireStaffApi();

  return Response.json(
    { stats: await loadDashboardStats() },
    { headers: { "Cache-Control": "private, no-store" } },
  );
});
