"use client";

import { useQuery } from "@tanstack/react-query";
import { use } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { TradePanel } from "@/components/trade/TradePanel";
import { getJson } from "@/lib/api/client";
import { cn } from "@/lib/utils";
import { formatMoney } from "@/lib/market";
import type { MarketState, StockQuote } from "@/types/domain";

const TIER_LABEL = { stable: "안정주", normal: "일반주", wild: "잡주" } as const;

interface QuoteBoardDto {
  marketState: MarketState;
  quotes: StockQuote[];
}

// 종목 상세 (T-303) — 차트는 Phase 4(T-402)에서 추가
export default function StockDetailPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = use(params);

  const { data, isLoading } = useQuery({
    queryKey: ["quotes"],
    queryFn: () => getJson<QuoteBoardDto>("/api/quotes"),
    refetchInterval: 60_000,
  });

  const quote = data?.quotes.find((q) => q.code === code.toUpperCase());

  if (isLoading) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (!quote) {
    return <p className="py-12 text-center text-muted-foreground">없는 종목입니다 👻</p>;
  }

  const up = quote.change > 0;
  const down = quote.change < 0;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-bold">{quote.name}</h1>
          <Badge variant="secondary">{TIER_LABEL[quote.tier]}</Badge>
          {quote.isUpperLimit && <Badge className="bg-bull">上</Badge>}
          {quote.isLowerLimit && <Badge className="bg-bear">下</Badge>}
          {quote.isHalted && <Badge variant="destructive">VI 정지</Badge>}
        </div>
        <p className={cn("mt-1 text-3xl font-bold", up && "text-bull", down && "text-bear")}>
          {formatMoney(quote.price)}
        </p>
        <p className={cn("text-sm", up && "text-bull", down && "text-bear")}>
          {up ? "▲" : down ? "▼" : "―"} {formatMoney(Math.abs(quote.change))} (
          {quote.changePercent > 0 ? "+" : ""}
          {quote.changePercent}%)
        </p>
      </div>

      {/* 차트 자리 — Phase 4에서 캔들차트로 교체 */}
      <Card>
        <CardContent className="flex h-40 items-center justify-center text-sm text-muted-foreground">
          📈 차트는 곧 열립니다
        </CardContent>
      </Card>

      <TradePanel quote={quote} />
    </div>
  );
}
