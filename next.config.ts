import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // react-pdf ships its own React reconciler and reads font files at runtime; keep it out of the bundle.
  serverExternalPackages: ["@react-pdf/renderer"],
};

export default nextConfig;
