"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { kioskStatus, KIOSK_ALERT_MS } from "@/lib/kiosks";
import { apiErrorMessage } from "@/lib/api-error-message";
type Device = { id: string; label: string | null; lastSeenAt: string; retiredAt: string | null };
export function KioskMonitor({ admin }: { admin: boolean }) {
  const [devices, setDevices] = useState<Device[]>([]);
  const [now, setNow] = useState(0);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string>();
  const [available, setAvailable] = useState(false);
  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/kiosks", { cache: "no-store" });
      if (!response.ok) throw new Error();
      const data = await response.json();
      setDevices(data.devices); setNow(new Date(data.time).getTime()); setAvailable(true);
    } catch { setAvailable(false); }
  }, []);
  useEffect(() => { const initial = setTimeout(refresh, 0); const timer = setInterval(refresh, 15_000); return () => { clearTimeout(initial); clearInterval(timer); }; }, [refresh]);
  async function update(id: string, change: { label?: string; retire?: boolean }) {
    try {
      const response = await fetch("/api/kiosks", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, ...change }) });
      if (!response.ok) { setError(apiErrorMessage((await response.json()).error)); return; }
      setError(undefined); await refresh();
    } catch { setError("Could not update the device. Please try again."); }
  }
  const active = devices.filter((device) => !device.retiredAt);
  const healthy = available && active.every((device) => kioskStatus(device.lastSeenAt, null, now) === "Online");
  const silent = active.some((device) => now - new Date(device.lastSeenAt).getTime() > KIOSK_ALERT_MS);
  return <header className="print-hidden border-b border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className={`rounded-full px-3 py-1 text-sm font-semibold ${healthy ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"}`}>Kiosks: {available ? healthy ? "Online" : "Offline" : "Unavailable"}</button>
      <Link href="/dashboard/roll-call" className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-red-700 px-4 py-2 text-sm font-bold text-white hover:bg-red-800 focus-visible:outline-red-700">
        <svg aria-hidden="true" className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M12 3 2 21h20L12 3Z" /><path strokeLinecap="round" d="M12 9v5m0 3h.01" /></svg>
        Emergency roll-call
      </Link>
    </div>
    {silent && <p role="alert" className="mt-3 rounded-lg bg-red-100 p-3 text-sm text-red-900">A kiosk has been silent for more than 3 minutes. Please switch to manual entry.</p>}
    {open && <section aria-label="Kiosk devices" className="mt-4 space-y-3">
      {!devices.length && <p className="text-sm">No kiosks have reported yet.</p>}
      {error && <p role="alert" className="text-red-700">{error}</p>}
      {devices.map((device, index) => <div key={device.id} className="flex flex-wrap items-center gap-3 rounded border p-3 text-sm">
        <span>{device.label ?? `Kiosk ${index + 1}`}</span><span>Last seen: {new Date(device.lastSeenAt).toLocaleString()}</span><span>{kioskStatus(device.lastSeenAt, device.retiredAt, now)}</span>
        {admin && <form onSubmit={(event) => { event.preventDefault(); const data = new FormData(event.currentTarget); void update(device.id, { label: String(data.get("label")) }); }} className="flex gap-2">
          <input aria-label={`Label for kiosk ${index + 1}`} name="label" defaultValue={device.label ?? ""} maxLength={80} className="rounded border px-2 py-1" /><button className="rounded border px-2 py-1">Rename</button>
        </form>}
        {admin && !device.retiredAt && <button onClick={() => { if (confirm("Retire this kiosk from monitoring?")) void update(device.id, { retire: true }); }} className="rounded border px-2 py-1">Retire</button>}
      </div>)}
    </section>}
  </header>;
}
