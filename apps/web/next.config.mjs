import path from "node:path";

/** @type {import("next").NextConfig} */
const nextConfig = {
  distDir: process.env.OU_E2E_WEB_PORT ? ".next-e2e" : process.env.OU_LOCAL_PREVIEW === "1" ? ".next-preview" : ".next",
  typescript: {
    tsconfigPath: process.env.OU_E2E_WEB_PORT ? "tsconfig.e2e.json" : process.env.OU_LOCAL_PREVIEW === "1" ? "tsconfig.preview.json" : "tsconfig.json"
  },
  outputFileTracingRoot: path.resolve(process.cwd(), "../.."),
  transpilePackages: ["@ou-image/ui", "@ou-image/shared"],
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/((?!api/integrations/nodeseek/settings\\.html$).*)",
        headers: [{ key: "X-Frame-Options", value: "SAMEORIGIN" }]
      },
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
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
