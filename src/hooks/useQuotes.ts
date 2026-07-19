"use client";

import { useQuery } from "@tanstack/react-query";
import { getJson } from "@/lib/api/client";
import { TICK_INTERVAL_SECONDS } from "@/lib/market";
import type { IndexQuote, MarketState, StockQuote } from "@/types/domain";

export interface QuoteBoardDto {
  marketState: MarketState;
  asOf: string;
  haltedUntil: string | null;
  market: { openHour: number; closeHour: number; closedWeekdays: number[] };
  indices: IndexQuote[];
  quotes: StockQuote[];
}

// 다음 10초 틱 경계까지 남은 ms + 서버 반영 여유 0.5초 (T-404: 틱 경계 정렬)
function msUntilNextTick(): number {
  const interval = TICK_INTERVAL_SECONDS * 1000;
  return interval - (Date.now() % interval) + 500;
}

// 전 종목 시세 공용 훅 — 항상 10초 틱 경계에 맞춰 갱신.
// 장 상태 판정은 서버 응답(marketState)이 유일한 진실이다 (config 임시 개장 대응).
// 장외에도 틱 경계마다 가벼운 폴링을 유지해 개장 전환을 자동으로 감지한다.
export function useQuotes() {
  return useQuery({
    queryKey: ["quotes"],
    queryFn: () => getJson<QuoteBoardDto>("/api/quotes"),
    refetchInterval: msUntilNextTick,
    refetchIntervalInBackground: false,
    staleTime: 5_000,
  });
}
