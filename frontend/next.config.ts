import type { NextConfig } from "next";

// Where the Python API runs. Browser calls go to /api/* on this app and are proxied there,
// so the API key never has to cross origins and no CORS setup is needed.
const API_URL = process.env.CLIMASURE_API_URL ?? "http://localhost:8000";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  experimental: {
    // Dashboard pages load data in the browser with the client's API key, so they can't be
    // instant by design. Only validate segments that explicitly export `instant`.
    instantInsights: { validationLevel: "manual-warning" },
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async rewrites() {
    return [
      { source: "/api/v1/:path*", destination: `${API_URL}/v1/:path*` },
      { source: "/api/health", destination: `${API_URL}/health` },
    ];
  },
};

export default nextConfig;
