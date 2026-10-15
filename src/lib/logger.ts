import { AsyncLocalStorage } from "node:async_hooks";

export const requestContext = new AsyncLocalStorage<{ requestId: string }>();
const sensitive = /password|secret|token|authorization|cookie|code|html|text|attachments|url/i;
export function maskEmail(value: string): string {
  return value.replace(/[^\s@]+@([^\s@]+)/g, "***@$1");
}
/**
 * Credentials that can turn up inside free text: 6-digit booking codes, visitor
 * pass tokens, secrets in URL query strings (manage and password-reset links
 * carry `?token=`), bearer tokens and inline images (a QR is a credential).
 */
export function redactSecrets(value: string): string {
  return value
    .replace(/\b\d{6}\b/g, "[redacted]")
    .replace(/\bvp1\.[\w.-]+/g, "[redacted]")
    .replace(/([?&](?:token|code|sig|signature|key|secret)=)[^&\s"'<>]+/gi, "$1[redacted]")
    .replace(/\bBearer\s+[\w.~+/=-]+/gi, "Bearer [redacted]")
    .replace(/data:image\/[\w.+-]+;base64,[A-Za-z0-9+/=]+/g, "[redacted image]");
}
export function sanitize(value: unknown, depth = 0): unknown {
  if (depth > 5) return "[omitted]";
  if (value instanceof Error) return { name: value.name }; // Error messages may contain credentials or SQL.
  if (typeof value === "string") return redactSecrets(maskEmail(value)).slice(0, 1000);
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => sanitize(item, depth + 1));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, sensitive.test(key) ? "[redacted]" : sanitize(item, depth + 1)]));
  return value;
}
function log(level: string, message: string, context?: unknown) {
  console.log(JSON.stringify({ level, message: sanitize(message), requestId: requestContext.getStore()?.requestId ?? null, context: sanitize(context), time: new Date().toISOString() }));
}
export const logger = {
  info: (message: string, context?: unknown) => log("info", message, context),
  warn: (message: string, context?: unknown) => log("warn", message, context),
  error: (message: string, context?: unknown) => log("error", message, context),
};
export async function reportError(error: unknown, context?: unknown): Promise<void> {
  const payload = { level: "error", message: "Application error", requestId: requestContext.getStore()?.requestId ?? null, error: sanitize(error), context: sanitize(context), time: new Date().toISOString() };
  logger.error(payload.message, { error, context });
  if (process.env.ERROR_WEBHOOK_URL) {
    try {
      const response = await fetch(process.env.ERROR_WEBHOOK_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload), signal: AbortSignal.timeout(5000) });
      if (!response.ok) logger.warn("Error webhook rejected report", { status: response.status });
    } catch { logger.warn("Error webhook unavailable"); }
  }
}
