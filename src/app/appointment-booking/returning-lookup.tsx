"use client";
import { apiErrorMessage } from "@/lib/api-error-message";


import Link from "next/link";
import { useRef, useState } from "react";

import { NameFields } from "@/components/name-fields";
import { QrScanner } from "@/components/qr-scanner";
import { formatFullName, validateNameParts, type NameErrors } from "@/lib/names";

import {
  errorClass,
  inputClass,
  labelClass,
  nameFieldsClasses,
  primaryButtonClass,
  textButtonClass,
  secondaryButtonClass,
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
 * "I've been here before": visitor pass → saved details, with the existing
 * email + name → 6-digit code flow available as a fallback.
 *
 * A profile is an email *and* a name — several people can share one address —
 * so the code is requested for, and only works with, that exact pair.
 *
 * The email lookup never says whether a profile was found: that fallback
 * always moves to code entry with the same wording. A signed pass must be
 * validated before saved details are returned.
 */
export function ReturningLookup({
  initialEmail,
  initialFirstName,
  initialLastName,
  onVerified,
  onNewVisitor,
  allowPass = false,
}: {
  initialEmail: string;
  initialFirstName: string;
  initialLastName: string;
  onVerified: (details: VerifiedDetails) => void;
  /**
   * Switch to the first-time flow, carrying over whatever was typed. Omitted on
   * the manage page, where there is no first-time flow to switch to.
   */
  onNewVisitor?: (details: TypedDetails) => void;
  /** Booking can use a pass; managing appointments still requires email verification. */
  allowPass?: boolean;
}) {
  const [phase, setPhase] = useState<"pass" | "details" | "code">(allowPass ? "pass" : "details");
  const [passToken, setPassToken] = useState("");
  const [scanning, setScanning] = useState(false);
  const passRequestRunning = useRef(false);
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

  async function submitPass(value = passToken) {
    if (passRequestRunning.current) return;
    setError(null);
    const token = value.trim();
    if (!token) {
      setError("Enter your visitor pass QR ID, or use your name and email.");
      return;
    }
    passRequestRunning.current = true;
    setBusy(true);
    setScanning(false);
    try {
      const response = await fetch("/api/booking/pass/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        setError(apiErrorMessage(data?.error) ?? "Could not read your pass. Please try again.");
        return;
      }
      onVerified({
        email: data.email,
        firstName: data.firstName,
        lastName: data.lastName,
        phone: data.phone,
      });
    } catch {
      setError("Network problem — please try again.");
    } finally {
      passRequestRunning.current = false;
      setBusy(false);
    }
  }

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
          setError(apiErrorMessage(data?.error) ?? "Could not send a code.");
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
        setError(data?.fieldErrors?.code ?? apiErrorMessage(data?.error) ?? "Could not verify.");
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

  const newVisitorLink = onNewVisitor ? (
    <button
      type="button"
      disabled={busy}
      onClick={() => onNewVisitor(identity)}
      className={textButtonClass}
    >
      Continue as a new visitor
    </button>
  ) : null;

  if (phase === "pass") {
    return (
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          if (!busy) void submitPass();
        }}
        className="space-y-5"
      >
        <p className="text-sm text-gray-600">
          Use your visitor pass to bring up your saved details and book another visit.
        </p>
        {scanning ? (
          <>
            <QrScanner
              active={!busy}
              onScan={(value) => {
                setPassToken(value);
                void submitPass(value);
              }}
              unavailableMessage="No camera available. Enter your QR ID below, or use your name and email."
              scanHint="Hold your visitor pass QR up to the camera."
            />
            <button type="button" disabled={busy} onClick={() => setScanning(false)} className={textButtonClass}>
              Stop scanning
            </button>
          </>
        ) : (
          <button type="button" disabled={busy} onClick={() => setScanning(true)} className={`${secondaryButtonClass} w-full`}>
            Scan visitor pass QR
          </button>
        )}
        <div>
          <label htmlFor="lookupPass" className={labelClass}>Visitor pass QR ID</label>
          <input
            id="lookupPass"
            type="text"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            maxLength={200}
            disabled={busy}
            value={passToken}
            onChange={(event) => {
              setPassToken(event.target.value);
              setError(null);
            }}
            placeholder="vp1.…"
            aria-invalid={Boolean(error)}
            aria-describedby={`lookupPassNote${error ? " lookupPassError" : ""}`}
            className={inputClass(Boolean(error))}
          />
          <p id="lookupPassNote" className="mt-2 text-sm text-gray-600">
            Scan your pass or paste the full code from its QR.
          </p>
          {error && <p id="lookupPassError" role="alert" className={errorClass}>{error}</p>}
        </div>
        <button type="submit" disabled={busy} className={primaryButtonClass}>
          {busy ? "Finding your details…" : "Continue with my pass"}
        </button>
        <p className="text-center">
          <button
            type="button"
            disabled={busy}
            className={textButtonClass}
            onClick={() => {
              setScanning(false);
              setError(null);
              setPhase("details");
            }}
          >
            I don’t have my QR ID — use name and email
          </button>
        </p>
        {newVisitorLink && <p className="text-center">{newVisitorLink}</p>}
      </form>
    );
  }

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
        {allowPass && (
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setError(null);
              setPhase("pass");
            }}
            className={textButtonClass}
          >
            Use my visitor pass QR ID instead
          </button>
        )}

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
            autoComplete="off"
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

        {newVisitorLink && <p className="text-center">{newVisitorLink}</p>}
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
          autoComplete="off"
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

      {newVisitorLink && (
        <p className="border-t border-gray-200 pt-4 text-center text-sm text-gray-600">
          No code? {newVisitorLink}
        </p>
      )}
    </form>
  );
}
