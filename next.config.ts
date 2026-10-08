import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
