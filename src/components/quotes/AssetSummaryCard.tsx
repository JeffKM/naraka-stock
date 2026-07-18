"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { LiveTotalAssets } from "@/components/quotes/LiveTotalAssets";
import { Sparkline } from "@/components/quotes/Sparkline";
import { useQuotes } from "@/hooks/useQuotes";
import { getJson } from "@/lib/api/client";
import { formatMoney } from "@/lib/market";
import { cn } from "@/lib/utils";
import type { Portfolio } from "@/types/domain";

// 보유 종목별 당일 가격 경로(spark)를 수량 가중 합산해 총자산 추세를 만든다.
// 기존 quotes 데이터 재사용 (서버 부하 0). 장중 체결 변화는 무시 — 표시용 추세.
function buildAssetTrend(
  holdings: { stockCode: string; quantity: number }[],
  sparkOf: (code: string) => number[] | undefined,
  cash: number
): number[] | null {
  const held = holdings
    .map((h) => ({ qty: h.quantity, spark: sparkOf(h.stockCode) }))
    .filter((x): x is { qty: number; spark: number[] } => !!x.spark && x.spark.length >= 2);
  if (held.length === 0) return null;
  // 종목마다 경로 길이가 다를 수 있어 가장 짧은 길이에 끝(현재)을 맞춰 정렬
  const len = Math.min(...held.map((x) => x.spark.length));
  return Array.from({ length: len }, (_, i) =>
    held.reduce((sum, x) => sum + x.qty * x.spark[x.spark.length - len + i], cash)
  );
}

// 내 자산 요약 카드 (Phase 8, 토스 홈 "내 계좌" 벤치마킹)
// 탭하면 지갑으로 이동. 비로그인이면 로그인 유도로 대체.
export function AssetSummaryCard() {
  const { data: quotes } = useQuotes();
  const { data: portfolio, isLoading, isError } = useQuery({
    queryKey: ["portfolio"],
    queryFn: () => getJson<Portfolio>("/api/portfolio"),
    retry: false,
    refetchInterval: 60_000, // 5분 틱 갱신을 놓치지 않게 폴링 (카운트업 연출의 전제)
  });

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex flex-col gap-2 py-3">
          <Skeleton className="h-3 w-12" />
          <Skeleton className="h-6 w-32" />
          <Skeleton className="h-3 w-40" />
        </CardContent>
      </Card>
    );
  }

  if (isError || !portfolio) {
    return (
      <Link href="/login">
        <Card className="transition-colors hover:bg-muted/40">
          <CardContent className="flex items-center justify-between py-3">
            <div>
              <p className="text-sm font-medium">로그인하고 거래를 시작하세요</p>
              <p className="text-xs text-muted-foreground">매장 가입 코드로 1,000만원 지급</p>
            </div>
            <ChevronRight className="size-4 text-muted-foreground" />
          </CardContent>
        </Card>
      </Link>
    );
  }

  // 평가손익 = 보유 종목 미실현 손익 합 (표시용 — 실제 정산은 서버)
  const pnl = portfolio.holdings.reduce((sum, h) => sum + h.pnl, 0);
  const cost = portfolio.holdings.reduce(
    (sum, h) => sum + Math.round(h.quantity * h.avgPrice),
    0
  );
  const pnlPercent = cost > 0 ? Math.round((pnl / cost) * 10000) / 100 : 0;
  const up = pnl > 0;
  const down = pnl < 0;

  // 현금/주식 비중 — 게이지용 (평가액 합 기준)
  const stockValue = portfolio.holdings.reduce((sum, h) => sum + h.value, 0);
  const base = stockValue + portfolio.cash;
  const stockPct = base > 0 ? Math.round((stockValue / base) * 100) : 0;
  const cashPct = 100 - stockPct;

  // 총자산 당일 추세 (보유 종목 spark 가중 합)
  const trend = buildAssetTrend(
    portfolio.holdings,
    (code) => quotes?.quotes.find((q) => q.code === code)?.spark,
    portfolio.cash
  );
  const trendUp = !!trend && trend[trend.length - 1] > trend[0];
  const trendDown = !!trend && trend[trend.length - 1] < trend[0];

  return (
    <Link href="/portfolio">
      <Card className="transition-colors hover:bg-muted/40">
        <CardContent className="flex flex-col gap-3 py-3">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-xs text-muted-foreground">내 투자</p>
              <LiveTotalAssets
                cash={portfolio.cash}
                totalAssets={portfolio.totalAssets}
                className="text-lg font-bold leading-tight"
              />
              <p
                className={cn(
                  "text-xs tabular-nums",
                  up && "text-bull",
                  down && "text-bear",
                  !up && !down && "text-muted-foreground"
                )}
              >
                평가손익 {up ? "+" : ""}
                {formatMoney(pnl)}
                {cost > 0 ? ` (${pnlPercent > 0 ? "+" : ""}${pnlPercent}%)` : ""}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              {trend && (
                <Sparkline points={trend} positive={trendUp} neutral={!trendUp && !trendDown} />
              )}
              <ChevronRight className="size-4 text-muted-foreground" />
            </div>
          </div>

          {/* 현금/주식 비중 게이지 — 보유 종목이 있을 때만 */}
          {stockValue > 0 && (
            <div className="flex flex-col gap-1">
              <div className="flex h-2 overflow-hidden rounded-full bg-muted">
                <div className="bg-primary-accent" style={{ width: `${stockPct}%` }} />
              </div>
              <div className="flex justify-between text-[11px] tabular-nums text-muted-foreground">
                <span>주식 {stockPct}%</span>
                <span>현금 {cashPct}%</span>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </Link>
  );
}
