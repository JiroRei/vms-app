"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import type { HostOption } from "@/lib/visits";

type FieldErrors = Partial<Record<"name" | "hostId", string>>;

const inputClass =
  "block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500";
const errorInputClass =
  "block w-full rounded-lg border border-red-400 px-3 py-2 text-sm shadow-sm placeholder:text-gray-400 focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500";

export function DeliveryForm({ hosts }: { hosts: HostOption[] }) {
  const router = useRouter();

  const [name, setName] = useState("");
  const [hostId, setHostId] = useState("");

  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [checkedIn, setCheckedIn] = useState(false);

  /** Clears everything so the kiosk is ready for the next courier. */
  function reset() {
    setName("");
    setHostId("");
    setFieldErrors({});
    setFormError(null);
    setCheckedIn(false);
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!name.trim()) {
      setFieldErrors({ name: "Please enter the courier or company name." });
      setFormError(null);
      return;
    }

    setFieldErrors({});
    setFormError(null);
    setSubmitting(true);

    try {
      const response = await fetch("/api/visits", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "DELIVERY",
          name: name.trim(),
          // Recipient department is optional for a drop-off.
          hostId: hostId || null,
        }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => null);

        if (data?.fieldErrors) {
          setFieldErrors(data.fieldErrors as FieldErrors);
        } else {
          setFormError(
            data?.error ?? "Could not log this delivery. Please try again.",
          );
        }

        return;
      }

      setCheckedIn(true);
    } catch {
      setFormError("Network problem — please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (checkedIn) {
    return (
      <div className="space-y-6 text-center">
        <div className="space-y-3">
          <span className="text-5xl" role="img" aria-label="Delivery logged">
            📦
          </span>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900">
            Delivery logged!
          </h1>
          <p className="text-sm text-gray-500">
            Thank you — please hand the package to reception.
          </p>
        </div>

        <button
          type="button"
          onClick={() => {
            reset();
            // Pull a fresh department list for the next courier.
            router.refresh();
          }}
          className="w-full rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-blue-500 transition-colors"
        >
          Log another delivery
        </button>
      </div>
    );
  }

  return (
    <>
      <div className="text-center">
        <h1 className="text-2xl font-bold tracking-tight text-gray-900">
          Delivery / Courier
        </h1>
        <p className="mt-2 text-sm text-gray-500">
          Just two quick details and you&apos;re done
        </p>
      </div>

      <form onSubmit={handleSubmit} noValidate className="space-y-4">
        <div>
          <label
            htmlFor="name"
            className="block text-sm font-medium text-gray-700 mb-1"
          >
            Courier / Company Name
          </label>
          <input
            id="name"
            name="name"
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="e.g. LBC Express"
            aria-invalid={Boolean(fieldErrors.name)}
            className={fieldErrors.name ? errorInputClass : inputClass}
          />
          {fieldErrors.name && (
            <p className="mt-1 text-sm text-red-600">{fieldErrors.name}</p>
          )}
        </div>

        <div>
          <label
            htmlFor="hostId"
            className="block text-sm font-medium text-gray-700 mb-1"
          >
            Recipient Department{" "}
            <span className="font-normal text-gray-400">(optional)</span>
          </label>
          <select
            id="hostId"
            name="hostId"
            value={hostId}
            onChange={(event) => setHostId(event.target.value)}
            aria-invalid={Boolean(fieldErrors.hostId)}
            className={fieldErrors.hostId ? errorInputClass : inputClass}
          >
            <option value="">Not sure / leave at reception</option>
            {hosts.map((host) => (
              <option key={host.id} value={host.id}>
                {host.name} — {host.department}
              </option>
            ))}
          </select>
          {fieldErrors.hostId && (
            <p className="mt-1 text-sm text-red-600">{fieldErrors.hostId}</p>
          )}
        </div>

        {formError && (
          <p
            role="alert"
            className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700"
          >
            {formError}
          </p>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-blue-500 transition-colors disabled:cursor-not-allowed disabled:bg-blue-300"
        >
          {submitting ? "Logging delivery…" : "Log Delivery"}
        </button>
      </form>
    </>
  );
}
