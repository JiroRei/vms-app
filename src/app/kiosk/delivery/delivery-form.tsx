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

type FieldName = "name" | "hostId";
type FieldErrors = Partial<Record<FieldName, string>>;

/** Also the order the first invalid field is focused in. */
const FIELD_ORDER: FieldName[] = ["name", "hostId"];

export function DeliveryForm({ hosts }: { hosts: HostOption[] }) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);

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

  /** Drops a field's complaint as soon as the courier starts fixing it. */
  function clearError(field: FieldName) {
    setFormError(null);
    setFieldErrors((current) => {
      if (!current[field]) return current;

      const next = { ...current };
      delete next[field];
      return next;
    });
  }

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

    if (!name.trim()) {
      const errors: FieldErrors = {
        name: "Please enter the courier or company name.",
      };

      setFieldErrors(errors);
      setFormError(null);
      focusFirstError(errors);
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
          const serverErrors = data.fieldErrors as FieldErrors;
          setFieldErrors(serverErrors);
          focusFirstError(serverErrors);
        } else {
          setFormError(
            data?.error ?? "Could not log this delivery. Please try again.",
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
          <span className="text-5xl" role="img" aria-label="Delivery logged">
            📦
          </span>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900 sm:text-3xl">
            Delivery logged!
          </h1>
          <p className="text-base text-gray-500">
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
          className={primaryButtonClass}
        >
          Log another delivery
        </button>
      </div>
    );
  }

  return (
    <>
      <div className="text-center">
        <h1 className="text-2xl font-bold tracking-tight text-gray-900 sm:text-3xl">
          Delivery / Courier
        </h1>
        <p className="mt-2 text-base text-gray-500">
          Just two quick details and you&apos;re done
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
            Courier / Company Name
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
            placeholder="e.g. LBC Express"
            // A kiosk is shared: never offer the previous courier's details.
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
          <label htmlFor="hostId" className={labelClass}>
            Recipient Department{" "}
            <span className="font-normal text-gray-400">(optional)</span>
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
            <option value="">Not sure / leave at reception</option>
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
          {submitting ? "Logging delivery…" : "Log Delivery"}
        </button>
      </form>
    </>
  );
}
