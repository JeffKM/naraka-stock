import "server-only";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { getQuoteBoard } from "@/services/quoteService";
import { settleUserOrders } from "@/services/orderService";
import type { Portfolio, PortfolioHolding, Trade, TradeSide } from "@/types/domain";

// 내 지갑 (T-304): 현금 + 보유 종목 평가 + 지정가 예약분 반영
export async function getPortfolio(userId: number): Promise<Portfolio> {
  const supabase = getSupabaseAdmin();

  // 조회 전 lazy 소급 정산 → 방금 체결된 지정가가 현금·보유에 즉시 반영된다 (§4.5)
  await settleUserOrders(userId);

  const [
    { data: user, error: userError },
    { data: holdings, error: holdingsError },
    { data: pending, error: pendingError },
    board,
  ] = await Promise.all([
    supabase.from("users").select("cash").eq("id", userId).single(),
    supabase
      .from("holdings")
      .select("stock_code, quantity, avg_price, stocks(name)")
      .eq("user_id", userId)
      .gt("quantity", 0)
      .order("stock_code"),
    supabase
      .from("orders")
      .select("stock_code, side, reserved_cash, reserved_qty")
      .eq("user_id", userId)
      .eq("status", "pending"),
    getQuoteBoard(),
  ]);
  if (userError) throw userError;
  if (holdingsError) throw holdingsError;
  if (pendingError) throw pendingError;

  // 미체결 예약 집계: 매수는 현금 합, 매도는 종목별 수량 합
  let reservedCash = 0;
  const reservedQtyByStock: Record<string, number> = {};
  for (const o of pending) {
    if (o.side === "buy") {
      reservedCash += o.reserved_cash ?? 0;
    } else if (o.reserved_qty != null) {
      reservedQtyByStock[o.stock_code] =
        (reservedQtyByStock[o.stock_code] ?? 0) + Number(o.reserved_qty);
    }
  }

  const priceMap = Object.fromEntries(board.quotes.map((q) => [q.code, q.price]));

  const items: PortfolioHolding[] = holdings.map((h) => {
    // numeric은 PostgREST가 문자열로 내려주므로 Number로 복원한다 (소수점 주식)
    const quantity = Number(h.quantity);
    const currentPrice = priceMap[h.stock_code] ?? 0;
    const value = Math.round(currentPrice * quantity);
    const cost = Math.round(h.avg_price * quantity);
    const reservedQty = reservedQtyByStock[h.stock_code] ?? 0;
    return {
      stockCode: h.stock_code,
      // Supabase 조인 결과 타입이 배열로 추론되지만 실제는 단일 객체
      stockName: (h.stocks as unknown as { name: string }).name,
      quantity,
      avgPrice: h.avg_price,
      currentPrice,
      value,
      pnl: value - cost,
      pnlPercent: cost > 0 ? Math.round(((value - cost) / cost) * 10000) / 100 : 0,
      reservedQty,
      availableQty: Math.max(0, quantity - reservedQty),
    };
  });

  return {
    cash: user.cash,
    holdings: items,
    // 총자산은 예약과 무관하게 불변 (예약은 실제 이동이 아님) — 현금 + 평가액 합
    totalAssets: user.cash + items.reduce((sum, h) => sum + h.value, 0),
    reservedCash,
    availableCash: Math.max(0, user.cash - reservedCash),
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
    quantity: Number(t.quantity), // numeric → 소수점 주식 복원

    price: t.price,
    fee: t.fee,
    createdAt: t.created_at,
  }));

  return { trades, page, hasMore };
}
