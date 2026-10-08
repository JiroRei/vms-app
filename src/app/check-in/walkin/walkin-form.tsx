"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { NameFields } from "@/components/name-fields";
import { validateNameParts, type NameField } from "@/lib/names";
import type { PurposeChoice } from "@/lib/purposes";
import type { HostOption } from "@/lib/visits";

type FieldErrors = Partial<
  Record<NameField | "purposeId" | "hostId", string>
>;

const inputClass =
  "block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500";
const errorInputClass =
  "block w-full rounded-lg border border-red-400 px-3 py-2 text-sm shadow-sm placeholder:text-gray-400 focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500";

export function WalkinForm({
  hosts,
  purposes,
}: {
  hosts: HostOption[];
  /** Active options only — the page filters retired ones out server-side. */
  purposes: PurposeChoice[];
}) {
  const router = useRouter();

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [purposeId, setPurposeId] = useState("");
  const [hostId, setHostId] = useState("");

  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [checkedIn, setCheckedIn] = useState(false);

  /** Clears everything so the kiosk is ready for the next visitor. */
  function reset() {
    setFirstName("");
    setLastName("");
    setPurposeId("");
    setHostId("");
    setFieldErrors({});
    setFormError(null);
    setCheckedIn(false);
  }

  function validate(): FieldErrors {
    const errors: FieldErrors = validateNameParts(firstName, lastName);

    if (!purposeId) errors.purposeId = "Please choose your purpose of visit.";
    if (!hostId) errors.hostId = "Please select who you are here to see.";

    return errors;
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const errors = validate();
    setFieldErrors(errors);
    setFormError(null);

    if (Object.keys(errors).length > 0) {
      return;
    }

    setSubmitting(true);

    try {
      const response = await fetch("/api/visits", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          firstName,
          lastName,
          purposeId,
          hostId,
        }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => null);

        if (data?.fieldErrors) {
          setFieldErrors(data.fieldErrors as FieldErrors);
        } else {
          setFormError(
            data?.error ?? "Could not complete check-in. Please try again.",
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
          <span className="text-5xl" role="img" aria-label="Checked in">
            ✅
          </span>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900">
            You&apos;re checked in!
          </h1>
          <p className="text-sm text-gray-500">
            Please take a seat — your host has been notified.
          </p>
        </div>

        <button
          type="button"
          onClick={() => {
            reset();
            // Pull a fresh host list for the next visitor.
            router.refresh();
          }}
          className="w-full rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-blue-500 transition-colors"
        >
          Check in another visitor
        </button>
      </div>
    );
  }

  return (
    <>
      <div className="text-center">
        <h1 className="text-2xl font-bold tracking-tight text-gray-900">
          Walk-in Registration
        </h1>
        <p className="mt-2 text-sm text-gray-500">
          Please fill in your details below
        </p>
      </div>

      <form onSubmit={handleSubmit} noValidate className="space-y-4">
        <NameFields
          firstName={firstName}
          lastName={lastName}
          onChange={(field, value) =>
            field === "firstName" ? setFirstName(value) : setLastName(value)
          }
          errors={fieldErrors}
        />

        <div>
          <label
            htmlFor="purposeId"
            className="block text-sm font-medium text-gray-700 mb-1"
          >
            Purpose of Visit
          </label>
          <select
            id="purposeId"
            name="purposeId"
            value={purposeId}
            onChange={(event) => setPurposeId(event.target.value)}
            aria-invalid={Boolean(fieldErrors.purposeId)}
            className={fieldErrors.purposeId ? errorInputClass : inputClass}
          >
            <option value="">
              {purposes.length === 0
                ? "None available — please ask reception"
                : "Select a purpose…"}
            </option>
            {purposes.map((purpose) => (
              <option key={purpose.id} value={purpose.id}>
                {purpose.label}
              </option>
            ))}
          </select>
          {fieldErrors.purposeId && (
            <p className="mt-1 text-sm text-red-600">{fieldErrors.purposeId}</p>
          )}
        </div>

        <div>
          <label
            htmlFor="hostId"
            className="block text-sm font-medium text-gray-700 mb-1"
          >
            Host / Department
          </label>
          <select
            id="hostId"
            name="hostId"
            value={hostId}
            onChange={(event) => setHostId(event.target.value)}
            aria-invalid={Boolean(fieldErrors.hostId)}
            className={fieldErrors.hostId ? errorInputClass : inputClass}
          >
            <option value="">Who are you here to see?</option>
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
          {submitting ? "Checking in…" : "Check In"}
        </button>
      </form>
    </>
  );
}
