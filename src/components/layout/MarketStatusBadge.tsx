"use client";

import { Badge } from "@/components/ui/badge";
import { useQuotes } from "@/hooks/useQuotes";
import type { MarketState } from "@/types/domain";

const LABELS: Record<MarketState, string> = {
  open: "개장중",
  closed: "장 마감",
  holiday: "휴장일",
  halted: "거래정지",
};

// 헤더 우측 장 상태 배지 — 서버(quotes API)의 장 상태를 그대로 따른다
// (config 기반 임시 개장·서킷브레이커까지 반영됨)
export function MarketStatusBadge() {
  const { data } = useQuotes();
  const state = data?.marketState;

  if (!state) {
    return <Badge variant="outline">&nbsp;</Badge>;
  }

  return (
    <Badge variant={state === "open" ? "default" : "outline"}>
      {state === "open" && (
        <span className="mr-1 inline-block size-1.5 animate-pulse rounded-full bg-primary-foreground" />
      )}
      {LABELS[state]}
    </Badge>
  );
}
