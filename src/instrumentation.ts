export async function onRequestError(error: unknown, request: { path: string; method: string }, context: { routerKind: string }) {
  const { reportError } = await import("@/lib/logger");
  await reportError(error, { method: request.method, routerKind: context.routerKind });
}
