import type { Metadata, Viewport } from "next";
import { Toaster } from "@/components/ui/sonner";
import { site } from "@/lib/site";
import "./globals.css";

// Pretendard 가변 글꼴. 한글은 글자 묶음 단위로 필요한 만큼만 내려받는다(dynamic subset)
const PRETENDARD = "https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css";

const TITLE = `${site.name} — 인스타그램 댓글 자동 DM`;

export const metadata: Metadata = {
  // 미리 렌더링된 페이지는 빌드 때의 SITE_URL, 요청마다 그리는 페이지는 실행 환경의 APP_URL로 공유 이미지 주소를 만든다
  metadataBase: new URL(process.env.SITE_URL ?? process.env.APP_URL ?? "http://localhost:3000"),
  title: { default: TITLE, template: `%s | ${site.name}` },
  description: site.description,
  openGraph: { type: "website", locale: "ko_KR", siteName: site.name, title: TITLE, description: site.description },
  twitter: { card: "summary_large_image", title: TITLE, description: site.description },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#F6F8FA" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <head>
        <link rel="preconnect" href="https://cdn.jsdelivr.net" crossOrigin="anonymous" />
        <link rel="stylesheet" href={PRETENDARD} crossOrigin="anonymous" />
      </head>
      <body className="min-h-dvh bg-background font-sans text-foreground antialiased">
        {children}
        <Toaster position="top-center" richColors />
      </body>
    </html>
  );
}
