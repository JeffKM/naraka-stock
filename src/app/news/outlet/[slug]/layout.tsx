import type { Metadata } from "next";
import { outletBySlug } from "@/lib/news/outlets";

// client 페이지("use client")는 metadata를 export할 수 없어 라우트 layout에서 지정.
// 매체명은 slug로 정적 조회 가능하므로 서버에서 title을 확정해 SSR·공유 미리보기에 실리게 한다.
export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const outlet = outletBySlug(slug);
  return { title: outlet ? outlet.name : "없는 매체" };
}

export default function NewsOutletLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
