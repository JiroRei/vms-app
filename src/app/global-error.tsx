"use client";
import Link from "next/link";
export default function GlobalError({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return <html lang="en"><body><main style={{ maxWidth: 480, margin: "80px auto", padding: 24, fontFamily: "sans-serif" }}><h1>Something went wrong</h1><p>Please try again or ask your administrator for help.</p><button onClick={retry}>Try again</button><p><Link href="/">Return home</Link></p></main></body></html>;
}
