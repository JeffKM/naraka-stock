import type { Metadata, Viewport } from "next";
import { Geist_Mono, Noto_Sans_KR } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/Providers";
import { BottomNav } from "@/components/layout/BottomNav";
import { FetchIndicator } from "@/components/layout/FetchIndicator";
import { Header } from "@/components/layout/Header";
import { HoldingAlertWatcher } from "@/components/layout/HoldingAlertWatcher";
import { MarketGridBackdrop } from "@/components/layout/MarketGridBackdrop";
import { MarketHaltBanner } from "@/components/quotes/MarketHaltBanner";
import { Toaster } from "@/components/ui/sonner";

const notoSansKr = Noto_Sans_KR({
  variable: "--font-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const OG_DESCRIPTION =
  "요괴 컨셉카페 나라카의 8월 이벤트 — 가상 화폐로 즐기는 모의 주식 거래";

export const metadata: Metadata = {
  // OG·Twitter 이미지/canonical을 절대 URL로 승격하기 위한 기준 도메인 (프로덕션)
  metadataBase: new URL("https://naraka.cafe"),
  title: {
    default: "나라카증권",
    template: "나라카증권 | %s",
  },
  description: OG_DESCRIPTION,
  // 카카오톡·SNS 공유 미리보기 카드 (1200×630 og.png)
  openGraph: {
    type: "website",
    siteName: "나라카증권",
    title: "나라카증권",
    description: OG_DESCRIPTION,
    url: "/",
    locale: "ko_KR",
    images: [{ url: "/og.png", width: 1200, height: 630, alt: "나라카증권" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "나라카증권",
    description: OG_DESCRIPTION,
    images: ["/og.png"],
  },
};

export const viewport: Viewport = {
  themeColor: "#1d1726",
};

// 다크 테마 기본 (아기자기한 지옥 무드 — PRD §6.1), 설정 모달에서 라이트 전환 가능.
// 테마 클래스는 next-themes가 html에 주입하므로 suppressHydrationWarning이 필요하다.
export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="ko"
      suppressHydrationWarning
      className={`${notoSansKr.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-dvh flex-col">
        <MarketGridBackdrop />
        <Providers>
          <FetchIndicator />
          <HoldingAlertWatcher />
          <Header />
          <MarketHaltBanner />
          <main className="mx-auto w-full max-w-lg flex-1 px-4 pb-24 pt-4">
            {children}
          </main>
          <BottomNav />
          <Toaster position="top-center" />
        </Providers>
      </body>
    </html>
  );
}
