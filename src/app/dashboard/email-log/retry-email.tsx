"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiErrorMessage } from "@/lib/api-error-message";
export function RetryEmail({ id }: { id: string }) {
  const router = useRouter();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  async function retry() {
    setBusy(true); setError(undefined);
    try {
      const response = await fetch("/api/email-log/retry", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
      if (!response.ok) setError(apiErrorMessage((await response.json()).error));
      else router.refresh();
    } catch { setError("Could not retry. Please try again."); }
    finally { setBusy(false); }
  }
  return <><button disabled={busy} onClick={retry} className="rounded border px-3 py-1 disabled:opacity-50">{busy ? "Queuing…" : "Retry now"}</button>{error && <p role="alert" className="text-red-700">{error}</p>}</>;
}
