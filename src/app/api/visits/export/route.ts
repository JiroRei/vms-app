import { withApi } from "@/lib/api";
import { getHistoryQuery } from "@/lib/history";
import { getSession } from "@/lib/session";
import { createVisitExport } from "@/lib/visit-export";

export const runtime = "nodejs";

async function GETHandler(request: Request) {
  const session = await getSession();
  if (session?.role !== "ADMIN") {
    return Response.json({ error: "Only administrators can export visits." }, { status: 403 });
  }
  const params: Record<string, string | string[]> = {};
  for (const [key, value] of new URL(request.url).searchParams) {
    const previous = params[key];
    params[key] = previous === undefined ? value : [...(Array.isArray(previous) ? previous : [previous]), value];
  }
  const query = getHistoryQuery(params);
  const filename = `visits_${query.filters.from || "all"}_to_${query.filters.to || "all"}.csv`;
  return new Response(await createVisitExport(session.userId, query), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export const GET = withApi(GETHandler);
