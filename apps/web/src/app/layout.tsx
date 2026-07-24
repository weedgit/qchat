import type { Metadata, Viewport } from "next";
import "./globals.css";
import AppProviders from "@/components/AppProviders";
import DesktopBootstrap from "@/components/DesktopBootstrap";
import PwaBootstrap from "@/components/PwaBootstrap";
import ShellConnectionBanner from "@/components/ShellConnectionBanner";

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

const localeBoot = `(function(){try{var l=localStorage.getItem('qchat.locale')||'system';var r=l;if(l==='system'){var n=(navigator.language||'en').toLowerCase();r=n.indexOf('zh')===0?'zh':'en';}document.documentElement.lang=r==='zh'?'zh-CN':'en';}catch(e){}})();`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
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
