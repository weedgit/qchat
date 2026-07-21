import type { Metadata, Viewport } from "next";
import "./globals.css";
import DesktopBootstrap from "@/components/DesktopBootstrap";
import PwaBootstrap from "@/components/PwaBootstrap";

export const metadata: Metadata = {
  title: "Qchat",
  description: "Qchat — secure enterprise messaging",
  applicationName: "Qchat",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/favicon.png", sizes: "32x32", type: "image/png" },
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  appleWebApp: {
    capable: true,
    title: "Qchat",
    statusBarStyle: "black-translucent",
  },
};

export const viewport: Viewport = {
  themeColor: "#0d1724",
};

const themeBoot = `(function(){try{var t=localStorage.getItem('qchat.theme')||'dark';var r=t==='system'?(matchMedia('(prefers-color-scheme: light)').matches?'light':'dark'):t;document.documentElement.setAttribute('data-theme',r);document.documentElement.style.colorScheme=r;}catch(e){}})();`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBoot }} />
      </head>
      <body>
        <PwaBootstrap />
        <DesktopBootstrap />
        {children}
      </body>
    </html>
  );
}
