import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Providers } from "@/components/Providers";

export const metadata: Metadata = {
  title: "Rchat Admin",
  description: "Rchat administration console",
  applicationName: "Rchat Admin",
  manifest: "/admin/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/admin/favicon.png", sizes: "32x32", type: "image/png" },
      { url: "/admin/icons/icon-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: [{ url: "/admin/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  appleWebApp: {
    capable: true,
    title: "Rchat Admin",
    statusBarStyle: "black-translucent",
  },
};

export const viewport: Viewport = {
  themeColor: "#0d1724",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
