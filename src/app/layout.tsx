import type { Metadata, Viewport } from "next";
import { Geist_Mono, Noto_Sans_KR } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/Providers";
import { BottomNav } from "@/components/layout/BottomNav";
import { FetchIndicator } from "@/components/layout/FetchIndicator";
import { Header } from "@/components/layout/Header";
import { HoldingAlertWatcher } from "@/components/layout/HoldingAlertWatcher";
import { HellAtmosphereLayer } from "@/components/layout/HellAtmosphereLayer";
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

export const metadata: Metadata = {
  title: {
    default: "나라카증권",
    template: "나라카증권 | %s",
  },
  description: "요괴 컨셉카페 나라카의 8월 이벤트 — 가상 화폐로 즐기는 모의 주식 거래",
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
        <HellAtmosphereLayer />
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
