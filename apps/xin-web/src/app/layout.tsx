import type { Metadata, Viewport } from "next";
import "./globals.css";
import "./xin-layout.css";
import AppProviders from "@/components/AppProviders";
import DesktopBootstrap from "@/components/DesktopBootstrap";
import PwaBootstrap from "@/components/PwaBootstrap";
import ShellConnectionBanner from "@/components/ShellConnectionBanner";
import { APP_BASE_PATH, STORAGE_KEYS } from "@/lib/brand";

const bp = APP_BASE_PATH;

export const metadata: Metadata = {
  title: "XinChat",
  description: "XinChat — secure enterprise messaging",
  applicationName: "XinChat",
  manifest: `${bp}/manifest.webmanifest`,
  icons: {
    icon: [
      { url: `${bp}/favicon.png`, sizes: "32x32", type: "image/png" },
      { url: `${bp}/icons/icon-192.png`, sizes: "192x192", type: "image/png" },
    ],
    apple: [{ url: `${bp}/icons/apple-touch-icon.png`, sizes: "180x180", type: "image/png" }],
  },
  appleWebApp: {
    capable: true,
    title: "XinChat",
    statusBarStyle: "black-translucent",
  },
};

export const viewport: Viewport = {
  themeColor: "#059669",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

const themeBoot = `(function(){try{var t=localStorage.getItem('${STORAGE_KEYS.theme}')||'dark';var r=t==='system'?(matchMedia('(prefers-color-scheme: light)').matches?'light':'dark'):t;document.documentElement.setAttribute('data-theme',r);document.documentElement.style.colorScheme=r;}catch(e){}})();`;

const localeBoot = `(function(){try{var l=localStorage.getItem('${STORAGE_KEYS.locale}')||'zh';var r=(l==='en')?'en':'zh';document.documentElement.lang=r==='zh'?'zh-CN':'en';}catch(e){}})();`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN" suppressHydrationWarning data-app="xinchat">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700;1,9..40,400&display=swap"
          rel="stylesheet"
        />
        <script dangerouslySetInnerHTML={{ __html: themeBoot }} />
        <script dangerouslySetInnerHTML={{ __html: localeBoot }} />
      </head>
      <body>
        <AppProviders>
          <PwaBootstrap />
          <DesktopBootstrap />
          <ShellConnectionBanner />
          {children}
        </AppProviders>
      </body>
    </html>
  );
}
