import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  outputFileTracingRoot: path.resolve(process.cwd(), "../.."),
  transpilePackages: ["@ou-image/ui", "@ou-image/shared"],
  poweredByHeader: false
};

export default nextConfig;
