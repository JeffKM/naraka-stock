import "server-only";
import { getSession } from "@/lib/auth/session";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { getQuoteBoard } from "@/services/quoteService";
import type { RankingEntry } from "@/types/domain";

export interface RankingBoard {
  top: RankingEntry[];
  me: RankingEntry | null; // 로그인 시 내 순위 (미로그인 null)
  totalUsers: number;
}

const TOP_SIZE = 20;

// 총자산 랭킹 (T-601): 현금 + 보유주식 평가액 (현재 틱 가격 기준)
// 참가자 수백 명 규모라 전량 메모리 계산으로 충분하다.
export async function getRanking(): Promise<RankingBoard> {
  const supabase = getSupabaseAdmin();

  const [{ data: users, error: usersError }, { data: holdings, error: holdingsError }, board, session] =
    await Promise.all([
      supabase.from("users").select("id, nickname, cash").eq("is_banned", false),
      supabase.from("holdings").select("user_id, stock_code, quantity").gt("quantity", 0),
      getQuoteBoard(),
      getSession(),
    ]);
  if (usersError) throw usersError;
  if (holdingsError) throw holdingsError;

  const priceMap = Object.fromEntries(board.quotes.map((q) => [q.code, q.price]));

  const holdingValue = new Map<number, number>();
  for (const h of holdings) {
    const value = (priceMap[h.stock_code] ?? 0) * h.quantity;
    holdingValue.set(h.user_id, (holdingValue.get(h.user_id) ?? 0) + value);
  }

  const ranked = users
    .map((u) => ({
      userId: u.id,
      nickname: u.nickname,
      totalAssets: u.cash + (holdingValue.get(u.id) ?? 0),
    }))
    .sort((a, b) => b.totalAssets - a.totalAssets)
    .map((entry, index) => ({ ...entry, rank: index + 1 }));

  const myEntry = session ? ranked.find((r) => r.userId === session.uid) : undefined;

  return {
    top: ranked.slice(0, TOP_SIZE).map(({ rank, nickname, totalAssets }) => ({
      rank,
      nickname,
      totalAssets,
    })),
    me: myEntry
      ? { rank: myEntry.rank, nickname: myEntry.nickname, totalAssets: myEntry.totalAssets }
      : null,
    totalUsers: ranked.length,
  };
}
