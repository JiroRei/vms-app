import { withApi } from "@/lib/api";
import { requireCron } from "@/lib/cron-auth";
import { processEmailOutbox } from "@/lib/email-outbox";
export const POST = withApi(async (request: Request) => {
  requireCron(request);
  return Response.json(await processEmailOutbox());
});
