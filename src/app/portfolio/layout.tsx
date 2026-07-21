import type { Metadata } from "next";

// client 페이지("use client")는 metadata를 export할 수 없어 라우트 layout에서 지정
// 개인 지갑(자산) — 색인 차단
export const metadata: Metadata = {
  title: "지갑",
  robots: { index: false, follow: false },
};

export default function PortfolioLayout({ children }: { children: React.ReactNode }) {
  return children;
}
