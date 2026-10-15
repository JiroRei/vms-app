import { KioskIdleReset } from "./kiosk-idle-reset";
import { KioskHeartbeat } from "./kiosk-heartbeat";

/**
 * Keeps kiosk screens readable regardless of the saved staff theme and mounts
 * the idle watchdog and heartbeat once for the whole section.
 */
export default function KioskLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="visitor-shell">
      {children}
      <KioskIdleReset />
      <KioskHeartbeat />
    </div>
  );
}
