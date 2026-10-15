export const KIOSK_STALE_MS = 90_000;
export const KIOSK_ALERT_MS = 180_000;
export function kioskStatus(lastSeenAt: Date | string, retiredAt: Date | string | null, now = Date.now()): "Retired" | "Online" | "Offline" {
  if (retiredAt) return "Retired";
  return now - new Date(lastSeenAt).getTime() <= KIOSK_STALE_MS ? "Online" : "Offline";
}
