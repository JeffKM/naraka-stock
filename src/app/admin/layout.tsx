import type { Metadata } from "next";

// client 페이지("use client")는 metadata를 export할 수 없어 라우트 layout에서 지정
export const metadata: Metadata = { title: "콘솔" };

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return children;
}
