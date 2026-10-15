import { timingSafeEqual } from "node:crypto";
import { ApiError } from "@/lib/api";
export function requireCron(request: Request): void {
  const expected = process.env.CRON_SECRET;
  if (!expected) throw new ApiError(503, "UNAVAILABLE", "Scheduled processing is unavailable.");
  const supplied = request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
  const a = Buffer.from(supplied), b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw new ApiError(401, "UNAUTHORIZED", "Unauthorized");
}
