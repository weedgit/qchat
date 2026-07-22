import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: "export",
  images: { unoptimized: true },
  transpilePackages: ["@qchat/i18n"],
  webpack: (config) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      "@qchat/i18n": path.resolve(__dirname, "../../packages/i18n/src/index.ts"),
    };
    return config;
  },
};

export default nextConfig;
