"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import {
  fieldErrorClass,
  formErrorClass,
  inputClass,
  labelClass,
  primaryButtonClass,
} from "@/app/check-in/form-styles";
import { NameFields, type NameFieldsClasses } from "@/components/name-fields";
import { validateNameParts, type NameField } from "@/lib/names";
import type { PurposeChoice } from "@/lib/purposes";
import type { HostOption } from "@/lib/visits";

type FieldName = NameField | "purposeId" | "hostId";
type FieldErrors = Partial<Record<FieldName, string>>;

/** Also the order the first invalid field is focused in. */
const FIELD_ORDER: FieldName[] = ["firstName", "lastName", "purposeId", "hostId"];

/** The shared name pair, in the kiosk's look. */
const nameFieldsClasses: NameFieldsClasses = {
  label: labelClass,
  input: inputClass,
  error: fieldErrorClass,
};

export function WalkinForm({
  hosts,
  purposes,
}: {
  hosts: HostOption[];
  /** Active options only — the page filters retired ones out server-side. */
  purposes: PurposeChoice[];
}) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);

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
    const errors: FieldErrors = validateNameParts(firstName, lastName);

    if (!purposeId) errors.purposeId = "Please choose your purpose of visit.";
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
        body: JSON.stringify({ firstName, lastName, purposeId, hostId }),
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
          {/*
            Says only what the system actually does. Checking in puts the
            visitor on the front desk's live list; telling the host is a person's
            job, not the software's — nothing here sends a notification. When
            one is built, this line can promise more.
          */}
          <p className="text-base text-gray-500">
            Please take a seat — reception can see you&apos;ve arrived and will
            let your host know.
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
        <NameFields
          firstName={firstName}
          lastName={lastName}
          onChange={(field, value) => {
            if (field === "firstName") setFirstName(value);
            else setLastName(value);
            clearError(field);
          }}
          errors={fieldErrors}
          classes={nameFieldsClasses}
        />

        <div>
          <label htmlFor="purposeId" className={labelClass}>
            Purpose of Visit
          </label>
          <select
            id="purposeId"
            name="purposeId"
            value={purposeId}
            onChange={(event) => {
              setPurposeId(event.target.value);
              clearError("purposeId");
            }}
            aria-invalid={Boolean(fieldErrors.purposeId)}
            aria-describedby={
              fieldErrors.purposeId ? "purposeId-error" : undefined
            }
            className={inputClass(Boolean(fieldErrors.purposeId))}
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
            <p id="purposeId-error" className={fieldErrorClass}>
              {fieldErrors.purposeId}
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
