import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Qchat Admin",
  description: "Qchat administration console",
  applicationName: "Qchat Admin",
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
    title: "Qchat Admin",
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
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
