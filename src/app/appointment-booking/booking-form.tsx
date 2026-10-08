"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { NameFields } from "@/components/name-fields";
import {
  checkSlot,
  formatDateKey,
  formatSlotTime,
  toSlotValue,
} from "@/lib/booking-config";
import { formatFullName, validateNameParts } from "@/lib/names";
import type { PurposeChoice } from "@/lib/purposes";
import type { HostOption } from "@/lib/visits";

import { DateTimePicker, type SlotValue } from "./date-time-picker";
import { HostCombobox } from "./host-combobox";
import { ReturningLookup, type VerifiedDetails } from "./returning-lookup";
import {
  errorClass,
  inputClass,
  labelClass,
  nameFieldsClasses,
  primaryButtonClass,
  secondaryButtonClass,
  textButtonClass,
} from "./styles";

type Field =
  | "firstName"
  | "lastName"
  | "visitorEmail"
  | "visitorPhone"
  | "hostId"
  | "purposeId"
  | "scheduledFor"
  | "consent";

type FieldErrors = Partial<Record<Field, string>>;

type Confirmation = {
  appointment: {
    referenceNumber: string;
    firstName: string;
    lastName: string;
    visitorEmail: string;
    purposeLabel: string | null;
    hostName: string;
    hostDepartment: string;
    scheduledFor: string;
    expiresAt: string;
  };
  qrDataUrl: string | null;
  emailSent: boolean;
};

/** 0 is the "visited before?" question; 1–4 are the numbered steps. */
type Step = 0 | 1 | 2 | 3 | 4;

const STEP_LABELS = ["Your details", "Visit", "Date & time", "Review"] as const;

/** Which step owns each field, so a server error can send the visitor back. */
const FIELD_STEP: Record<Field, Step> = {
  firstName: 1,
  lastName: 1,
  visitorEmail: 1,
  visitorPhone: 1,
  hostId: 2,
  purposeId: 2,
  scheduledFor: 3,
  consent: 4,
};

/** Same limits and pattern as `POST /api/appointments`. */
const MAX_EMAIL = 200;
const MAX_PHONE = 40;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

type FormState = {
  firstName: string;
  lastName: string;
  visitorEmail: string;
  visitorPhone: string;
  hostId: string;
  purposeId: string;
  slot: SlotValue;
  consent: boolean;
};

const EMPTY_FORM: FormState = {
  firstName: "",
  lastName: "",
  visitorEmail: "",
  visitorPhone: "",
  hostId: "",
  purposeId: "",
  slot: { date: null, time: null },
  consent: false,
};

function validateStep(step: Step, form: FormState): FieldErrors {
  const errors: FieldErrors = {};

  if (step === 1) {
    const email = form.visitorEmail.trim();

    Object.assign(errors, validateNameParts(form.firstName, form.lastName));

    if (!email) errors.visitorEmail = "Please enter your email address.";
    else if (email.length > MAX_EMAIL || !EMAIL_PATTERN.test(email))
      errors.visitorEmail = "Please enter a valid email address.";

    if (form.visitorPhone.trim().length > MAX_PHONE)
      errors.visitorPhone = `Please keep this under ${MAX_PHONE} characters.`;
  }

  if (step === 2) {
    if (!form.hostId) errors.hostId = "Please choose who you are visiting.";
    if (!form.purposeId) errors.purposeId = "Please say what the visit is about.";
  }

  if (step === 3) {
    const { date, time } = form.slot;

    if (!date || !time) {
      errors.scheduledFor = "Please choose a date and a time.";
    } else {
      // An event handler, so reading the clock here is safe — and it catches
      // a slot that passed while the visitor was deciding.
      const check = checkSlot(toSlotValue(date, time), new Date());
      if (!check.ok) errors.scheduledFor = check.error;
    }
  }

  if (step === 4 && !form.consent) {
    errors.consent = "Please agree to the Privacy Policy to continue.";
  }

  return errors;
}

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString([], {
    weekday: "long",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function Progress({ step }: { step: Step }) {
  return (
    <div>
      <p className="mb-2 text-sm font-medium text-gray-600">
        Step {step} of {STEP_LABELS.length}
        <span className="text-gray-400"> · </span>
        <span className="text-gray-900">{STEP_LABELS[step - 1]}</span>
      </p>
      <ol className="grid grid-cols-4 gap-1.5" aria-hidden>
        {STEP_LABELS.map((label, index) => (
          <li
            key={label}
            className={`h-1.5 rounded-full ${
              index < step ? "bg-accent" : "bg-gray-200"
            }`}
          />
        ))}
      </ol>
    </div>
  );
}

function ReviewRow({
  label,
  onEdit,
  children,
}: {
  label: string;
  onEdit: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 px-4 py-3">
      <div className="min-w-0">
        <dt className="text-xs font-medium uppercase tracking-wide text-gray-500">
          {label}
        </dt>
        <dd className="mt-0.5 break-words text-sm text-gray-900">{children}</dd>
      </div>
      <button
        type="button"
        onClick={onEdit}
        className={`${textButtonClass} shrink-0 text-sm`}
      >
        Edit
      </button>
    </div>
  );
}

export function BookingForm({
  hosts,
  purposes,
}: {
  hosts: HostOption[];
  /** Active options only — the page filters retired ones out server-side. */
  purposes: PurposeChoice[];
}) {
  const [step, setStep] = useState<Step>(0);
  const [returning, setReturning] = useState(false);
  const [verified, setVerified] = useState<VerifiedDetails | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);

  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);

  // Move focus to each new step's heading, so screen-reader and keyboard users
  // land at the top of what just changed. Skipped on first render.
  const headingRef = useRef<HTMLHeadingElement>(null);
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    headingRef.current?.focus();
  }, [step]);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
    // Clear a field's error as soon as it is edited.
    const field = (key === "slot" ? "scheduledFor" : key) as Field;
    if (fieldErrors[field]) {
      setFieldErrors((current) => {
        const rest = { ...current };
        delete rest[field];
        return rest;
      });
    }
  }

  function goTo(next: Step) {
    setFieldErrors({});
    setFormError(null);
    setStep(next);
  }

  function next() {
    const errors = validateStep(step, form);
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }
    goTo((step + 1) as Step);
  }

  function back() {
    goTo((step - 1) as Step);
  }

  function handleVerified(details: VerifiedDetails) {
    setVerified(details);
    setForm((current) => ({
      ...current,
      firstName: details.firstName,
      lastName: details.lastName,
      visitorEmail: details.email,
      visitorPhone: details.phone ?? "",
    }));
    goTo(2);
  }

  function startOver() {
    setVerified(null);
    setReturning(false);
    setForm((current) => ({
      ...current,
      firstName: "",
      lastName: "",
      visitorEmail: "",
      visitorPhone: "",
    }));
    goTo(0);
  }

  async function submit() {
    if (submitting) return;

    const errors = validateStep(4, form);
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }

    setFieldErrors({});
    setFormError(null);
    setSubmitting(true);

    try {
      const { date, time } = form.slot;
      const response = await fetch("/api/appointments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          firstName: form.firstName,
          lastName: form.lastName,
          visitorEmail: form.visitorEmail,
          visitorPhone: form.visitorPhone,
          hostId: form.hostId,
          purposeId: form.purposeId,
          scheduledFor: date && time ? toSlotValue(date, time) : "",
          consent: form.consent,
        }),
      });

      const data = await response.json().catch(() => null);

      if (!response.ok) {
        if (data?.fieldErrors) {
          const serverErrors = data.fieldErrors as FieldErrors;
          // Send the visitor back to the earliest step with a problem.
          const earliest = Math.min(
            ...Object.keys(serverErrors).map(
              (field) => FIELD_STEP[field as Field] ?? 4,
            ),
          ) as Step;
          setStep(earliest);
          setFieldErrors(serverErrors);
        } else {
          setFormError(data?.error ?? "Could not book this visit.");
        }

        return;
      }

      setConfirmation(data as Confirmation);
    } catch {
      setFormError("Network problem — please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (confirmation) {
    const { appointment, qrDataUrl, emailSent } = confirmation;

    return (
      <div className="space-y-6">
        <div className="space-y-2 text-center">
          <span className="text-5xl" role="img" aria-label="Booked">
            ✅
          </span>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900">
            Your visit is booked
          </h1>
          <p className="text-sm text-gray-500" suppressHydrationWarning>
            {formatWhen(appointment.scheduledFor)}
          </p>
        </div>

        {/* The reference number is the headline, not a footnote: it is what
            still works when the email does not arrive. */}
        <div className="rounded-xl border border-gray-200 bg-white p-5 text-center shadow-sm">
          <p className="text-xs font-medium uppercase tracking-widest text-gray-500">
            Reference number
          </p>
          <p className="mt-1 text-3xl font-bold tracking-widest text-gray-900">
            {appointment.referenceNumber}
          </p>
          <p className="mt-2 text-sm text-gray-500">
            Type this at the kiosk if your QR code will not scan.
          </p>

          {qrDataUrl && (
            <Image
              src={qrDataUrl}
              alt={`QR code for appointment ${appointment.referenceNumber}`}
              width={200}
              height={200}
              unoptimized
              className="mx-auto mt-4 rounded-lg border border-gray-200"
            />
          )}
        </div>

        <dl className="divide-y divide-gray-100 rounded-lg border border-gray-200 bg-white shadow-sm">
          <div className="flex justify-between gap-4 px-4 py-3">
            <dt className="text-sm text-gray-500">Name</dt>
            <dd className="text-right text-sm font-semibold text-gray-900">
              {formatFullName(appointment.firstName, appointment.lastName)}
            </dd>
          </div>
          <div className="flex justify-between gap-4 px-4 py-3">
            <dt className="text-sm text-gray-500">Host</dt>
            <dd className="text-right">
              <span className="block text-sm text-gray-900">
                {appointment.hostName}
              </span>
              <span className="block text-xs text-gray-500">
                {appointment.hostDepartment}
              </span>
            </dd>
          </div>
          {appointment.purposeLabel && (
            <div className="flex justify-between gap-4 px-4 py-3">
              <dt className="text-sm text-gray-500">Purpose</dt>
              <dd className="text-right text-sm text-gray-900">
                {appointment.purposeLabel}
              </dd>
            </div>
          )}
        </dl>

        <p
          className={`rounded-lg px-3 py-2 text-sm ${
            emailSent
              ? "bg-green-50 text-green-800"
              : "bg-amber-50 text-amber-800"
          }`}
        >
          {emailSent
            ? `We have emailed your QR code to ${appointment.visitorEmail}.`
            : "We could not email your QR code just now. Save this page or write down the reference number above — it is all you need to check in."}
        </p>
      </div>
    );
  }

  const host = hosts.find((option) => option.id === form.hostId);
  const purpose = purposes.find((option) => option.id === form.purposeId);

  const inLookup = step === 1 && returning && !verified;

  const headingClass =
    "text-2xl font-bold tracking-tight text-gray-900 focus:outline-none";

  let body: React.ReactNode;

  if (step === 0) {
    body = (
      <div className="space-y-6">
        <div className="text-center">
          <h1 ref={headingRef} tabIndex={-1} className={headingClass}>
            Book a visit
          </h1>
          <p className="mt-2 text-base text-gray-600">
            Have you visited us before?
          </p>
        </div>

        <div className="grid gap-3">
          {[
            {
              label: "First time",
              hint: "I haven't booked a visit here before",
              isReturning: false,
            },
            {
              label: "I've been here before",
              hint: "Use the details from a previous visit",
              isReturning: true,
            },
          ].map((choice) => (
            <button
              key={choice.label}
              type="button"
              onClick={() => {
                // Switching to "first time" drops any verified profile, so its
                // locked name can't carry into an unverified booking form.
                if (verified && !choice.isReturning) {
                  startOver();
                }
                setReturning(choice.isReturning);
                goTo(1);
              }}
              className="group flex min-h-20 w-full items-center justify-between gap-4 rounded-xl border-2 border-gray-200 bg-white px-5 py-4 text-left transition-colors hover:border-accent hover:bg-accent-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              <span>
                <span className="block text-lg font-semibold text-gray-900">
                  {choice.label}
                </span>
                <span className="block text-sm text-gray-600">
                  {choice.hint}
                </span>
              </span>
              <span
                aria-hidden
                className="text-2xl text-gray-400 transition-colors group-hover:text-accent"
              >
                →
              </span>
            </button>
          ))}
        </div>
      </div>
    );
  } else if (inLookup) {
    body = (
      <div className="space-y-6">
        <h2 ref={headingRef} tabIndex={-1} className={headingClass}>
          Welcome back
        </h2>
        <ReturningLookup
          initialEmail={form.visitorEmail}
          onVerified={handleVerified}
          initialFirstName={form.firstName}
          initialLastName={form.lastName}
          onNewVisitor={(details) => {
            setReturning(false);
            setForm((current) => ({
              ...current,
              visitorEmail: details.email,
              firstName: details.firstName,
              lastName: details.lastName,
            }));
          }}
        />
        <button type="button" onClick={back} className={secondaryButtonClass}>
          Back
        </button>
      </div>
    );
  } else if (step === 1) {
    body = (
      <div className="space-y-5">
        <h2 ref={headingRef} tabIndex={-1} className={headingClass}>
          Your details
        </h2>

        {verified && (
          <p className="rounded-lg bg-accent-soft px-3 py-2.5 text-sm text-gray-900">
            Verified as <strong>{verified.email}</strong>. Not you?{" "}
            <button type="button" onClick={startOver} className={textButtonClass}>
              Start over
            </button>
          </p>
        )}

        <div>
          <NameFields
            firstName={form.firstName}
            lastName={form.lastName}
            onChange={(field, value) => update(field, value)}
            errors={fieldErrors}
            readOnly={Boolean(verified)}
            classes={nameFieldsClasses}
          />
          {verified && (
            <p className="mt-1.5 text-sm text-gray-600">
              From your saved profile. Ask reception if it needs correcting.
            </p>
          )}
        </div>

        <div>
          <label htmlFor="visitorEmail" className={labelClass}>
            Email
          </label>
          <input
            id="visitorEmail"
            type="email"
            inputMode="email"
            autoComplete="email"
            readOnly={Boolean(verified)}
            value={form.visitorEmail}
            onChange={(event) => update("visitorEmail", event.target.value)}
            placeholder="you@example.com"
            aria-invalid={Boolean(fieldErrors.visitorEmail)}
            aria-describedby="visitorEmailError"
            className={inputClass(Boolean(fieldErrors.visitorEmail))}
          />
          {fieldErrors.visitorEmail ? (
            <p id="visitorEmailError" className={errorClass}>
              {fieldErrors.visitorEmail}
            </p>
          ) : (
            !verified && (
              <p className="mt-1.5 text-sm text-gray-600">
                We&rsquo;ll send your QR code here.
              </p>
            )
          )}
        </div>

        <div>
          <label htmlFor="visitorPhone" className={labelClass}>
            Phone <span className="font-normal text-gray-500">(optional)</span>
          </label>
          <input
            id="visitorPhone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            value={form.visitorPhone}
            onChange={(event) => update("visitorPhone", event.target.value)}
            placeholder="+63 900 000 0000"
            aria-invalid={Boolean(fieldErrors.visitorPhone)}
            aria-describedby="visitorPhoneError"
            className={inputClass(Boolean(fieldErrors.visitorPhone))}
          />
          {fieldErrors.visitorPhone && (
            <p id="visitorPhoneError" className={errorClass}>
              {fieldErrors.visitorPhone}
            </p>
          )}
        </div>
      </div>
    );
  } else if (step === 2) {
    body = (
      <div className="space-y-5">
        <h2 ref={headingRef} tabIndex={-1} className={headingClass}>
          About your visit
        </h2>

        <div>
          <label htmlFor="hostId" className={labelClass}>
            Who or what are you visiting?
          </label>
          <HostCombobox
            id="hostId"
            hosts={hosts}
            value={form.hostId}
            onChange={(hostId) => update("hostId", hostId)}
            invalid={Boolean(fieldErrors.hostId)}
            describedBy="hostIdError"
          />
          {fieldErrors.hostId && (
            <p id="hostIdError" className={errorClass}>
              {fieldErrors.hostId}
            </p>
          )}
        </div>

        <div>
          <label htmlFor="purposeId" className={labelClass}>
            Purpose of visit
          </label>
          <select
            id="purposeId"
            value={form.purposeId}
            onChange={(event) => update("purposeId", event.target.value)}
            aria-invalid={Boolean(fieldErrors.purposeId)}
            aria-describedby="purposeIdError"
            className={inputClass(Boolean(fieldErrors.purposeId))}
          >
            <option value="">
              {purposes.length === 0
                ? "None available — please contact reception"
                : "Select a purpose…"}
            </option>
            {purposes.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
          {fieldErrors.purposeId && (
            <p id="purposeIdError" className={errorClass}>
              {fieldErrors.purposeId}
            </p>
          )}
        </div>
      </div>
    );
  } else if (step === 3) {
    body = (
      <div className="space-y-5">
        <h2 ref={headingRef} tabIndex={-1} className={headingClass}>
          When are you coming?
        </h2>
        <DateTimePicker
          value={form.slot}
          onChange={(slot) => update("slot", slot)}
          error={fieldErrors.scheduledFor}
        />
      </div>
    );
  } else {
    const { date, time } = form.slot;

    body = (
      <div className="space-y-5">
        <h2 ref={headingRef} tabIndex={-1} className={headingClass}>
          Check and confirm
        </h2>

        <dl className="divide-y divide-gray-100 rounded-xl border border-gray-200 bg-white">
          <ReviewRow label="Name" onEdit={() => goTo(1)}>
            {formatFullName(form.firstName, form.lastName)}
          </ReviewRow>
          <ReviewRow label="Email" onEdit={() => goTo(1)}>
            {form.visitorEmail}
          </ReviewRow>
          {form.visitorPhone.trim() && (
            <ReviewRow label="Phone" onEdit={() => goTo(1)}>
              {form.visitorPhone}
            </ReviewRow>
          )}
          <ReviewRow label="Visiting" onEdit={() => goTo(2)}>
            {host?.name}
            {host && (
              <span className="block text-xs text-gray-500">
                {host.department}
              </span>
            )}
          </ReviewRow>
          <ReviewRow label="Purpose" onEdit={() => goTo(2)}>
            {purpose?.label}
          </ReviewRow>
          <ReviewRow label="When" onEdit={() => goTo(3)}>
            {date && time
              ? `${formatDateKey(date)} at ${formatSlotTime(time)}`
              : "—"}
          </ReviewRow>
        </dl>

        <div>
          <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-gray-200 bg-white p-4">
            <input
              type="checkbox"
              checked={form.consent}
              onChange={(event) => update("consent", event.target.checked)}
              aria-invalid={Boolean(fieldErrors.consent)}
              aria-describedby="consentError"
              className="mt-0.5 size-5 shrink-0 accent-accent"
            />
            <span className="text-sm text-gray-800">
              I agree to the{" "}
              <Link
                href="/privacy"
                target="_blank"
                className="font-medium text-accent underline"
              >
                Privacy Policy
              </Link>
              .
            </span>
          </label>
          {fieldErrors.consent && (
            <p id="consentError" className={errorClass}>
              {fieldErrors.consent}
            </p>
          )}
        </div>

        {formError && (
          <p
            role="alert"
            className="rounded-lg bg-red-50 px-3 py-2.5 text-sm text-red-800"
          >
            {formError}
          </p>
        )}
      </div>
    );
  }

  // The opening question and the lookup screen carry their own buttons, and
  // the lookup has its own forms, which must not nest inside this one.
  if (step === 0 || inLookup) {
    return (
      <div className="space-y-6">
        {step > 0 && <Progress step={step} />}
        {body}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Progress step={step} />

      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          if (step === 4) void submit();
          else next();
        }}
        className="space-y-6"
      >
        {body}

        <div className="flex gap-3">
          <button type="button" onClick={back} className={secondaryButtonClass}>
            Back
          </button>
          <button
            type="submit"
            disabled={submitting}
            className={`${primaryButtonClass} flex-1`}
          >
            {step === 4 ? (submitting ? "Booking…" : "Book visit") : "Continue"}
          </button>
        </div>
      </form>
    </div>
  );
}
