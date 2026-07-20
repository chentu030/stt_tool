import type { Metadata, Viewport } from "next";
import "./globals.css";
import { AuthProvider } from "@/components/AuthProvider";
import { PrefsProvider } from "@/components/PrefsProvider";
import DialogProvider from "@/components/DialogProvider";
import ToastProvider from "@/components/ToastProvider";
import AppShell from "@/components/shell/AppShell";
import AccessGate from "@/components/AccessGate";

export const metadata: Metadata = {
  title: "Albireus — 把說話寫成知識",
  description: "語音驅動的知識工作區：轉錄、編輯、組織筆記。",
  applicationName: "Albireus",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "Albireus",
    statusBarStyle: "default",
  },
  icons: {
    icon: [
      { url: "/brand/logo-mark.png", type: "image/png" },
      { url: "/brand/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/brand/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/brand/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#0F766E" },
    { media: "(prefers-color-scheme: dark)", color: "#0B1220" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-TW" data-theme="light" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700&family=Space+Grotesk:wght@500;700&display=swap"
          rel="stylesheet"
        />
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/npm/katex@0.16.22/dist/katex.min.css"
          crossOrigin="anonymous"
        />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@24,400,0,0&display=swap"
        />
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var r=localStorage.getItem('cadence_prefs_v1');var t=localStorage.getItem('theme');var theme='light';if(r){var p=JSON.parse(r);if(p.theme==='dark'||p.theme==='light')theme=p.theme;else if(p.theme==='system'&&matchMedia('(prefers-color-scheme:dark)').matches)theme='dark';}else if(t==='dark'||t==='light')theme=t;document.documentElement.setAttribute('data-theme',theme);}catch(e){}})();`,
          }}
        />
      </head>
      <body>
        <AuthProvider>
          <PrefsProvider>
            <DialogProvider>
              <ToastProvider>
                <AccessGate>
                  <AppShell>{children}</AppShell>
                </AccessGate>
              </ToastProvider>
            </DialogProvider>
          </PrefsProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
