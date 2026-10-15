import { withApi } from "@/lib/api";
import { requireAdminApi } from "@/lib/api-auth";
import { getHistoryQuery } from "@/lib/history";
import { loadVisitExport } from "@/lib/staff-data";

export const runtime = "nodejs";

async function GETHandler(request: Request) {
  // 401 for anonymous callers, 403 for guards (KNOWN_ISSUES N-06).
  await requireAdminApi("Only administrators can export visits.");
  const params: Record<string, string | string[]> = {};
  for (const [key, value] of new URL(request.url).searchParams) {
    const previous = params[key];
    params[key] = previous === undefined ? value : [...(Array.isArray(previous) ? previous : [previous]), value];
  }
  const query = getHistoryQuery(params);
  const filename = `visits_${query.filters.from || "all"}_to_${query.filters.to || "all"}.csv`;
  return new Response(await loadVisitExport(query), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export const GET = withApi(GETHandler);
