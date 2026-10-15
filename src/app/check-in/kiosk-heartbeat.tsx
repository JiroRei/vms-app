"use client";
import { useEffect } from "react";
export function KioskHeartbeat() {
  useEffect(() => {
    let deviceId: string;
    try {
      deviceId = localStorage.getItem("vms-kiosk-device") ?? "";
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(deviceId)) {
        // getRandomValues works on LAN HTTP origins where randomUUID may be unavailable.
        const bytes = crypto.getRandomValues(new Uint8Array(16));
        bytes[6] = (bytes[6] & 15) | 64;
        bytes[8] = (bytes[8] & 63) | 128;
        const hex = Array.from(bytes, value => value.toString(16).padStart(2, "0")).join("");
        deviceId = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
        localStorage.setItem("vms-kiosk-device", deviceId);
      }
    } catch { return; }
    const beat = () => { void fetch("/api/kiosk/heartbeat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ deviceId }), cache: "no-store" }).catch(() => {}); };
    beat();
    const interval = setInterval(beat, 30_000);
    return () => clearInterval(interval);
  }, []);
  return null;
}
