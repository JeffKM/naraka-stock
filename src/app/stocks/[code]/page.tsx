"use client";

import { use } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { NewsList } from "@/components/news/NewsList";
import { StockChart } from "@/components/chart/StockChart";
import { TradePanel } from "@/components/trade/TradePanel";
import { usePriceWiggle } from "@/hooks/usePriceWiggle";
import { useQuotes } from "@/hooks/useQuotes";
import { cn } from "@/lib/utils";
import { formatMoney } from "@/lib/market";

const TIER_LABEL = { stable: "우량주", normal: "일반주", wild: "테마주" } as const;

// 종목 상세 (T-303/T-402/T-403)
export default function StockDetailPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = use(params);
  const { data, isLoading } = useQuotes();

  const quote = data?.quotes.find((q) => q.code === code.toUpperCase());
  // 표시용 미세 진동 (장중 + 정지 아님일 때만) — 체결가는 항상 서버 틱 값
  const displayPrice = usePriceWiggle(
    quote?.price ?? 0,
    data?.marketState === "open" && !quote?.isHalted
  );

  if (isLoading) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-56 w-full" />
        <Skeleton className="h-64 w-full" />
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
        <p className={cn("mt-1 text-3xl font-bold tabular-nums", up && "text-bull", down && "text-bear")}>
          {formatMoney(displayPrice)}
        </p>
        <p className={cn("text-sm", up && "text-bull", down && "text-bear")}>
          {up ? "▲" : down ? "▼" : "―"} {formatMoney(Math.abs(quote.change))} (
          {quote.changePercent > 0 ? "+" : ""}
          {quote.changePercent}%)
        </p>
      </div>

      <StockChart code={quote.code} />

      <TradePanel quote={quote} marketHalted={data?.marketState === "halted"} />

      {/* 해당 종목 뉴스 (T-504) */}
      <Card>
        <CardContent className="py-1">
          <h2 className="pt-3 text-sm font-semibold text-muted-foreground">관련 뉴스</h2>
          <NewsList stock={quote.code} compact />
        </CardContent>
      </Card>
    </div>
  );
}
