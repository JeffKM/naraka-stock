import type { Metadata } from "next";

// client 페이지("use client")는 metadata를 export할 수 없어 라우트 layout에서 지정
// 운영자 콘솔 — 색인 차단 (상품 걸린 이벤트의 관리 화면)
export const metadata: Metadata = {
  title: "콘솔",
  robots: { index: false, follow: false },
};

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return children;
}
