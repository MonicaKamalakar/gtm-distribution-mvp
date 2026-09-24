import type { NextConfig } from "next";

// FastAPI backend base URL (no trailing slash). Local development default;
// override in production by setting BACKEND_URL.
const BACKEND_URL = process.env.BACKEND_URL ?? "http://127.0.0.1:8000";

const nextConfig: NextConfig = {
  rewrites() {
    // Proxy API calls to the FastAPI backend to avoid CORS.
    return [
      {
        source: "/api/health",
        destination: `${BACKEND_URL}/health`,
      },
      {
        source: "/api/projects",
        destination: `${BACKEND_URL}/projects`,
      },
      {
        source: "/api/v1/feedback",
        destination: `${BACKEND_URL}/api/v1/feedback`,
      },
      {
        source: "/api/v1/projects/:path*",
        destination: `${BACKEND_URL}/api/v1/projects/:path*`,
      },
    ];
  },
};

export default nextConfig;
