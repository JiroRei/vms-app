"use client";

import Link from "next/link";
import { useState } from "react";

import { NameFields } from "@/components/name-fields";
import { formatFullName, validateNameParts, type NameErrors } from "@/lib/names";

import {
  errorClass,
  inputClass,
  labelClass,
  nameFieldsClasses,
  primaryButtonClass,
  textButtonClass,
} from "./styles";

export type VerifiedDetails = {
  email: string;
  /** As stored on the profile; shown locked in the details step. */
  firstName: string;
  lastName: string;
  phone: string | null;
};

type TypedDetails = { email: string; firstName: string; lastName: string };

/**
 * "I've been here before": email + name → 6-digit code → saved details.
 *
 * A profile is an email *and* a name — several people can share one address —
 * so the code is requested for, and only works with, that exact pair.
 *
 * The lookup response never says whether a profile was found, so this screen
 * can't either: it always moves on to the code entry with the same wording,
 * and offers a way out for someone who isn't on file after all.
 */
export function ReturningLookup({
  initialEmail,
  initialFirstName,
  initialLastName,
  onVerified,
  onNewVisitor,
}: {
  initialEmail: string;
  initialFirstName: string;
  initialLastName: string;
  onVerified: (details: VerifiedDetails) => void;
  /** Switch to the first-time flow, carrying over whatever was typed. */
  onNewVisitor: (details: TypedDetails) => void;
}) {
  const [phase, setPhase] = useState<"details" | "code">("details");
  const [email, setEmail] = useState(initialEmail);
  const [firstName, setFirstName] = useState(initialFirstName);
  const [lastName, setLastName] = useState(initialLastName);
  const [code, setCode] = useState("");
  const [emailError, setEmailError] = useState<string | null>(null);
  const [nameErrors, setNameErrors] = useState<NameErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const identity = { email: email.trim(), firstName, lastName };

  async function requestCode() {
    setError(null);
    setEmailError(null);

    const errors = validateNameParts(firstName, lastName);
    setNameErrors(errors);
    if (!email.trim()) setEmailError("Please enter your email address.");
    if (Object.keys(errors).length > 0 || !email.trim()) return;

    setBusy(true);

    try {
      const response = await fetch("/api/booking/lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(identity),
      });
      const data = await response.json().catch(() => null);

      if (!response.ok) {
        if (data?.fieldErrors) {
          const { email: emailFieldError, ...rest } = data.fieldErrors;
          setEmailError(emailFieldError ?? null);
          setNameErrors(rest as NameErrors);
        } else {
          setError(data?.error ?? "Could not send a code.");
        }
        return;
      }

      setNotice(data.message);
      setCode("");
      setPhase("code");
    } catch {
      setError("Network problem — please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function submitCode() {
    setError(null);

    if (!/^\d{6}$/.test(code)) {
      setError("Enter the 6-digit code from the email.");
      return;
    }

    setBusy(true);

    try {
      const response = await fetch("/api/booking/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...identity, code }),
      });
      const data = await response.json().catch(() => null);

      if (!response.ok) {
        setError(data?.fieldErrors?.code ?? data?.error ?? "Could not verify.");
        return;
      }

      onVerified({
        email: identity.email,
        firstName: data.firstName,
        lastName: data.lastName,
        phone: data.phone,
      });
    } catch {
      setError("Network problem — please try again.");
    } finally {
      setBusy(false);
    }
  }

  const newVisitorLink = (
    <button
      type="button"
      onClick={() => onNewVisitor(identity)}
      className={textButtonClass}
    >
      Continue as a new visitor
    </button>
  );

  if (phase === "details") {
    return (
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          if (!busy) void requestCode();
        }}
        className="space-y-5"
      >
        <p className="text-sm text-gray-600">
          Enter the email and name you booked with before.
        </p>

        <NameFields
          idPrefix="lookup-"
          firstName={firstName}
          lastName={lastName}
          onChange={(field, value) => {
            if (field === "firstName") setFirstName(value);
            else setLastName(value);
            setNameErrors((current) => {
              const rest = { ...current };
              delete rest[field];
              return rest;
            });
          }}
          errors={nameErrors}
          classes={nameFieldsClasses}
        />

        <div>
          <label htmlFor="lookupEmail" className={labelClass}>
            Email
          </label>
          <input
            id="lookupEmail"
            type="email"
            autoComplete="email"
            inputMode="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@example.com"
            aria-invalid={Boolean(emailError)}
            aria-describedby="lookupEmailNote"
            className={inputClass(Boolean(emailError))}
          />
          {emailError && <p className={errorClass}>{emailError}</p>}
          <p id="lookupEmailNote" className="mt-2 text-sm text-gray-600">
            We use your email and name only to find your previous visit
            records, so you don&rsquo;t have to type your details again. See
            our{" "}
            <Link href="/privacy" className="font-medium text-accent underline">
              Privacy Policy
            </Link>
            .
          </p>
        </div>

        {error && (
          <p role="alert" className={errorClass}>
            {error}
          </p>
        )}

        <button type="submit" disabled={busy} className={primaryButtonClass}>
          {busy ? "Sending…" : "Send me a code"}
        </button>

        <p className="text-center">{newVisitorLink}</p>
      </form>
    );
  }

  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        if (!busy) void submitCode();
      }}
      className="space-y-5"
    >
      {notice && (
        <p
          role="status"
          className="rounded-lg bg-accent-soft px-3 py-2.5 text-sm text-gray-900"
        >
          {notice}
        </p>
      )}

      <div>
        <label htmlFor="lookupCode" className={labelClass}>
          6-digit code for {formatFullName(firstName, lastName)}, sent to{" "}
          {identity.email}
        </label>
        <input
          id="lookupCode"
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          value={code}
          onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))}
          placeholder="123456"
          aria-invalid={Boolean(error)}
          aria-describedby="codeError"
          className={`${inputClass(Boolean(error))} text-center font-mono text-2xl tracking-[0.5em]`}
        />
        {error && (
          <p id="codeError" role="alert" className={errorClass}>
            {error}
          </p>
        )}
      </div>

      <button type="submit" disabled={busy} className={primaryButtonClass}>
        {busy ? "Checking…" : "Verify code"}
      </button>

      <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
        <button
          type="button"
          disabled={busy}
          onClick={() => void requestCode()}
          className={textButtonClass}
        >
          Send a new code
        </button>
        <button
          type="button"
          onClick={() => {
            setPhase("details");
            setError(null);
            setNotice(null);
          }}
          className={textButtonClass}
        >
          Change email or name
        </button>
      </div>

      <p className="border-t border-gray-200 pt-4 text-center text-sm text-gray-600">
        No code? {newVisitorLink}
      </p>
    </form>
  );
}
