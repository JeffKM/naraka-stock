import "server-only";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { getQuoteBoard } from "@/services/quoteService";
import type { Portfolio, PortfolioHolding, Trade, TradeSide } from "@/types/domain";

// 내 지갑 (T-304): 현금 + 보유 종목 평가
export async function getPortfolio(userId: number): Promise<Portfolio> {
  const supabase = getSupabaseAdmin();

  const [{ data: user, error: userError }, { data: holdings, error: holdingsError }, board] =
    await Promise.all([
      supabase.from("users").select("cash").eq("id", userId).single(),
      supabase
        .from("holdings")
        .select("stock_code, quantity, avg_price, stocks(name)")
        .eq("user_id", userId)
        .gt("quantity", 0)
        .order("stock_code"),
      getQuoteBoard(),
    ]);
  if (userError) throw userError;
  if (holdingsError) throw holdingsError;

  const priceMap = Object.fromEntries(board.quotes.map((q) => [q.code, q.price]));

  const items: PortfolioHolding[] = holdings.map((h) => {
    const currentPrice = priceMap[h.stock_code] ?? 0;
    const value = currentPrice * h.quantity;
    const cost = h.avg_price * h.quantity;
    return {
      stockCode: h.stock_code,
      // Supabase 조인 결과 타입이 배열로 추론되지만 실제는 단일 객체
      stockName: (h.stocks as unknown as { name: string }).name,
      quantity: h.quantity,
      avgPrice: h.avg_price,
      currentPrice,
      value,
      pnl: value - cost,
      pnlPercent: cost > 0 ? Math.round(((value - cost) / cost) * 10000) / 100 : 0,
    };
  });

  return {
    cash: user.cash,
    holdings: items,
    totalAssets: user.cash + items.reduce((sum, h) => sum + h.value, 0),
  };
}

export interface TradePage {
  trades: Trade[];
  page: number;
  hasMore: boolean;
}

const PAGE_SIZE = 20;

// 거래내역 (T-305): 최신순 페이지네이션
export async function getTrades(userId: number, page: number): Promise<TradePage> {
  const supabase = getSupabaseAdmin();
  const from = (page - 1) * PAGE_SIZE;

  const { data, error } = await supabase
    .from("trades")
    .select("id, stock_code, side, quantity, price, fee, created_at, stocks(name)")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range(from, from + PAGE_SIZE); // 1개 더 읽어 hasMore 판정
  if (error) throw error;

  const hasMore = data.length > PAGE_SIZE;
  const trades: Trade[] = data.slice(0, PAGE_SIZE).map((t) => ({
    id: t.id,
    stockCode: t.stock_code,
    stockName: (t.stocks as unknown as { name: string }).name,
    side: t.side as TradeSide,
    quantity: t.quantity,
    price: t.price,
    fee: t.fee,
    createdAt: t.created_at,
  }));

  return { trades, page, hasMore };
}
