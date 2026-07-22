/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: "export",
  basePath: "/admin",
  images: { unoptimized: true },
};

export default nextConfig;
