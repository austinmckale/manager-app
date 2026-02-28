import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Joist PDFs are often 10MB+; raise Server Action payload limit so imports
    // do not fail before reaching the parser.
    serverActions: {
      bodySizeLimit: "64mb",
    },
    // Keep prefetched route payloads reusable in the client router cache so
    // bottom-nav tab switches feel instant instead of re-fetching every time.
    staleTimes: {
      dynamic: 30,
      static: 180,
    },
    dynamicOnHover: true,
  },
};

export default nextConfig;
