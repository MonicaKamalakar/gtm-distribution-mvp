import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  rewrites() {
    // Proxy API calls to the FastAPI backend to avoid CORS.
    return [
      {
        source: "/api/health",
        destination: "http://127.0.0.1:8000/health",
      },
      {
        source: "/api/projects",
        destination: "http://127.0.0.1:8000/projects",
      },
      {
        source: "/api/v1/feedback",
        destination: "http://127.0.0.1:8000/api/v1/feedback",
      },
      {
        source: "/api/v1/projects/:path*",
        destination: "http://127.0.0.1:8000/api/v1/projects/:path*",
      },
    ];
  },
};

export default nextConfig;
