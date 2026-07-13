"use client";

import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { getJson } from "@/lib/api/client";
import { formatMoney } from "@/lib/market";
import { cn } from "@/lib/utils";
import type { Portfolio, StockQuote } from "@/types/domain";

// 내 보유 현황 (Phase 8, 토스 주문화면 "내 투자" 벤치마킹)
// 평가액·손익은 현재 틱 가격 기준 표시용 추정 — 실제 정산은 항상 서버.
export function MyHoldingCard({ quote }: { quote: StockQuote }) {
  // 비로그인이면 조용히 실패해 카드 자체를 숨긴다
  const { data: portfolio } = useQuery({
    queryKey: ["portfolio"],
    queryFn: () => getJson<Portfolio>("/api/portfolio"),
    retry: false,
  });

  const holding = portfolio?.holdings.find((h) => h.stockCode === quote.code);
  if (!holding || holding.quantity <= 0) return null;

  const value = holding.quantity * quote.price;
  const pnl = value - holding.quantity * holding.avgPrice;
  const pnlPercent =
    holding.avgPrice > 0
      ? Math.round((pnl / (holding.quantity * holding.avgPrice)) * 10000) / 100
      : 0;
  const up = pnl > 0;
  const down = pnl < 0;

  return (
    <Card>
      <CardContent className="py-4">
        <div className="flex items-baseline justify-between">
          <h2 className="text-sm font-semibold text-muted-foreground">내 보유</h2>
          <span className="text-xs text-muted-foreground">
            {holding.quantity.toLocaleString("ko-KR")}주 · 평단 {formatMoney(holding.avgPrice)}
          </span>
        </div>
        <div className="mt-1 flex items-baseline justify-between">
          <p className="text-lg font-bold tabular-nums">{formatMoney(value)}</p>
          <p className={cn("text-sm tabular-nums", up && "text-bull", down && "text-bear")}>
            {up ? "+" : ""}
            {formatMoney(pnl)} ({pnlPercent > 0 ? "+" : ""}
            {pnlPercent}%)
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
