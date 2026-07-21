import type { Metadata } from "next";

// client 페이지("use client")는 metadata를 export할 수 없어 라우트 layout에서 지정
// 인증 페이지 — 색인 차단
export const metadata: Metadata = {
  title: "회원가입",
  robots: { index: false, follow: false },
};

export default function SignupLayout({ children }: { children: React.ReactNode }) {
  return children;
}
