"use client";

import { useEffect, useState } from "react";
import { flushSync } from "react-dom";
import { SITE_TIMEZONE, SITE_TIMEZONE_LABEL } from "@/lib/site-config";
import { reportTimestamp } from "@/lib/visit-report";

export function PrintButton() {
  return <button type="button" onClick={() => window.print()} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500">Print</button>;
}

/** Also refreshes for printing from the browser menu after leaving a page open. */
export function PrintFooter({ name, initialTimestamp, preposition = "on", includeSeconds = false }: { name: string; initialTimestamp: string; preposition?: "on" | "at"; includeSeconds?: boolean }) {
  const [printedAt, setPrintedAt] = useState(initialTimestamp);
  useEffect(() => {
    const update = () => flushSync(() => setPrintedAt(new Date().toISOString()));
    window.addEventListener("beforeprint", update);
    return () => window.removeEventListener("beforeprint", update);
  }, []);
  const date = new Date(printedAt);
  const seconds = includeSeconds ? `:${new Intl.DateTimeFormat("en-GB", { timeZone: SITE_TIMEZONE, second: "2-digit" }).format(date).padStart(2, "0")}` : "";
  return <p className="text-sm">Printed by {name} {preposition} {reportTimestamp(date)}{seconds} ({SITE_TIMEZONE_LABEL})</p>;
}
