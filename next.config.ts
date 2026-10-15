import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1"],
  distDir: process.env.NEXT_DIST_DIR || ".next",
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

export default nextConfig;
