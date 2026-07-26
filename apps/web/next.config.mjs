import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDev = process.env.NODE_ENV === "development";

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Static export for production/nginx. Dev uses a server so /v1 can be proxied.
  ...(isDev ? {} : { output: "export" }),
  images: { unoptimized: true },
  transpilePackages: ["@qchat/i18n"],
  ...(isDev
    ? {
        // Proxy API through :3000 so captcha works via Cursor port-forward / same origin.
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
