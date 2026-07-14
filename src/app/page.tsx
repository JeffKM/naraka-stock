"use client";

import Link from "next/link";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { AssetSummaryCard } from "@/components/quotes/AssetSummaryCard";
import { IndexCards, IndexCardsSkeleton } from "@/components/quotes/IndexCards";
import { NewsHighlight } from "@/components/news/NewsHighlight";
import { PopularStocks } from "@/components/quotes/PopularStocks";
import { Sparkline } from "@/components/quotes/Sparkline";
import { usePriceFlash } from "@/hooks/usePriceFlash";
import { usePriceWiggle } from "@/hooks/usePriceWiggle";
import { useQuotes } from "@/hooks/useQuotes";
import { cn } from "@/lib/utils";
import { formatMoney } from "@/lib/market";
import type { StockQuote } from "@/types/domain";

const TIER_LABEL = { stable: "우량주", normal: "일반주", wild: "테마주" } as const;

const WEEKDAY_LABEL = ["", "월", "화", "수", "목", "금", "토", "일"];

// 장 운영 안내 문구: "매일 12:00~24:00" / 휴장 요일 지정 시 "12:00~24:00 (월 휴장)" 등
function marketHoursLabel(market: {
  openHour: number;
  closeHour: number;
  closedWeekdays: number[];
}): string {
  const time = `${market.openHour}:00~${market.closeHour}:00`;
  if (market.closedWeekdays.length === 0) return `매일 ${time}`;
  const closed = market.closedWeekdays.map((d) => WEEKDAY_LABEL[d]).join("·");
  return `${time} (${closed} 휴장)`;
}

type SortMode = "marketCap" | "volume" | "up" | "down";

const SORT_OPTIONS: { value: SortMode; label: string }[] = [
  { value: "marketCap", label: "시가총액" },
  { value: "volume", label: "거래량" },
  { value: "up", label: "급상승" },
  { value: "down", label: "급하락" },
];

// 표시용 재정렬 — 체결·가격 로직과 무관 (서버 데이터는 code 정렬)
function sortQuotes(quotes: StockQuote[], mode: SortMode): StockQuote[] {
  const sorted = [...quotes];
  switch (mode) {
    case "marketCap":
      return sorted.sort((a, b) => b.marketCap - a.marketCap);
    case "volume":
      return sorted.sort((a, b) => b.volume - a.volume);
    case "up":
      return sorted.sort((a, b) => b.changePercent - a.changePercent);
    case "down":
      return sorted.sort((a, b) => a.changePercent - b.changePercent);
  }
}

// 시세판 한 줄 — 장중엔 틱 사이 가격 미세 진동 + 등락 배경 플래시 (표시용, 상세 화면과 동일 연출)
function QuoteRow({ quote: q, marketOpen }: { quote: StockQuote; marketOpen: boolean }) {
  const displayPrice = usePriceWiggle(q.price, marketOpen && !q.isHalted);
  const flash = usePriceFlash(displayPrice);
  const up = q.change > 0;
  const down = q.change < 0;
  return (
    <Link
      href={`/stocks/${q.code}`}
      className="flex items-center justify-between py-3 transition-colors hover:bg-muted/40"
    >
      <div className="flex items-center gap-2">
        <div>
          <p className="font-medium leading-tight">{q.name}</p>
          <p className="text-xs text-muted-foreground">{TIER_LABEL[q.tier]}</p>
        </div>
        {q.isUpperLimit && <Badge className="bg-bull px-1.5 text-xs">上</Badge>}
        {q.isLowerLimit && <Badge className="bg-bear px-1.5 text-xs">下</Badge>}
        {q.isHalted && (
          <Badge variant="destructive" className="px-1.5 text-xs">
            VI
          </Badge>
        )}
      </div>
      <div className="flex items-center gap-3">
        <Sparkline points={q.spark} positive={up} neutral={!up && !down} />
        <div
          key={flash.seq}
          className={cn(
            "-mx-1.5 rounded-md px-1.5 text-right",
            flash.direction === "up" && "animate-flash-bull-bg",
            flash.direction === "down" && "animate-flash-bear-bg"
          )}
        >
          <p
            className={cn(
              "font-semibold leading-tight tabular-nums",
              up && "text-bull",
              down && "text-bear"
            )}
          >
            {formatMoney(displayPrice)}
          </p>
          <p
            className={cn(
              "text-xs",
              up && "text-bull",
              down && "text-bear",
              !up && !down && "text-muted-foreground"
            )}
          >
            {up ? "▲" : down ? "▼" : "―"} {q.changePercent > 0 ? "+" : ""}
            {q.changePercent}%
          </p>
        </div>
      </div>
    </Link>
  );
}

// 시세판 홈 (T-401/Phase 8): 지수 + 내 자산 + 전 종목 전광판 + 뉴스 하이라이트
export default function Home() {
  const { data, isLoading } = useQuotes();
  const [sort, setSort] = useState<SortMode>("marketCap");

  const quotes = data ? sortQuotes(data.quotes, sort) : undefined;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">시세판</h1>
        {data?.marketState === "holiday" && (
          <span className="text-sm text-muted-foreground">오늘은 휴장일입니다</span>
        )}
      </div>

      {isLoading ? (
        <IndexCardsSkeleton />
      ) : (
        data && (
          <IndexCards indices={data.indices} marketOpen={data.marketState === "open"} />
        )
      )}

      <AssetSummaryCard />

      <PopularStocks />

      <div className="flex justify-end gap-1">
        {SORT_OPTIONS.map((option) => (
          <Button
            key={option.value}
            variant="ghost"
            size="sm"
            onClick={() => setSort(option.value)}
            className={cn(
              "h-7 px-2 text-xs",
              sort === option.value
                ? "bg-muted text-foreground"
                : "text-muted-foreground"
            )}
          >
            {option.label}
          </Button>
        ))}
      </div>

      <Card>
        <CardContent className="flex flex-col divide-y divide-border/60 py-2">
          {isLoading &&
            Array.from({ length: 8 }, (_, i) => (
              <div key={i} className="flex items-center justify-between py-3">
                <Skeleton className="h-5 w-28" />
                <Skeleton className="h-5 w-24" />
              </div>
            ))}
          {quotes?.map((q) => (
            <QuoteRow key={q.code} quote={q} marketOpen={data?.marketState === "open"} />
          ))}
        </CardContent>
      </Card>

      <NewsHighlight />

      <p className="text-center text-xs text-muted-foreground">
        시세는 5분마다 갱신됩니다{data?.market ? ` · 장 시간 ${marketHoursLabel(data.market)}` : ""}
      </p>
    </div>
  );
}
