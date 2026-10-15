import Link from "next/link";
export default function NotFound() {
  return <main className="mx-auto max-w-lg space-y-4 p-10"><h1 className="text-2xl font-semibold">Page not found</h1><p>This page is no longer available. Please check the address.</p><Link href="/" className="underline">Return home</Link></main>;
}
