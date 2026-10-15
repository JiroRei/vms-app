import { randomUUID } from "node:crypto";
import { after } from "next/server";
import { logger, reportError, requestContext } from "@/lib/logger";
import { sweepEmailOutboxIfDue } from "@/lib/email-outbox";
import { pruneRateLimits } from "@/lib/database-rate-limit";

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}
const codes: Record<number, string> = { 400: "INVALID_REQUEST", 401: "UNAUTHORIZED", 403: "FORBIDDEN", 404: "NOT_FOUND", 409: "CONFLICT", 413: "PAYLOAD_TOO_LARGE", 429: "RATE_LIMITED", 503: "UNAVAILABLE" };
export function withApi<A extends unknown[]>(handler: (...args: A) => Promise<Response>) {
  return async (...args: A): Promise<Response> => {
    const requestId = randomUUID();
    return requestContext.run({ requestId }, async () => {
      try {
        after(async () => { await sweepEmailOutboxIfDue(); try { await pruneRateLimits(); } catch (error) { await reportError(error); } });
        const response = await handler(...args);
        response.headers.set("X-Request-Id", requestId);
        if (response.status < 400 || !response.headers.get("Content-Type")?.includes("application/json")) return response;
        const parsed = await response.clone().json();
        const body = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
        if (body.status && body.db && body.time) return response;
        if (response.status >= 500) logger.error("API request failed", { status: response.status });
        const message = response.status >= 500 ? "Service temporarily unavailable. Please try again." : typeof body.error === "string" ? body.error : typeof body.error?.message === "string" ? body.error.message : typeof body.message === "string" ? body.message : "Please check your entries and try again.";
        // Preserve only the validation metadata used by the UI; never forward provider/debug fields.
        const metadata = {
          ...(body.fieldErrors ? { fieldErrors: body.fieldErrors } : {}),
          ...(typeof body.reason === "string" ? { reason: body.reason } : {}),
          ...(body.reauthenticate === true ? { reauthenticate: true } : {}),
        };
        return Response.json({ ...metadata, error: { code: codes[response.status] ?? (response.status >= 500 ? "INTERNAL_ERROR" : "REQUEST_FAILED"), message, requestId } }, { status: response.status, headers: response.headers });
      } catch (error) {
        logger.error("API handler error", { error });
        after(() => requestContext.run({ requestId }, () => reportError(error)));
        const status = error instanceof ApiError ? error.status : error instanceof SyntaxError ? 400 : 500;
        return Response.json({ error: { code: error instanceof ApiError ? error.code : codes[status] ?? "INTERNAL_ERROR", message: error instanceof ApiError ? error.message : status === 400 ? "Invalid JSON body." : "Something went wrong. Please try again.", requestId } }, { status, headers: { "X-Request-Id": requestId } });
      }
    });
  };
}

export async function boundedJson(request: Request, maxBytes = 1024): Promise<Record<string, unknown>> {
  if (!request.body) throw new ApiError(400, "INVALID_REQUEST", "A JSON body is required.");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) { await reader.cancel(); throw new ApiError(413, "PAYLOAD_TOO_LARGE", "Request is too large."); }
    chunks.push(value);
  }
  const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new ApiError(400, "INVALID_REQUEST", "A JSON object is required.");
  return body;
}
