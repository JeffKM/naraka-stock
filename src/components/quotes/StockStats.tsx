"use client";

import { Card, CardContent } from "@/components/ui/card";
import { formatCompactMoney, formatMoney } from "@/lib/market";
import { cn } from "@/lib/utils";
import type { StockQuote } from "@/types/domain";

// 시세 상세 정보 (Phase 8, 토스 종목 상세 벤치마킹)
// 시가·고가·저가는 서버가 준 당일 경로(spark)에서 계산한다 — 장 전이면 "-"
export function StockStats({ quote }: { quote: StockQuote }) {
  const hasToday = quote.spark.length > 0;
  const open = hasToday ? quote.spark[0] : null;
  const high = hasToday ? Math.max(...quote.spark) : null;
  const low = hasToday ? Math.min(...quote.spark) : null;

  const rows: Array<{ label: string; value: string; className?: string }> = [
    { label: "시가", value: open !== null ? formatMoney(open) : "―" },
    { label: "고가", value: high !== null ? formatMoney(high) : "―", className: "text-bull" },
    { label: "저가", value: low !== null ? formatMoney(low) : "―", className: "text-bear" },
    { label: "전일 종가", value: quote.prevClose > 0 ? formatMoney(quote.prevClose) : "―" },
    {
      label: "상한가",
      value: quote.upperLimit > 0 ? formatMoney(quote.upperLimit) : "―",
      className: "text-bull",
    },
    {
      label: "하한가",
      value: quote.lowerLimit > 0 ? formatMoney(quote.lowerLimit) : "―",
      className: "text-bear",
    },
    { label: "거래량", value: `${quote.volume.toLocaleString("ko-KR")}주` },
    { label: "시가총액", value: formatCompactMoney(quote.marketCap) },
  ];

  return (
    <Card>
      <CardContent className="py-4">
        <h2 className="mb-2 text-sm font-semibold text-muted-foreground">시세 정보</h2>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-sm">
          {rows.map((row) => (
            <div key={row.label} className="flex items-baseline justify-between">
              <dt className="text-muted-foreground">{row.label}</dt>
              <dd className={cn("tabular-nums", row.className)}>{row.value}</dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  );
}
