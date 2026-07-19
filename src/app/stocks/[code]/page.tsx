"use client";

import { use, useCallback, useEffect, useRef, useState } from "react";
import { Star } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { NewsList } from "@/components/news/NewsList";
import { StockChart } from "@/components/chart/StockChart";
import { StockStats } from "@/components/quotes/StockStats";
import { MyHoldingCard } from "@/components/trade/MyHoldingCard";
import { MyOrdersCard } from "@/components/order/MyOrdersCard";
import { StockComments } from "@/components/trade/StockComments";
import { TradePanel } from "@/components/trade/TradePanel";
import { usePriceFlash } from "@/hooks/usePriceFlash";
import { usePriceWiggle } from "@/hooks/usePriceWiggle";
import { useQuotes } from "@/hooks/useQuotes";
import { useWatchlist } from "@/hooks/useWatchlist";
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
  const watchlist = useWatchlist();

  // 전체 요약 블록이 헤더 위로 스크롤되면 한 줄 요약 바를 상단에 고정.
  // 콜백 ref로 노드 마운트 시점(로딩 스켈레톤 이후 실제 요약이 나타날 때)에 붙인다.
  const observerRef = useRef<IntersectionObserver | null>(null);
  const [pinned, setPinned] = useState(false);
  const summaryRef = useCallback((node: HTMLDivElement | null) => {
    observerRef.current?.disconnect();
    if (!node) return;
    const observer = new IntersectionObserver(
      ([entry]) => setPinned(!entry.isIntersecting),
      { rootMargin: "-56px 0px 0px 0px" } // 헤더(h-14=56px) 아래 기준
    );
    observer.observe(node);
    observerRef.current = observer;
  }, []);

  const quote = data?.quotes.find((q) => q.code === code.toUpperCase());
  // 표시용 미세 진동 (장중 + 정지 아님일 때만) — 체결가는 항상 서버 틱 값
  const displayPrice = usePriceWiggle(
    quote?.price ?? 0,
    data?.marketState === "open" && !quote?.isHalted
  );
  // 가격 변동 시 등락 방향 배경 플래시 (시세판과 동일 연출)
  // 플래시는 wiggle 잔진동이 아니라 진짜 10초 틱 변화(원값)에만 발동
  const flash = usePriceFlash(quote?.price ?? 0);

  // 탭 타이틀 = "체결가 ±등락률% | 종목명" — 체결가 기준(표시용 진동 제외), 값이 바뀔 때만 갱신
  const docTitle = quote
    ? `${formatMoney(quote.price)} ${quote.changePercent > 0 ? "+" : ""}${quote.changePercent}% | ${quote.name}`
    : null;
  useEffect(() => {
    if (docTitle) document.title = docTitle;
  }, [docTitle]);

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
    return <p className="py-12 text-center text-muted-foreground">없는 종목입니다</p>;
  }

  const up = quote.change > 0;
  const down = quote.change < 0;

  return (
    <div className="flex flex-col gap-4">
      <div ref={summaryRef}>
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-bold">{quote.name}</h1>
          <button
            type="button"
            onClick={() => watchlist.toggle(quote.code)}
            className="rounded-sm p-1 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={watchlist.isWatching(quote.code) ? "관심 해제" : "관심 등록"}
          >
            <Star
              className={cn(
                "h-4 w-4",
                watchlist.isWatching(quote.code)
                  ? "fill-primary-accent text-primary-accent"
                  : "text-muted-foreground"
              )}
            />
          </button>
          <Badge variant="secondary">{TIER_LABEL[quote.tier]}</Badge>
          <Badge variant="secondary">{quote.sectorLabel}</Badge>
          {quote.isUpperLimit && <Badge className="bg-bull">上</Badge>}
          {quote.isLowerLimit && <Badge className="bg-bear">下</Badge>}
          {quote.isHalted && <Badge variant="destructive">VI 정지</Badge>}
        </div>
        <p
          key={flash.seq}
          className={cn(
            "-mx-1.5 mt-1 inline-block rounded-md px-1.5 text-3xl font-bold tabular-nums",
            up && "text-bull",
            down && "text-bear",
            flash.direction === "up" && "animate-flash-bull-bg",
            flash.direction === "down" && "animate-flash-bear-bg"
          )}
        >
          {formatMoney(displayPrice)}
        </p>
        <p className={cn("text-sm", up && "text-bull", down && "text-bear")}>
          {up ? "▲" : down ? "▼" : "―"} {formatMoney(Math.abs(quote.change))} (
          {quote.changePercent > 0 ? "+" : ""}
          {quote.changePercent}%)
        </p>
      </div>

      {/* 스크롤 시 종목명·현재가를 잃지 않게 한 줄 요약을 상단 고정 */}
      <div
        aria-hidden={!pinned}
        className={cn(
          "sticky top-14 z-20 -mx-4 overflow-hidden border-b bg-card/95 px-4 backdrop-blur transition-[max-height,opacity,padding,border-color] duration-200",
          pinned
            ? "max-h-16 border-border py-2 opacity-100"
            : "pointer-events-none max-h-0 border-transparent py-0 opacity-0"
        )}
      >
        <div className="flex items-center justify-between gap-2">
          <span className="truncate font-semibold">{quote.name}</span>
          <span
            className={cn(
              "flex shrink-0 items-center gap-1.5 text-sm tabular-nums",
              up && "text-bull",
              down && "text-bear"
            )}
          >
            <span>{up ? "▲" : down ? "▼" : "―"}</span>
            <span className="font-semibold">{formatMoney(displayPrice)}</span>
            <span>
              {quote.changePercent > 0 ? "+" : ""}
              {quote.changePercent}%
            </span>
          </span>
        </div>
      </div>

      <StockChart code={quote.code} />

      <MyHoldingCard quote={quote} />

      <TradePanel quote={quote} marketHalted={data?.marketState === "halted"} />

      <MyOrdersCard stockCode={quote.code} />

      <StockStats quote={quote} />

      {/* 해당 종목 뉴스 (T-504) */}
      <Card>
        <CardContent className="py-1">
          <h2 className="pt-3 text-sm font-semibold text-muted-foreground">관련 뉴스</h2>
          <NewsList stock={quote.code} compact />
        </CardContent>
      </Card>

      {/* 종목 토론방 — 주가 보면서 밈 나누는 댓글창 */}
      <StockComments stockCode={quote.code} />
    </div>
  );
}
