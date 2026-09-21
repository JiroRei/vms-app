import { KioskIdleReset } from "./kiosk-idle-reset";

/**
 * Wraps every kiosk screen. Its only job is to mount the idle watchdog once for
 * the whole section instead of once per form.
 */
export default function KioskLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      {children}
      <KioskIdleReset />
    </>
  );
}
