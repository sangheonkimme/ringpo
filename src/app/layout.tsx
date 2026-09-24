import type { Metadata, Viewport } from "next";
import { Hahmlet, IBM_Plex_Sans_KR } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import { site } from "@/lib/site";
import "./globals.css";

const display = Hahmlet({ weight: ["600", "700", "800"], preload: false, display: "swap", variable: "--font-hahmlet" });
const sans = IBM_Plex_Sans_KR({ weight: ["400", "500", "600", "700"], preload: false, display: "swap", variable: "--font-plex" });

export const metadata: Metadata = {
  title: { default: `${site.name} — 인스타그램 댓글 자동 DM`, template: `%s | ${site.name}` },
  description: site.description,
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#F5F1EA" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko" className={`${display.variable} ${sans.variable}`}>
      <body className="min-h-dvh bg-background font-sans text-foreground antialiased">
        {children}
        <Toaster position="top-center" richColors />
      </body>
    </html>
  );
}
