import "server-only";
import { getSupabaseAdmin } from "@/lib/supabase/server";

// 관심종목 — 내 관심 목록 조회 및 토글

// 내 관심종목 코드 목록
export async function getWatchlist(userId: number): Promise<string[]> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("watchlists")
    .select("stock_code")
    .eq("user_id", userId);
  if (error) throw error;
  return data.map((row) => row.stock_code);
}

// 관심종목 토글 — RPC 호출 후 최종 등록 상태 반환 (true=등록됨)
export async function toggleWatchlist(userId: number, stockCode: string): Promise<boolean> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.rpc("toggle_watchlist", {
    p_user_id: userId,
    p_stock_code: stockCode,
  });
  if (error) throw error;
  return data as boolean;
}
