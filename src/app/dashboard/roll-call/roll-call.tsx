"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { PrintButton, PrintFooter } from "@/components/print-button";
import { PrintTable } from "@/components/print-table";
import { apiErrorMessage } from "@/lib/api-error-message";
import { ORGANIZATION_NAME, SITE_TIMEZONE, SITE_TIMEZONE_LABEL } from "@/lib/site-config";
import type { RollCallSnapshot, RollCallVisit } from "@/lib/roll-call-types";

const timeFormatter = new Intl.DateTimeFormat("en-GB", { timeZone: SITE_TIMEZONE, hourCycle: "h23", hour: "2-digit", minute: "2-digit", second: "2-digit" });
const time = (value: string) => timeFormatter.format(new Date(value));
type Ticks = Record<string, boolean>;

function Destination({ visit }: { visit: RollCallVisit }) {
  return <><span>{visit.destination}</span>{visit.department && <span className="block text-xs text-gray-500 dark:text-gray-400">{visit.department}</span>}</>;
}

export function RollCall({ initial, userId, userName }: { initial: RollCallSnapshot; userId: string; userName: string }) {
  const [snapshot, setSnapshot] = useState(initial);
  const [ticks, setTicks] = useState<Ticks>({});
  const [ready, setReady] = useState(false);
  const [storageUnavailable, setStorageUnavailable] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string>();
  const request = useRef<AbortController | null>(null);
  const printing = useRef(false);
  const storageKey = `vms-roll-call-accounted:${userId}`;

  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        const stored = JSON.parse(sessionStorage.getItem(storageKey) ?? "{}");
        if (stored && typeof stored === "object" && !Array.isArray(stored)) setTicks(Object.fromEntries(Object.entries(stored).filter(([, value]) => value === true).map(([id]) => [id, true])));
      } catch { setStorageUnavailable(true); }
      setReady(true);
    }, 0);
    return () => clearTimeout(timer);
  }, [storageKey]);

  const refresh = useCallback(async () => {
    if (request.current || printing.current) return;
    const controller = new AbortController();
    request.current = controller;
    setRefreshing(true);
    try {
      const response = await fetch("/api/roll-call", { cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]) });
      const data = await response.json();
      if (!response.ok) throw new Error(apiErrorMessage(data.error) ?? "Could not refresh the roll-call.");
      if (!controller.signal.aborted && !printing.current) { setSnapshot(data); setError(undefined); }
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Could not refresh the roll-call.");
    } finally {
      request.current = null;
      if (!controller.signal.aborted) setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    const interval = setInterval(() => void refresh(), 15_000);
    const beforePrint = () => { printing.current = true; };
    const afterPrint = () => { printing.current = false; };
    window.addEventListener("beforeprint", beforePrint);
    window.addEventListener("afterprint", afterPrint);
    return () => {
      clearInterval(interval);
      request.current?.abort();
      window.removeEventListener("beforeprint", beforePrint);
      window.removeEventListener("afterprint", afterPrint);
    };
  }, [refresh]);

  function accountFor(id: string, checked: boolean) {
    const next = { ...ticks };
    if (checked) next[id] = true;
    else delete next[id];
    setTicks(next);
    try { sessionStorage.setItem(storageKey, JSON.stringify(next)); }
    catch { setStorageUnavailable(true); }
  }
  function clearTicks() {
    setTicks({});
    try { sessionStorage.removeItem(storageKey); }
    catch { setStorageUnavailable(true); }
  }

  const accountedFor = snapshot.onSite.filter(visit => ticks[visit.id]).length;
  const title = `Emergency roll-call: ${ORGANIZATION_NAME}`;
  return <article className="print-report roll-call-report space-y-6 text-gray-900 dark:text-gray-100">
    <header className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <h1 className="text-2xl font-bold">{title}</h1>
        <div className="print-hidden flex flex-wrap gap-2">
          <button type="button" onClick={() => void refresh()} disabled={refreshing} className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-semibold disabled:opacity-50 dark:border-gray-600 dark:bg-gray-800">{refreshing ? "Refreshing…" : "Refresh"}</button>
          <button type="button" onClick={clearTicks} disabled={!ready} className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-semibold disabled:opacity-50 dark:border-gray-600 dark:bg-gray-800">Clear ticks</button>
          <PrintButton />
        </div>
      </div>
      <dl className="flex flex-wrap gap-x-8 gap-y-2">
        <div className="flex items-baseline gap-2"><dt>On site:</dt><dd className="text-3xl font-bold" data-testid="roll-call-on-site-count">{snapshot.onSite.length}</dd></div>
        <div className="flex items-baseline gap-2"><dt>Out, expected back:</dt><dd className="text-2xl font-semibold" data-testid="roll-call-expected-back-count">{snapshot.expectedBack.length}</dd></div>
      </dl>
      <p className="text-sm text-gray-600 dark:text-gray-300">Last updated <time dateTime={snapshot.updatedAt}>{time(snapshot.updatedAt)}</time> ({SITE_TIMEZONE_LABEL})</p>
      <p className="print-hidden rounded-lg bg-teal-50 p-3 font-semibold text-teal-900 dark:bg-teal-950 dark:text-teal-100" role="status">{accountedFor} of {snapshot.onSite.length} accounted for</p>
      {error && <p role="alert" className="print-hidden rounded-lg border border-red-300 bg-red-50 p-3 text-red-900 dark:bg-red-950 dark:text-red-100">{error} Showing the list from {time(snapshot.updatedAt)}. Refresh before relying on these headcounts.</p>}
      {storageUnavailable && <p role="alert" className="print-hidden text-sm text-amber-800 dark:text-amber-200">This browser cannot save ticks in session storage. Ticks will last only while this page stays open.</p>}
    </header>

    <section aria-labelledby="roll-call-on-site-heading" className="roll-call-on-site space-y-3">
      <h2 id="roll-call-on-site-heading" className="text-lg font-semibold">Currently on site</h2>
      <PrintTable caption="People currently on site" rows={snapshot.onSite} rowKey={visit => visit.id} emptyMessage="No visitors are currently on site." columns={[
        { key: "name", label: "Name", render: visit => visit.name },
        { key: "type", label: "Type", render: visit => visit.type === "DELIVERY" ? "Delivery" : "Guest" },
        { key: "destination", label: "Host or destination", render: visit => <Destination visit={visit} /> },
        { key: "in", label: "Time in", render: visit => time(visit.checkInTime) },
        { key: "accounted", label: "Accounted for", render: visit => <>
          <label className="print-hidden flex min-h-11 cursor-pointer items-center justify-center"><input type="checkbox" aria-label={`Accounted for ${visit.name}`} disabled={!ready} checked={Boolean(ticks[visit.id])} onChange={event => accountFor(visit.id, event.target.checked)} className="h-5 w-5 accent-teal-700" /></label>
          <span aria-hidden="true" className="roll-call-empty-box hidden print:inline-block" />
        </> },
      ]} />
    </section>

    <section aria-labelledby="roll-call-expected-back-heading" className="roll-call-expected-back space-y-3 rounded-xl border-2 border-dashed border-amber-400 bg-amber-50 p-4 dark:bg-amber-950/30">
      <h2 id="roll-call-expected-back-heading" className="text-lg font-semibold text-amber-950 dark:text-amber-100">Out, expected back</h2>
      <p className="text-sm font-medium text-amber-900 dark:text-amber-200">These visitors are not on site and are not counted in the on-site total.</p>
      <PrintTable caption="Visitors out and expected back, excluded from the on-site total" rows={snapshot.expectedBack} rowKey={visit => visit.id} emptyMessage="No visitors are currently out and expected back." columns={[
        { key: "name", label: "Name", render: visit => visit.name },
        { key: "destination", label: "Host or destination", render: visit => <Destination visit={visit} /> },
        { key: "out", label: "Stepped out", render: visit => visit.exitTime ? time(visit.exitTime) : "Not recorded" },
      ]} />
    </section>
    <PrintFooter name={userName} initialTimestamp={initial.updatedAt} preposition="at" includeSeconds />
  </article>;
}
