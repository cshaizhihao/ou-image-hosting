import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  outputFileTracingRoot: path.resolve(process.cwd(), "../.."),
  transpilePackages: ["@ou-image/ui", "@ou-image/shared"],
  poweredByHeader: false,
  async rewrites() {
    const apiTarget =
      process.env.API_PROXY_TARGET ?? "http://127.0.0.1:4000";
    return [
      {
        source: "/api/:path*",
        destination: `${apiTarget}/:path*`
      }
    ];
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Referrer-Policy", value: "same-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()"
          }
        ]
      }
    ];
  }
};

export default nextConfig;
