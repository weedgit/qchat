import type { Metadata } from "next";
import "./globals.css";
import DesktopBootstrap from "@/components/DesktopBootstrap";

export const metadata: Metadata = {
  title: "Qchat",
  description: "Qchat — secure enterprise messaging",
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
        <DesktopBootstrap />
        {children}
      </body>
    </html>
  );
}
