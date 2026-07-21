import type { Metadata } from "next";
import { getSupabaseAdmin } from "@/lib/supabase/server";

// client 페이지("use client")는 metadata를 export할 수 없어 라우트 layout에서 지정.
// 종목명은 code로 서버 조회 가능하므로 SSR·공유 미리보기에 "나라카증권 | 종목명"이 실리게 한다.
// (실시간 체결가 타이틀은 페이지가 hydration 후 document.title로 덧씌운다)
export async function generateMetadata({
  params,
}: {
  params: Promise<{ code: string }>;
}): Promise<Metadata> {
  const { code } = await params;
  try {
    const { data } = await getSupabaseAdmin()
      .from("stocks")
      .select("name")
      .eq("code", code.toUpperCase())
      .maybeSingle();
    if (data?.name) return { title: data.name };
  } catch {
    // 조회 실패 시 상위 기본 타이틀로 폴백 (메타데이터가 페이지 렌더를 막지 않도록)
  }
  return {};
}

export default function StockDetailLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
