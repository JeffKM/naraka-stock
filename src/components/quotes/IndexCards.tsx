"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Sparkline } from "@/components/quotes/Sparkline";
import { usePriceFlash } from "@/hooks/usePriceFlash";
import { useIndexWiggle } from "@/hooks/usePriceWiggle";
import { cn } from "@/lib/utils";
import type { IndexQuote } from "@/types/domain";

function formatIndex(value: number): string {
  return value.toLocaleString("ko-KR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

// 지수 카드 로딩 스켈레톤 (홈 첫 로딩 시 카드 자리 유지)
export function IndexCardsSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-3">
      {[0, 1].map((i) => (
        <Card key={i}>
          <CardContent className="flex flex-col gap-2 py-3">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-6 w-24" />
            <Skeleton className="h-3 w-20" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// 지수 카드 한 장 — 장중엔 틱 사이 미세 진동 + 등락 배경 플래시 (종목 시세와 동일 연출)
// 등락·등락률도 진동값 기준으로 재계산해 숫자끼리 어긋나지 않게 한다 (표시 전용).
function IndexCard({ index, marketOpen }: { index: IndexQuote; marketOpen: boolean }) {
  const displayValue = useIndexWiggle(index.value, marketOpen);
  // 플래시는 wiggle 잔진동이 아니라 진짜 10초 틱 변화(원값)에만 발동
  const flash = usePriceFlash(index.value);

  const prevClose = index.value - index.change; // 전 개장일 종가 지수
  const displayChange = Math.round((displayValue - prevClose) * 100) / 100;
  const displayPercent =
    prevClose > 0 ? Math.round((displayChange / prevClose) * 10000) / 100 : 0;
  const up = displayChange > 0;
  const down = displayChange < 0;

  return (
    <Card>
      <CardContent className="flex flex-col gap-1 py-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-muted-foreground">{index.name}</span>
          <Sparkline points={index.spark} positive={up} neutral={!up && !down} />
        </div>
        <p
          key={flash.seq}
          className={cn(
            "-mx-1 self-start rounded-md px-1 text-lg font-bold leading-tight tabular-nums",
            up && "text-bull",
            down && "text-bear",
            flash.direction === "up" && "animate-flash-bull-bg",
            flash.direction === "down" && "animate-flash-bear-bg"
          )}
        >
          {formatIndex(displayValue)}
        </p>
        <p
          className={cn(
            "text-xs tabular-nums",
            up && "text-bull",
            down && "text-bear",
            !up && !down && "text-muted-foreground"
          )}
        >
          {up ? "▲" : down ? "▼" : "―"} {formatIndex(Math.abs(displayChange))} (
          {displayPercent > 0 ? "+" : ""}
          {displayPercent}%)
        </p>
      </CardContent>
    </Card>
  );
}

// 시장 지수 카드 (Phase 8, 토스 홈 지수 영역 벤치마킹)
// 나스피(우량+일반) / 나스닥(테마) — 시총가중 체인, 기준 1,000pt
export function IndexCards({
  indices,
  marketOpen,
}: {
  indices: IndexQuote[];
  marketOpen: boolean;
}) {
  if (indices.length === 0) return null;

  return (
    <div className="grid grid-cols-2 gap-3">
      {indices.map((index) => (
        <IndexCard key={index.code} index={index} marketOpen={marketOpen} />
      ))}
    </div>
  );
}
