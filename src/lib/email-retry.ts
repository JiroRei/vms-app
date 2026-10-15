export const EMAIL_BACKOFF_MS = [60_000, 300_000, 1_800_000, 7_200_000, 43_200_000] as const;
/** Initial failure is attempt 1; five retries follow, then failure is final. */
export function nextEmailAttempt(attempts: number, now: Date): Date | null {
  const delay = EMAIL_BACKOFF_MS[attempts - 1];
  return delay === undefined ? null : new Date(now.getTime() + delay);
}
