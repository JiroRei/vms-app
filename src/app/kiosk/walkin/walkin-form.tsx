"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import {
  fieldErrorClass,
  formErrorClass,
  inputClass,
  labelClass,
  primaryButtonClass,
} from "@/app/kiosk/form-styles";
import type { HostOption } from "@/lib/visits";

type FieldName = "name" | "purpose" | "hostId";
type FieldErrors = Partial<Record<FieldName, string>>;

/** Also the order the first invalid field is focused in. */
const FIELD_ORDER: FieldName[] = ["name", "purpose", "hostId"];

export function WalkinForm({ hosts }: { hosts: HostOption[] }) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);

  const [name, setName] = useState("");
  const [purpose, setPurpose] = useState("");
  const [hostId, setHostId] = useState("");

  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [checkedIn, setCheckedIn] = useState(false);

  /** Clears everything so the kiosk is ready for the next visitor. */
  function reset() {
    setName("");
    setPurpose("");
    setHostId("");
    setFieldErrors({});
    setFormError(null);
    setCheckedIn(false);
  }

  /**
   * Drops a field's complaint the moment the visitor starts fixing it, rather
   * than leaving stale red text under a box they have already corrected. The
   * whole-form error goes too — it described the submit that is being redone.
   */
  function clearError(field: FieldName) {
    setFormError(null);
    setFieldErrors((current) => {
      if (!current[field]) return current;

      const next = { ...current };
      delete next[field];
      return next;
    });
  }

  function validate(): FieldErrors {
    const errors: FieldErrors = {};

    if (!name.trim()) errors.name = "Please enter your name.";
    if (!purpose.trim()) errors.purpose = "Please enter your purpose of visit.";
    if (!hostId) errors.hostId = "Please select who you are here to see.";

    return errors;
  }

  /** Puts the cursor on the problem instead of making the visitor hunt for it. */
  function focusFirstError(errors: FieldErrors) {
    const first = FIELD_ORDER.find((field) => errors[field]);

    if (first) {
      formRef.current?.querySelector<HTMLElement>(`#${first}`)?.focus();
    }
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    // The button is disabled while submitting, but a double-tap can land both
    // presses before React has re-rendered it.
    if (submitting) return;

    const errors = validate();
    setFieldErrors(errors);
    setFormError(null);

    if (Object.keys(errors).length > 0) {
      focusFirstError(errors);
      return;
    }

    setSubmitting(true);

    try {
      const response = await fetch("/api/visits", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          purpose: purpose.trim(),
          hostId,
        }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => null);

        if (data?.fieldErrors) {
          const serverErrors = data.fieldErrors as FieldErrors;
          setFieldErrors(serverErrors);
          focusFirstError(serverErrors);
        } else {
          setFormError(
            data?.error ?? "Could not complete check-in. Please try again.",
          );
        }

        return;
      }

      setCheckedIn(true);
    } catch {
      setFormError(
        "Could not reach the check-in system. Please try again, or ask reception for help.",
      );
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
          <h1 className="text-2xl font-bold tracking-tight text-gray-900 sm:text-3xl">
            You&apos;re checked in!
          </h1>
          <p className="text-base text-gray-500">
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
          className={primaryButtonClass}
        >
          Check in another visitor
        </button>
      </div>
    );
  }

  return (
    <>
      <div className="text-center">
        <h1 className="text-2xl font-bold tracking-tight text-gray-900 sm:text-3xl">
          Walk-in Registration
        </h1>
        <p className="mt-2 text-base text-gray-500">
          Please fill in your details below
        </p>
      </div>

      <form
        ref={formRef}
        onSubmit={handleSubmit}
        noValidate
        className="space-y-4"
      >
        <div>
          <label htmlFor="name" className={labelClass}>
            Full Name
          </label>
          <input
            id="name"
            name="name"
            type="text"
            value={name}
            onChange={(event) => {
              setName(event.target.value);
              clearError("name");
            }}
            placeholder="John Doe"
            // A kiosk is shared: never offer the previous visitor's details.
            autoComplete="off"
            enterKeyHint="next"
            aria-invalid={Boolean(fieldErrors.name)}
            aria-describedby={fieldErrors.name ? "name-error" : undefined}
            className={inputClass(Boolean(fieldErrors.name))}
          />
          {fieldErrors.name && (
            <p id="name-error" className={fieldErrorClass}>
              {fieldErrors.name}
            </p>
          )}
        </div>

        <div>
          <label htmlFor="purpose" className={labelClass}>
            Purpose of Visit
          </label>
          <input
            id="purpose"
            name="purpose"
            type="text"
            value={purpose}
            onChange={(event) => {
              setPurpose(event.target.value);
              clearError("purpose");
            }}
            placeholder="e.g. Meeting, Delivery, Interview"
            autoComplete="off"
            enterKeyHint="next"
            aria-invalid={Boolean(fieldErrors.purpose)}
            aria-describedby={fieldErrors.purpose ? "purpose-error" : undefined}
            className={inputClass(Boolean(fieldErrors.purpose))}
          />
          {fieldErrors.purpose && (
            <p id="purpose-error" className={fieldErrorClass}>
              {fieldErrors.purpose}
            </p>
          )}
        </div>

        <div>
          <label htmlFor="hostId" className={labelClass}>
            Host / Department
          </label>
          <select
            id="hostId"
            name="hostId"
            value={hostId}
            onChange={(event) => {
              setHostId(event.target.value);
              clearError("hostId");
            }}
            aria-invalid={Boolean(fieldErrors.hostId)}
            aria-describedby={fieldErrors.hostId ? "hostId-error" : undefined}
            className={inputClass(Boolean(fieldErrors.hostId))}
          >
            <option value="">Who are you here to see?</option>
            {hosts.map((host) => (
              <option key={host.id} value={host.id}>
                {host.name} — {host.department}
              </option>
            ))}
          </select>
          {fieldErrors.hostId && (
            <p id="hostId-error" className={fieldErrorClass}>
              {fieldErrors.hostId}
            </p>
          )}
        </div>

        {formError && (
          <p role="alert" className={formErrorClass}>
            {formError}
          </p>
        )}

        <button
          type="submit"
          disabled={submitting}
          className={primaryButtonClass}
        >
          {submitting ? "Checking in…" : "Check In"}
        </button>
      </form>
    </>
  );
}
