"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";

export default function ForgotPasswordPage() {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    const email = new FormData(event.currentTarget).get("email");
    try {
      await fetch("/api/auth/request-password-reset", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, redirectTo: `${window.location.origin}/reset-password` }),
      });
    } finally {
      setMessage("If that staff account exists, a reset link will be sent to its email address.");
      setBusy(false);
    }
  }

  return <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-5">
    <h1 className="text-2xl font-bold">Reset your password</h1>
    <p className="mt-2 text-sm text-gray-600">Enter your staff account email address.</p>
    <form onSubmit={submit} className="mt-6 space-y-4">
      <label className="block text-sm font-medium">Email<input name="email" type="email" required autoComplete="email" className="mt-1 block w-full rounded-lg border px-3 py-2" /></label>
      <button disabled={busy} className="w-full rounded-lg bg-blue-600 px-4 py-2.5 font-semibold text-white disabled:opacity-50">{busy ? "Sending…" : "Send reset link"}</button>
      {message && <p role="status" className="text-sm text-gray-600">{message}</p>}
    </form>
    <Link className="mt-5 text-sm text-blue-700" href="/login">Back to sign in</Link>
  </main>;
}
