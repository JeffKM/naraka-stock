"use client";

import { useQuery } from "@tanstack/react-query";
import { getJson } from "@/lib/api/client";
import { getMarketState, TICK_INTERVAL_MINUTES } from "@/lib/market";
import type { MarketState, StockQuote } from "@/types/domain";

export interface QuoteBoardDto {
  marketState: MarketState;
  asOf: string;
  haltedUntil: string | null;
  quotes: StockQuote[];
}

// 다음 5분 틱 경계까지 남은 ms + 서버 반영 여유 5초 (T-404: 틱 경계 정렬)
function msUntilNextTick(): number {
  const interval = TICK_INTERVAL_MINUTES * 60_000;
  return interval - (Date.now() % interval) + 5_000;
}

// 전 종목 시세 공용 훅 — 장중엔 틱 경계에 맞춰 갱신, 장외엔 폴링 중단
export function useQuotes() {
  return useQuery({
    queryKey: ["quotes"],
    queryFn: () => getJson<QuoteBoardDto>("/api/quotes"),
    refetchInterval: () => (getMarketState() === "open" ? msUntilNextTick() : false),
    staleTime: 10_000,
  });
}
