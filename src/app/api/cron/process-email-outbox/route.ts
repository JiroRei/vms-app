import { withApi } from "@/lib/api";
import { requireCron } from "@/lib/cron-auth";
import { processEmailOutbox, purgeEmailOutbox } from "@/lib/email-outbox";
export const POST = withApi(async (request: Request) => {
  requireCron(request);
  const result = await processEmailOutbox();
  return Response.json({ ...result, retention: await purgeEmailOutbox() });
});
