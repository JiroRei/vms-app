import type { NextConfig } from "next";
import { PHASE_PRODUCTION_BUILD, PHASE_PRODUCTION_SERVER } from "next/constants";

import { assertProductionAuthSecret } from "./src/lib/auth-secret";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1"],
  distDir: process.env.NEXT_DIST_DIR || ".next",
  logging: {
    // The development request log prints full URLs; manage links and password
    // reset links carry their token in the query string.
    incomingRequests: { ignore: [/[?&]token=/i] },
  },
  async redirects() {
    return [
      { source: "/kiosk", destination: "/check-in", permanent: false },
      {
        source: "/kiosk/:path*",
        destination: "/check-in/:path*",
        permanent: false,
      },
      { source: "/book", destination: "/appointment-booking", permanent: false },
      {
        source: "/book/:path*",
        destination: "/appointment-booking/:path*",
        permanent: false,
      },
    ];
  },
};

export default function config(phase: string): NextConfig {
  // `next build` and the production server (server.mjs or `next start`) both
  // load this file, so a missing or public BETTER_AUTH_SECRET stops either one.
  if (phase === PHASE_PRODUCTION_BUILD || phase === PHASE_PRODUCTION_SERVER) {
    assertProductionAuthSecret();
  }
  return nextConfig;
}
