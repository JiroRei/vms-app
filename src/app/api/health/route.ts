import { withApi } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";
export const GET = withApi(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return Response.json({ status: "ok", db: "ok", time: new Date().toISOString() }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    logger.warn("Database health check failed");
    return Response.json({ status: "unavailable", db: "unavailable", time: new Date().toISOString() }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
});
