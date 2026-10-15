import { ApiError, withApi } from "@/lib/api";
import { getSession } from "@/lib/session";
import { getRollCall } from "@/lib/roll-call";

export const dynamic = "force-dynamic";
export const GET = withApi(async () => {
  if (!await getSession()) throw new ApiError(401, "UNAUTHORIZED", "Please sign in to view the roll-call.");
  return Response.json(await getRollCall(), { headers: { "Cache-Control": "private, no-store" } });
});
