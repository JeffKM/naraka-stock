import "server-only";
import { getSupabaseAdmin } from "@/lib/supabase/server";

// 실시간 인기 종목 (토스 벤치마킹): 최근 10분 체결 건수 상위 5종목
// 개인 식별 없이 익명 집계만 노출한다 (거래량 공개 정책과 동일 원칙).

const WINDOW_MINUTES = 10;
const TOP_N = 5;

export interface PopularStock {
  rank: number;
  code: string;
  name: string;
  tradeCount: number; // 최근 10분 체결 건수
}

export async function getPopularStocks(): Promise<PopularStock[]> {
  const supabase = getSupabaseAdmin();
  const since = new Date(Date.now() - WINDOW_MINUTES * 60_000).toISOString();

  // 이벤트 규모(수백 명)에선 원본 행을 가져와 JS 집계로 충분하다
  const { data: trades, error } = await supabase
    .from("trades")
    .select("stock_code")
    .gte("created_at", since)
    .limit(5000);
  if (error) throw error;
  if (trades.length === 0) return [];

  const countByCode = new Map<string, number>();
  for (const t of trades) {
    countByCode.set(t.stock_code, (countByCode.get(t.stock_code) ?? 0) + 1);
  }

  const top = [...countByCode.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, TOP_N);

  const { data: stocks, error: stockError } = await supabase
    .from("stocks")
    .select("code, name")
    .in(
      "code",
      top.map(([code]) => code)
    );
  if (stockError) throw stockError;
  const nameByCode = new Map(stocks.map((s) => [s.code, s.name]));

  return top.map(([code, tradeCount], i) => ({
    rank: i + 1,
    code,
    name: nameByCode.get(code) ?? code,
    tradeCount,
  }));
}
