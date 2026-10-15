"use client";

import Link from "next/link";
import { Suspense, type FormEvent, useState } from "react";
import { useSearchParams } from "next/navigation";

export const dynamic = "force-dynamic";

export default function ResetPasswordPage() {
  return <Suspense fallback={<main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-5">Loading password reset…</main>}>
    <ResetPasswordForm />
  </Suspense>;
}

function ResetPasswordForm() {
  const params = useSearchParams();
  const token = params.get("token") ?? "";
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const newPassword = String(form.get("password") ?? "");
    if (newPassword !== form.get("confirmPassword")) {
      setMessage("The passwords do not match.");
      return;
    }
    setBusy(true);
    try {
      const response = await fetch("/api/auth/reset-password", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, newPassword }),
      });
      const result = await response.json();
      setMessage(response.ok ? "Password updated. You can now sign in." : result.message ?? "This reset link is invalid or expired.");
    } catch {
      setMessage("Could not update the password. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-5">
    <h1 className="text-2xl font-bold">Choose a new password</h1>
    {!token ? <p className="mt-3 text-sm text-red-700">This reset link is missing or invalid.</p> : <form onSubmit={submit} className="mt-6 space-y-4">
      <label className="block text-sm font-medium">New password<input name="password" type="password" required minLength={8} autoComplete="new-password" className="mt-1 block w-full rounded-lg border px-3 py-2" /></label>
      <label className="block text-sm font-medium">Confirm password<input name="confirmPassword" type="password" required minLength={8} autoComplete="new-password" className="mt-1 block w-full rounded-lg border px-3 py-2" /></label>
      <button disabled={busy} className="w-full rounded-lg bg-blue-600 px-4 py-2.5 font-semibold text-white disabled:opacity-50">{busy ? "Updating…" : "Update password"}</button>
      {message && <p role="status" className="text-sm text-gray-600">{message}</p>}
    </form>}
    <Link className="mt-5 text-sm text-blue-700" href="/login">Back to sign in</Link>
  </main>;
}
