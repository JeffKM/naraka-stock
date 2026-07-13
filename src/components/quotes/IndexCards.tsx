"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Sparkline } from "@/components/quotes/Sparkline";
import { cn } from "@/lib/utils";
import type { IndexQuote } from "@/types/domain";

function formatIndex(value: number): string {
  return value.toLocaleString("ko-KR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

// 시장 지수 카드 (Phase 8, 토스 홈 지수 영역 벤치마킹)
// 나스피(우량+일반) / 나스닥(테마) — 시총가중 체인, 기준 1,000pt
export function IndexCards({ indices }: { indices: IndexQuote[] }) {
  if (indices.length === 0) return null;

  return (
    <div className="grid grid-cols-2 gap-3">
      {indices.map((index) => {
        const up = index.change > 0;
        const down = index.change < 0;
        return (
          <Card key={index.code}>
            <CardContent className="flex flex-col gap-1 py-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground">{index.name}</span>
                <Sparkline points={index.spark} positive={up} neutral={!up && !down} />
              </div>
              <p
                className={cn(
                  "text-lg font-bold leading-tight tabular-nums",
                  up && "text-bull",
                  down && "text-bear"
                )}
              >
                {formatIndex(index.value)}
              </p>
              <p
                className={cn(
                  "text-xs tabular-nums",
                  up && "text-bull",
                  down && "text-bear",
                  !up && !down && "text-muted-foreground"
                )}
              >
                {up ? "▲" : down ? "▼" : "―"} {formatIndex(Math.abs(index.change))} (
                {index.changePercent > 0 ? "+" : ""}
                {index.changePercent}%)
              </p>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
