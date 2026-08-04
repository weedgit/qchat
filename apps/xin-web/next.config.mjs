import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDev = process.env.NODE_ENV === "development";
const basePath = "/xin";

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  basePath,
  ...(isDev ? {} : { output: "export" }),
  images: { unoptimized: true },
  transpilePackages: ["@qchat/i18n"],
  env: {
    NEXT_PUBLIC_BASE_PATH: basePath,
  },
  ...(isDev
    ? {
        async rewrites() {
          const api = (
            process.env.QCHAT_DEV_API_PROXY || "http://127.0.0.1:8080"
          ).replace(/\/$/, "");
          return [{ source: "/v1/:path*", destination: `${api}/v1/:path*` }];
        },
      }
    : {}),
  webpack: (config) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      "@qchat/i18n": path.resolve(__dirname, "../../packages/i18n/src/index.ts"),
    };
    return config;
  },
};

export default nextConfig;
