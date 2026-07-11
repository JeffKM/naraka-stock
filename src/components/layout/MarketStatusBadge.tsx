"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { getMarketState } from "@/lib/market";
import type { MarketState } from "@/types/domain";

const LABELS: Record<Exclude<MarketState, "halted">, string> = {
  open: "개장중",
  closed: "장 마감",
  holiday: "휴장일",
};

// 헤더 우측 장 상태 배지 — 클라이언트 시계 기준, 30초마다 갱신.
// 서킷브레이커(halted) 상태는 서버 데이터가 필요해 Phase 4에서 연결한다.
export function MarketStatusBadge() {
  const [state, setState] = useState<Exclude<MarketState, "halted"> | null>(null);

  useEffect(() => {
    const update = () => setState(getMarketState());
    update();
    const timer = setInterval(update, 30_000);
    return () => clearInterval(timer);
  }, []);

  // SSR/hydration 불일치 방지: 마운트 전에는 자리만 잡는다
  if (state === null) {
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
