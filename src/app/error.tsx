"use client";
import Link from "next/link";
export default function ErrorPage({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return <main className="mx-auto max-w-lg space-y-4 p-10"><h1 className="text-2xl font-semibold">Something went wrong</h1><p>Please try again. If the problem continues, ask your administrator for help.</p><button onClick={retry} className="rounded border px-4 py-2">Try again</button><Link href="/" className="block underline">Return home</Link></main>;
}
