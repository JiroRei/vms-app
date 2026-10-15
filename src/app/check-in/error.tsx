"use client";
import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
export default function KioskError() {
  const router = useRouter();
  useEffect(() => { const timer = setTimeout(() => router.replace("/check-in"), 15_000); return () => clearTimeout(timer); }, [router]);
  return <main className="mx-auto max-w-lg space-y-4 p-10 text-center"><h1 className="text-2xl font-semibold">Something went wrong. Please ask the guard for help.</h1><p>Returning to check-in in 15 seconds.</p><Link href="/check-in" className="underline">Return to check-in</Link></main>;
}
