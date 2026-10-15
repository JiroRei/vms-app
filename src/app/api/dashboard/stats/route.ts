import { ApiError, withApi } from "@/lib/api";
import { getDashboardStats } from "@/lib/dashboard-stats";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";
export const GET = withApi(async () => {
  if (!(await getSession())) {
    throw new ApiError(
      401,
      "UNAUTHORIZED",
      "Please sign in to view dashboard stats.",
    );
  }

  return Response.json(
    { stats: await getDashboardStats() },
    { headers: { "Cache-Control": "private, no-store" } },
  );
});
