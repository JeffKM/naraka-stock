import "server-only";
import { getKstParts, getMarketState, getTickIndex } from "@/lib/market";
import { loadMarketHours } from "@/lib/marketHours";
import { PRICE_LIMIT_RATE } from "@/lib/engine/randomWalk";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import type { MarketState, StockQuote, StockTier } from "@/types/domain";

export interface QuoteBoard {
  marketState: MarketState;
  asOf: string; // 기준 시각 (ISO)
  haltedUntil: string | null; // 서킷브레이커 해제 시각 (발동 중일 때만)
  quotes: StockQuote[];
}

// 전 종목 현재가 일괄 조회 (T-205)
// - 장중: 현재 틱 인덱스의 사전 생성 가격
// - 장 마감 후: 오늘 종가 (틱 83)
// - 개장 전·휴장일: 직전 개장일 종가 (등락률 0)
export async function getQuoteBoard(now: Date = new Date()): Promise<QuoteBoard> {
  const supabase = getSupabaseAdmin();
  const hours = await loadMarketHours(); // config 기반 장 시간 (임시 개장 대응)
  let state: MarketState = getMarketState(now, hours);
  const { date: today, hour } = getKstParts(now);

  // 서킷브레이커 (어드민 수동 발동, T-405/T-604) — 장중에만 의미 있음
  let haltedUntil: string | null = null;
  if (state === "open") {
    const { data: cb } = await supabase
      .from("config")
      .select("value")
      .eq("key", "circuit_breaker_until")
      .maybeSingle();
    if (cb?.value) {
      const until = new Date(String(cb.value));
      if (until > now) {
        state = "halted";
        haltedUntil = until.toISOString();
      }
    }
  }

  const { data: stocks, error: stocksError } = await supabase
    .from("stocks")
    .select("code, name, tier")
    .eq("listed", true)
    .order("code");
  if (stocksError) throw stocksError;

  // 직전 개장일 종가 (오늘 이전 가장 최근 요약) — 등락률 기준
  const { data: prevRows, error: prevError } = await supabase
    .from("daily_summary")
    .select("stock_code, date, close")
    .lt("date", today)
    .order("date", { ascending: false });
  if (prevError) throw prevError;
  const prevCloses: Record<string, number> = {};
  for (const row of prevRows) {
    if (!(row.stock_code in prevCloses)) prevCloses[row.stock_code] = row.close;
  }

  // 오늘 이전 요약이 없으면(리허설 기간) 미래의 기준가로 폴백하되,
  // 오늘 자신의 잠정 요약은 제외 (오늘 종가가 미리 새는 것 방지)
  if (Object.keys(prevCloses).length === 0) {
    const { data: earliest, error: earliestError } = await supabase
      .from("daily_summary")
      .select("stock_code, date, close")
      .gt("date", today)
      .order("date", { ascending: true });
    if (earliestError) throw earliestError;
    for (const row of earliest) {
      if (!(row.stock_code in prevCloses)) prevCloses[row.stock_code] = row.close;
    }
  }

  // 현재 참조할 틱 인덱스: 장중이면 현재 틱, 마감 후면 83, 그 외 null
  let tickIndex: number | null = null;
  if (state === "open" || state === "halted") {
    tickIndex = getTickIndex(now, hours); // CB 중에도 가격은 현재 틱에서 동결 표시
  } else if (state === "closed" && hour >= hours.closeHour) {
    tickIndex = 83; // 오늘 장 마감 직후 → 오늘 종가
  }

  const prices: Record<string, { price: number; isHalted: boolean }> = {};
  const sparks: Record<string, number[]> = {};
  if (tickIndex !== null) {
    // 현재 틱까지의 오늘 경로 전체 (현재가 + 스파크라인을 한 번에)
    const { data: tickRows, error: tickError } = await supabase
      .from("daily_ticks")
      .select("stock_code, tick_index, price, is_halted")
      .eq("date", today)
      .lte("tick_index", tickIndex)
      .order("tick_index", { ascending: true });
    if (tickError) throw tickError;
    for (const row of tickRows) {
      (sparks[row.stock_code] ??= []).push(row.price);
      if (row.tick_index === tickIndex) {
        prices[row.stock_code] = { price: row.price, isHalted: row.is_halted };
      }
    }
  }

  const quotes: StockQuote[] = stocks.map((stock) => {
    const prevClose = prevCloses[stock.code] ?? 0;
    const current = prices[stock.code];
    const price = current?.price ?? prevClose;
    const change = prevClose > 0 ? price - prevClose : 0;
    const upperLimit = prevClose > 0 ? Math.round(prevClose * (1 + PRICE_LIMIT_RATE)) : 0;
    const lowerLimit = prevClose > 0 ? Math.round(prevClose * (1 - PRICE_LIMIT_RATE)) : 0;

    return {
      code: stock.code,
      name: stock.name,
      tier: stock.tier as StockTier,
      price,
      prevClose,
      change,
      changePercent: prevClose > 0 ? Math.round((change / prevClose) * 10000) / 100 : 0,
      isHalted: current?.isHalted ?? false,
      // 반올림 오차를 감안해 ±10원 이내면 상·하한 도달로 표시
      isUpperLimit: prevClose > 0 && price >= upperLimit - 10,
      isLowerLimit: prevClose > 0 && price <= lowerLimit + 10,
      spark: sparks[stock.code] ?? [],
    };
  });

  return { marketState: state, asOf: now.toISOString(), haltedUntil, quotes };
}
